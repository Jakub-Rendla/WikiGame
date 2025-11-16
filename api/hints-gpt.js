// api/hints-gpt.js
// GPT-4o-mini quiz generator (7 sets → JSON)
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
   MULTILINGUAL PROMPT
------------------------------------------------------------- */
function buildPrompt(lang = "cs") {
  return `
Generate EXACTLY 7 quiz question sets in STRICT JSON format.

LANGUAGE: ${lang}

RULES:
- Questions must be based ONLY on the article.
- Do NOT use general knowledge unless explicitly in article.
- Avoid questions unrelated to the article theme.
- Avoid generic universal facts.
- Avoid trick questions with nearly identical numeric values.
- Avoid repeating question topics.
- Focus on specific, factual details found ONLY inside the given text.
- Answers must all be plausible.
- EXACTLY one correct answer.

OUTPUT STRICTLY AS VALID JSON:
{
  "questions": [
    {
      "question": "...",
      "answers": ["A", "B", "C"],
      "correctIndex": 0
    }
  ]
}

NO markdown.
NO comments.
NO natural language outside JSON.
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
          { role: "user",   content: userPrompt }
        ],
        max_output_tokens: 500,
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
     EXTRACT TEXT — SUPPORT ALL RESPONSE SHAPES
  --------------------------------------------------------- */
  let text = null;

  // new format
  try { text = raw.output?.[0]?.content?.[0]?.text; } catch {}

  // fallback: legacy
  if (!text) try { text = raw.output_text; } catch {}

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

  if (!parsed || !Array.isArray(parsed.questions)) {
    return res.status(500).json({
      error: "`questions` array missing in JSON",
      parsed
    });
  }

  /* SUCCESS */
  return res.status(200).json({
    questions: parsed.questions,
    count: parsed.questions.length,
    lang
  });
}
