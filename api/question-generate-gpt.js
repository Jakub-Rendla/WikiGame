// /api/question-generate-gpt.js
// GPT question generator with automatic slicing for WikiGame

export const config = { runtime: "nodejs" };

/* ---------------------------------------------------------------------
   CORS
------------------------------------------------------------------------*/
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* ---------------------------------------------------------------------
   CLEAN HTML
------------------------------------------------------------------------*/
function cleanHTML(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------------------------------------------
   SLICER
------------------------------------------------------------------------*/
function sliceArticle(text) {
  let raw = text.split(/(?=^#|\n#|\n==|\n===)/gm);

  if (raw.length <= 1) {
    const parts = [];
    for (let i = 0; i < text.length; i += 1500) {
      parts.push(text.slice(i, i + 1500));
    }
    return parts;
  }

  return raw.map(s => s.trim()).filter(s => s.length > 200);
}

/* ---------------------------------------------------------------------
   SHA256
------------------------------------------------------------------------*/
async function sha256(str) {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(str).digest("hex");
}

/* ---------------------------------------------------------------------
   GPT CLIENT
------------------------------------------------------------------------*/
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------------------------------------------------------------
   MAIN HANDLER
------------------------------------------------------------------------*/
export default async function handler(req, res) {
  setCors(res, "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    setCors(res, "*");
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { lang = "cs", context = "", title = "" } = req.body;

    if (!context || context.length < 50) {
      setCors(res, "*");
      return res.status(400).json({ error: "Context too short" });
    }

    /* -----------------------------------------------------------
       CLEAN + SLICE
    ------------------------------------------------------------*/
    const clean = cleanHTML(context);
    const slices = sliceArticle(clean);

    if (!slices.length) {
      setCors(res, "*");
      return res.status(400).json({ error: "No slices found" });
    }

    const maxSlices =
      clean.length < 5000 ? 2 :
      clean.length < 15000 ? 5 : 10;

    const chosenSlices = slices.slice(0, maxSlices);
    const slice = chosenSlices[Math.floor(Math.random() * chosenSlices.length)];

    /* -----------------------------------------------------------
       GPT GENERATION
    ------------------------------------------------------------*/
    const prompt = `
LANGUAGE: ${lang}

You generate a single multiple-choice question based ONLY on the provided text slice.
Rules:
- Use only facts in the text.
- 1 question
- 3 answers
- 1 correct answer
- Strict JSON

TEXT:
${slice}
`;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 200,
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
      }
    });

    const data = completion.output[0].parsed;

    const question_hash = await sha256(
      data.question + "|" +
      data.answers.join("|") + "|" +
      data.correctIndex
    );

    const enriched = {
      ...data,
      model: "gpt-4.1-mini",
      question_hash
    };

    setCors(res, "*");
    return res.status(200).json(enriched);

  } catch (err) {
    console.error("GPT ERROR:", err);
    setCors(res, "*");
    return res
      .status(500)
      .json({ error: "Generator failed", detail: err.message });
  }
}
