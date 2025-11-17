// api/question-save.js
// Save generated question to wiki_questions

export const config = { runtime: "nodejs" };

function setCors(res, origin = "*") {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Missing Supabase keys" });
  }

  const payload = req.body || {};

  if (!payload.question_hash) {
    return res.status(400).json({ error: "Missing question_hash" });
  }

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/wiki_questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();

    if (!r.ok) {
      return res.status(500).json({
        error: "Supabase insert failed",
        status: r.status,
        body: text
      });
    }

    return res.status(200).json({ ok: true, inserted: payload });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
