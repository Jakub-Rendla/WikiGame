// api/question-save.js
// Saves generated question into wiki_questions table

export const config = { runtime: "nodejs" };

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    setCors(res);
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body;
  try {
    body = req.body;
  } catch (err) {
    setCors(res);
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const {
    question_hash,
    question,
    answers,
    correct_index,
    model,
    article_hash,
    context_slice,
    topic_title,
    lang
  } = body || {};

  // Validate
  if (!question_hash ||
      !question ||
      !answers ||
      typeof correct_index !== "number" ||
      !model ||
      !article_hash ||
      !context_slice ||
      !topic_title ||
      !lang) 
  {
    setCors(res);
    return res.status(400).json({
      error: "Missing required fields",
      body
    });
  }

  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/wiki_questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        question_hash,
        question,
        answers,
        correct_index,
        model,
        article_hash,
        context_slice,
        topic_title,
        lang
      })
    });

    const text = await r.text();

    if (!r.ok) {
      setCors(res);
      return res.status(500).json({
        error: "Supabase insert failed",
        status: r.status,
        body: text
      });
    }

    setCors(res);
    return res.status(200).json({
      success: true,
      inserted: true
    });

  } catch (err) {
    console.error("SAVE QUESTION ERROR:", err);
    setCors(res);
    return res.status(500).json({
      error: "Internal server error",
      detail: err.message
    });
  }
}
