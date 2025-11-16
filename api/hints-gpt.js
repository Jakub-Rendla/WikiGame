// api/hints-gpt.js
// GPT-4o-mini JSON quiz generator (10 sets → Webflow picks 3)
// Required: OPENAI_API_KEY in Vercel → Project → Settings → Environment Variables

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   GAME PROMPT – GENERATE 10 UNIQUE QUESTION SETS IN JSON
------------------------------------------------------------- */
function gamePrompt(language = "cs") {
  const lang = language.trim().toLowerCase();

  return `
You generate JSON ONLY.

Produce EXACTLY 10 unique, high-quality quiz question sets based ONLY on the provided article.

LANGUAGE:
- All text MUST be strictly in: ${lang.toUpperCase()}.

QUESTION RULES:
- Questions must be meaningful, factual, and based on important information in the article.
- All 10 questions must cover DIFFERENT aspects of the topic.
- Avoid trivial questions with obvious answers.
- Avoid numeric-only questions (exact sizes, distances, rankings, tiny number differences).
- Avoid hyper-specific or low-value facts.
- Prefer people, places, events, concepts, relationships.
- Avoid repeating the same phrasing or topic.

ANSWER RULES:
Each set contains:
- 1 question
- 3 answers (a/b/c)
- Exactly 1 correct answer → marked with "(ano)"
- 2 distractors of SAME TYPE (country→countries, person→people, year→years)
- Distractors must be plausible, realistic, and not absurd.
- DO NOT create distractors that differ only by tiny numbers.
- DO NOT repeat the same entity.

OUTPUT FORMAT (MUST be valid JSON):
{
  "questions": [
    {
      "question": "text",
      "answers": [
        "option A",
        "option B (ano)",
        "option C"
      ]
    },
    ...
    (10 items)
  ]
}

STRICT:
- Output JSON ONLY.
- No markdown.
- No backticks.
- No explanations.
- No text before or after JSON.
`.trim();
}

/* -------------------------------------------------------------
   API HANDLER (robust OpenAI Responses API parser)
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
      return res.status(200).json({ ok: true, info: "POST required" });
    }

    setCors(res, origin);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[GPT-HINTS] Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    /* -------------------------------
       Parse body
    -------------------------------- */
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

    const lang = (language || "cs").trim().toLowerCase();

    // Limit input for cost/perf
    const MAX_INPUT = 8000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(lang);
    const user = `
Here is the article text:
"""${ctx}"""

Return ONLY the JSON object described in the instructions.
    `.trim();

    /* -------------------------------
       OpenAI Call (Responses API)
    -------------------------------- */
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
        max_output_tokens: 600,
        temperature: 0.5
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      console.error("[GPT-HINTS] OpenAI Error:", r.status, raw.slice(0, 300));
      return res.status(r.status).json({
        error: "OpenAI error",
        details: raw.slice(0, 400)
      });
    }

    /* -------------------------------------------------------
       UNIVERSAL PARSER — supports all OpenAI formats
    ------------------------------------------------------- */
    let parsed;
    try {
      const json = JSON.parse(raw);

      // Case A: output_text
      if (json.output_text) {
        parsed = JSON.parse(json.output_text);
      }
      // Case B: output[0].content
      else if (Array.isArray(json.output) && json.output[0]?.content) {
        parsed = JSON.parse(json.output[0].content);
      }
      // Case C: already-parsed JSON
      else if (json.questions) {
        parsed = json;
      }
      else {
        throw new Error("Unexpected OpenAI output format");
      }

    } catch (err) {
      console.error("[GPT-HINTS] PARSE FAIL:", err, raw.slice(0, 300));
      return res.status(500).json({
        error: "Invalid JSON returned by model",
        raw: raw.slice(0, 200)
      });
    }

    /* -------------------------------------------------------
       Validate Questions
    ------------------------------------------------------- */
    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
      return res.status(500).json({
        error: "Missing questions[] in response",
        raw: parsed
      });
    }

    /* -------------------------------------------------------
       Convert answers → add correctIndex
    ------------------------------------------------------- */
    const finalQuestions = parsed.questions.map(set => {
      const q = set.question || "";
      const answers = set.answers || [];

      const correctIndex = answers.findIndex(a => a.includes("(ano)"));
      const cleanAnswers = answers.map(a => a.replace("(ano)", "").trim());

      return {
        question: q,
        answers: cleanAnswers,
        correctIndex: correctIndex === -1 ? 0 : correctIndex
      };
    });

    return res.status(200).json({
      mode: "game",
      language: lang,
      questions: finalQuestions
    });

  } catch (err) {
    console.error("[GPT-HINTS] FATAL:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.toString()
    });
  }
}
