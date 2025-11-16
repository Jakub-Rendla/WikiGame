// api/hints-gpt-single.js
// Single-question generator with:
// - random slicing
// - title filter
// - numeric similarity filter
// - strict JSON output
// - GPT-4o-mini

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
   Title + number filtering
------------------------------------------------------------- */
function extractNumber(str) {
  const m = str.match(/-?\d+(?:[\.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const t = title.toLowerCase();

  // title filter
  for (const ans of obj.answers) {
    if (ans.toLowerCase().includes(t)) return false;
  }

  // numeric similarity filter
  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];

  if (correct !== null) {
    for (let i = 0; i < nums.length; i++) {
      if (i === obj.correctIndex) continue;
      const fake = nums[i];
      if (fake === null) continue;

      const diff = Math.abs(fake - correct);
      const rel = diff / Math.max(1, Math.abs(correct));

      // reject if too close (±10 or ±10%)
      if (diff < 10 || rel < 0.10) return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------
   Build prompt
------------------------------------------------------------- */
function buildPrompt(lang, title) {
  return `
Generate ONE quiz question in STRICT JSON format.

OUTPUT MUST BE:
{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

RULES:
- Use ONLY the supplied article text.
- Avoid trivial or obvious facts from the first sentences.
- The correct answer MUST NOT be the article title: "${title}".
- No answer option may contain the article title (even in declined form).
- If the correct answer is numeric (year, %, count), fake answers must differ substantially.
  Avoid nearly identical numeric values (±10 units or ±10%).
- 3 answers total, short, factual, plausible.
- No invented facts.
- NO markdown, NO comments.

Language: ${lang}
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
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
    const systemPrompt = buildPrompt(lang, title);

    const userPrompt = `
ARTICLE TEXT:
"""${chosen}"""
`.trim();

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.60,
        max_output_tokens: 180
      })
    });

    const raw = await response.json().catch(() => null);
    if (!raw) return res.status(500).json({ error: "Invalid OpenAI response" });

    if (raw.error) return res.status(500).json({ error: raw.error });

    let text = raw.output?.[0]?.content?.[0]?.text || null;
    if (!text) return res.status(500).json({ error: "No text returned", raw });

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

  } catch (err) {
    return res.status(500).json({ error: "Fatal", details: err.toString() });
  }
}
