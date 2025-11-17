// api/question-save.js
// Insert a generated question into wiki_questions

export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

/* --------------------------------------------------------------
   CORS
-------------------------------------------------------------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* --------------------------------------------------------------
   HANDLER
-------------------------------------------------------------- */
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SUPA_URL  = process.env.SUPABASE_URL;
  const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY; // MUST be service key!

  if (!SUPA_URL || !SUPA_KEY) {
    console.error("Missing Supabase keys");
    return res.status(500).json({ error: "Missing Supabase keys" });
  }

  const supabase = createClient(SUPA_URL, SUPA_KEY);

  const payload = req.body || {};
  console.log("[SAVE] PAYLOAD:", payload);

  if (!payload.question_hash) {
    return res.status(400).json({ error: "Missing question_hash" });
  }

  const { data, error } = await supabase
    .from("wiki_questions")
    .insert({
      question_hash: payload.question_hash,
      question: payload.question,
      answers: payload.answers,
      correct_index: payload.correct_index,
      lang: payload.lang,
      model: payload.model,
      topic_title: payload.topic_title,
      article_hash: payload.article_hash,
      context_slice: payload.context_slice,
      difficulty_rating: null,
      quality_rating: null
    })
    .select("*");

  if (error) {
    console.error("SUPABASE INSERT ERROR:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ stored: true, id: data?.[0]?.id });
}
