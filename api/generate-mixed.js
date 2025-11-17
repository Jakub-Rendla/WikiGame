// /api/generate-mixed.js
// Orchestrator: calls hints-gpt-single + hints-gemini-single → picks best → returns final question.
// Works across domains (Webflow → Vercel) using fixed base URL.

export const config = { runtime: "nodejs" };

/* ---------------------------------------------------------
   CORS
--------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );
}

/* ---------------------------------------------------------
   HANDLER
--------------------------------------------------------- */
export default async function handler(req, res) {
  const origin = req.headers?.origin || "*";
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {}
  }

  const { lang = "cs", context = "", title = "" } = body || {};

  if (!context || !context.trim()) {
    return res.status(400).json({ error: "Missing context" });
  }

  console.log("[MIXED] Incoming request from:", origin);

  /* ---------------------------------------------------------
     IMPORTANT FIX:
     DO NOT USE req.headers.origin — ALWAYS USE YOUR VERCEL URL
  --------------------------------------------------------- */
  const baseUrl =
    process.env.MIXED_API_BASE || "https://wiki-game-inky.vercel.app";

  console.log("[MIXED] Using base:", baseUrl);

  /* ---------------------------------------------------------
     HELPER: CALL INTERNAL API SAFELY
  --------------------------------------------------------- */
  async function callAPI(endpoint, payload) {
    try {
      const url = `${baseUrl}${endpoint}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const raw = await r.text();
      console.log(`[MIXED] RAW from ${endpoint}:`, raw.slice(0, 300));

      try {
        return { ok: true, data: JSON.parse(raw) };
      } catch (err) {
        return { ok: false, error: "Invalid JSON: " + raw };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /* ---------------------------------------------------------
     CALL BOTH MODELS
  --------------------------------------------------------- */
  const payload = { lang, context, title };

  const gpt = await callAPI("/api/hints-gpt-single", payload);
  const gem = await callAPI("/api/hints-gemini-single", payload);

  console.log("[MIXED] GPT:", gpt);
  console.log("[MIXED] GEM:", gem);

  /* ---------------------------------------------------------
     SELECT BEST RESULT
  --------------------------------------------------------- */
  let chosen = null;

  if (gpt.ok && gem.ok) {
    // prefer GPT as primary
    chosen = { ...gpt.data, model: "gpt" };
  } else if (gpt.ok) {
    chosen = { ...gpt.data, model: "gpt" };
  } else if (gem.ok) {
    chosen = { ...gem.data, model: "gemini" };
  } else {
    return res.status(500).json({
      error: "Both GPT and Gemini failed",
      gptError: gpt.error,
      geminiError: gem.error
    });
  }

  /* ---------------------------------------------------------
     RETURN FINAL QUESTION
  --------------------------------------------------------- */
  return res.status(200).json({
    question: chosen.question,
    answers: chosen.answers,
    correctIndex: chosen.correctIndex,
    model: chosen.model
  });
}
