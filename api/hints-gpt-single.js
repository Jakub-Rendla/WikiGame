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
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
   HANDLER
------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const lang = body.lang || "cs";
  const context = body.context || "";
  const title = body.title || "";

  if (!context.trim())
    return res.status(400).json({ error: "Missing context" });

  if (!title.trim())
    return res.status(400).json({ error: "Missing title" });

  /* -----------------------------------------------------------
     BUILD PROMPT
  ----------------------------------------------------------- */
  const prompt = `
Generate ONE quiz question in STRICT JSON ONLY.

LANGUAGE: ${lang}

RULES:
- Use ONLY information from the provided article.
- The question must be factual and unambiguous.
- Provide exactly 3 answer options.
- EXACTLY ONE answer must be correct.
- Keep answers short and distinct.
- NEVER repeat the question across calls.

ARTICLE TITLE:
"${title}"

ARTICLE:
${context}
  `;

  console.log("[GPT] Calling model gpt-4o-mini…");

  /* -----------------------------------------------------------
     CALL GPT using JSON_MODE
  ----------------------------------------------------------- */
  let parsed = null;

  try {
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6
      })
    });

    const data = await gptRes.json();
    console.log("[GPT RAW]", data);

    parsed = data.choices?.[0]?.message?.content
      ? JSON.parse(data.choices[0].message.content)
      : null;

  } catch (err) {
    console.error("[GPT ERROR]", err);
    return res.status(500).json({ error: "GPT fetch/JSON parse failed" });
  }

  if (
    !parsed ||
    !parsed.question ||
    !Array.isArray(parsed.answers) ||
    typeof parsed.correctIndex !== "number"
  ) {
    return res.status(500).json({ error: "Invalid question structure" });
  }

  /* -----------------------------------------------------------
     ADD MODEL + question_hash
  ----------------------------------------------------------- */
  parsed.model = "gpt-4o-mini";
  parsed.question_hash = await sha256(
    parsed.question + "|" +
    parsed.answers.join("|") + "|" +
    parsed.correctIndex
  );

  console.log("[GPT OK] →", parsed.question_hash);

  return res.status(200).json(parsed);
}
