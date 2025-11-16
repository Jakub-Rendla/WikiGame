// api/hints-gpt.js
// GPT-4o-mini quiz generator (10 question sets) with strict JSON output
// Requires env: OPENAI_API_KEY

export const config = { runtime: "nodejs" };

// -------------------------------------------------------------
// CORS
// -------------------------------------------------------------
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// -------------------------------------------------------------
// SYSTEM PROMPT GENERATOR
// -------------------------------------------------------------
function gamePrompt(lang = "cs") {
  const L = lang.trim().toLowerCase();

  return `
You are a quiz generator for the WikiGame.

TASK:
- Create EXACTLY 10 question sets.
- Each set must contain:
  {
    "question": "...",
    "answers": ["A","B","C"],
    "correctIndex": 0|1|2
  }

LANGUAGE RULE:
- ALL content (questions + answers) must be written strictly in: ${L.toUpperCase()}.
- Do NOT translate incorrectly.
- Stay STRICTLY within facts mentioned in the provided article excerpt.
- If the article is about sub-topic X, DO NOT drift into global/general topic Y.

QUESTION RULES:
- Must be factual, relevant, short, and derived solely from the given article.
- Avoid overly generic questions not grounded in the text.
- Avoid overly detailed numeric comparisons (e.g., 1–3 %, 2–4 %, etc.)
- Avoid trick questions.

ANSWER RULES:
- Provide 3 options (A, B, C).
- EXACTLY ONE must be correct.
- Wrong answers must be plausible but clearly incorrect.
- No formatting, no markdown.

OUTPUT:
Return STRICT VALID JSON:
{
  "questions": [ ... 10 sets ... ]
}
`.trim();
}

// -------------------------------------------------------------
// HANDLER
// -------------------------------------------------------------
export default async function handler(req, res) {
  try {
    const origin = req.headers?.origin || "*";

    // OPTIONS (preflight)
    if (req.method === "OPTIONS") {
      setCors(res, origin);
      return res.status(204).end();
    }

    // ⭐ CORS MUST BE ENABLED FOR ALL RESPONSES ⭐
    setCors(res, origin);

    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "Use POST" });
    }

    // Parse JSON body
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { context, lang } = body;

    if (!context || typeof context !== "string") {
      return res.status(400).json({ error: 'Missing "context"' });
    }

    // default language = cs
    const L = (typeof lang === "string" ? lang : "cs").trim().toLowerCase();

    // input length guardrail
    const MAX_INPUT = 6000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(L);
    const user = `
ARTICLE TEXT (${L}):
"""${ctx}"""
    `.trim();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[GPT-HINTS] Missing OPENAI_API_KEY!");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // ---------------------------------------------------------
    // OPENAI CALL (Responses API)
    // ---------------------------------------------------------
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_output_tokens: 900,
        temperature: 0.35,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const rawText = await response.text();

    if (!response.ok) {
      console.error("[GPT-HINTS] OpenAI error:", response.status, rawText.slice(0, 400));
      return res.status(response.status).json({
        error: "OpenAI error",
        details: rawText
      });
    }

    // ---------------------------------------------------------
    // PARSE MODEL OUTPUT
    // ---------------------------------------------------------
    let parsed;
    try {
      // output_text = already extracted plain text
      const json = JSON.parse(rawText);
      const out = json?.output_text;

      if (!out) {
        return res.status(500).json({
          error: "Model did not return output_text",
          raw: json
        });
      }

      parsed = JSON.parse(out);
    } catch (err) {
      console.error("[GPT-HINTS] JSON parse fail:", err);
      return res.status(500).json({
        error: "Invalid JSON returned by model",
        raw: rawText
      });
    }

    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
      return res.status(500).json({
        error: "JSON missing 'questions' array",
        parsed
      });
    }

    // ---------------------------------------------------------
    // SUCCESS
    // ---------------------------------------------------------
    return res.status(200).json({
      ok: true,
      lang: L,
      questions: parsed.questions
    });

  } catch (err) {
    console.error("[GPT-HINTS] Fatal error:", err);
    return res.status(500).json({
      error: "Server failure",
      details: err?.toString()
    });
  }
}
