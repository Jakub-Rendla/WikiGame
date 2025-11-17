// /api/questions-gpt-gfl.js
// VARIANTA A1 — 5× GPT + 3× Gemini, max speed

export const config = { runtime: "nodejs" };

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   PROMPT — GPT
------------------------------------------------------------- */
function promptGPT(lang, context) {
  return `
Generate EXACTLY 5 question sets in STRICT JSON ONLY.

LANGUAGE: ${lang}

RULES:
- Use ONLY information present in the article.
- Never reference the article itself (forbidden: "v tomto článku", "podle textu", "text uvádí", etc.).
- No invented facts.
- No synonyms not in the text.
- Questions must be factual, specific and varied (people, places, dates, events, structures, processes, functions, numbers).
- EXACTLY one correct answer per question.
- Answers must be homogeneous type.
- No answer leakage (the question must not contain the correct answer).
- No intro, no markdown, no commentary — JSON ONLY.

FORMAT:
{
  "sets": [
    {
      "question": "...",
      "answers": ["...", "...", "..."],
      "correctIndex": 0
    }
  ]
}

ARTICLE:
${context}
  `;
}

/* -------------------------------------------------------------
   PROMPT — Gemini
------------------------------------------------------------- */
function promptGemini(lang, context) {
  return `
Generate EXACTLY 3 question sets in STRICT JSON ONLY.

LANGUAGE: ${lang}

RULES:
- Use ONLY explicit facts from the article.
- Never reference the article or text (forbidden: "v tomto článku", "text uvádí", "podle článku", etc.).
- No summaries, no prefaces, no explanations.
- No invented facts.
- Questions must be factual and varied (events, buildings, people, processes, natural phenomena).
- EXACTLY one correct answer per question.
- Answers must be homogeneous type.
- No answer leakage.

OUTPUT FORMAT:
{
  "sets": [
    {
      "question": "...",
      "answers": ["...", "...", "..."],
      "correctIndex": 0
    }
  ]
}

ARTICLE:
${context}
`;
}

/* -------------------------------------------------------------
   JSON EXTRACTOR
------------------------------------------------------------- */
function extractJSON(raw) {
  if (!raw) throw new Error("EMPTY_OUTPUT");

  let txt = raw.trim();

  txt = txt.replace(/^```json/i, "")
           .replace(/^```/i, "")
           .replace(/```$/i, "");

  txt = txt.replace(/^[^{]*({)/s, "$1");

  const match = txt.match(/\{[\s\S]*\}$/);
  if (!match) throw new Error("NO_JSON_FOUND");

  return JSON.parse(match[0]);
}

/* -------------------------------------------------------------
   VALIDATOR
------------------------------------------------------------- */
const META = /(v tomto článku|v tomto clanku|podle článku|podle clanku|text uvádí|text uvadi|jak text|jak článek|jak clanek)/i;

function validateSet(s) {
  if (!s || typeof s !== "object") return false;
  if (!s.question || META.test(s.question)) return false;
  if (!Array.isArray(s.answers) || s.answers.length !== 3) return false;
  if (s.answers.some(a => META.test(a))) return false;
  if (typeof s.correctIndex !== "number") return false;
  return true;
}

/* -------------------------------------------------------------
   MODEL CALLS
------------------------------------------------------------- */
async function askGPT(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

async function askGemini(prompt) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }
  );
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/* -------------------------------------------------------------
   MAIN HANDLER
------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "ONLY_POST_ALLOWED" });

  const { lang = "cs", context } = req.body || {};
  if (!context) return res.status(400).json({ error: "NO_CONTEXT" });

  try {
    const [gptRaw, gemRaw] = await Promise.all([
      askGPT(promptGPT(lang, context)),
      askGemini(promptGemini(lang, context)),
    ]);

    const gpt = extractJSON(gptRaw);
    const gem = extractJSON(gemRaw);

    if (!Array.isArray(gpt.sets) || gpt.sets.length !== 5)
      throw new Error("GPT_INVALID");
    if (!Array.isArray(gem.sets) || gem.sets.length !== 3)
      throw new Error("GEM_INVALID");

    gpt.sets.forEach(s => { if (!validateSet(s)) throw new Error("GPT_BAD_SET"); });
    gem.sets.forEach(s => { if (!validateSet(s)) throw new Error("GEM_BAD_SET"); });

    return res.status(200).json({
      sets: [...gpt.sets, ...gem.sets],
    });

  } catch (err) {
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      details: err.message,
    });
  }
}

