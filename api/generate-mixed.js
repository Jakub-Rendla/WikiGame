// /api/generate-mixed.js
// Orchestrates two internal APIs: GPT + Gemini → returns the better question

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { lang = "cs", context = "" } = req.body || {};

  if (!context.trim()) {
    return res.status(400).json({ error: "Missing context" });
  }

  const baseUrl = req.headers.origin;

  // --- GPT SINGLE ---
  const gptPromise = fetch(`${baseUrl}/api/hints-gpt-single`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang, context })
  })
    .then(r => r.json())
    .then(data => ({ ok: true, model: "gpt", data }))
    .catch(err => ({ ok: false, model: "gpt", error: err.message }));

  // --- GEMINI SINGLE ---
  const gemPromise = fetch(`${baseUrl}/api/hints-gemini-single`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang, context })
  })
    .then(r => r.json())
    .then(data => ({ ok: true, model: "gemini", data }))
    .catch(err => ({ ok: false, model: "gemini", error: err.message }));

  // --- PARALLEL ---
  const [gpt, gem] = await Promise.all([gptPromise, gemPromise]);

  // --- SELECT BETTER ---
  let chosen;

  if (gpt.ok && gem.ok) {
    chosen = gpt; // prefer GPT
  } else if (gpt.ok) {
    chosen = gpt;
  } else if (gem.ok) {
    chosen = gem;
  } else {
    return res.status(500).json({
      error: "Both GPT and Gemini failed",
      gptError: gpt.error,
      geminiError: gem.error
    });
  }

  return res.status(200).json({
    question: chosen.data.question,
    answers: chosen.data.answers,
    correctIndex: chosen.data.correctIndex,
    model: chosen.model
  });
}

