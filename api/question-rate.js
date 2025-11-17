// api/question-rate.js
// Saves user rating into wiki_questions_rating

export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ error: "Missing Supabase keys" });
  }

  const supabase = createClient(SUPA_URL, SUPA_KEY);

  const {
    question_hash,
    quality_rating,
    difficulty_rating,
    selected_answer,
    correct,
    model,
    topic_title
  } = req.body || {};

  if (!question_hash) {
    return res.status(400).json({ error: "Missing question_hash" });
  }

  const { data, error } = await supabase
    .from("wiki_questions_rating")
    .insert({
      question_hash,
      quality_rating,
      difficulty_rating,
      selected_answer,
      correct,
      model,
      topic_title
    })
    .select("*");

  if (error) {
    console.error("RATE ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ stored: true });
}
