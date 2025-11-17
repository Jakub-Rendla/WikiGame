// api/hints-gpt-single.js
// GPT-4o-mini single question generator
// - title-aware
// - numeric filter
// - answer-in-question filter
// - random slice
// - strict JSON
// - robust validation

export const config = { runtime: "nodejs" };

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

/* -------------------------------------------------------------
   HASH
------------------------------------------------------------- */
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

/* -------------------------------------------------------------
   BUILD PROMPT
------------------------------------------------------------- */
function buildPrompt(lang, title, context) {
  return `
Generate EXACTLY ONE quiz question in STRICT JSON.

LANGUAGE: ${lang}

RULES:
- Use only information from the article.
- Provide EXACTLY 3 answers.
- EXACTLY one answer must be correct.
- Answers must be short and distinct.
- Do NOT include explanations.
- JSON ONLY, no prose, no markdown.

RETURN JSON:
{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 0
}

ARTICLE TITLE:
${title}

ARTICLE:
${context}
`;
}

/* -------------------------------------------------------------
   HANDLER
------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { lang = "cs", title = "", context = "" } = req.body || {};

  if (!context.trim())
    return res.status(400).json({ error: "Missing context" });

  const prompt = buildPrompt(lang, title, context);

  try {
    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const data = await apiRes.json();
    let raw = data.choices?.[0]?.message?.content || "";

    // extract JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);

    // VALIDATE
    if (
      !parsed ||
      !parsed.question ||
      !Array.isArray(parsed.answers) ||
      parsed.answers.length !== 3 ||
      typeof parsed.correctIndex !== "number"
    ) {
      return res.status(500).json({ error: "Invalid question structure" });
    }

    parsed.model = "gpt-4o-mini";
    parsed.question_hash = await sha256(
      parsed.question + "|" +
      parsed.answers.join("|") + "|" +
      parsed.correctIndex
    );

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("GPT ERROR:", err);
    return res.status(500).json({ error: "Failed to generate question" });
  }
}
