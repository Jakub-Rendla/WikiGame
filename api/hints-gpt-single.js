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

OUTPUT EXAMPLE:
{"question":"Q","answers":["A1","A2","A3"],"correctIndex":1}

ARTICLE TITLE:
"${title}"

ARTICLE:
${context}
  `;

  console.log("[GPT] Calling model gpt-4o-mini…");

  /* -----------------------------------------------------------
     CALL GPT
  ----------------------------------------------------------- */
  let raw = "";
  try {
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
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

    raw = await gptRes.text();
    console.log("[GPT RAW]:", raw);
  } catch (err) {
    console.log("[GPT ERROR]:", err);
    return res.status(500).json({ error: "GPT fetch failed" });
  }

  /* -----------------------------------------------------------
     PARSE JSON ROBUSTLY
  ----------------------------------------------------------- */
  let json = null;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    json = match ? JSON.parse(match[0]) : null;
  } catch (err) {
    console.log("[JSON PARSE ERROR]:", err);
    return res.status(500).json({ error: "Invalid JSON returned" });
  }

  if (
    !json ||
    !json.question ||
    !Array.isArray(json.answers) ||
    typeof json.correctIndex !== "number"
  ) {
    return res.status(500).json({ error: "Invalid question structure" });
  }

  /* -----------------------------------------------------------
     GENERATE question_hash
  ----------------------------------------------------------- */
  json.model = "gpt-4o-mini";
  json.question_hash = await sha256(
    json.question + "|" + json.answers.join("|") + "|" + json.correctIndex
  );

  console.log("[GPT] OK → Hash:", json.question_hash);

  return res.status(200).json(json);
}
