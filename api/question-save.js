// api/question-save.js
// Save unique question into wiki_questions (no duplicates)

export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

/* CORS */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPA_URL || !SUPA_KEY) {
    return res.status(500).json({ error: "Missing Supabase keys" });
  }

  const supabase = createClient(SUPA_URL, SUPA_KEY);

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
  } = req.body || {};

  if (!question_hash || !question) {
    return res.status(400).json({ error: "Missing question or hash" });
  }

  /* 1️⃣ Check if already exists */
  const existing = await supabase
    .from("wiki_questions")
    .select("id")
    .eq("question_hash", question_hash)
    .single();

  if (existing.data) {
    return res.status(200).json({
      stored: false,
      exists: true,
      id: existing.data.id
    });
  }

  /* 2️⃣ Insert new question */
  const { data, error } = await supabase
    .from("wiki_questions")
    .insert({
      question_hash,
      question,
      answers,
      correct_index,
      model,
      article_hash,
      context_slice,
      topic_title,
      lang,
      difficulty_estimate_by_ai: null,
      quality_rating: null,
      difficulty_rating: null
    })
    .select("*");

  if (error) {
    console.error("SAVE ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    stored: true,
    row: data?.[0] || null
  });
}
