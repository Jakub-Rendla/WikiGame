// api/hints-gpt.js
// GPT-4o-mini quiz generator (10 question sets → JSON) with multilingual support
// Required env: OPENAI_API_KEY

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   GAME PROMPT (MULTILINGUAL, STRICT JSON REQUIRED)
------------------------------------------------------------- */
function gamePrompt(lang = "cs") {
  const L = lang.trim().toLowerCase();

  return `
You are a professional quiz generator.

TASK:
Generate EXACTLY 10 question sets from the provided article text.
Return them STRICTLY as a valid JSON object.

LANGUAGE:
- All questions & answers MUST be written fully in: ${L.toUpperCase()}
- Ensure terminology is correct for the language.
- No English leakage in non-English settings.

STRUCTURE OF EACH SET:
{
  "question": "string",
  "answers": ["A", "B", "C"],
  "correctIndex": 0|1|2
}

STRICT RULES:
- Exactly 10 sets in the array "questions".
- Each question must be short, factual, based only on the article.
- Wrong answers MUST be plausible, not random noise.
- No trick questions, no extremely close numeric values.
- Avoid asking about trivial calendar facts (e.g., "Which day is July 5?").
- Favor well-defined facts (people, dates, locations, properties, meanings).

JSON OUTPUT FORMAT (NO PREAMBLE, NO MARKDOWN):
{
  "questions": [
    {
      "question": "...",
      "answers": ["a","b","c"],
      "correctIndex": 0
    }
  ]
}

OUTPUT REQUIREMENTS:
- Output ONLY valid JSON.
- No text before or after JSON.
`.trim();
}

/* -------------------------------------------------------------
   ROBUST JSON EXTRACTOR (handles garbage / wrappers / noise)
------------------------------------------------------------- */
function extractJSONObject(str) {
  const match = str.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
}

/* -------------------------------------------------------------
   MAIN HANDLER
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

    /* ---- API KEY ---- */
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[GPT-HINTS] Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    /* ---- Parse body ---- */
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { context, language } = body;
    if (!context || typeof context !== "string") {
      return res.status(400).json({ error: 'Missing "context"' });
    }

    const lang = (typeof language === "string" ? language : "cs").trim().toLowerCase();

    /* ---- Input limit ---- */
    const MAX_INPUT = 7000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    /* ---- Compose prompts ---- */
    const system = gamePrompt(lang);
    const user = `
Here is the article text in ${lang}:
"""${ctx}"""
Generate the required JSON object with exactly 10 question sets.
`.trim();

    /* ---------------------------------------------------------
       CALL OPENAI GPT-4o-MINI
    --------------------------------------------------------- */
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ],
        max_output_tokens: 750,
        temperature: 0.35
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      console.error("[GPT-HINTS] OpenAI error:", r.status, raw.slice(0, 300));
      return res.status(r.status).json({
        error: "OpenAI error",
        raw: raw.slice(0, 500)
      });
    }

    /* ---------------------------------------------------------
       PARSE RAW RESPONSE → extract JSON safely
    --------------------------------------------------------- */
    let parsed = null;

    // Option 1: try as JSON (if model returned a wrapper)
    try {
      const top = JSON.parse(raw);
      if (top.output_text) parsed = extractJSONObject(top.output_text);
      else if (Array.isArray(top.output) && top.output[0]?.content)
        parsed = extractJSONObject(top.output[0].content);
    } catch (_) {
      // ignore; move to fallback
    }

    // Option 2: extract JSON anywhere in raw text
    if (!parsed) parsed = extractJSONObject(raw);

    if (!parsed) {
      console.error("[GPT-HINTS] No JSON object found in output.");
      return res.status(500).json({
        error: "Invalid JSON returned by model",
        raw: raw.slice(0, 600)
      });
    }

    /* ---------------------------------------------------------
       VALIDATE JSON SHAPE
    --------------------------------------------------------- */
    if (!Array.isArray(parsed.questions)) {
      return res.status(500).json({
        error: "JSON missing 'questions' array",
        parsed
      });
    }

    /* ---------------------------------------------------------
       SUCCESS
    --------------------------------------------------------- */
    return res.status(200).json({
      ok: true,
      language: lang,
      count: parsed.questions.length,
      questions: parsed.questions
    });

  } catch (err) {
    console.error("[GPT-HINTS] Fatal:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.toString()
    });
  }
}
