// api/hints.js
// Serverless function for Gemini 2.0 Flash-Lite (fast & cheap)
// Requires env GOOGLE_API_KEY on Vercel

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ------------------------------------------------------------------
   STRICT GAME PROMPT (3 sets, highly structured)
------------------------------------------------------------------ */
function strictGamePrompt(lang = "cs") {
  return `
Vygeneruj PŘESNĚ 3 různé sady kvízových otázek z dodaného textu.

Každá sada musí být ve formátu přesně:

Otázka?
a) možnost A
b) možnost B
c) možnost C

POŽADAVKY:
- Každá sada obsahuje přesně 1 otázku + 3 možnosti.
- Správnou možnost označ tak, že za ni dáš "(ano)" — např. "b) Oliva (ano)".
- Ostatní možnosti musí být věrohodné (falešné, ale relevantní).
- Každá otázka musí být jasná, krátká, faktická (jména, pojmy, místa, roky).
- Bez úvodů, bez shrnutí, bez dodatečného textu.
- Žádné prázdné řádky mezi sadami.
`.trim();
}

/* ------------------------------------------------------------------
   FACTS prompt (použit jen když mode=facts)
------------------------------------------------------------------ */
function strictFactsPrompt() {
  return `
Vygeneruj 5–6 řádků faktů z dodaného textu, každý přesně:

Otázka? Odpověď: krátká správná odpověď

- Jedna otázka + jedna odpověď na jednom řádku.
- Žádné seznamy, žádné další věty.
`.trim();
}

export default async function handler(req, res) {
  try {
    const origin = req.headers?.origin || "*";

    // Preflight
    if (req.method === "OPTIONS") {
      setCors(res, origin);
      return res.status(204).end();
    }

    if (req.method !== "POST") {
      setCors(res, origin);
      return res.status(200).json({ ok: true, info: "Use POST" });
    }

    setCors(res, origin);

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error("[hints] Missing GOOGLE_API_KEY");
      return res.status(500).json({ error: "Missing GOOGLE_API_KEY" });
    }

    // Parse body
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { context, mode = "facts", lang = "cs" } = body;
    if (!context || typeof context !== "string") {
      return res.status(400).json({ error: 'Missing "context" string' });
    }

    /* --------------------------------------------------------------
       Limit input for speed (Flash-Lite loves shorter input)
    -------------------------------------------------------------- */
    const MAX_INPUT = 4500;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    /* --------------------------------------------------------------
       Build prompts
    -------------------------------------------------------------- */
    const system = mode === "game"
      ? strictGamePrompt(lang)
      : strictFactsPrompt();

    const user = `Zde je text článku:\n"""${ctx}"""\n\nDodrž prosím formát pro mód: ${mode}.`;

    /* --------------------------------------------------------------
       CALL GEMINI 2.0 FLASH-LITE (FASTER)
    -------------------------------------------------------------- */
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: system }] },
          { role: "user", parts: [{ text: user }] }
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 220, // optimal for 3 sets
        }
      })
    });

    if (!r.ok) {
      const details = await r.text().catch(() => "");
      console.error("[hints] Gemini error:", r.status, details?.slice?.(0, 200));
      return res.status(r.status).json({ error: "Gemini error", details });
    }

    const data = await r.json().catch((e) => {
      console.error("[hints] JSON parse error:", e);
      return null;
    });

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("")
        ?.trim() || "";

    const hints = text.replace(/\r\n/g, "\n").trim();

    return res.status(200).json({ hints, mode });
  } catch (e) {
    console.error("[hints] fatal", e);
    return res.status(500).json({
      error: "Internal error",
      details: e?.toString()
    });
  }
}
