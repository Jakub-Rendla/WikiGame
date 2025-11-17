// api/hints-gpt-single.js
// --- GPT-4.1-mini single question generator with strict JSON schema + fallback ---
// Requires: OPENAI_API_KEY

export const config = { runtime: "nodejs" };

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* --------------------------------------------------------------
   JSON SCHEMA
-------------------------------------------------------------- */
const schema = {
  name: "Question",
  strict: true,
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
      correctIndex: { type: "integer", minimum: 0, maximum: 2 },
      model: { type: "string" }
    },
    required: ["question", "answers", "correctIndex", "model"],
    additionalProperties: false
  }
};

/* --------------------------------------------------------------
   PROMPT BUILDER
-------------------------------------------------------------- */
function buildPrompt(lang, title, context) {
  return `
Vytvoř přesně 1 kvízovou otázku na základě daného článku.

PRAVIDLA:
- Pouze fakta z textu (žádné vymyšlené věci).
- Jedna otázka, 3 odpovědi (1 správná, 2 špatné).
- Odpovědi musí být krátké a rozdílné.
- Nepoužívej hodnoty, které nejsou ve článku.
- Nepoužívej stejné slovo v otázce i správné odpovědi.
- Žádné úvodní věty, žádný komentář.

JAZYK OTÁZKY: ${lang}

TITULEK: ${title}

ČLÁNEK:
${context}
`;
}

/* --------------------------------------------------------------
   MODEL CALL (WITH FALLBACK)
-------------------------------------------------------------- */
async function askModel(prompt, model) {
  try {
    const res = await client.responses.create({
      model,
      reasoning: { effort: "medium" },
      input: prompt,
      response_format: { type: "json_schema", json_schema: schema }
    });

    const json = res.output[0]?.content[0]?.json;
    if (!json) throw new Error("No JSON returned");

    json.model = model;
    return json;

  } catch (e) {
    console.error(`[API] Model ${model} failed →`, e.message);
    return null;
  }
}

/* --------------------------------------------------------------
   MAIN HANDLER
-------------------------------------------------------------- */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { lang = "cs", title = "", context = "" } = req.body || {};

    if (!context) return res.status(400).json({ error: "Missing context" });

    const prompt = buildPrompt(lang, title, context);

    // 1) primary model
    let out =
      (await askModel(prompt, "gpt-4.1-mini")) ||
      (await askModel(prompt, "gpt-4o-mini-high")) ||
      (await askModel(prompt, "gpt-4o-mini"));

    if (!out) {
      return res.status(500).json({
        error: "All models failed to produce valid JSON"
      });
    }

    return res.status(200).json(out);

  } catch (err) {
    console.error("FATAL ERROR:", err);
    return res.status(500).json({ error: "Server crash" });
  }
}
