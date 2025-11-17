// api/hints-gemini-single.js
// Gemini Flash Lite — FINAL STABLE VERSION
// - few-shots (2 GOOD + 1 BAD)
// - softened validation
// - robust JSON extraction
// - strict JSON output
// - stable prompt

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

  return overlap < Math.ceil(titleWords.length * 0.3);
}

function validateAnswers(obj, title) {
  if (!obj || !Array.isArray(obj.answers)) return false;

  const q = obj.question.toLowerCase();

  for (const ans of obj.answers) {
    const a = ans.toLowerCase().trim();
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

      if (diff < 5 || rel < 0.05) return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------
   Prompt (SAFE FEW SHOTS)
------------------------------------------------------------- */
function buildGeminiPrompt(lang, title) {
  return `
Vygeneruj přesně 1 otázku jako STRICT JSON:

{
  "question": "...",
  "answers": ["A","B","C"],
  "correctIndex": 0
}

GOOD PŘÍKLADY:
1)
{
  "question": "Jaký byl hlavní cíl reformy popsané v textu?",
  "answers": ["Zlepšit správu provincie","Snížit obchod","Zavést nové daně"],
  "correctIndex": 0
}

2)
{
  "question": "Kdo inicioval změnu zmíněnou v textu?",
  "answers": ["Marcus Livius","Varro Atticus","Publius Marus"],
  "correctIndex": 0
}

BAD PŘÍKLAD (nepoužívat):
"Co článek uvádí o X?"

PRAVIDLA:
- Nepoužívej reference na článek („v textu“, „článek říká“).
- Používej pouze fakta z textu.
- Správná odpověď nesmí být stejná jako název článku: "${title}".
- Preferuj: příčiny, role, důsledky.
- Jazyk: ${lang}
- Pouze JSON.
`.trim();
}

/* -------------------------------------------------------------
   Slice
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
   Extract clean JSON
------------------------------------------------------------- */
function extractJSON(text) {
  let cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : cleaned;
}

/* -------------------------------------------------------------
   Handler
------------------------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(200).json({ ok: true, info: "Use POST" });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Missing GOOGLE_API_KEY" });

  let body = req.body;
  if (typeof body === "string") try { body = JSON.parse(body); } catch {}

  const { context = "", lang = "cs", title = "" } = body || {};
  if (!context) return res.status(400).json({ error: "Missing context" });

  const chosen = pickSlice(context);
  const system = buildGeminiPrompt(lang, title);
  const user = `Zde je text:\n"""${chosen}"""\nVrať pouze JSON.`;

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
      generationConfig: { temperature: 0.65, maxOutputTokens: 200 }
    })
  });

  const data = await r.json().catch(() => null);
  if (!data)
    return res.status(500).json({ error: "Invalid Gemini response" });

  let txt =
    data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

  const jsonString = extractJSON(txt);

  let obj;
  try { obj = JSON.parse(jsonString); }
  catch {
    return res.status(500).json({ error: "Invalid JSON", rawText: jsonString });
  }

  if (!validateAnswers(obj, title)) {
    return res.status(500).json({ error: "Answer validation failed", obj });
  }

  return res.status(200).json(obj);
}
