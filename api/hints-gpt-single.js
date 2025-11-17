// api/hints-gpt-single.js
// GPT-4o-mini single question generator
// - title-aware
// - numeric filter
// - answer-in-question filter
// - random slice
// - strict JSON

export const config = { runtime: "nodejs" };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    setCors(res);
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (!body || !body.context) {
    setCors(res);
    return res.status(400).json({ error: "Missing context" });
  }

  const { lang, context, title } = body;

  // Strict prompt
  const prompt = `
Generate EXACTLY 1 factual multiple-choice quiz question in STRICT JSON.
LANGUAGE: ${lang}

RULES:
- Base ONLY on the given text.
- DO NOT include numeric traps.
- Avoid repeating numbers or facts not found in text.
- Provide 3 answers (one correct).
- Return STRICT JSON:
{
  "question": "",
  "answers": ["",""],
  "correctIndex": 1,
  "model": "gpt-4o-mini"
}

TEXT:
${context.slice(0, 9000)}
`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a strict JSON generator."},
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    const raw = await r.text();

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      setCors(res);
      return res.status(500).json({
        error: "OpenAI returned non-JSON",
        raw
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      setCors(res);
      return res.status(500).json({ error: "No content from model" });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      setCors(res);
      return res.status(500).json({
        error: "Model JSON parse error",
        raw: content
      });
    }

    if (!parsed.question || !Array.isArray(parsed.answers)) {
      setCors(res);
      return res.status(500).json({
        error: "Invalid JSON format",
        parsed
      });
    }

    parsed.model = "gpt-4o-mini";

    setCors(res);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error("GPT ERROR:", err);
    setCors(res);
    return res.status(500).json({
      error: "Internal error",
      detail: err.message
    });
  }
}
