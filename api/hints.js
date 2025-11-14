// api/hints.js — Gemini 2.0 Flash strict prompt (CS/EN), 3 otázkové sady

export const config = { runtime: "nodejs" };

// ---------------------------------------------------------
// CORS
// ---------------------------------------------------------
function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ---------------------------------------------------------
// STRICT PROMPTS – Czech + English
// Přesně 3 sady × 4 řádky = 12 řádků
// ---------------------------------------------------------

function strictPromptCS() {
  return `
MÓD: WIKI-GAME STRICT (CS)

Vygeneruj přesně 3 sady otázek z dodaného textu. 
Každá sada MUSÍ obsahovat přesně 4 řádky v tomto formátu:

Otázka?
a) možnost A
b) možnost B
c) možnost C

POVINNÉ:
1) Otázky vycházejí výhradně z textu článku. NEVYMÝŠLEJ fakta, která nejsou uvedena.
2) Jedna a pouze jedna odpověď MUSÍ být označena "(ano)".
3) Distraktory MUSÍ být realistické a věcně související.
4) Formát je striktní — žádné číslování, odrážky, emoji nebo komentáře.
5) Žádné úvody, žádné vysvětlování, žádné prázdné řádky.
6) Výstup = přesně 12 řádků.

PŘÍKLAD DOBŘE:
Kdy začala první světová válka?
a) 1914 (ano)
b) 1939
c) 1905
`;
}

function strictPromptEN() {
  return `
MODE: WIKI-GAME STRICT (EN)

Generate exactly 3 question sets from the provided text.
Each set MUST contain exactly 4 lines:

Question?
a) option A
b) option B
c) option C

REQUIREMENTS:
1) Base ALL questions strictly on the provided article text.
2) Exactly ONE answer must be marked with "(yes)".
3) Distractors must be realistic and topic-related.
4) STRICT format — no numbering, no bullets, no extra lines.
5) No introductions, no explanations, no empty lines.
6) Output = exactly 12 lines.

GOOD EXAMPLE:
When did World War I begin?
a) 1914 (yes)
b) 1939
c) 1905
`;
}

// Routing for CS / EN
function getStrictPrompt(lang = "cs") {
  return lang === "en" ? strictPromptEN() : strictPromptCS();
}

// ---------------------------------------------------------
// MAIN HANDLER
// ---------------------------------------------------------

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

    // ----------------------------------------
    // Parse incoming JSON
    // ----------------------------------------
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

    // ----------------------------------------
    // Trim long input (speed!)
    // ----------------------------------------
    const MAX_INPUT = 4500;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    // ----------------------------------------
    // Prepare prompts
    // ----------------------------------------
    const system = safeMode === "game"
      ? getStrictPrompt(safeLang)
      : "You are a factual assistant. Answer concisely.";

    const user = `Source article text:\n"""${ctx}"""\n\nVrať výstup přesně podle instrukcí. Language: ${safeLang}.`;

    // ----------------------------------------
    // Call Gemini 2.0 Flash
    // ----------------------------------------
    const apiKey = process.env.GOOGLE_API_KEY;
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

    const r = await fetch(`${url}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: system }] },
          { role: "user", parts: [{ text: user }] }
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 220
        }
      })
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("[hints] Gemini error:", r.status, text);
      return res.status(r.status).json({ error: "Gemini error", details: text });
    }

    const data = await r.json().catch(() => null);

    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("")?.trim() ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    const hints = (text || "").trim();

    return res.status(200).json({
      ok: true,
      lang: safeLang,
      mode: safeMode,
      hints
    });

  } catch (e) {
    console.error("[hints] fatal", e);
    return res.status(500).json({ error: "Server error", details: e.toString() });
  }
}
