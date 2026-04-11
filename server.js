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

function send(res, status, body, type = "text/plain; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": type, ...extraHeaders });
  res.end(body);
}

const COOKIE_ADMIN = "fortune_admin=1";

function adminProtectionActive() {
  return !!String(process.env.ADMIN_PIN || "").trim();
}

function hasAdminSession(req) {
  if (!adminProtectionActive()) return true;
  const c = req.headers.cookie || "";
  return /(?:^|;\s*)fortune_admin=1(?:;|$)/.test(c);
}

function adminCookieHeader(req) {
  const parts = [`${COOKIE_ADMIN}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 14}; SameSite=Lax`];
  const xfProto = req.headers["x-forwarded-proto"];
  if (xfProto === "https" || process.env.FORCE_SECURE_COOKIE === "1") {
    parts[0] += "; Secure";
  }
  return parts[0];
}

function clearAdminCookieHeader() {
  return `${COOKIE_ADMIN.split("=")[0]}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

const DATA_DIR = path.join(__dirname, "data");
const INVITE_CODES_FILE = path.join(DATA_DIR, "invite_codes.json");
const INVITE_DEFAULTS = {
  "ADMIN-2026": { tier: "admin" },
  "TEST-2026": { tier: "admin" },
};

function normalizeInviteCodeServer(code) {
  return String(code || "")
    .trim()
    .toLowerCase();
}

function mergeInviteCodesFromDisk() {
  let disk = {};
  try {
    if (fs.existsSync(INVITE_CODES_FILE)) {
      const raw = fs.readFileSync(INVITE_CODES_FILE, "utf8");
      disk = JSON.parse(raw || "{}");
      if (!disk || typeof disk !== "object") disk = {};
    }
  } catch (e) {
    console.error("[invite] read disk", e);
    disk = {};
  }
  return { ...INVITE_DEFAULTS, ...disk };
}

function writeInviteCodesToDisk(codes) {
  if (!codes || typeof codes !== "object") throw new Error("Invalid codes");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INVITE_CODES_FILE, JSON.stringify(codes, null, 2), "utf8");
}

let supabaseClientMemo = undefined;
function getSupabaseClient() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  ).trim();
  if (!url || !key) return null;
  if (supabaseClientMemo === undefined) {
    try {
      const { createClient } = require("@supabase/supabase-js");
      supabaseClientMemo = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    } catch (e) {
      console.error("[supabase] init", e);
      supabaseClientMemo = null;
    }
  }
  return supabaseClientMemo || null;
}

function resolveInviteKeyForProfile(code) {
  const q = normalizeInviteCodeServer(code);
  if (!q) return null;
  const merged = mergeInviteCodesFromDisk();
  const keys = Object.keys(merged);
  const key = keys.find((k) => normalizeInviteCodeServer(k) === q);
  if (!key) return null;
  const meta = merged[key];
  if (!meta || typeof meta !== "object") return null;
  return key;
}

function customerRowToProfile(row) {
  if (!row) return null;
  return {
    name: row.name || "",
    contact: row.contact || "",
    birthDay: row.birth_day || "",
    birthMonth: row.birth_month || "",
    birthYear: row.birth_year || "",
    birthHour: row.birth_hour || "",
    updatedAt: row.updated_at || null,
  };
}

function customerProfileLoadHandler(req, res) {
  const supa = getSupabaseClient();
  if (!supa) {
    return send(
      res,
      503,
      JSON.stringify({ ok: false, error: "not_configured" }),
      "application/json; charset=utf-8"
    );
  }
  readJsonBody(req)
    .then(async (body) => {
      const key = resolveInviteKeyForProfile(body && body.code);
      if (!key) return send(res, 200, JSON.stringify({ ok: false }));
      const { data, error } = await supa
        .from("customer_profiles")
        .select("*")
        .eq("invite_code", key)
        .maybeSingle();
      if (error) {
        console.error("[customer-profile/load]", error);
        return send(res, 500, JSON.stringify({ ok: false, error: "db_error" }), "application/json; charset=utf-8");
      }
      if (!data) return send(res, 200, JSON.stringify({ ok: true, profile: null }));
      send(res, 200, JSON.stringify({ ok: true, profile: customerRowToProfile(data) }), "application/json; charset=utf-8");
    })
    .catch(() => send(res, 400, JSON.stringify({ ok: false }), "application/json; charset=utf-8"));
}

function customerProfileSaveHandler(req, res) {
  const supa = getSupabaseClient();
  if (!supa) {
    return send(
      res,
      503,
      JSON.stringify({ ok: false, error: "not_configured" }),
      "application/json; charset=utf-8"
    );
  }
  readJsonBody(req)
    .then(async (body) => {
      const key = resolveInviteKeyForProfile(body && body.code);
      if (!key) {
        return send(res, 403, JSON.stringify({ ok: false, error: "invalid_invite" }), "application/json; charset=utf-8");
      }
      const row = {
        invite_code: key,
        name: String((body && body.name) || "").slice(0, 500),
        contact: String((body && body.contact) || "").slice(0, 500),
        birth_day: String((body && body.birthDay) || "").slice(0, 50),
        birth_month: String((body && body.birthMonth) || "").slice(0, 50),
        birth_year: String((body && body.birthYear) || "").slice(0, 50),
        birth_hour: String((body && body.birthHour) || "").slice(0, 100),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supa.from("customer_profiles").upsert(row, { onConflict: "invite_code" });
      if (error) {
        console.error("[customer-profile/save]", error);
        return send(res, 500, JSON.stringify({ ok: false, error: "db_error" }), "application/json; charset=utf-8");
      }
      send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    })
    .catch(() => send(res, 400, JSON.stringify({ ok: false }), "application/json; charset=utf-8"));
}

function inviteLookupHandler(req, res) {
  readJsonBody(req)
    .then((body) => {
      const q = normalizeInviteCodeServer(body && body.code);
      if (!q) return send(res, 400, JSON.stringify({ ok: false }), "application/json; charset=utf-8");
      const merged = mergeInviteCodesFromDisk();
      const keys = Object.keys(merged);
      const key = keys.find((k) => normalizeInviteCodeServer(k) === q);
      if (!key) return send(res, 200, JSON.stringify({ ok: false }));
      const meta = merged[key];
      if (!meta || typeof meta !== "object") return send(res, 200, JSON.stringify({ ok: false }));
      send(res, 200, JSON.stringify({ ok: true, key, meta }), "application/json; charset=utf-8");
    })
    .catch(() => send(res, 400, JSON.stringify({ ok: false, error: "Bad request" }), "application/json; charset=utf-8"));
}

function inviteCodesGetHandler(req, res) {
  if (adminProtectionActive() && !hasAdminSession(req)) {
    return send(res, 403, JSON.stringify({ ok: false, error: "Cần đăng nhập admin." }), "application/json; charset=utf-8");
  }
  send(res, 200, JSON.stringify({ ok: true, codes: mergeInviteCodesFromDisk() }), "application/json; charset=utf-8");
}

function inviteCodesPostHandler(req, res) {
  if (adminProtectionActive() && !hasAdminSession(req)) {
    return send(res, 403, JSON.stringify({ ok: false, error: "Cần đăng nhập admin để lưu mã." }), "application/json; charset=utf-8");
  }
  readJsonBody(req)
    .then((body) => {
      const codes = body && body.codes;
      if (!codes || typeof codes !== "object") {
        return send(res, 400, JSON.stringify({ ok: false, error: "Thiếu codes" }), "application/json; charset=utf-8");
      }
      const merged = { ...INVITE_DEFAULTS, ...codes };
      writeInviteCodesToDisk(merged);
      send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    })
    .catch(() => send(res, 400, JSON.stringify({ ok: false }), "application/json; charset=utf-8"));
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
    "Output MUST be 260-400 Vietnamese words (three continuous paragraphs).",
    "",
    "INPUT JSON:",
    JSON.stringify(payload)
  ].join("\n");
  const buildBody = (textPrompt) => ({
    contents: [{ role: "user", parts: [{ text: textPrompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
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
  if (words < 180) {
    const retryPrompt = [
      "Bạn vừa trả lời quá ngắn và chưa đạt chuẩn dashboard.",
      "Hãy viết lại thành 3 đoạn văn liên tục, 260-400 từ, có chiều sâu, không bullet, không lặp.",
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
  if (!sentenceEnd && text.split(/\s+/).filter(Boolean).length < 120) {
    const finalizePrompt = [
      "Nội dung trước bị cụt. Hãy viết lại trọn vẹn 3 đoạn tiếng Việt, không bullet, 260-400 từ.",
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
  if (req.method === "POST" && req.url === "/api/admin/login") {
    readJsonBody(req)
      .then((body) => {
        const expected = String(process.env.ADMIN_PIN || "").trim();
        if (!expected) {
          return send(
            res,
            503,
            JSON.stringify({ ok: false, error: "Server chưa cấu hình ADMIN_PIN." }),
            "application/json; charset=utf-8"
          );
        }
        const pin = String((body && body.pin) || "").trim();
        if (pin !== expected) {
          return send(res, 401, JSON.stringify({ ok: false, error: "Mã PIN không đúng." }), "application/json; charset=utf-8");
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Set-Cookie": adminCookieHeader(req),
        });
        res.end(JSON.stringify({ ok: true }));
      })
      .catch(() => send(res, 400, JSON.stringify({ ok: false, error: "Bad request" }), "application/json; charset=utf-8"));
    return;
  }

  if (req.method === "GET" && (req.url || "").split("?")[0] === "/api/admin/logout") {
    res.writeHead(302, { Location: "/", "Set-Cookie": clearAdminCookieHeader() });
    return res.end();
  }

  const pathOnly = (req.url || "").split("?")[0];
  if (req.method === "POST" && pathOnly === "/api/invite/lookup") {
    inviteLookupHandler(req, res);
    return;
  }
  if (req.method === "GET" && pathOnly === "/api/invite-codes") {
    inviteCodesGetHandler(req, res);
    return;
  }
  if (req.method === "POST" && pathOnly === "/api/invite-codes") {
    inviteCodesPostHandler(req, res);
    return;
  }

  if (req.method === "POST" && pathOnly === "/api/customer-profile/load") {
    customerProfileLoadHandler(req, res);
    return;
  }
  if (req.method === "POST" && pathOnly === "/api/customer-profile/save") {
    customerProfileSaveHandler(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/fortune/analyze") {
    readJsonBody(req)
      .then((payload) => callGeminiAnalysis(payload))
      .then((analysis) => send(res, 200, JSON.stringify({ ok: true, analysis, source: "gemini" }), "application/json; charset=utf-8"))
      .catch((err) => {
        const message = String(err && err.message ? err.message : err);
        console.error("[fortune/analyze]", message);
        let status = 500;
        let body = {
          ok: false,
          errorCode: "gemini_error",
          error:
            "Luận giải AI tạm không khả dụng. Phần phân tích nội bộ bên dưới vẫn đầy đủ — vui lòng thử lại sau.",
        };
        if (message.includes("Missing GEMINI_API_KEY")) {
          status = 503;
          body.errorCode = "gemini_not_configured";
          body.error =
            "Luận giải AI chưa bật trên máy chủ (chưa cấu hình khoá). Bạn vẫn xem được phân tích nội bộ đầy đủ. Admin: thêm biến GEMINI_API_KEY trên Render.";
        }
        if (process.env.NODE_ENV !== "production") {
          body.debug = message.slice(0, 500);
        }
        send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
      });
    return;
  }

  if (req.method === "GET") {
    const u = new URL(req.url || "/", "http://localhost");
    const incomingPath = decodeURIComponent(u.pathname || "/");

    if (incomingPath === "/profile.html") {
      const entry = u.searchParams.get("entry") || u.searchParams.get("role") || "";
      if (entry === "admin" && !hasAdminSession(req)) {
        const next = u.pathname + (u.search || "");
        res.writeHead(302, { Location: "/admin-login.html?next=" + encodeURIComponent(next) });
        return res.end();
      }
    }

    if (incomingPath === "/") {
      res.writeHead(302, { Location: "/profile.html?entry=customer" });
      return res.end();
    }
    if (incomingPath === "/admin") {
      res.writeHead(302, { Location: "/profile.html?entry=admin" });
      return res.end();
    }
    if (incomingPath === "/customer") {
      res.writeHead(302, { Location: "/profile.html?entry=customer" });
      return res.end();
    }
    const shortCodeMatch = incomingPath.match(/^\/([a-zA-Z0-9]{6})\/?$/);
    if (shortCodeMatch) {
      const code = shortCodeMatch[1].toLowerCase();
      res.writeHead(302, { Location: "/profile.html?entry=customer&code=" + encodeURIComponent(code) });
      return res.end();
    }
  }

  const urlPath = req.url || "/";
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
