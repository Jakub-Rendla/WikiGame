// api/question-generate-gpt.js
import OpenAI from "openai";

export const config = { runtime: "nodejs" };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(400).json({ error: "POST only" });

  const { lang = "cs", title = "", context = "" } = req.body || {};

  if (!context || !title) {
    return res.status(400).json({ error: "Missing title or context" });
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const prompt = `
Generate EXACTLY this JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

RULES:
- Language: ${lang}
- Based ONLY on the article text
- 1 question only
- 3 answers only
- 1 correct answer only
- Keep it factual
- NO extra text before or after JSON

TITLE: ${title}
TEXT:
${context.slice(0, 12000)}
`;

  try {
    // gpt-4.1-mini must use "input", WITHOUT text.format
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    const raw = response.output_text;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({
        error: "Model did not return valid JSON",
        raw
      });
    }

    data.model = "gpt-4.1-mini";

    return res.status(200).json(data);

  } catch (err) {
    console.error("GPT ERROR:", err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      detail: err?.message || String(err)
    });
  }
}
