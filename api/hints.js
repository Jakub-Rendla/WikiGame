<script>
// api/hints.js
// Vercel serverless function for Gemini 2.0 Flash
// Env var required: GOOGLE_API_KEY (set in Vercel → Project → Settings → Environment Variables)

export default async function handler(req, res) {
  // --- CORS (loose for dev; tighten to your domains later) ---
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing GOOGLE_API_KEY' });

    const { context } = req.body || {};
    if (!context || typeof context !== 'string') {
      return res.status(400).json({ error: 'Missing "context" string' });
    }

    // keep input small → fast & cheap
    const MAX_INPUT = 9000;
    const ctx = context.length > MAX_INPUT ? context.slice(0, MAX_INPUT) : context;

    const system = `Jsi nápovědní asistent pro WikiGame. Dostaneš čistý text článku.
- Odpovídej česky.
- Vrať 5–6 velmi krátkých otázek (max ~90 znaků), každou na novém řádku.
- Zviditelni pojmy, data, místa, jména. Žádné vysvětlování, žádné číslování.
– Za otázku dej tečku. A za ni napiš Odpověď: a sem dej správnou odpověď`;
    const user = `Text článku (zkrácený):\n"""${ctx}"""\n\nVrať pouze otázky, každou na novém řádku.`;

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

    const r = await fetch(`${url}?key=${apiKey}`, {
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
      const errText = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Gemini error', details: errText });
    }

    const data = await r.json();
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
</script>
