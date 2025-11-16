// api/hints-gemini-single.js
// Gemini version with:
// - random slice
// - title filter
// - numeric similarity filter
// - strict JSON parsing

export const config = { runtime: "nodejs" };

import crypto from "crypto";

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   Filters
------------------------------------------------------------- */
function extractNumber(str) {
  const m = str.match(/-?\d+(?:[\.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const t = title.toLowerCase();

  for (const ans of obj.answers)
    if (ans.toLowerCase().includes(t)) return false;

  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];

  if (correct !== null) {
    for (let i = 0; i < nums.length; i++) {
      if (i === obj.correctIndex) continue;
      const fake = nums[i];
      if (fake === null) continue;

      const diff = Math.abs(fake - correct);
      const rel = diff / Math.max(1, Math.abs(correct));

      if (diff < 10 || rel < 0.10) return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------
   Prompt
------------------------------------------------------------- */
function strictJSONPrompt(lang, title) {
  return `
Vygeneruj PŘESNĚ jednu otázku jako STRICT JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

PRAVIDLA:
- Správná odpověď NIKDY nesmí být název článku: "${title}".
- Žádná možnost odpovědi nesmí obsahovat název článku.
- Nepoužívej trivia z prvního odstavce.
- Pokud je správná odpověď číslo, falešné odpovědi musí být výrazně odlišné.
  Vyhni se číslům blízkým správné hodnotě (±10 jednotek nebo ±10 %).
- Tři možnosti, 1 správná, dvě věrohodné.
- Žádné markdown, žádné komentáře.

Jazyk: ${lang}
`.trim();
}

/* -------------------------------------------------------------
   Random slice
------------------------------------------------------------- */
function pickSlice(full) {
  const len = full.length;
  if (len < 3500) return full;

  if (Math.random() < 0.5) return full;

  const sliceLen = 3000 + Math.floor(Math.random() * 600);
  const maxStart = Math.max(0, len - sliceLen);
  const start = Math.floor(Math.random() * maxStart);

  return full.slice(start, start + sliceLen);
}

/* -------------------------------------------------------------
   JSON extraction from Gemini wrappers
------------------------------------------------------------- */
function extractJSON(text) {
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

/* -------------------------------------------------------------
   HANDLER
------------------------------------------------------------- */
export default async function handler(req, res) {
  try {
    const origin = req.headers?.origin || "*";

    if (req.method === "OPTIONS") {
      setCors(res, origin);
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      setCors(res, origin);
      return res.status(200).json({ ok: true, info: "Use POST" });
    }

    setCors(res, origin);

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GOOGLE_API_KEY" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    const { context = "", lang = "cs", title = "" } = body;

    if (!context) {
      return res.status(400).json({ error: "Missing context" });
    }

    const chosen = pickSlice(context);
    const system = strictJSONPrompt(lang, title);
    const user = `ZDE JE TEXT:\n"""${chosen}"""\nVrať pouze JSON.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: system }] },
          { role: "user", parts: [{ text: user }] }
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
      })
    });

    const data = await r.json().catch(() => null);
    if (!data) return res.status(500).json({ error: "Invalid Gemini response" });

    let text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("")
        ?.trim() || "";

    text = extractJSON(text);

    let obj;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({ error: "Invalid JSON", rawText: text });
    }

    if (!validateAnswers(obj, title)) {
      return res.status(500).json({ error: "Answer validation failed", obj });
    }

    return res.status(200).json(obj);

  } catch (e) {
    return res.status(500).json({ error: "Internal error", details: e.toString() });
  }
}
