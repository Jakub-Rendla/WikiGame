// api/hints-gpt-single.js
// GPT-4o-mini — Node.js version + retry + few-shot

export const config = { runtime: "nodejs" };

/* -------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
function extractNumber(str) {
  const m = str.match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

function validateTitleFilter(answer, title) {
  if (!title || title.trim().length < 3) return true;

  const a = answer.toLowerCase().trim();
  const t = title.toLowerCase().trim();

  if (a === t) return false;

  const titleWords = t.split(/\s+/).filter(w => w.length >= 3);
  const ansWords = a.split(/\s+/);

  let overlap = 0;
  for (const tw of titleWords) {
    if (ansWords.includes(tw)) overlap++;
  }

  return overlap < Math.ceil(titleWords.length * 0.5);
}

function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const q = obj.question.toLowerCase();

  // forbidden: answer contained in question
  for (const ans of obj.answers) {
    const a = ans.toLowerCase();
    if (a.length >= 3 && q.includes(a)) return false;
    if (!validateTitleFilter(ans, title)) return false;
  }

  // numeric checks
  const nums = obj.answers.map(extractNumber);
  const correct = nums[obj.correctIndex];

  if (correct !== null) {
    for (let i = 0; i < nums.length; i++) {
      if (i === obj.correctIndex) continue;
      const fake = nums[i];
      if (fake === null) continue;

      const diff = Math.abs(fake - correct);
      const rel = diff / Math.max(1, Math.abs(correct));

      if (diff < 10 || rel < 0.1) return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------
   Prompt with few-shot
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
"Co podle tohoto článku text uvádí?" // meta reference

BAD 2:
{
  "question": "Jaký byl rok 1875?",
  "answers": ["1875","1876","1874"],
  "correctIndex": 0
}

BAD 3:
{
  "question": "Které tři věci článek popisuje?",
  "answers": ["...","...","..."],
  "correctIndex": 1
}

======================
RULES
======================

- Use ONLY explicit facts from the article.
- STRICTLY forbid referencing the article (“v tomto článku”, “text říká”…).
- Do NOT repeat or mimic the title: "${title}".
- Avoid extraction questions.
- Correct answer must be distinguishable.
- Language: ${lang}
`.trim();
}

/* -------------------------------------------------------------
   Slice
------------------------------------------------------------- */
function pickSlice(txt) {
  if (txt.length < 3500) return txt;

  if (Math.random() < 0.5) return txt;

  const sliceLen = 3000 + Math.floor(Math.random() * 600);
  const maxStart = Math.max(0, txt.length - sliceLen);
  const start = Math.floor(Math.random() * maxStart);
  return txt.slice(start, start + sliceLen);
}

/* -------------------------------------------------------------
   Single GPT call
------------------------------------------------------------- */
async function tryGPT(apiKey, systemPrompt, userPrompt) {
  const response = await fetch("https://api.openai.com/v1/responses", {
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

  const raw = await response.json().catch(() => null);
  const text = raw?.output?.[0]?.content?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------
   Node handler with retry
------------------------------------------------------------- */
export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      return res.status(200).json({ ok: true, info: "Use POST" });
    }

    // Parse body
    let body = req.body;
    if (!body || typeof body !== "object") {
      try {
        body = JSON.parse(await getRawBody(req));
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const { context = "", lang = "cs", title = "" } = body;
    if (!context) return res.status(400).json({ error: "Missing context" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    let final = null;

    for (let i = 0; i < 2; i++) {
      const chosen = pickSlice(context);
      const system = buildPrompt(lang, title);
      const user = `ARTICLE:\n"""${chosen}"""`;

      const obj = await tryGPT(apiKey, system, user);
      if (obj && validateAnswers(obj, title)) {
        final = obj;
        break;
      }
    }

    if (!final) {
      return res.status(500).json({ error: "Answer validation failed (retry)" });
    }

    return res.status(200).json(final);
  } catch (e) {
    return res.status(500).json({ error: "Fatal", details: e.toString() });
  }
}

/* -------------------------------------------------------------
   Node raw body helper
------------------------------------------------------------- */
function getRawBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
  });
}
