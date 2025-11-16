// api/hints-gpt.js
// GPT-4o-mini JSON quiz generator (10 sets → Webflow picks best 3)
// Required: OPENAI_API_KEY in Vercel → Project → Settings → Environment Variables

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   JSON GAME PROMPT – 10 UNIQUE SETS
------------------------------------------------------------- */
function gamePrompt(language = "cs") {
  const lang = language.trim().toLowerCase();

  return `
You are generating JSON output ONLY.

Generate EXACTLY 10 unique, high-quality quiz questions based ONLY on the provided article text.

LANGUAGE:
- ALL text must be strictly in: ${lang.toUpperCase()}.

CONTENT RULES:
- Each question must be meaningful, factual and based on important information in the article.
- All 10 questions MUST focus on different aspects of the article.
- Avoid trivial questions with obvious answers.
- Avoid overly difficult numeric-only questions (sizes, distances, exact dates, rankings).
- Avoid hyper-specific details or single-sentence trivia.
- Prefer questions about people, places, events, concepts, relationships.
- Avoid repeating the same question phrasing or topic across sets.

ANSWER RULES:
Each question must have EXACTLY 3 answer options:
- 1 correct answer → mark it with "(ano)" at the end.
- 2 incorrect but plausible distractors of the SAME TYPE (person→people, country→countries, year→years).
- Distractors must be realistic and relevant.
- Distractors must NOT be:
    - too similar (e.g., tiny number differences)
    - obviously absurd
    - copies of the correct answer

OUTPUT FORMAT (JSON ONLY):
{
  "questions": [
    {
      "question": "text",
      "answers": ["A", "B (ano)", "C"]
    },
    ...
    (10 total)
  ]
}

STRICT:
- Output MUST be valid JSON.
- Do NOT include backticks.
- Do NOT include markdown.
- Do NOT include explanations.
- Do NOT include additional text before or after JSON.
`.trim();
}

/* -------------------------------------------------------------
   HANDLER: GPT-4o-mini → JSON parsing → Ready for Webflow
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

    // Parse body
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { context, language } = body;
    if (!context) {
      return res.status(400).json({ error: 'Missing "context"' });
    }

    const lang = (language || "cs").trim().toLowerCase();

    // Limit long input
    const MAX_INPUT = 8000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(lang);

    const user = `
Here is the article text:
"""${ctx}"""

Return ONLY the JSON structure described in the instructions.
    `.trim();

    /* ---------------------------------------------------------
       CALL OPENAI
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
        max_output_tokens: 600,
        temperature: 0.5
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      console.error("[GPT-HINTS] OpenAI error:", r.status, raw.slice(0, 300));
      return res.status(r.status).json({
        error: "OpenAI error",
        details: raw.slice(0, 400)
      });
    }

    // Parse JSON output
    let parsed;
    try {
      parsed = JSON.parse(raw)?.output_text
        ? JSON.parse(JSON.parse(raw).output_text)
        : JSON.parse(raw);
    } catch (err) {
      console.error("[GPT-HINTS] JSON PARSE FAIL:", err, raw.slice(0, 400));
      return res.status(500).json({
        error: "Invalid JSON returned by model",
        raw: raw.slice(0, 300)
      });
    }

    // Validate structure
    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
      return res.status(500).json({
        error: "Invalid structure (missing questions[])",
        raw: parsed
      });
    }

    // Convert answer list → add correctIndex
    const finalQuestions = parsed.questions.map(set => {
      const q = set.question || "";
      const answers = set.answers || [];

      const index = answers.findIndex(a => a.includes("(ano)"));
      const cleanAnswers = answers.map(a => a.replace("(ano)", "").trim());

      return {
        question: q,
        answers: cleanAnswers,
        correctIndex: index === -1 ? 0 : index
      };
    });

    return res.status(200).json({
      mode: "game",
      language: lang,
      questions: finalQuestions
    });

  } catch (err) {
    console.error("[GPT-HINTS] fatal", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.toString()
    });
  }
}
