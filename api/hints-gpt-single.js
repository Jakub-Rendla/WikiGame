// api/hints-gpt-single.js
// GPT-4o-mini single question generator
// - title-aware
// - numeric filter
// - answer-in-question filter
// - random slice
// - strict JSON
// - robust validation

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* -------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
function extractNumber(str) {
  const m = str.match(/-?\d+(?:[\.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

/* -------------------------------------------------------------
   Title-aware validation
------------------------------------------------------------- */
function validateTitleFilter(answer, title) {
  if (!title || title.trim().length < 3) return true;

  const a = answer.toLowerCase().trim();
  const t = title.toLowerCase().trim();

  // exact match
  if (a === t) return false;

  // split into words
  const titleWords = t.split(/\s+/).filter(w => w.length >= 3);
  const ansWords = a.split(/\s+/);

  if (!titleWords.length) return true;

  let overlap = 0;
  for (const tw of titleWords) {
    for (const aw of ansWords) {
      if (aw === tw) overlap++;
    }
  }

  // ≥50% overlap = too similar
  return overlap < Math.ceil(titleWords.length * 0.5);
}

/* -------------------------------------------------------------
   Global validation
------------------------------------------------------------- */
function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const qLower = obj.question.toLowerCase();

  // Answer-in-question filter
  for (const ans of obj.answers) {
    const a = ans.toLowerCase().trim();
    if (a.length >= 3 && qLower.includes(a)) return false;
  }

  // Title filter ONLY on answers
  for (const ans of obj.answers) {
    if (!validateTitleFilter(ans, title)) return false;
  }

  // Numeric similarity
  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];

  if (correct !== null) {
    for (let i = 0; i < nums.length; i++) {
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

/* -------------------------------------------------------------
   Prompt
------------------------------------------------------------- */
function buildPrompt(lang, title) {
  return `
Generate ONE quiz question in STRICT JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

RULES:
- Use ONLY article text.
- Never reveal the correct answer inside the question.
- The correct answer must NOT be exactly the article title: "${title}".
- Answers must NOT contain the article title or be too similar to it.
- If the answer is numeric, fake answers must differ strongly (±10 or ±10%).
- Language: ${lang}
- No markdown.
`.trim();
}

/* -------------------------------------------------------------
   Random slice
------------------------------------------------------------- */
function pickSlice(full) {
  const len = full.length;
  if (len < 3500) return full;

  if (Math.random() < 0.5) return full;

  const sliceLen = 3000 + Math.floor(Math.random() * 600);
  const maxStart = Math.max(0, len - sliceLen);
  const start = Math.floor(Math.random() * maxStart);
  return full.slice(start, start + sliceLen);
}

/* -------------------------------------------------------------
   Handler
------------------------------------------------------------- */
export default async function handler(req, res) {
  try {
    const origin = req.headers?.origin || "*";

    if (req.method === "OPTIONS") {
      setCors(res, origin);
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      setCors(res, origin);
      return res.status(200).json({ ok: true, info: "Use POST" });
    }

    setCors(res, origin);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    let body = req.body;
    if (typeof body === "string") try { body = JSON.parse(body); } catch {}

    const { context = "", lang = "cs", title = "" } = body;
    if (!context) return res.status(400).json({ error: "Missing context" });

    const chosen = pickSlice(context);
    const systemPrompt = buildPrompt(lang, title);
    const userPrompt = `ARTICLE TEXT:\n"""${chosen}"""`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.60,
        max_output_tokens: 180
      })
    });

    const raw = await r.json().catch(() => null);
    if (!raw) return res.status(500).json({ error: "Invalid OpenAI response" });
    if (raw.error) return res.status(500).json({ error: raw.error });

    const text = raw.output?.[0]?.content?.[0]?.text;
    if (!text) return res.status(500).json({ error: "Empty text", raw });

    let obj;
    try { obj = JSON.parse(text); }
    catch { return res.status(500).json({ error: "Invalid JSON", rawText: text }); }

    if (!validateAnswers(obj, title)) {
      return res.status(500).json({ error: "Answer validation failed", obj });
    }

    return res.status(200).json(obj);

  } catch (e) {
    return res.status(500).json({ error: "Fatal", details: e.toString() });
  }
}
