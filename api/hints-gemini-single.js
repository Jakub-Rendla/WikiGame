// api/hints-gemini-single.js
// Gemini Flash-Lite — Node.js version + retry + few-shot

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
   Prompt
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

- Nepoužívej meta reference („v článku“, „text uvádí“…).
- Odpověď nesmí být podobná názvu článku "${title}".
- Žádné vymyšlené údaje.
- Preferuj příčiny, následky, role, funkce.
- Jazyk: ${lang}
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
   Single Gemini call
------------------------------------------------------------- */
async function tryGemini(apiKey, systemPrompt, userPrompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "user", parts: [{ text: userPrompt }] }
      ],
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 200
      }
    })
  });

  const data = await response.json().catch(() => null);
  const txt =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

  try {
    const match = txt.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
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

    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST")
      return res.status(200).json({ ok: true, info: "Use POST" });

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    let final = null;

    // Retry loop
    for (let i = 0; i < 2; i++) {
      const chosen = pickSlice(context);
      const system = buildGeminiPrompt(lang, title);
      const user = `Zde je text článku:\n"""${chosen}"""\nVrať striktně JSON.`;

      const obj = await tryGemini(apiKey, system, user);

      if (obj && validateAnswers(obj, title)) {
        final = obj;
        break;
      }
    }

    if (!final)
      return res.status(500).json({ error: "Answer validation failed (retry)" });

    return res.status(200).json(final);
  } catch (e) {
    return res.status(500).json({ error: "Internal error", details: e.toString() });
  }
}

/* -------------------------------------------------------------
   Raw body helper for Node
------------------------------------------------------------- */
function getRawBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
  });
}
