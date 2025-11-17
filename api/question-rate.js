// api/question-rate.js
// Saves user rating into wiki_question_rating and updates medians in wiki_questions

export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   HANDLER
------------------------------------------------------------- */
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
    quality_rating,
    difficulty_rating,
    selected_answer,
    correct,
    model,
    topic_title,
    duration_ms,
    session_id
  } = req.body || {};

  if (!question_hash) {
    return res.status(400).json({ error: "Missing question_hash" });
  }

  /* -------------------------------------------------------------
      INSERT RATING ROW
  ------------------------------------------------------------- */
  const { data, error } = await supabase
    .from("wiki_question_rating")
    .insert({
      question_hash,
      quality_rating,
      difficulty_rating,
      selected_answer,
      correct,
      model,
      topic_title,
      duration_ms,
      session_id
    })
    .select("*");

  if (error) {
    console.error("RATE ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  /* -------------------------------------------------------------
      UPDATE MEDIANS IN wiki_questions
  ------------------------------------------------------------- */
  const { error: medianError } = await supabase.rpc(
    "recompute_question_rating",
    { q_hash: question_hash }
  );

  if (medianError) {
    console.error("MEDIAN UPDATE ERROR:", medianError);
    return res.status(500).json({ error: "Could not update medians" });
  }

  return res.status(200).json({
    stored: true,
    row: data?.[0] || null,
    medians_updated: true
  });
}
