// api/hints-gpt-single.js
// GPT-4o-mini — FINAL STABLE VERSION
// - nodejs runtime
// - few-shot (2 GOOD + 1 BAD)
// - softened validation
// - no meta references
// - strict JSON output
// - minimal but safe restrictions

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
  const m = str.match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

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

  // Softer now: 30% not 50%
  return overlap < Math.ceil(titleWords.length * 0.3);
}

function validateAnswers(obj, title) {
  if (!obj || !obj.answers || !Array.isArray(obj.answers)) return false;

  const q = obj.question.toLowerCase();

  // answer inside question?
  for (const ans of obj.answers) {
    const a = ans.toLowerCase().trim();
    if (a.length >= 3 && q.includes(a)) return false;
    if (!validateTitleFilter(ans, title)) return false;
  }

  // numeric consistency (softer)
  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];

  if (correct !== null) {
    for (let i = 0; i < nums.length; i++) {
      if (i === obj.correctIndex) continue;
      const fake = nums[i];
      if (fake === null) continue;

      const diff = Math.abs(fake - correct);
      const rel = diff / Math.max(1, Math.abs(correct));

      // Softer rule
      if (diff < 5 || rel < 0.05) return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------
   Prompt with SAFE FEW-SHOTS
------------------------------------------------------------- */
function buildPrompt(lang, title) {
  return `
Generate ONE quiz question in STRICT JSON format only.

FORMAT:
{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 0
}

GOOD EXAMPLES:
1)
{
  "question": "Který faktor nejvíce přispěl k růstu města?",
  "answers": ["Rozvoj obchodu","Nedostatek vody","Zákaz těžby"],
  "correctIndex": 0
}

2)
{
  "question": "Kdo vedl výpravu popsanou v textu?",
  "answers": ["John Hunt","Charles Baker","Arthur Davis"],
  "correctIndex": 0
}

BAD EXAMPLE (do not imitate):
"Co tento článek uvádí o X?"

RULES:
- Use ONLY explicit facts from the article.
- DO NOT reference the article or text itself (no: "v článku", "text uvádí").
- DO NOT use extraction questions.
- Answer must NOT equal the article title: "${title}".
- Keep answers same type.
- No invented facts.
- Output JSON ONLY.
- Language: ${lang}
`.trim();
}

/* -------------------------------------------------------------
   Slice logic
------------------------------------------------------------- */
function pickSlice(text) {
  if (text.length < 3500) return text;

  if (Math.random() < 0.5) return text;

  const sliceLen = 3000 + Math.floor(Math.random() * 600);
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
    return res.status(200).json({ ok: true, info: "Use POST" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

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
  catch { return res.status(500).json({ error: "Invalid JSON", rawText: text }); }

  if (!validateAnswers(obj, title)) {
    return res.status(500).json({ error: "Answer validation failed", obj });
  }

  return res.status(200).json(obj);
}
