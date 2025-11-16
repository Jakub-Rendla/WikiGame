// api/hints-gpt.js
// GPT-4o-mini quiz generator (10 sets → JSON)
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
Generate EXACTLY 10 quiz question sets in JSON format.

LANGUAGE: ${lang}

REQUIREMENTS:
- Each question must be based ONLY on the provided article.
- No generic background knowledge unless present in article.
- Focus on specific factual details, not broad or universal facts.
- Avoid trick questions with too similar numeric values.
- Avoid repeating question topics.
- Avoid questions unrelated to the article's theme.

OUTPUT STRICTLY AS VALID JSON:

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

NO extra text, no explanation, no markdown.
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

  /* Prepare prompt */
  const systemPrompt = buildPrompt(lang);

  const userPrompt = `
ARTICLE TEXT (keep only essential meaning):
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
        model: "gpt-4o-mini-2024-07-18",
        input: [
          { role:"system", content: systemPrompt },
          { role:"user",   content: userPrompt }
        ],
        max_output_tokens: 900,
        temperature: 0.35
      })
    });
  } catch (err) {
    return res.status(500).json({ error: "Connection to OpenAI failed", details: err });
  }

  const raw = await response.json().catch(()=>null);

  if (!raw) {
    return res.status(500).json({ error: "Invalid OpenAI response" });
  }

  /* ---------------------------------------------------------
     EXTRACT JSON FROM output[0].content[0].text
  --------------------------------------------------------- */
  let text;
  try {
    text = raw.output?.[0]?.content?.[0]?.text;
  } catch {}

  if (!text) {
    return res.status(500).json({ error: "Model did not return output_text", raw });
  }

  /* Parse JSON */
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
      error: "`questions` array missing in returned JSON",
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
