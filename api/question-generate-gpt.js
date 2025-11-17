// api/question-generate-gpt.js
import OpenAI from "openai";

export const config = {
  runtime: "nodejs",
};

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  allowCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(200).json({ error: "POST only" });
  }

  const { lang = "cs", title = "", context = "" } = req.body || {};

  if (!context || !title) {
    return res
      .status(400)
      .json({ error: "Missing required fields: title, context" });
  }

  /* -----------------------------------------------
     OPENAI CLIENT
  ----------------------------------------------- */
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    /* -----------------------------------------------
       GPT REQUEST — Responses API (FINAL FORMAT)
    ----------------------------------------------- */
    const response = await client.responses.create({
      model: "gpt-4.1-mini",

      input: `
Generate ONE quiz question in STRICT JSON.

RULES:
- Language: ${lang}
- Based ONLY on the supplied article text.
- Provide exactly 3 answers.
- Exactly one must be correct.
- Keep questions concise and factual.

Return ONLY JSON in this shape:
{
  "question": "...",
  "answers": ["A", "B", "C"],
  "correctIndex": 1
}

ARTICLE TITLE: ${title}
ARTICLE TEXT: ${context.slice(0, 12000)}
`,

      text: {
        format: {
          type: "json"   // ← correct structure
        }
      }
    });

    const raw = response.output_text || "";
    let data;

    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res
        .status(500)
        .json({ error: "Bad JSON from GPT", raw });
    }

    data.model = "gpt-4.1-mini";

    return res.status(200).json(data);

  } catch (err) {
    console.error("GPT ERROR:", err);

    return res.status(500).json({
      error: "SERVER_ERROR",
      detail: err?.message || String(err),
    });
  }
}
