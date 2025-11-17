// api/hints-gpt-single.js
// GPT-4o-mini single question generator (improved with 3 GOOD + 3 BAD few-shot)
// - title-aware
// - numeric filter
// - answer-in-question filter
// - random slice
// - strict JSON
// - strong prompt
// - 3 GOOD + 3 BAD few-shot
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
   Title-aware filter
------------------------------------------------------------- */
function validateTitleFilter(answer, title) {
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

/* -------------------------------------------------------------
   Global validation
------------------------------------------------------------- */
function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const qLower = obj.question.toLowerCase();

  for (const ans of obj.answers) {
    const a = ans.toLowerCase().trim();
    if (a.length >= 3 && qLower.includes(a)) return false;
  }

  for (const ans of obj.answers) {
    if (!validateTitleFilter(ans, title)) return false;
  }

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
   GPT PROMPT (with 3 GOOD + 3 BAD few-shot)
------------------------------------------------------------- */
function buildPrompt(lang, title) {
  return `
Generate ONE quiz question in STRICT JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

======================
GOOD EXAMPLES
======================

GOOD 1:
{
  "question": "Které město sloužilo jako hlavní centrum obchodu?",
  "answers": ["Siena","Arezzo","Perugia"],
  "correctIndex": 0
}

GOOD 2:
{
  "question": "Kdo vedl expedici popsanou v textu?",
  "answers": ["John Hunt","George Hall","Arthur Jamison"],
  "correctIndex": 0
}

GOOD 3:
{
  "question": "Co způsobilo rozsáhlé poškození města?",
  "answers": ["Záplavy po protržení hráze","Rozsáhlé požáry","Zemětřesení v sousední provincii"],
  "correctIndex": 0
}

======================
BAD EXAMPLES
======================

BAD 1:
"Co podle tohoto článku autor tvrdí?"   // meta reference — forbidden

BAD 2:
{
  "question": "Jaký byl rok 1875?",
  "answers": ["1875","1876","1874"],
  "correctIndex": 0
}   // answers too similar

BAD 3:
{
  "question": "Které tři stavby článek zmiňuje?",
  "answers": ["...","...","..."],
  "correctIndex": 1
}   // extraction question — forbidden


======================
RULES
======================

- Use ONLY explicit facts from the article text.
- NEVER reference the article itself (forbidden: "v tomto článku", "text uvádí", "podle textu", etc.).
- The question must be fully self-standing (no meta layer).
- Do NOT repeat or restate the article title: "${title}".
- The correct answer must NOT equal or be too similar to the article title.
- All answers must be homogeneous type (all people / all cities / all dates / all objects).
- No invented facts. No hallucinations.
- No trivial universal facts unless explicitly present in the text.
- Prefer deeper context: causes, roles, processes, functions, chronology.
- The correct answer must not appear inside the question text.
- Output STRICT JSON ONLY.
- Language: ${lang}
`.trim();
}

/* -------------------------------------------------------------
   Slice
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
        temperature: 0.55,
        max_output_tokens: 180
      })
    });

    const raw = await r.json();
    if (!raw || raw.error) return res.status(500).json({ error: "OpenAI error", raw });

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
