// api/hints-gpt-single.js
// GPT-4o-mini — single question generator
// Strict JSON, stable, validated

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

function bad(res, msg) {
  return res.status(400).json({ error: msg });
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { lang, context, title } = req.body || {};

  if (!lang || !context || !title) {
    return bad(res, "Missing lang/context/title");
  }

  const prompt = `
Generate exactly ONE multiple-choice question in STRICT JSON format.

LANGUAGE: ${lang}

Rules:
- The question must come ONLY from the provided text.
- No external facts.
- Answers: exactly 3 options.
- Only 1 correct answer.
- JSON fields required:
  {
    "question": "...",
    "answers": ["A","B","C"],
    "correctIndex": 0,
    "model": "gpt-4o-mini"
  }
TEXT:
${context}
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
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200
      })
    });

    const raw = await r.text();

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ error: "Invalid JSON from model", raw });
    }

    const text = json.choices?.[0]?.message?.content?.trim() || "";
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: "Model did not return strict JSON", text });
    }

    if (
      !parsed.question ||
      !Array.isArray(parsed.answers) ||
      typeof parsed.correctIndex !== "number"
    ) {
      return res.status(500).json({ error: "Invalid question structure" });
    }

    parsed.model = "gpt-4o-mini";

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
