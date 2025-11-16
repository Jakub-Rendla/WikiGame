// api/hints-gpt-single.js
// Ultra-fast single-question generator for WikiGame
// Requires: OPENAI_API_KEY

export const config = { runtime: "nodejs" };

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

/* -------------------------------------------------------------
   Build the super-optimized prompt
------------------------------------------------------------- */
function buildPrompt(lang = "cs") {
  return `
Generate ONE quiz question in STRICT JSON format.

LANGUAGE: ${lang}

RULES:
- Use ONLY the supplied article text.
- Do NOT use general knowledge unless explicitly in the article.
- The question must be factual, unambiguous, and specific.
- Provide EXACTLY 3 answers: 1 correct, 2 plausible but wrong.
- Answers must be short (max 80 characters).
- Avoid repeating previously asked topics (cannot be enforced here—just ignore this rule if unclear).
- Avoid trick questions with nearly identical numeric values.
- Do NOT invent details not found in the text.

OUTPUT STRICT JSON:
{
  "question": "...",
  "answers": ["A", "B", "C"],
  "correctIndex": 1
}

NO markdown.
NO extra text.
NO comments.
  `.trim();
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  // Parse body
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {}
  }

  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { lang = "cs", context = "" } = body;

  if (!context.trim()) {
    return res.status(400).json({ error: "Missing context" });
  }

  /* Prepare prompt */
  const systemPrompt = buildPrompt(lang);

  const userPrompt = `
ARTICLE TEXT:
"""${context.slice(0, 9000)}"""
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
        temperature: 0.35
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

  /* ---------------------------------------------------------
     CATCH explicit OpenAI error object
  --------------------------------------------------------- */
  if (raw.error) {
    return res.status(500).json({
      error: "OpenAI model error",
      details: raw.error
    });
  }

  /* ---------------------------------------------------------
     EXTRACT TEXT — Responses API new shape
  --------------------------------------------------------- */
  let text = null;

  try {
    text = raw.output?.[0]?.content?.[0]?.text;
  } catch {}

  if (!text) {
    return res.status(500).json({
      error: "Model did not return usable text",
      raw
    });
  }

  /* ---------------------------------------------------------
     PARSE JSON
  --------------------------------------------------------- */
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
      error: "Invalid structure (answers array missing)",
      parsed
    });
  }

  return res.status(200).json(parsed);
}
