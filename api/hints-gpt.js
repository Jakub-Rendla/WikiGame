// api/hints-gpt.js
// GPT-4o-mini → 10 quiz sets → JSON output → Topic-focused questions

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   MULTILINGUAL + TOPIC-FOCUSED GAME PROMPT (STRICT JSON)
------------------------------------------------------------- */
function gamePrompt(language = "cs") {
  const lang = language.trim().toLowerCase();

  return `
You generate quiz questions **strictly based on the provided article**.

LANGUAGE:
- All output MUST be written strictly in: ${lang.toUpperCase()}.

OUTPUT FORMAT (VERY STRICT):
Return ONLY valid JSON in this exact structure:

{
  "questions": [
    {
      "question": "string",
      "answers": ["A","B","C"],
      "correctIndex": 0
    },
    ...
    (10 items total)
  ]
}

NO extra text. No markdown. No commentary. No trailing commas.


======================================================
   RULES ABOUT QUESTION RELEVANCE (VERY IMPORTANT)
======================================================

1) **Questions must be ONLY about specific facts in the article.**
   - Questions must be directly tied to the main subject of the article.
   - Use only concrete facts explicitly found in the article text.

2) **NEVER generate questions about general concepts** that appear only incidentally.
   Forbidden examples:
     - generic history / geology / biology
     - definitions (e.g. "What is history?")
     - general periods (e.g. "What is the Early Modern Age?")
     - general language or science questions
     - anything that could fit ANY article

3) **Avoid vague or overly broad questions.**
   - Prefer specific events, names, dates, terms, locations, facts.
   - Prefer concrete details over abstractions.

4) **Questions must be diverse.**
   - Avoid repeating similar patterns.
   - Each question should touch a different specific aspect of the article.

5) **Answers must be plausible.**
   - Wrong answers must be believable, not random.

6) **Correct answer must be 100% extractable from the article.**
   - No guessing.
   - No outside knowledge unless it's extremely basic background required for clarity.

7) **You MUST produce exactly 10 question objects.**

======================================================

Now generate the JSON.
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
       BODY
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

    // Trim input for speed
    const MAX_INPUT = 7000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(lang);

    const user = `
Text článku v jazyce ${lang}:
"""${ctx}"""

Vrať pouze JSON podle přísného formátu výše.
    `.trim();

    /* ----------------------------------------------
       CALL OPENAI
    ---------------------------------------------- */
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": \`Bearer \${apiKey}\`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ],
        temperature: 0.4,
        max_output_tokens: 800
      })
    });

    if (!r.ok) {
      const errorTxt = await r.text().catch(() => "");
      console.error("[GPT-HINTS] OpenAI error:", r.status, errorTxt);
      return res.status(r.status).json({ error: "OpenAI error", details: errorTxt });
    }

    const data = await r.json().catch(e => {
      console.error("[GPT-HINTS] OpenAI JSON parse fail", e);
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
      console.error("[GPT-HINTS] Model returned empty output", data);
      return res.status(200).json({ error: "empty_output", raw: data });
    }

    /* ----------------------------------------------
       PARSE JSON INSIDE RAW
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
       VALIDATE
    ---------------------------------------------- */
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      console.error("[GPT-HINTS] JSON missing questions[]:", parsed);
      return res.status(200).json({
        error: "missing_questions_array",
        parsed
      });
    }

    if (parsed.questions.length !== 10) {
      console.warn("[GPT-HINTS] Wrong number of questions:", parsed.questions.length);
    }

    /* ----------------------------------------------
       OUTPUT FOR WEBFLOW
    ---------------------------------------------- */
    return res.status(200).json({
      sets: parsed.questions,
      mode: "game",
      language: lang
    });

  } catch (err) {
    console.error("[GPT-HINTS] Fatal:", err);
    return res.status(500).json({
      error: "fatal",
      details: err.toString()
    });
  }
}
