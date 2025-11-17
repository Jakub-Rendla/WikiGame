// /api/question-generate-gpt.js
// GPT question generator with automatic slicing for WikiGame

import OpenAI from "openai";
import crypto from "crypto";

/* ----------------------------------------------------------
   CORS
----------------------------------------------------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/* ----------------------------------------------------------
   SHA256 — Node.js version (guaranteed functional)
----------------------------------------------------------- */
function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

/* ----------------------------------------------------------
   CLEAN HTML
----------------------------------------------------------- */
function cleanHTML(t) {
  return t
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sliceContext(t) {
  if (t.length <= 1500) return [t];
  const slices = [];
  for (let i = 0; i < Math.min(8000, t.length); i += 1500) {
    slices.push(t.slice(i, i + 1500));
  }
  return slices;
}

/* ----------------------------------------------------------
   OPENAI CLIENT
----------------------------------------------------------- */
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ----------------------------------------------------------
   MAIN HANDLER
----------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { lang = "cs", context = "", title = "" } = req.body;

    if (!context) {
      return res.status(400).json({ error: "Missing context" });
    }

    const cleaned = cleanHTML(context);
    const slices = sliceContext(cleaned);
    const slice = slices[Math.floor(Math.random() * slices.length)];

    const prompt = `
LANG = ${lang}
Generate EXACTLY 1 question with 3 answers.

TEXT:
${slice}

Return JSON in shape:
{
  "question": "...",
  "answers": ["a","b","c"],
  "correctIndex": 0
}
`;

    /* ----------------------------------------------------------
       OPENAI RESPONSES API CALL
    ----------------------------------------------------------- */
    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wikigame_q",
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
              correctIndex: {
                type: "integer",
                minimum: 0,
                maximum: 2
              }
            },
            required: ["question", "answers", "correctIndex"],
            additionalProperties: false
          }
        }
      }
    });

    let parsed;
    try {
      parsed = completion.output[0].parsed;
    } catch {
      return res.status(500).json({ error: "PARSE_ERROR" });
    }

    if (!parsed || !parsed.question || !Array.isArray(parsed.answers)) {
      return res.status(500).json({ error: "INVALID_OUTPUT" });
    }

    parsed.model = "gpt-4.1-mini";
    parsed.question_hash = sha256(
      parsed.question + "|" +
      parsed.answers.join("|") + "|" +
      parsed.correctIndex
    );

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(500).json({ error: "SERVER_ERROR", detail: String(err) });
  }
}

