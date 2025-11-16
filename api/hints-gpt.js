// api/hints-gpt.js
// GPT-4o-mini → 10 question sets → clean JSON → stable output

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   MULTILINGUAL GAME PROMPT (JSON OUTPUT)
------------------------------------------------------------- */
function gamePrompt(language = "cs") {
  const lang = language.trim().toLowerCase();

  return `
Generate **exactly 10** quiz question sets from the provided article text.

LANGUAGE:
- All output MUST be written strictly in: ${lang.toUpperCase()}.

OUTPUT FORMAT:
Return ONLY valid JSON in this format:

{
  "questions": [
    {
      "question": "string",
      "answers": ["A","B","C"],
      "correctIndex": 0
    },
    ...
    (10 items)
  ]
}

RULES:
- Exactly 10 items in "questions" array — no more, no less.
- Each item must contain:
    • "question" (short factual question)
    • "answers": array of 3 strings
    • "correctIndex": index of correct answer (0/1/2)
- Wrong answers must be plausible but incorrect.
- NO explanations, NO markdown, NO commentary.
- JSON must be valid, no trailing commas.
- Questions MUST be based ONLY on provided article text.
`.trim();
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

    /* ----------------------------------------------
       ENV VAR CHECK
    ---------------------------------------------- */
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[GPT-HINTS] Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    /* ----------------------------------------------
       BODY PARSING
    ---------------------------------------------- */
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

    const lang = (typeof language === "string" ? language : "cs")
      .trim()
      .toLowerCase();

    const MAX_INPUT = 5000;
    const ctx =
      context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(lang);

    const user = `
Text v jazyce ${lang}:
"""${ctx}"""

GENERUJ JSON (10 otázek).
    `.trim();

    /* ----------------------------------------------
       CALL OPENAI
    ---------------------------------------------- */
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ],
        temperature: 0.35,
        max_output_tokens: 750
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[GPT-HINTS] OpenAI error:", r.status, errText);
      return res.status(r.status).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json().catch(e => {
      console.error("[GPT-HINTS] FAILED JSON:", e);
      return null;
    });

    /* ----------------------------------------------
       EXTRACT RAW MODEL OUTPUT
    ---------------------------------------------- */
    const rawText =
      data?.output?.[0]?.content?.[0]?.text ||
      data?.output_text ||
      "";

    if (!rawText) {
      console.error("[GPT-HINTS] Empty model output:", data);
      return res.status(200).json({ error: "Empty output", raw: data });
    }

    /* ----------------------------------------------
       PARSE JSON (INSIDE TEXT)
    ---------------------------------------------- */
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error("[GPT-HINTS] JSON parse error:", e, rawText.slice(0, 250));
      return res.status(200).json({
        error: "invalid_json_in_raw",
        raw: rawText
      });
    }

    /* ----------------------------------------------
       VALIDATE STRUCTURE
    ---------------------------------------------- */
    if (!parsed || !parsed.questions || !Array.isArray(parsed.questions)) {
      console.error("[GPT-HINTS] JSON missing 'questions':", parsed);
      return res.status(200).json({
        error: "JSON missing 'questions' array",
        parsed
      });
    }

    /* ----------------------------------------------
       OK — return for Webflow
    ---------------------------------------------- */
    return res.status(200).json({
      sets: parsed.questions,
      mode: "game",
      language: lang
    });

  } catch (err) {
    console.error("[GPT-HINTS] Fatal error:", err);
    return res.status(500).json({
      error: "internal_server_error",
      details: err.toString()
    });
  }
}
