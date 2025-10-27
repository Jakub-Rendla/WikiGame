// api/hints.js
// Vercel serverless function for Gemini 2.0 Flash
// Env var required: GOOGLE_API_KEY (set in Vercel → Project → Settings → Environment Variables)

// optional: pin runtime
export const config = { runtime: 'nodejs' };

// permissive CORS for initial bring-up (you can tighten later)
function setCors(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  try {
    const origin = req.headers?.origin || '*';

    // Preflight
    if (req.method === 'OPTIONS') {
      setCors(res, origin);
      return res.status(204).end();
    }

    // GET → simple info (avoid 500 on direct visit)
    if (req.method !== 'POST') {
      setCors(res, origin);
      return res.status(200).json({ error: 'Use POST', ok: true });
    }

    setCors(res, origin);

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('[hints] Missing GOOGLE_API_KEY');
      return res.status(500).json({ error: 'Missing GOOGLE_API_KEY' });
    }

    // robust body parse
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* ignore */ }
    }
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { context } = body || {};
    if (!context || typeof context !== 'string') {
      return res.status(400).json({ error: 'Missing "context" string' });
    }

    // limit input for latency/cost
    const MAX_INPUT = 9000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = `Jsi nápovědní asistent pro WikiGame. Dostaneš čistý text článku.
- Odpovídej česky.
- Vrať 5–6 velmi krátkých otázek (max ~90 znaků), každou na novém řádku.
- Zaměř se na důležité pojmy, jména, data, události nebo místa.
- Nepoužívej zvýraznění, formátování ani číslování.
- Každá otázka končí tečkou. Za ní napiš "Odpověď:" a krátkou správnou odpověď.`;

    const user = `Text článku (zkrácený):\n"""${ctx}"""\n\nVrať pouze otázky s odpovědí, každou na novém řádku.`;

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    const r = await fetch(`${url}?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: system }] },
          { role: 'user', parts: [{ text: user }] }
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
      })
    });

    if (!r.ok) {
      const details = await r.text().catch(() => '');
      console.error('[hints] Gemini error:', r.status, details?.slice?.(0, 200));
      return res.status(r.status).json({ error: 'Gemini error', details });
    }

    const data = await r.json().catch(e => {
      console.error('[hints] JSON parse error:', e);
      return null;
    });

    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('')?.trim() ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '';

    const hints = (text || '').replace(/\r\n/g, '\n').trim();
    return res.status(200).json({ hints });
  } catch (e) {
    console.error('[hints] fatal', e);
    return res.status(500).json({ error: 'Někde se něco pokazilo. Sorry. Zkus to znovu nebo nahlaš chybu, prosím.' });
  }
}
