// api/hints-gpt.js
// GPT-4o-mini quiz generator (7 sets → JSON)
// Ready for multilingual Webflow integration
// Required: OPENAI_API_KEY

export const config = { runtime: "nodejs" };

function setCors(res, origin="*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   MULTILINGUAL PROMPT
------------------------------------------------------------- */
function buildPrompt(lang="cs") {
  return `
Generate EXACTLY 7 quiz question sets in STRICT JSON format.

LANGUAGE: ${lang}

RULES:
- Use ONLY facts visible in the provided article text.
- Do NOT invent unrelated global facts.
- Avoid questions with confusingly similar numeric options.
- Avoid overly broad or general questions.
- Avoid repeating question topics.
- Make questions factual, specific, clear.
- Answers must be short.
- Provide exactly 3 answer options.
- Only ONE correct answer.

OUTPUT FORMAT (STRICT):

{
  "questions": [
    {
      "question": "…",
      "answers": ["A", "B", "C"],
      "correctIndex": 0
    },
    ...
  ]
}

DO NOT add commentary, markdown, quotes, or text outside JSON.
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

  const { lang="cs", context="" } = body;

  if (!context.trim()) {
    return res.status(400).json({ error: "Missing context" });
  }

  /* --------------------- PROMPTS ---------------------- */
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
        model: "gpt-4o-mini-2024-07-18-fast", // can switch to non-fast if needed
        input: [
          { role:"system", content: systemPrompt },
          { role:"user",   content: userPrompt }
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
    return res.status(500).json({ error: "Invalid OpenAI response" });
  }

  /* ---------------------------------------------------------
     ROBUST OUTPUT EXTRACTION (covers all OpenAI formats)
  --------------------------------------------------------- */

  let text = null;

  try {
    // Format A: modern → output[0].content[].text (most common)
    const content = raw.output?.[0]?.content;
    if (Array.isArray(content)) {
      const found = content.find(c => c.type === "output_text");
      if (found?.text) text = found.text;
    }

    // Format B: fallback → raw.output_text
    if (!text && typeof raw.output_text === "string") {
      text = raw.output_text;
    }

    // Format C: legacy → raw.output[0].content[0].text
    if (!text && raw.output?.[0]?.content?.[0]?.text) {
      text = raw.output[0].content[0].text;
    }

  } catch (err) {
    return res.status(500).json({
      error: "Error extracting text from model",
      raw
    });
  }

  if (!text) {
    return res.status(500).json({
      error: "Model did not return usable text",
      raw
    });
  }

  /* ---------------------------------------------------------
     PARSE JSON SAFELY
  --------------------------------------------------------- */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return res.status(500).json({
      error: "Invalid JSON returned by model",
      raw: text
    });
  }

  if (!parsed || !Array.isArray(parsed.questions)) {
    return res.status(500).json({
      error: "`questions` array missing in JSON",
      parsed
    });
  }

  /* ---------------------- SUCCESS ---------------------- */
  return res.status(200).json({
    questions: parsed.questions,
    count: parsed.questions.length,
    lang
  });
}
