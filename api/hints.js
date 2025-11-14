// api/hints.js
// Vercel serverless function for Gemini 2.0 Flash

export const config = { runtime: 'nodejs' };

// ---------------------------------------------
// CORS
// ---------------------------------------------
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------------------------------------------
// STRICT PROMPTS – Czech + English
// ---------------------------------------------
// 20 lines total (5 sets * 4 lines)
// Each question:
// Q?
// a) ...
// b) ...
// c) ... (ano)

function strictPromptCS() {
  return `
MÓD: WIKI-GAME STRICT (CS)

Vygeneruj přesně 5 sad otázek z dodaného textu. 
Každá sada obsahuje přesně 4 řádky v tomto formátu:

Otázka?
a) možnost A
b) možnost B
c) možnost C

POVINNÉ:
1) Otázky piš výhradně podle dodaného textu. NEVYMÝŠLEJ fakta, která nejsou uvedena.
2) Označ přesně jednu odpověď pomocí "(ano)".
3) Správná odpověď MUSÍ pocházet z článku.
4) Distraktory MUSÍ být realistické a související s tématem (žádné nesmysly).
5) Přesný formát, žádné číslování, žádné odrážky, žádné jiné řádky.
6) Bez úvodu, komentářů nebo vysvětlování.
7) Výstup = přesně 20 řádků.

PŘÍKLAD DOBŘE:
Kdy začala první světová válka?
a) 1914 (ano)
b) 1939
c) 1905

ŠPATNĚ:
1) Kdy začala... (NE)
A: 1914 ✓ (NE)
Odpověď: 1914 (NE)
`;
}

function strictPromptEN() {
  return `
MODE: WIKI-GAME STRICT (EN)

Generate exactly 5 question sets from the provided text.
Each set must have exactly 4 lines:

Question?
a) option A
b) option B
c) option C

REQUIREMENTS:
1) Base all questions ONLY on the provided article. DO NOT INVENT facts not present there.
2) Mark exactly one correct option with "(yes)".
3) The correct answer MUST be directly supported by the article.
4) Distractors must be realistic and related to the topic.
5) Strict format, no numbering, no bullets, no extra text.
6) No explanations, no introductions, no commentary.
7) Output = exactly 20 lines.

GOOD EXAMPLE:
When did World War II end?
a) 1945 (yes)
b) 1939
c) 1951

BAD EXAMPLE:
1) When did WW2 end? (NO)
Answer: 1945 (NO)
`;
}

// ---------------------------------------------
// CHOOSE PROMPT BASED ON lang = 'cs' or 'en'
// ---------------------------------------------
function getStrictPrompt(lang) {
  return lang === "en" ? strictPromptEN() : strictPromptCS();
}

// ---------------------------------------------
// MAIN HANDLER
// ---------------------------------------------
export default async function handler(req, res) {
  try {
    const origin = req.headers?.origin || "*";

    if (req.method === "OPTIONS") {
      setCors(res, origin);
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      setCors(res, origin);
      return res.status(200).json({ ok: true, error: "Use POST" });
    }

    setCors(res, origin);

    // -------------------------------------
    // PARSE BODY
    // -------------------------------------
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    const { context, mode, lang } = body || {};

    if (!context || typeof context !== "string") {
      return res.status(400).json({ error: 'Missing "context"' });
    }

    const safeLang = (lang === "en" || lang === "cs") ? lang : "cs";
    const safeMode = mode === "game" ? "game" : "facts";

    // -------------------------------------
    // PREPARE PROMPTS
    // -------------------------------------
    const system = safeMode === "game"
      ? getStrictPrompt(safeLang)
      : "You are a fact assistant. Answer concisely.";

    const MAX_INPUT = 9000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const user = `Zkrácený text článku / Source article text:\n"""${ctx}"""\n\nVrať výstup přesně podle instrukcí. Language: ${safeLang}.`;

    // -------------------------------------
    // CALL GEMINI 2.0 FLASH
    // -------------------------------------
    const apiKey = process.env.GOOGLE_API_KEY;
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

    const r = await fetch(`${url}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: system }]},
          { role: "user", parts: [{ text: user }]}
        ],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 340
        }
      })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("[hints] Gemini error:", r.status, t);
      return res.status(r.status).json({ error: "Gemini error", details: t });
    }

    const data = await r.json().catch(e => null);
    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim() ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    const hints = (text || "").trim();

    return res.status(200).json({
      ok: true,
      mode: safeMode,
      lang: safeLang,
      hints
    });

  } catch (err) {
    console.error("[hints] fatal", err);
    return res.status(500).json({
      error: "Server error",
      details: err.toString()
    });
  }
}
