// api/debug.js
// Diagnostic endpoint to see what's REALLY running on Vercel

export const config = { runtime: "nodejs" };

import fs from "fs";
import path from "path";
import crypto from "crypto";

export default async function handler(req, res) {
  const apiDir = path.join(process.cwd(), "api");

  let files = [];
  try {
    files = fs.readdirSync(apiDir).map(name => {
      const full = path.join(apiDir, name);
      const content = fs.readFileSync(full, "utf8");

      return {
        name,
        size: content.length,
        hash: crypto.createHash("md5").update(content).digest("hex"),
        preview: content.slice(0, 200)
      };
    });
  } catch (err) {
    files = [{ error: "Cannot read api directory", details: err.toString() }];
  }

  return res.status(200).json({
    status: "DEBUG OK",
    now: Date.now(),
    node: process.version,
    cwd: process.cwd(),
    apiDirectory: apiDir,
    files,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "present" : "missing"
    }
  });
}
