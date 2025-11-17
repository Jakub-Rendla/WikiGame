// /api/questions-gpt-gfl-debug.js
// FULL RAW DEBUG — prints GPT + Gemini raw responses + errors

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   PROMPT GPT
------------------------------------------------------------- */
function promptGPT(lang, context) {
  return `
Generate EXACTLY 5 question sets in STRICT JSON.
LANGUAGE: ${lang}
ARTICLE:
${context}
`;
}

/* -------------------------------------------------------------
   PROMPT GEMINI
------------------------------------------------------------- */
function promptGemini(lang, context) {
  return `
Generate EXACTLY 3 question sets in STRICT JSON.
LANGUAGE: ${lang}
ARTICLE:
${context}
`;
}

/* -------------------------------------------------------------
   RAW CALLS (NO FILTERING)
------------------------------------------------------------- */
async function askGPT(prompt) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });
    const j = await res.json();
    return { raw: j, openaiStatus: res.status };
  } catch (err) {
    return { error: String(err) };
  }
}

async function askGemini(prompt) {

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 },
      }),
    });

    const j = await res.json();
    return { raw: j, geminiStatus: res.status, endpoint: url };
  } catch (err) {
    return { error: String(err), endpoint: url };
  }
}

/* -------------------------------------------------------------
   MAIN DEBUG HANDLER
------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "ONLY_POST_ALLOWED" });

  const { lang = "cs", context } = req.body || {};

  if (!context)
    return res.status(400).json({
      error: "NO_CONTEXT",
      body: req.body,
    });

  // build both prompts
  const gptPrompt = promptGPT(lang, context);
  const gemPrompt = promptGemini(lang, context);

  // run both in parallel
  const [gpt, gem] = await Promise.all([
    askGPT(gptPrompt),
    askGemini(gemPrompt),
  ]);

  return res.status(200).json({
    debug: true,
    receivedContext: context?.slice(0, 200) + "...",
    OPENAI_KEY_EXISTS: !!process.env.OPENAI_API_KEY,
    GEMINI_KEY_EXISTS: !!process.env.GEMINI_API_KEY,
    gptPrompt,
    gemPrompt,
    gpt,
    gem,
  });
}
