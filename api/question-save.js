// api/question-save.js
// Saves generated question into wiki_questions table

export const config = { runtime: "nodejs" };

import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

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

  if (!question_hash)
    return res.status(400).json({ error: "Missing question_hash" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
  if (!supabaseUrl || !supabaseKey)
    return res.status(500).json({ error: "Missing Supabase keys" });

  const supabase = createClient(supabaseUrl, supabaseKey);

  const payload = {
    question_hash,
    question,
    answers,
    correct_index,
    model,
    article_hash,
    context_slice,
    topic_title,
    lang
  };

  console.log("[SAVE QUESTION] Payload:", payload);

  const { data, error } = await supabase
    .from("wiki_questions")
    .insert(payload)
    .select();

  if (error) {
    console.error("[SAVE QUESTION ERROR]", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, data });
}
console.log("ENV CHECK", {
  url: process.env.SUPABASE_URL,
  anon: process.env.SUPABASE_ANON_KEY ? "OK" : "MISSING",
  service: process.env.SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING"
});
