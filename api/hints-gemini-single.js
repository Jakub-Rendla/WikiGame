// api/hints-gemini-single.js
// Gemini Flash-Lite — EDGE RUNTIME + RETRY

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
   Prompt (few-shot)
------------------------------------------------------------- */
function buildGeminiPrompt(lang, title) {
  return `
Vygeneruj přesně 1 otázku jako STRICT JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 1
}

====================
GOOD
====================

GOOD 1:
{
  "question": "Jaký účel plnil hlavní most popsaný v textu?",
  "answers": ["Propojoval obchodní čtvrti","Sloužil jako pevnost","Sběr daní"],
  "correctIndex": 0
}

GOOD 2:
{
  "question": "Kdo inicioval reformu uvedenou v textu?",
  "answers": ["Marcus Livius","Claudius Varro","Publius Metellus"],
  "correctIndex": 0
}

GOOD 3:
{
  "question": "Co bylo bezprostředním důsledkem popsané události?",
  "answers": ["Změna hranic provincie","Kolaps přístavu","Uzavření obchodní trasy"],
  "correctIndex": 0
}

====================
BAD
====================

BAD 1: "Co podle tohoto článku text říká?"
BAD 2: {"question":"Kolik měřil rok 1875?","answers":["1875","1876","1874"],"correctIndex":1}
BAD 3: {"question":"Jaké tři věci článek uvádí?","answers":["...","...","..."],"correctIndex":1}

====================
PRAVIDLA
====================

- Nepoužívej meta reference („text uvádí“, „článek říká“).
- Odpověď nesmí být totožná ani podobná názvu článku "${title}".
- Žádné vymyšlené údaje.
- Preferuj příčiny, následky, role, funkce.
- Odpovědi stejného typu.
- Jazyk: ${lang}
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

function extractJSON(text) {
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

/* -------------------------------------------------------------
   Core Gemini request (single attempt)
------------------------------------------------------------- */
async function tryGenerateGemini(system, user, apiKey) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: system }] },
        { role: "user", parts: [{ text: user }] }
      ],
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 200
      }
    })
  });

  const data = await r.json();
  const txt =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

  const jsonString = extractJSON(txt);
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------
   Handler (EDGE) with retry
------------------------------------------------------------- */
export default async function handler(request) {
  try {
    const { context = "", lang = "cs", title = "" } = await request.json();

    if (!context) {
      return new Response(JSON.stringify({ error: "Missing context" }), {
        status: 400
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY" }), {
        status: 500
      });

    let finalObj = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const chosen = pickSlice(context);
      const system = buildGeminiPrompt(lang, title);
      const user = `Zde je text článku:\n"""${chosen}"""\nVrať striktně JSON.`;

      const obj = await tryGenerateGemini(system, user, apiKey);

      if (obj && validateAnswers(obj, title)) {
        finalObj = obj;
        break;
      }
    }

    if (!finalObj) {
      return new Response(
        JSON.stringify({ error: "Answer validation failed (retry)" }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify(finalObj), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal error", details: e.toString() }),
      { status: 500 }
    );
  }
}
