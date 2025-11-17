// api/hints-gpt-single.js
// GPT-4o-mini single question generator — EDGE RUNTIME VERSION

export const config = { runtime: "edge" };

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

  for (const ans of obj.answers) {
    const a = ans.toLowerCase();
    if (a.length >= 3 && q.includes(a)) return false;
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

      if (diff < 10 || rel < 0.1) return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------
   Prompt (with 3 GOOD + 3 BAD few-shot)
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
"Co podle tohoto článku autor tvrdí?"   // meta reference

BAD 2:
{
  "question": "Jaký byl rok 1875?",
  "answers": ["1875","1876","1874"],
  "correctIndex": 0
}   // answers too similar

BAD 3:
{
  "question": "Které tři věci článek zmiňuje?",
  "answers": ["...","...","..."],
  "correctIndex": 1
}   // extraction question — forbidden


======================
RULES
======================

- Use ONLY explicit facts from the provided article.
- NEVER reference the article itself (forbidden: "v tomto článku", "text uvádí", etc.).
- No meta commentary.
- Do NOT repeat the article title: "${title}".
- Correct answer must NOT be similar to title.
- No invented facts.
- No universal trivia unless explicitly present.
- Prefer deeper context: causes, roles, processes, functions.
- Answers must be homogeneous type.
- Language: ${lang}
`.trim();
}

function pickSlice(txt) {
  if (txt.length < 3500) return txt;

  if (Math.random() < 0.5) return txt;

  const sliceLen = 3000 + Math.floor(Math.random() * 600);
  const maxStart = Math.max(0, txt.length - sliceLen);
  const start = Math.floor(Math.random() * maxStart);
  return txt.slice(start, start + sliceLen);
}

/* -------------------------------------------------------------
   Handler (EDGE)
------------------------------------------------------------- */
export default async function handler(request) {
  try {
    const { context = "", lang = "cs", title = "" } = await request.json();

    if (!context) {
      return new Response(JSON.stringify({ error: "Missing context" }), {
        status: 400
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500
      });

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

    const raw = await r.json();

    const text = raw?.output?.[0]?.content?.[0]?.text;
    if (!text)
      return new Response(JSON.stringify({ error: "Empty text", raw }), {
        status: 500
      });

    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON", rawText: text }),
        { status: 500 }
      );
    }

    if (!validateAnswers(obj, title)) {
      return new Response(
        JSON.stringify({ error: "Answer validation failed", obj }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Fatal", details: e.toString() }), {
      status: 500
    });
  }
}
