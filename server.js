require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4180;
const PUBLIC_DIR = path.join(__dirname, "public");
const GEMINI_PLAYBOOK_PATH = path.join(__dirname, "docs", "GEMINI_ENGINE_PLAYBOOK_V1.md");
const GEMINI_CORE_TRONG_NGAM_PATH = path.join(__dirname, "docs", "GEMINI_CORE_TRONG_NGAM_CUNG.md");
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
  const payload = JSON.stringify(codes, null, 2);
  const tmp = path.join(DATA_DIR, "invite_codes.json.tmp." + process.pid);
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, INVITE_CODES_FILE);
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
      const usageCount = Math.max(0, parseInt(meta.usageCount, 10) || 0);
      const metaOut = { ...meta, usageCount };
      send(res, 200, JSON.stringify({ ok: true, key, meta: metaOut }), "application/json; charset=utf-8");
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

function inviteRecordUsageHandler(req, res) {
  readJsonBody(req)
    .then((body) => {
      const key = resolveInviteKeyForProfile(body && body.code);
      if (!key) {
        return send(res, 403, JSON.stringify({ ok: false, error: "invalid_code" }), "application/json; charset=utf-8");
      }
      const merged = mergeInviteCodesFromDisk();
      const meta = { ...(merged[key] || {}) };
      if (meta.tier === "admin") {
        return send(res, 200, JSON.stringify({ ok: true, skipped: true }), "application/json; charset=utf-8");
      }
      const limit = Math.max(1, parseInt(meta.totalLimit, 10) || 20);
      const cur = Math.max(0, parseInt(meta.usageCount, 10) || 0);
      if (cur >= limit) {
        return send(
          res,
          403,
          JSON.stringify({ ok: false, error: "quota_exceeded", usageCount: cur, limit }),
          "application/json; charset=utf-8"
        );
      }
      const next = cur + 1;
      merged[key] = { ...meta, usageCount: next };
      try {
        writeInviteCodesToDisk(merged);
      } catch (e) {
        console.error("[invite/record-usage]", e);
        return send(res, 500, JSON.stringify({ ok: false, error: "write_failed" }), "application/json; charset=utf-8");
      }
      send(
        res,
        200,
        JSON.stringify({ ok: true, usageCount: next, limit }),
        "application/json; charset=utf-8"
      );
    })
    .catch(() => send(res, 400, JSON.stringify({ ok: false, error: "bad_request" }), "application/json; charset=utf-8"));
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(clean).replace(/^(\.\.[/\\])+/, "");
  return normalized;
}

function loadGeminiPlaybook() {
  try {
    const base = fs.readFileSync(GEMINI_PLAYBOOK_PATH, "utf-8");
    let core = "";
    try {
      core = fs.readFileSync(GEMINI_CORE_TRONG_NGAM_PATH, "utf-8");
    } catch (_) {
      core = "";
    }
    geminiPlaybook = core ? base + "\n\n---\n\n" + core : base;
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

function extractJsonObjectFromModelText(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(t.slice(start, end + 1));
}

async function callGeminiAnalysis(payload) {
  if (process.env.GEMINI_PLAYBOOK_HOT_RELOAD === "1") {
    loadGeminiPlaybook();
  }
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(apiKey);
  const buildBody = (textPrompt) => ({
    contents: [{ role: "user", parts: [{ text: textPrompt }] }],
    generationConfig: {
      temperature: 0.45,
      maxOutputTokens: 512,
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

  const prompt = [
    "SYSTEM PLAYBOOK (use for reasoning; output format is strict JSON below, not prose):",
    geminiPlaybook || "Use Luc Nham + Hoa Giap from payload; stay concrete.",
    "",
    "TASK:",
    "Read INPUT JSON (day/hour cung, Can Chi, relations, topic, status, confidence hint).",
    "Refine the numeric confidence using the playbook and payload (not random).",
    "Write ONE short Vietnamese sentence for the dashboard user (no bullets, no second paragraph).",
    "",
    "OUTPUT RULES — reply with ONLY a JSON object, no markdown fences, no text before or after:",
    '{"confidence": <integer 55-92>, "summary_one_line": "<one sentence, max 220 chars Vietnamese>"}',
    "summary_one_line must mention the topic (use topic_verbatim) and the day gist; you may end with (~NN%) matching confidence.",
    "",
    "INPUT JSON:",
    JSON.stringify(payload)
  ].join("\n");

  let text = await generate(prompt);
  let parsed;
  try {
    parsed = extractJsonObjectFromModelText(text);
  } catch (_) {
    const retryPrompt = [
      "Invalid JSON before. Reply with ONLY valid JSON, one line or pretty-print, keys exactly:",
      '{"confidence":55,"summary_one_line":"..."}',
      "confidence integer 55-92. summary_one_line max 220 chars Vietnamese.",
      "",
      "INPUT JSON:",
      JSON.stringify(payload)
    ].join("\n");
    text = await generate(retryPrompt);
    parsed = extractJsonObjectFromModelText(text);
  }
  const conf = Math.max(55, Math.min(92, Math.round(Number(parsed.confidence))));
  const line = String(parsed.summary_one_line || "").trim().slice(0, 280);
  if (!Number.isFinite(conf)) throw new Error("Gemini JSON missing valid confidence");
  if (!line) throw new Error("Gemini JSON missing summary_one_line");
  return { confidence: conf, summary_one_line: line };
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
  if (req.method === "POST" && pathOnly === "/api/invite/record-usage") {
    inviteRecordUsageHandler(req, res);
    return;
  }
  if (req.method === "GET" && pathOnly === "/api/public-config") {
    send(
      res,
      200,
      JSON.stringify({
        ok: true,
        supportEmail: String(process.env.SUPPORT_EMAIL || "").trim(),
        supportPhone: String(process.env.SUPPORT_PHONE || "").trim(),
        supportWhatsappUrl: String(process.env.SUPPORT_WHATSAPP_URL || "").trim(),
      }),
      "application/json; charset=utf-8"
    );
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
      .then((result) =>
        send(
          res,
          200,
          JSON.stringify({
            ok: true,
            source: "gemini",
            confidence: result.confidence,
            summary_one_line: result.summary_one_line,
            analysis: result.summary_one_line
          }),
          "application/json; charset=utf-8"
        )
      )
      .catch((err) => {
        const message = String(err && err.message ? err.message : err);
        console.error("[fortune/analyze]", message);
        let status = 500;
        let body = {
          ok: false,
          errorCode: "gemini_error",
          error:
            "Luận giải chi tiết tạm chưa sẵn sàng. Bạn vẫn xem được dòng tóm tắt ngay bên dưới — thử lại sau ít phút.",
        };
        if (message.includes("Missing GEMINI_API_KEY")) {
          status = 503;
          body.errorCode = "gemini_not_configured";
          body.error =
            "Tính năng luận giải tăng cường tạm chưa bật. Bạn vẫn xem được tóm tắt bên dưới bình thường.";
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
