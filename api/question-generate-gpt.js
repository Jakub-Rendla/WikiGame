// /api/question-generate-gpt.js
// GPT question generator with automatic slicing for WikiGame

export const config = { runtime: "nodejs" };

/* ----------------------------------------------------------
   CORS (musí být *naprosto* na začátku handleru)
----------------------------------------------------------- */
function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/* ----------------------------------------------------------
   CLEAN
----------------------------------------------------------- */
function cleanHTML(str) {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sliceText(t) {
  if (t.length <= 1500) return [t];
  const out = [];
  for (let i = 0; i < Math.min(t.length, 8000); i += 1500) {
    out.push(t.slice(i, i + 1500));
  }
  return out;
}

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

import crypto from "crypto";
const sha256 = str => crypto.createHash("sha256").update(str).digest("hex");

/* ----------------------------------------------------------
   MAIN
----------------------------------------------------------- */
export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    applyCors(res);
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { lang = "cs", context = "", title = "" } = req.body;
    if (!context) {
      applyCors(res);
      return res.status(400).json({ error: "Missing context" });
    }

    const clean = cleanHTML(context);
    const slices = sliceText(clean);
    const slice = slices[Math.floor(Math.random() * slices.length)];

    const prompt = `
LANG: ${lang}
One multiple-choice question (3 answers, 1 correct) based *only* on this text:

TEXT:
${slice}

Strict JSON:
{
  "question": "...",
  "answers": ["a","b","c"],
  "correctIndex": 0
}
`;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wikigame",
          schema: {
            type: "object",
            properties: {
              question: { type: "string" },
              answers: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3
              },
              correctIndex: { type: "integer", minimum: 0, maximum: 2 }
            },
            required: ["question", "answers", "correctIndex"],
            additionalProperties: false
          }
        }
      },
      max_output_tokens: 150
    });

    const out = completion.output[0].parsed;

    out.model = "gpt-4.1-mini";
    out.question_hash = sha256(
      out.question + "|" + out.answers.join("|") + "|" + out.correctIndex
    );

    applyCors(res);
    return res.status(200).json(out);

  } catch (err) {
    console.error("ERR:", err);
    applyCors(res);
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}

