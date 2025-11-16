// api/hints-gpt-single.js
// Ultra-fast single-question generator for WikiGame
// Random text slicing + higher temperature = more variety

export const config = { runtime: "nodejs" };

import crypto from "crypto";

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   Build prompt
------------------------------------------------------------- */
function buildPrompt(lang = "cs") {
  return `
Generate ONE quiz question in STRICT JSON format.

LANGUAGE: ${lang}

RULES:
- Use ONLY the supplied article text.
- The question must be meaningful and based on non-trivial details.
- Avoid obvious or superficial facts from first sentences.
- Provide EXACTLY 3 answers: 1 correct, 2 plausible but wrong.
- Keep answers under 80 characters.
- Avoid nearly identical numeric answers.
- Avoid overly generic or universally true statements.
- No invented details.

OUTPUT STRICT JSON:
{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

NO markdown.
NO extra text.
NO commentary.
  `.trim();
}

/* -------------------------------------------------------------
   Pick random text slice for variety
------------------------------------------------------------- */
function pickSlice(full) {
  const len = full.length;

  // If short, return full
  if (len < 4000) return full;

  // 50% full, 50% slice
  if (Math.random() < 0.5) return full;

  const sliceLen = 3200 + Math.floor(Math.random() * 400); // 3200–3600 chars
  const maxStart = Math.max(0, len - sliceLen);
  const start = Math.floor(Math.random() * maxStart);

  return full.slice(start, start + sliceLen);
}

/* -------------------------------------------------------------
   HANDLER
------------------------------------------------------------- */
export default async function handler(req, res) {
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

  // Check API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  // Parse JSON body
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {}
  }

  const { lang = "cs", context = "" } = body;

  if (!context.trim()) {
    return res.status(400).json({ error: "Missing context" });
  }

  /* Prepare prompts */
  const systemPrompt = buildPrompt(lang);

  // Pick random portion of the article
  const chosenText = pickSlice(context);

  const userPrompt = `
ARTICLE TEXT:
"""${chosenText}"""
  `.trim();

  /* ---------------------------------------------------------
     CALL OPENAI RESPONSES API
  --------------------------------------------------------- */
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
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
        max_output_tokens: 180,
        temperature: 0.60
      })
    });
  } catch (err) {
    return res.status(500).json({
      error: "Connection to OpenAI failed",
      details: err.toString()
    });
  }

  const raw = await response.json().catch(() => null);

  if (!raw) {
    return res.status(500).json({
      error: "Invalid OpenAI response (empty)"
    });
  }

  if (raw.error) {
    return res.status(500).json({
      error: "OpenAI model error",
      details: raw.error
    });
  }

  /* Extract text */
  let text = null;
  try { text = raw.output?.[0]?.content?.[0]?.text; } catch {}

  if (!text) {
    return res.status(500).json({
      error: "Model did not return usable text",
      raw
    });
  }

  /* Parse JSON */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return res.status(500).json({
      error: "Invalid JSON returned by model",
      rawText: text
    });
  }

  if (!parsed || !Array.isArray(parsed.answers)) {
    return res.status(500).json({
      error: "Invalid structure (answers missing)",
      parsed
    });
  }

  return res.status(200).json(parsed);
}
