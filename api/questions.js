// api/questions.js
// Unified WikiGame question generator with Supabase caching.
// CORS + GPT + Gemini + caching + full validation

export const config = { runtime: "nodejs" };

import { createClient } from '@supabase/supabase-js';
import crypto from "crypto";

/* ---------------------------------------------------------
   CORS
--------------------------------------------------------- */
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ---------------------------------------------------------
   Supabase client
--------------------------------------------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */

// hash článku → cache
function hashArticle(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// extrakce čísel z odpovědi
function extractNumber(str) {
  const m = str.match(/-?\d+(?:[\.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

// hash otázky → aby nebyly duplicity
function hashQuestion(q) {
  const norm = (q.question + "||" + q.answers.join("|"))
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

  return crypto.createHash("sha256").update(norm).digest("hex");
}

// náhodný slicing kontextu pro pestrost
function pickSlice(full) {
  const len = full.length;
  if (len < 3500) return full;
  if (Math.random() < 0.5) return full;

  const sliceLen = 3000 + Math.floor(Math.random() * 600);
  const maxStart = Math.max(0, len - sliceLen);
  const start = Math.floor(Math.random() * maxStart);
  return full.slice(start, start + sliceLen);
}

/* ---------------------------------------------------------
   Title similarity filter
--------------------------------------------------------- */
function titleFilterOK(answer, title) {
  if (!title || title.trim().length < 3) return true;

  const a = answer.toLowerCase().trim();
  const t = title.toLowerCase().trim();

  if (a === t) return false;

  const titleWords = t.split(/\s+/).filter(w => w.length >= 3);
  const ansWords = a.split(/\s+/);

  let overlap = 0;
  for (const tw of titleWords) {
    for (const aw of ansWords) {
      if (aw === tw) overlap++;
    }
  }

  return overlap < Math.ceil(titleWords.length * 0.5);
}

/* ---------------------------------------------------------
   Question validations
--------------------------------------------------------- */
function validateQuestion(obj, title) {
  if (!obj) return false;
  if (!obj.question || !Array.isArray(obj.answers)) return false;
  if (obj.answers.length !== 3) return false;
  if (obj.correctIndex < 0 || obj.correctIndex > 2) return false;

  const qLower = obj.question.toLowerCase();

  // answer-in-question check
  for (const ans of obj.answers) {
    const a = ans.toLowerCase().trim();
    if (a.length >= 3 && qLower.includes(a)) return false;
  }

  // title similarity
  for (const ans of obj.answers) {
    if (!titleFilterOK(ans, title)) return false;
  }

  // numeric diversity
  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];

  if (correct !== null) {
    for (let i = 0; i < 3; i++) {
      if (i === obj.correctIndex) continue;
      const fake = nums[i];
      if (fake === null) continue;

      const diff = Math.abs(fake - correct);
      const rel = diff / Math.max(1, Math.abs(correct));

      if (diff < 10 || rel < 0.10) return false;
    }
  }

  return true;
}

/* ---------------------------------------------------------
   GPT generator
--------------------------------------------------------- */
async function generateViaGPT(context, lang, title) {
  const sys = `
Generate ONE quiz question in JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

Rules:
- No markdown.
- Question must NOT contain the correct answer.
- Correct answer must NOT be similar to article title: "${title}".
- Incorrect numeric answers must differ significantly.
- Language: ${lang}.
  `.trim();

  const user = `ARTICLE TEXT:\n"""${pickSlice(context)}"""`;

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      temperature: 0.6,
      max_output_tokens: 180
    })
  });

  const j = await r.json();
  const text = j?.output?.[0]?.content?.[0]?.text;
  if (!text) return null;

  try { return JSON.parse(text); }
  catch { return null; }
}

/* ---------------------------------------------------------
   Gemini generator
--------------------------------------------------------- */
function extractJSON(text) {
  if (!text) return null;
  let t = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = t.match(/\{[\s\S]*\}/);
  return match ? match[0] : t;
}

async function generateViaGemini(context, lang, title) {
  const sys = `
Vytvoř přesně 1 otázku v JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

Požadavky:
- Otázka nesmí obsahovat správnou odpověď.
- Správná odpověď nesmí být podobná názvu článku („${title}“).
- Číselné odpovědi musí být výrazně odlišné.
- Jazyk: ${lang}.
- Bez markdownu.
  `.trim();

  const user = `Zde je text článku:\n"""${pickSlice(context)}"""\nVrať pouze JSON.`;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GOOGLE_API_KEY}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: sys }] },
        { role: "user", parts: [{ text: user }] }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 200
      }
    })
  });

  const j = await r.json();
  const raw = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  const jsonText = extractJSON(raw);

  try { return JSON.parse(jsonText); }
  catch { return null; }
}

/* ---------------------------------------------------------
   MAIN HANDLER
--------------------------------------------------------- */
export default async function handler(req, res) {
  const origin = req.headers?.origin || "*";
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const { context = "", lang = "cs", title = "" } = req.body;
    if (!context) return res.status(400).json({ error: "Missing context" });

    const article_hash = hashArticle(context);

    /* -----------------------------------------------------
       1) CACHE READ
    ----------------------------------------------------- */
    const cached = await supabase
      .from("wiki_questions")
      .select("*")
      .eq("article_hash", article_hash)
      .eq("lang", lang)
      .eq("is_removed", false)
      .limit(12);

    if (cached.data && cached.data.length >= 8) {
      const q = cached.data[Math.floor(Math.random() * cached.data.length)];
      return res.status(200).json({
        question: q.question,
        answers: q.answers,
        correctIndex: q.correct_index
      });
    }

    /* -----------------------------------------------------
       2) CACHE MISS → GENERATE MORE
    ----------------------------------------------------- */
    const missing = 12 - (cached.data?.length || 0);
    let generated = [];

    for (let i = 0; i < missing; i++) {
      const viaGPT    = await generateViaGPT(context, lang, title);
      const viaGemini = await generateViaGemini(context, lang, title);
      const cand      = viaGPT || viaGemini;

      if (cand && validateQuestion(cand, title)) {

        const qHash = hashQuestion(cand);

        const { error: insertError } = await supabase
          .from("wiki_questions")
          .insert([{
            article_hash,
            lang,
            question: cand.question,
            answers: cand.answers,
            correct_index: cand.correctIndex,
            question_hash: qHash,
            model_text: viaGPT ? "gpt" : "gemini",
            is_removed: false
          }]);

        if (insertError) {
          console.error("[questions] INSERT ERROR:", insertError);
        }

        generated.push(cand);
      }
    }

    /* -----------------------------------------------------
       3) RETURN ANY VALID QUESTION
    ----------------------------------------------------- */
    const pool = [...(cached.data || []), ...generated];
    if (!pool.length) {
      return res.status(500).json({ error: "No valid questions generated" });
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];

    return res.status(200).json({
      question: pick.question,
      answers: pick.answers,
      correctIndex: pick.correct_index ?? pick.correctIndex
    });

  } catch (err) {
    console.error("[questions] FATAL:", err);
    return res.status(500).json({ error: err.toString() });
  }
}
