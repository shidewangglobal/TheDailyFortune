const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4180;
const PUBLIC_DIR = path.join(__dirname, "public");
const GEMINI_PLAYBOOK_PATH = path.join(__dirname, "docs", "GEMINI_ENGINE_PLAYBOOK_V1.md");
let geminiPlaybook = "";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(clean).replace(/^(\.\.[/\\])+/, "");
  return normalized;
}

function loadGeminiPlaybook() {
  try {
    geminiPlaybook = fs.readFileSync(GEMINI_PLAYBOOK_PATH, "utf-8");
  } catch (_) {
    geminiPlaybook = "";
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function callGeminiAnalysis(payload) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(apiKey);
  const prompt = [
    "SYSTEM PLAYBOOK (MUST FOLLOW):",
    geminiPlaybook || "Fallback: Write 3 Vietnamese paragraphs, practical and non-generic.",
    "",
    "TASK:",
    "Produce a practical interpretation in Vietnamese using Luc Nham + Hoa Giap input JSON.",
    "Do not output bullet list.",
    "Focus on relation between day/hour and owner fate for this specific event.",
    "Do NOT use generic sales templates if topic is not sales.",
    "Output MUST be 170-260 Vietnamese words.",
    "",
    "INPUT JSON:",
    JSON.stringify(payload)
  ].join("\n");
  const buildBody = (textPrompt) => ({
    contents: [{ role: "user", parts: [{ text: textPrompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1200,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  });
  const generate = async (textPrompt) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(textPrompt))
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error("Gemini API error: " + resp.status + " " + txt.slice(0, 300));
    }
    const data = await resp.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("\n")
      .trim();
    if (!text) throw new Error("Gemini empty response");
    return text.trim();
  };

  let text = await generate(prompt);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 120) {
    const retryPrompt = [
      "Bạn vừa trả lời quá ngắn và chưa đạt chuẩn dashboard.",
      "Hãy viết lại thành 3 đoạn văn liên tục, 180-260 từ, có chiều sâu, không bullet, không lặp.",
      "Bắt buộc giải thích rõ: quẻ chính, mệnh ngày/gia chủ, giờ thuận-tránh và hành động cụ thể.",
      "",
      "INPUT JSON:",
      JSON.stringify(payload)
    ].join("\n");
    const retryText = await generate(retryPrompt);
    if (retryText.split(/\s+/).filter(Boolean).length > words) text = retryText;
  }
  // Avoid returning obviously cut-off one-liners.
  const sentenceEnd = /[.!?…]$/.test(text);
  if (!sentenceEnd && text.split(/\s+/).filter(Boolean).length < 80) {
    const finalizePrompt = [
      "Nội dung trước bị cụt. Hãy viết lại trọn vẹn 3 đoạn tiếng Việt, không bullet, 170-260 từ.",
      "Bám đúng dữ liệu input, tập trung lý giải vì sao và gợi ý hành động phù hợp.",
      "",
      "INPUT JSON:",
      JSON.stringify(payload)
    ].join("\n");
    text = await generate(finalizePrompt);
  }
  return text;
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/fortune/analyze") {
    readJsonBody(req)
      .then((payload) => callGeminiAnalysis(payload))
      .then((analysis) => send(res, 200, JSON.stringify({ ok: true, analysis, source: "gemini" }), "application/json; charset=utf-8"))
      .catch((err) => {
        const message = String(err && err.message ? err.message : err);
        const status = message.includes("Missing GEMINI_API_KEY") ? 503 : 500;
        send(res, status, JSON.stringify({ ok: false, error: message }), "application/json; charset=utf-8");
      });
    return;
  }

  const urlPath = req.url === "/" ? "/dashboard-purple.html" : req.url;
  const reqPath = safePath(urlPath);
  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, "Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, "Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = CONTENT_TYPES[ext] || "application/octet-stream";
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return send(res, 500, "Server error");
      send(res, 200, data, type);
    });
  });
});

loadGeminiPlaybook();
server.listen(PORT, () => {
  console.log(`Daily fortune is running at http://localhost:${PORT}`);
});
