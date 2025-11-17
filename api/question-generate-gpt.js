// /api/question-generate-gpt.js
// GPT question generator with automatic slicing for WikiGame

export const config = { runtime: "nodejs" };

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
   SHA-256 pomocí WebCrypto (Edge-safe)
----------------------------------------------------------- */
async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ----------------------------------------------------------
   ČIŠTĚNÍ TEXTU
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
  for (let i = 0; i < Math.min(t.length, 8000); i += 1500) {
    slices.push(t.slice(i, i + 1500));
  }
  return slices;
}

/* ----------------------------------------------------------
   OPENAI
----------------------------------------------------------- */
import OpenAI from "openai";
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ----------------------------------------------------------
   HANDLER
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
Generate EXACTLY 1 question with 3 answers (1 correct).

TEXT:
${slice}

Return JSON in shape:
{
  "question": "...",
  "answers": ["a","b","c"],
  "correctIndex": 0
}
`;

    /* --------------------------------------------------------------------
       CALL OPENAI RESPONSES API
    -------------------------------------------------------------------- */
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
      },
      max_output_tokens: 200
    });

    /* ----------------------------------------------------------
       SAFE PARSE
    ----------------------------------------------------------- */
    let parsed = null;
    try {
      parsed = completion.output[0].parsed;
    } catch (e) {
      console.error("PARSE FAIL:", e);
    }

    if (
      !parsed ||
      !parsed.question ||
      !Array.isArray(parsed.answers) ||
      parsed.answers.length !== 3
    ) {
      return res.status(500).json({
        error: "Invalid_question_generated"
      });
    }

    /* ----------------------------------------------------------
       ADD model + question_hash
    ----------------------------------------------------------- */
    parsed.model = "gpt-4.1-mini";
    parsed.question_hash = await sha256(
      parsed.question + "|" + parsed.answers.join("|") + "|" + parsed.correctIndex
    );

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(500).json({
      error: "Server_error",
      detail: String(err)
    });
  }
}
