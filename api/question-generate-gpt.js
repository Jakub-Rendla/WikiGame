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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
- NO additional text outside the JSON

TITLE: ${title}
TEXT:
${context.slice(0, 14000)}
`;

  /* --------------------------------------------
     TRY 1 — GPT 4.1 MINI
  -------------------------------------------- */
  async function try41mini() {
    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });
    return resp.output_text;
  }

  /* --------------------------------------------
     TRY 2 — GPT 4O MINI (fallback)
  -------------------------------------------- */
  async function try4omini() {
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: prompt
    });
    return resp.output_text;
  }

  let raw = null;
  let sourceModel = null;

  /* --------------------------------------------
     RUN primary model
  -------------------------------------------- */
  try {
    raw = await try41mini();
    sourceModel = "gpt-4.1-mini";
  } catch (err) {
    console.error("Primary model FAILED → fallback:", err);
  }

  /* --------------------------------------------
     FALLBACK if JSON parse fails or empty
  -------------------------------------------- */
  let parsed = null;

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
  }

  if (!parsed) {
    try {
      raw = await try4omini();
      sourceModel = "gpt-4o-mini";
      parsed = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({
        error: "Both models failed",
        primary_fail: "gpt-4.1-mini invalid JSON",
        fallback_fail: err?.message,
        raw
      });
    }
  }

  /* --------------------------------------------
     OK → return standard structure
  -------------------------------------------- */
  parsed.model = sourceModel;

  return res.status(200).json(parsed);
}
