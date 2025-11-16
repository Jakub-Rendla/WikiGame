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
- Do NOT mistranslate or invent facts. Stay faithful to the provided article.

FORMAT FOR EACH SET:
Question?
a) option A
b) option B
c) option C

STRICT RULES:
- Exactly 3 sets.
- Exactly 1 question + exactly 3 answers per set.
- Mark the correct answer by adding "(ano)" at the end.
- Wrong answers must be plausible but incorrect.
- No numbering, no markdown, no empty lines.
- Output must be plain text only.
`.trim();
}

/* -------------------------------------------------------------
   HANDLER (GPT-4o-mini • chat/completions)
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

    const lang = (typeof language === "string" ? language : "cs")
      .trim().toLowerCase();

    // Limit input
    const MAX_INPUT = 5000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = gamePrompt(lang);
    const user = `
Text of the article in ${lang}:
"""${ctx}"""

Generate exactly 3 question sets following the strict rules.
    `.trim();

    /* ---------------------------------------------------------
       CALL GPT-4o-mini (correct endpoint)
    --------------------------------------------------------- */
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user",   content: user }
        ],
        max_tokens: 300,
        temperature: 0.4
      })
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("[GPT-HINTS] OpenAI error:", r.status, errText.slice(0, 200));
      return res.status(r.status).json({ error: "OpenAI error", details: errText });
    }

    const data = await r.json().catch(err => {
      console.error("[GPT-HINTS] JSON parse fail", err);
      return null;
    });

    // Extract text properly for GPT-4o-mini
    const text =
      data?.choices?.[0]?.message?.content?.trim() ||
      "";

    return res.status(200).json({
      hints: text,
      mode: "game",
      language: lang
    });

  } catch (err) {
    console.error("[GPT-HINTS] fatal", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.toString()
    });
  }
}
