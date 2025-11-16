// api/hints-gemini-single.js
// Single-question generator for Gemini 2.0 Flash-Lite
// Produces 1 question in strict JSON form
// Compatible with WikiGame new parallel architecture

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
   Strict JSON question prompt
------------------------------------------------------------- */
function strictJSONPrompt(lang = "cs") {
  return `
Vygeneruj PŘESNĚ jednu otázku z dodaného textu.

VÝSTUP MUSÍ BÝT PŘESNÝ JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

PRAVIDLA:
- Použij JEN fakta z textu.
- Vyber NE zjevnou informaci — ne něco z prvního odstavce.
- Vytvoř tři možnosti: 1 správná, 2 věrohodné falešné.
- Správnou dej na pozici correctIndex.
- Žádný markdown, žádné komentáře, žádné \`\`\`.
- Bez úvodů nebo shrnutí.

Jazyk: ${lang}

`.trim();
}

/* -------------------------------------------------------------
   Random slice for variety
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
   Strip unwanted wrappers (Gemini likes to wrap JSON in text)
------------------------------------------------------------- */
function extractJSON(text) {
  let cleaned = text.trim();

  cleaned = cleaned
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // find longest {...} block
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

    /* Parse JSON body */
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    const { context = "", lang = "cs" } = body;

    if (!context || typeof context !== "string") {
      return res.status(400).json({ error: 'Missing "context" string' });
    }

    /* Random slice */
    const chosen = pickSlice(context);

    /* Prompts */
    const system = strictJSONPrompt(lang);
    const user = `ZDE JE TEXT:\n"""${chosen}"""\nVrať pouze JSON.`;

    /* Gemini API call */
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: system }] },
          { role: "user", parts: [{ text: user }] }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 200
        }
      })
    });

    const raw = await r.json().catch(() => null);

    if (!raw) {
      return res.status(500).json({ error: "Invalid Gemini response" });
    }

    let text =
      raw?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("")
        ?.trim() || "";

    text = extractJSON(text);

    let obj;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      return res.status(500).json({
        error: "Invalid JSON returned by Gemini",
        rawText: text
      });
    }

    if (
      !obj ||
      typeof obj.question !== "string" ||
      !Array.isArray(obj.answers)
    ) {
      return res.status(500).json({
        error: "Invalid structure from Gemini",
        parsed: obj
      });
    }

    return res.status(200).json(obj);

  } catch (e) {
    return res.status(500).json({
      error: "Internal error",
      details: e.toString()
    });
  }
}
