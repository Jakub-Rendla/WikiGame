// /api/question-generate-gpt.js
// GPT question generator with automatic slicing
// for WikiGame (Jakub Rendla)

export const config = { runtime: "nodejs" };

/* ---------------------------------------------------------------------
   CORS
------------------------------------------------------------------------*/
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* ---------------------------------------------------------------------
   HELPER — Clean HTML → plain text
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
   HELPER — Split article into slices (sections)
------------------------------------------------------------------------*/
function sliceArticle(text) {
  // split by common wiki-like headers
  let rawSections = text.split(/(?=^#|\n#|\n==|\n===)/gm);

  if (rawSections.length === 1) {
    // fallback: split every 1500 chars
    const parts = [];
    for (let i = 0; i < text.length; i += 1500) {
      parts.push(text.slice(i, i + 1500));
    }
    return parts;
  }

  // normalize and filter
  const sections = rawSections
    .map(s => s.trim())
    .filter(s => s.length > 200); // must have some content

  return sections;
}

/* ---------------------------------------------------------------------
   HASHING (sha-256)
------------------------------------------------------------------------*/
async function sha256(str) {
  const crypto = await import("crypto");
  return crypto.createHash("sha256").update(str).digest("hex");
}

/* ---------------------------------------------------------------------
   OPENAI CLIENT
------------------------------------------------------------------------*/
import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------------------------------------------------------------
   MAIN HANDLER
------------------------------------------------------------------------*/
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  try {
    const { lang = "cs", context = "", title = "" } = req.body;

    if (!context || context.length < 50) {
      return res.status(400).json({ error: "Context too short" });
    }

    /* -----------------------------------------------------------
       1) Clean & slice the article
    ------------------------------------------------------------*/
    const clean = cleanHTML(context);
    const slices = sliceArticle(clean);

    if (!slices.length) {
      return res.status(400).json({ error: "No article slices" });
    }

    // choose slice based on article length
    const maxSlices =
      clean.length < 5000 ? 2 :
      clean.length < 15000 ? 5 :
      10;

    const chosenSlices = slices.slice(0, maxSlices);

    // random pick (avoids repetition)
    const slice = chosenSlices[Math.floor(Math.random() * chosenSlices.length)];

    /* -----------------------------------------------------------
       2) GPT generation (4.1-mini recommended)
    ------------------------------------------------------------*/
    const prompt = `
LANGUAGE: ${lang}

You are generating a single multiple-choice question based ONLY on the provided text slice.
Rules:
- Use ONLY facts from the text.
- NO external facts.
- EXACTLY 1 question.
- EXACTLY 3 answers.
- EXACTLY 1 correct answer.
- Answers must be short and distinct.

Return STRICT JSON:
{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 0
}

TEXT SLICE:
${slice}
`;

    const completion = await client.responses.create({
      model: "gpt-4.1-mini", // or "gpt-4o-mini-high"
      input: prompt,
      max_output_tokens: 200,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wikigame_question",
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

    /* -----------------------------------------------------------
       3) Add metadata (model + hash)
    ------------------------------------------------------------*/
    const question_hash = await sha256(
      data.question + "|" + data.answers.join("|") + "|" + data.correctIndex
    );

    const enriched = {
      ...data,
      model: "gpt-4.1-mini",
      question_hash
    };

    return res.status(200).json(enriched);

  } catch (err) {
    console.error("GPT GENERATE ERROR:", err);
    return res.status(500).json({ error: "Generator failed", detail: err.message });
  }
}

