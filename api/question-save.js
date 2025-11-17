// /api/question-save.js
export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------
   CORS
-------------------------------------------------------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   MAIN HANDLER
-------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  /* ---------------------------------------------------------
       EXPECTED PAYLOAD
       {
         question_hash: string,
         article_hash: string,
         lang: "cs"|"en"|...,
         topic_title: string,
         context_slice: string,

         question: string,
         answers: ["A", "B", "C"],
         correct_index: 0|1|2,

         model: "gpt-4o-mini"|"gemini-2.0-flash-lite"
       }
  ---------------------------------------------------------- */

  const {
    question_hash,
    article_hash,
    lang,
    topic_title,
    context_slice,
    question,
    answers,
    correct_index,
    model
  } = req.body || {};

  /* ---------------------------------------------------------
       VALIDATION
  ---------------------------------------------------------- */
  if (!question_hash) return res.status(400).json({ error: "Missing question_hash" });
  if (!question) return res.status(400).json({ error: "Missing question" });
  if (!Array.isArray(answers) || answers.length !== 3)
    return res.status(400).json({ error: "answers must be array of 3 items" });
  if (correct_index === undefined)
    return res.status(400).json({ error: "Missing correct_index" });
  if (!model) return res.status(400).json({ error: "Missing model" });
  if (!lang) return res.status(400).json({ error: "Missing lang" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  /* ---------------------------------------------------------
       INSERT — with ON CONFLICT DO NOTHING 
       (unique by question_hash)
  ---------------------------------------------------------- */
  const { data, error } = await supabase
    .from("wiki_questions")
    .insert({
      question_hash,
      article_hash: article_hash || "",
      lang,
      topic_title: topic_title || "",
      context_slice: context_slice || "",
      question,
      answers,
      correct_index,
      model
    })
    .select("*");

  // If the row already exists, skip error (thanks to unique constraint)
  if (error && error.code !== "23505") {
    console.error("[SAVE QUESTION] Error:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.json({
    ok: true,
    saved: error ? false : true,
    reason: error ? "duplicate_question_hash" : "inserted",
    data: data || null
  });
}
