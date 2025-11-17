// /api/question-rate.js
export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    question_hash,
    quality_rating,
    difficulty_rating,
    selected_answer,
    correct,
    model,
    duration_ms,
    session_id,
    topic_title
  } = req.body;

  // --- Basic validation ---
  if (!question_hash) {
    return res.status(400).json({ error: "Missing question_hash" });
  }
  if (selected_answer === undefined) {
    return res.status(400).json({ error: "Missing selected_answer" });
  }
  if (correct === undefined) {
    return res.status(400).json({ error: "Missing correct (true/false)" });
  }
  if (!model) {
    return res.status(400).json({ error: "Missing model" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from("wiki_question_ratings")
    .insert({
      question_hash,
      quality_rating,
      difficulty_rating,
      selected_answer,
      correct,
      model,
      duration_ms,
      session_id,
      topic_title
    })
    .select("*")
    .single();

  if (error) {
    console.error("[RATE] Supabase insert error:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.json({ ok: true, data });
}
