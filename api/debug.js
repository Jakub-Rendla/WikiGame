// /api/debug.js
// REAL RAW DEBUG ENDPOINT — returns GPT + Gemini raw output

export const config = { runtime: "nodejs" };

function setCorsHeaders(headers) {
  return {
    ...headers,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

async function askGPT(prompt) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    return {
      httpStatus: response.status,
      raw: await response.json()
    };
  } catch (err) {
    return { error: String(err) };
  }
}

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0 }
      })
    });

    return {
      endpoint: url,
      httpStatus: response.status,
      raw: await response.json()
    };
  } catch (err) {
    return { endpoint: url, error: String(err) };
  }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: setCorsHeaders({})
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "USE_POST" }), {
      status: 405,
      headers: setCorsHeaders({ "Content-Type": "application/json" })
    });
  }

  const { lang = "cs", context } = await req.json();

  if (!context) {
    return new Response(JSON.stringify({ error: "NO_CONTEXT" }), {
      status: 400,
      headers: setCorsHeaders({ "Content-Type": "application/json" })
    });
  }

  const gptPrompt = `DEBUG GPT TEST. LANGUAGE=${lang}\nARTICLE:\n${context}`;
  const gemPrompt = `DEBUG GEMINI TEST. LANGUAGE=${lang}\nARTICLE:\n${context}`;

  const [gpt, gem] = await Promise.all([
    askGPT(gptPrompt),
    askGemini(gemPrompt)
  ]);

  return new Response(
    JSON.stringify({
      debug: true,
      OPENAI_KEY_EXISTS: !!process.env.OPENAI_API_KEY,
      GEMINI_KEY_EXISTS: !!process.env.GEMINI_API_KEY,
      gptPrompt,
      gemPrompt,
      gpt,
      gem
    }),
    {
      status: 200,
      headers: setCorsHeaders({ "Content-Type": "application/json" })
    }
  );
}
