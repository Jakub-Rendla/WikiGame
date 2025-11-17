// api/question-rate.js
// Saves user rating into wiki_question_rating

export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------
   CORS
------------------------------------------------------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

/* -------------------------------------------------------
   MAIN HANDLER
------------------------------------------------------- */
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

  /* ------------------------------------------
     READ INPUT
  ------------------------------------------- */
  const {
    question_hash,
    quality_rating,
    difficulty_rating,
    selected_answer,
    correct,
    duration_ms,
    model,
    topic_title
  } = req.body || {};

  /* ------------------------------------------
     VALIDATION
  ------------------------------------------- */
  if (!question_hash) {
    return res.status(400).json({ error: "Missing question_hash" });
  }

  // DB requires NOT NULL
  const safeSelected =
    typeof selected_answer === "number" ? selected_answer : -1;

  const safeCorrect = correct === true ? true : false;

  /* ------------------------------------------
     INSERT
  ------------------------------------------- */
  const { data, error } = await supabase
    .from("wiki_question_rating")  // ← OPRAVENO (bez „s“)
    .insert({
      question_hash,
      quality_rating: quality_rating ?? null,
      difficulty_rating: difficulty_rating ?? null,
      selected_answer: safeSelected,
      correct: safeCorrect,
      duration_ms: duration_ms ?? null,
      model: model || "unknown",
      topic_title: topic_title || null
    })
    .select("*");

  if (error) {
    console.error("RATE ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    stored: true,
    rows: data
  });
}
