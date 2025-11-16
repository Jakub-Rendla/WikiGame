// api/hints-gpt.js
// GPT-4o-mini quiz generator (3 questions A/B/C) with multilingual support
// Required env var: OPENAI_API_KEY

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* -------------------------------------------------------------
   MULTILINGUAL GAME PROMPT
------------------------------------------------------------- */
function gamePrompt(language = "cs") {
  const lang = language.trim().toLowerCase();

  return `
Generate EXACTLY 3 quiz question sets from the provided article text.

LANGUAGE RULE:
- All questions and answers MUST be written strictly in: ${lang.toUpperCase()}
- Do NOT auto-translate concepts incorrectly; keep terminology accurate for the language.

FORMAT FOR EACH SET:
Question?
a) option A
b) option B
c) option C

STRICT REQUIREMENTS:
- Exactly 3 sets.
- Exactly 1 question + exactly 3 answer options (a/b/c) per set.
- Mark the correct answer by adding "(ano)" at the end.
- Wrong answers must be plausible but incorrect.
- Questions must be short, factual, and based entirely on the provided text.
- DO NOT number the sets.
- DO NOT add explanations, comments, markdown, empty lines or anything else.
- Keep output plain text.
`.trim();
}

/* -------------------------------------------------------------
   HANDLER: GPT-4o-mini
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[GPT-HINTS] Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // Parse JSON body
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

    // language fallback = Czech
    const lang = (typeof language === "string" ? language : "cs").trim().toLowerCase();

    // Limit input size
    const MAX_INPUT = 5000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(lang);
    const user = `
Text of the article in ${lang}:
"""${ctx}"""

Generate exactly 3 question sets following the strict rules.
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
        reasoning: { effort: "medium" },
        input: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ],
        max_output_tokens: 300,
        temperature: 0.4
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[GPT-HINTS] OpenAI error:", r.status, errText.slice(0, 200));
      return res.status(r.status).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json().catch(e => {
      console.error("[GPT-HINTS] JSON parse fail", e);
      return null;
    });

    const text = data?.output_text?.trim() || "";

    return res.status(200).json({ hints: text, mode: "game", language: lang });

  } catch (err) {
    console.error("[GPT-HINTS] fatal", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.toString()
    });
  }
}
