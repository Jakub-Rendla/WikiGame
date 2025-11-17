// api/hints-gpt-single.js
// GPT-4o-mini — BALANCED VERSION
// - nodejs runtime
// - 1 GOOD example
// - 1 BAD example
// - softened validation
// - reference-avoid (soft rule)
// - very stable for mini models
// - strict JSON output

export const config = { runtime: "nodejs" };

/* -------------------------------------------------------------
   CORS
------------------------------------------------------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

/* -------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
function extractNumber(str) {
  const m = str?.match?.(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

/* Softer title alias rule */
function validateTitleFilter(answer, title) {
  if (!title || title.trim().length < 3) return true;

  const a = answer.toLowerCase();
  const t = title.toLowerCase();
  if (a === t) return false;

  const titleWords = t.split(/\s+/).filter(w => w.length >= 3);
  const ansWords = a.split(/\s+/);

  let overlap = 0;
  for (const tw of titleWords) {
    if (ansWords.includes(tw)) overlap++;
  }

  // Balanced: 15 % threshold
  return overlap < Math.ceil(titleWords.length * 0.15);
}

/* Softer, balanced validation */
function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const qLower = obj.question.toLowerCase();

  // NO answer inside question
  for (const ans of obj.answers) {
    const a = ans.toLowerCase().trim();
    if (a.length >= 3 && qLower.includes(a)) return false;
    if (!validateTitleFilter(ans, title)) return false;
  }

  // Balanced numeric filter:
  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];
  if (correct !== null) {
    for (let i = 0; i < nums.length; i++) {
      if (i === obj.correctIndex) continue;

      const fake = nums[i];
      if (fake === null) continue;

      const diff = Math.abs(fake - correct);
      const rel = diff / Math.max(1, Math.abs(correct));

      // Balanced thresholds:
      if (diff < 3 && rel < 0.03) return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------
   BALANCED PROMPT (short, stable)
------------------------------------------------------------- */
function buildPrompt(lang, title) {
  return `
Generate ONE quiz question in STRICT JSON:

{
  "question": "...",
  "answers": ["A", "B", "C"],
  "correctIndex": 0
}

GOOD EXAMPLE:
{
  "question": "Kdo vedl expedici popsanou v textu?",
  "answers": ["John Hunt","Charles Baker","Arthur Davis"],
  "correctIndex": 0
}

BAD EXAMPLE (do not imitate):
"Co článek uvádí o X?"

RULES:
- Use ONLY facts from the provided text.
- Avoid referencing the article directly (no “v článku”, “text uvádí”).
- Avoid pure extraction questions.
- Correct answer must NOT equal the article title: "${title}".
- Prefer context-based: roles, causes, consequences, functions.
- Answers must be of the same type.
- Language: ${lang}
- Output JSON only.
`.trim();
}

/* -------------------------------------------------------------
   Slice
------------------------------------------------------------- */
function pickSlice(text) {
  if (text.length < 3500) return text;
  if (Math.random() < 0.5) return text;

  const sliceLen = 3000 + Math.floor(Math.random() * 500);
  const maxStart = Math.max(0, text.length - sliceLen);
  const start = Math.floor(Math.random() * maxStart);
  return text.slice(start, start + sliceLen);
}

/* -------------------------------------------------------------
   Handler
------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(200).json({ ok: true, info: "POST only" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  let body = req.body;
  if (typeof body === "string") try { body = JSON.parse(body); } catch {}

  const { context = "", lang = "cs", title = "" } = body || {};
  if (!context) return res.status(400).json({ error: "Missing context" });

  const chosen = pickSlice(context);
  const systemPrompt = buildPrompt(lang, title);
  const userPrompt = `ARTICLE:\n"""${chosen}"""`;

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.55,
      max_output_tokens: 200
    })
  });

  const raw = await r.json().catch(() => null);
  if (!raw) return res.status(500).json({ error: "Invalid OpenAI response" });

  const text = raw?.output?.[0]?.content?.[0]?.text;
  if (!text) return res.status(500).json({ error: "Empty output", raw });

  let obj;
  try { obj = JSON.parse(text); }
  catch {
    return res.status(500).json({ error: "Invalid JSON", rawText: text });
  }

  if (!validateAnswers(obj, title)) {
    return res.status(500).json({ error: "Answer validation failed", obj });
  }

  return res.status(200).json(obj);
}
