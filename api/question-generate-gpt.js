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
    return res.status(400).json({ error: "POST only" });
  }

  const { lang = "cs", title = "", context = "" } = req.body || {};

  if (!context || !title) {
    return res.status(400).json({
      error: "Missing required fields: title, context",
    });
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini",

      input: `
Generate ONE quiz question in STRICT JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

RULES:
- Language: ${lang}
- Based ONLY on the provided article
- Exactly 3 answers
- Exactly 1 correct
- Factual
- No hallucinations
- Keep it concise

TITLE: ${title}
TEXT: ${context.slice(0, 12000)}
`,

      text: {
        format: "json_object"  // << ✔ VALID FORMAT
      }
    });

    const raw = response.output_text;

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({
        error: "Bad JSON returned by model",
        raw
      });
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
