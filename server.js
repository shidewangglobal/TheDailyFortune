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
const TRANSLATION_CACHE_FILE = path.join(DATA_DIR, "translation_cache.json");
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

function loadTranslationCacheFromDisk() {
  try {
    if (!fs.existsSync(TRANSLATION_CACHE_FILE)) return {};
    const raw = fs.readFileSync(TRANSLATION_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("[i18n/cache] read", e);
    return {};
  }
}

function writeTranslationCacheToDisk(cache) {
  try {
    if (!cache || typeof cache !== "object") return;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = JSON.stringify(cache, null, 2);
    const tmp = path.join(DATA_DIR, "translation_cache.json.tmp." + process.pid);
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, TRANSLATION_CACHE_FILE);
  } catch (e) {
    console.error("[i18n/cache] write", e);
  }
}

let translationCacheMemo = null;
let translationCacheFlushTimer = null;
function getTranslationCache() {
  if (!translationCacheMemo) translationCacheMemo = loadTranslationCacheFromDisk();
  return translationCacheMemo;
}
function buildTranslationCacheKey(targetLang, text, sourceLang = "auto", domain = "general") {
  const target = String(targetLang || "").trim().toLowerCase();
  const source = String(sourceLang || "auto").trim().toLowerCase();
  const scope = String(domain || "general").trim().toLowerCase();
  return `${scope}::${source}::${target}::${String(text || "").trim()}`;
}
function normalizeComparableText(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}
function queueFlushTranslationCache() {
  if (translationCacheFlushTimer) return;
  translationCacheFlushTimer = setTimeout(() => {
    translationCacheFlushTimer = null;
    writeTranslationCacheToDisk(getTranslationCache());
  }, 250);
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
    birthMinute: row.birth_minute || "",
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
        birth_minute: String((body && body.birthMinute) || "").slice(0, 100),
        updated_at: new Date().toISOString(),
      };
      let { error } = await supa.from("customer_profiles").upsert(row, { onConflict: "invite_code" });
      // Backward compatible for older schemas without birth_minute column.
      if (error && /birth_minute/i.test(String(error && error.message ? error.message : error))) {
        const fallbackRow = { ...row };
        delete fallbackRow.birth_minute;
        const retry = await supa.from("customer_profiles").upsert(fallbackRow, { onConflict: "invite_code" });
        error = retry.error;
      }
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

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientGeminiError(err) {
  const msg = String(err && err.message ? err.message : err || "");
  return (
    /Gemini API error:\s*(429|500|502|503)\b/.test(msg) ||
    /\b(429|502|503)\b/.test(msg) ||
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network|timeout/i.test(msg)
  );
}

/** Tiếng Việt: đếm từ theo khoảng trắng không đủ; thêm số ký tự và số đoạn để bắt bản một câu. */
function fortuneAnalysisTooShort(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  const noSpaceLen = t.replace(/\s/g, "").length;
  const paragraphs = t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40).length;
  return words < 140 || noSpaceLen < 720 || paragraphs < 2;
}

/** Legacy Vietnamese section titles — if present in model output, trigger retry/finalize. */
const LEGACY_VI_ANALYSIS_HEADER_MARKERS = /Kết luận nhanh|1 câu chốt/i;
function analysisHasLegacyViHeaders(text) {
  return LEGACY_VI_ANALYSIS_HEADER_MARKERS.test(String(text || ""));
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
  const targetLanguage = String((payload && payload.target_language) || "vi").trim() || "vi";
  const neighborHint = Array.isArray(payload && payload.nearby_windows) ? payload.nearby_windows : [];
  const eventImportance = String((payload && payload.event_importance_hint) || "normal");
  const prompt = [
    "SYSTEM PLAYBOOK (MUST FOLLOW):",
    geminiPlaybook || "Fallback: Write 3 Vietnamese paragraphs, practical and non-generic.",
    "",
    "TASK:",
    `Write the analysis in target_language="${targetLanguage}" only.`,
    "Output MUST contain exactly 5 titled sections in this order:",
    "1) Summary — for Vietnamese (vi) use heading **Tóm tắt**; other languages: natural equivalent.",
    "2) Reasons",
    "3) Recommendations",
    "4) Detailed interpretation",
    "5) Closing recommendation — for Vietnamese (vi) use heading **Lời khuyên**; other languages: natural equivalent (e.g. Closing advice).",
    "Headings must be in target_language and natural for that language.",
    "Do not reuse deprecated Vietnamese section-title wording from older app builds; follow the Vietnamese examples above when target_language is vi.",
    "For section 4, keep original technical astrology language (Luc Nham, cung, can chi, ngu hanh relations).",
    "Do NOT return JSON, markdown code block, or bullet-only response.",
    "Avoid repetitive, alarming words. If risk exists, explain specific possible issue and reason.",
    "In section 3, suggest practical hours and if needed nearby days/weeks/months according to event importance.",
    `Event importance hint: ${eventImportance}. Nearby windows: ${JSON.stringify(neighborHint)}.`,
    "Mention percentage at most once; it cannot replace reasoning.",
    "",
    "INPUT JSON:",
    JSON.stringify(payload)
  ].join("\n");
  const buildBody = (textPrompt) => ({
    contents: [{ role: "user", parts: [{ text: textPrompt }] }],
    generationConfig: {
      temperature: 0.72,
      maxOutputTokens: 4096,
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  });
  const generateOnce = async (textPrompt) => {
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
    const block = data?.promptFeedback?.blockReason;
    if (block) throw new Error("Gemini blocked: " + block);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const finish = data?.candidates?.[0]?.finishReason;
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      throw new Error("Gemini finish: " + finish);
    }
    const text = parts
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("\n")
      .trim();
    if (!text) throw new Error("Gemini empty response");
    return text.trim();
  };

  const generate = async (textPrompt) => {
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await generateOnce(textPrompt);
      } catch (e) {
        lastErr = e;
        if (!isTransientGeminiError(e) || attempt === 4) throw e;
        await sleepMs(350 * attempt);
      }
    }
    throw lastErr;
  };

  let text = await generate(prompt);
  // #region agent log
  fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'analysis-headers',hypothesisId:'H17',location:'server.js:callGeminiAnalysis',message:'initial_output_header_scan',data:{targetLanguage,hasLegacyViHeaders:analysisHasLegacyViHeaders(text),charLen:String(text||'').length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (fortuneAnalysisTooShort(text) || analysisHasLegacyViHeaders(text)) {
    // #region agent log
    fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'analysis-headers',hypothesisId:'H18',location:'server.js:callGeminiAnalysis',message:'retry_triggered',data:{targetLanguage,isTooShort:fortuneAnalysisTooShort(text),hasLegacyViHeaders:analysisHasLegacyViHeaders(text)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const retryPrompt = [
      "Bản trước KHÔNG ĐẠT format hoặc quá ngắn.",
      "Rewrite with exactly 5 sections in this order: Summary (vi: Tóm tắt) / Reasons / Recommendations / Detailed interpretation / Closing recommendation (vi: Lời khuyên).",
      `Bắt buộc dùng ngôn ngữ: ${targetLanguage}.`,
      "For Vietnamese output, section 1 heading must be Tóm tắt and section 5 heading must be Lời khuyên; do not reuse deprecated section-title wording from older builds.",
      "Phần Đề xuất cần có khung giờ khả thi thực tế; nếu ngày hiện tại không thuận thì gợi ý cửa sổ ngày gần kề.",
      "Không JSON, không code block, không dùng từ dọa rủi ro lặp lại.",
      "",
      "INPUT JSON:",
      JSON.stringify(payload)
    ].join("\n");
    const retryText = await generate(retryPrompt);
    if (!fortuneAnalysisTooShort(retryText) || retryText.length > text.length) text = retryText;
    // #region agent log
    fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'analysis-headers',hypothesisId:'H19',location:'server.js:callGeminiAnalysis',message:'retry_output_header_scan',data:{targetLanguage,hasLegacyViHeaders:analysisHasLegacyViHeaders(text),charLen:String(text||'').length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }
  if (fortuneAnalysisTooShort(text) || analysisHasLegacyViHeaders(text)) {
    // #region agent log
    fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'analysis-headers',hypothesisId:'H20',location:'server.js:callGeminiAnalysis',message:'finalize_triggered',data:{targetLanguage,isTooShort:fortuneAnalysisTooShort(text),hasLegacyViHeaders:analysisHasLegacyViHeaders(text)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const finalizePrompt = [
      "Still not valid. Must output exactly 5 clear titled sections with no repetitive points.",
      `Ngôn ngữ đầu ra bắt buộc: ${targetLanguage}.`,
      "Use natural headings in target_language. For Vietnamese: first section **Tóm tắt**, last section **Lời khuyên**; no deprecated legacy section titles.",
      "INPUT JSON:",
      JSON.stringify(payload)
    ].join("\n");
    text = await generate(finalizePrompt);
  }
  return text;
}

async function callGeminiTranslateTexts(payload) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  const texts = Array.isArray(payload && payload.texts) ? payload.texts : [];
  if (!texts.length) return [];
  const source = String((payload && payload.source_language) || "auto");
  const target = String((payload && payload.target_language) || "en");
  const domain = String((payload && payload.domain) || "general");
  const strictTranslate = !!(payload && payload.strict_translate);
  const cache = getTranslationCache();
  const result = new Array(texts.length).fill("");
  const misses = [];
  const missIndexes = [];
  for (let i = 0; i < texts.length; i++) {
    const src = String(texts[i] || "");
    const scopedKey = buildTranslationCacheKey(target, src, source, domain);
    const legacyKey = `${String(target || "").trim().toLowerCase()}::${src}`;
    const cached = cache[scopedKey] || (domain === "general" ? cache[legacyKey] : undefined);
    if (typeof cached === "string" && cached.trim()) {
      result[i] = cached;
    } else {
      misses.push(src);
      missIndexes.push(i);
    }
  }
  if (!misses.length) return result;
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(apiKey);
  async function translateBatch(batchTexts, extraRules) {
    const prompt = [
      "Translate each text item preserving order and meaning.",
      source === "auto"
        ? `Source language hint: auto-detect from each text item. Target language: ${target}.`
        : `Source language hint: ${source}. Target language: ${target}.`,
      extraRules || "",
      "Return strict JSON object: {\"translations\":[...]}",
      "No markdown, no commentary.",
      "INPUT:",
      JSON.stringify({ texts: batchTexts })
    ].filter(Boolean).join("\n");
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } }
      })
    });
    if (!resp.ok) {
      throw new Error("Gemini API error: " + resp.status);
    }
    const data = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .join("\n")
      .trim();
    const jsonText = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed && parsed.translations) ? parsed.translations : [];
  }
  const glossaryRule = domain === "astrology_glossary"
    ? "These are Vietnamese astrology terms used as user-facing labels. Translate every term into natural target-language wording (or common transliteration if no direct equivalent). Do not keep Vietnamese unchanged."
    : "";
  const out = await translateBatch(misses, glossaryRule);
  const unresolvedIndexes = [];
  const unresolvedTexts = [];
  for (let j = 0; j < missIndexes.length; j++) {
    const idx = missIndexes[j];
    const src = misses[j];
    let translated = typeof out[j] === "string" && out[j].trim() ? out[j] : src;
    const isNearSource =
      normalizeComparableText(translated) === normalizeComparableText(src);
    if (
      strictTranslate &&
      String(target || "").toLowerCase() !== "vi" &&
      isNearSource
    ) {
      unresolvedIndexes.push(j);
      unresolvedTexts.push(src);
    }
    result[idx] = translated;
    cache[buildTranslationCacheKey(target, src, source, domain)] = translated;
  }
  if (unresolvedTexts.length) {
    const retryOut = await translateBatch(
      unresolvedTexts,
      "Retry mode: translation must not be identical to the Vietnamese source text. Translate to target language only."
    );
    for (let k = 0; k < unresolvedIndexes.length; k++) {
      const missPos = unresolvedIndexes[k];
      const src = unresolvedTexts[k];
      const idx = missIndexes[missPos];
      const retried = typeof retryOut[k] === "string" && retryOut[k].trim() ? retryOut[k] : result[idx];
      result[idx] = retried;
      cache[buildTranslationCacheKey(target, src, source, domain)] = retried;
    }
    // #region agent log
    fetch('http://127.0.0.1:7721/ingest/40683a09-4bbd-4ee6-8c85-c52ade641def',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b669db'},body:JSON.stringify({sessionId:'b669db',runId:'post-fix',hypothesisId:'H16',location:'server.js:callGeminiTranslateTexts',message:'strict_retry_for_near_source_terms',data:{domain,target,count:unresolvedTexts.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }
  queueFlushTranslationCache();
  return result.map((x, i) => (typeof x === "string" && x.trim() ? x : texts[i]));
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
          return send(res, 401, JSON.stringify({ ok: false, error: "Mã quản trị không đúng." }), "application/json; charset=utf-8");
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
        adminLoginRequired: adminProtectionActive(),
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

  if (req.method === "POST" && pathOnly === "/api/fortune/analyze") {
    readJsonBody(req)
      .then((payload) => callGeminiAnalysis(payload))
      .then((analysis) =>
        send(
          res,
          200,
          JSON.stringify({
            ok: true,
            source: "gemini",
            analysis
          }),
          "application/json; charset=utf-8"
        )
      )
      .catch((err) => {
        const message = String(err && err.message ? err.message : err);
        console.error("[fortune/analyze]", message.slice(0, 500));
        let status = 500;
        let body = {
          ok: false,
          errorCode: "gemini_error",
          error:
            "Luận giải AI tạm không khả dụng. Phần tóm tắt nội bộ bên dưới vẫn xem được — vui lòng thử lại sau.",
        };
        if (message.includes("Missing GEMINI_API_KEY")) {
          status = 503;
          body.errorCode = "gemini_not_configured";
          body.error =
            "Tính năng luận giải AI tạm chưa bật. Bạn vẫn xem được tóm tắt nội bộ bên dưới.";
        }
        if (process.env.NODE_ENV !== "production") {
          body.debug = message.slice(0, 500);
        }
        send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
      });
    return;
  }
  if (req.method === "POST" && pathOnly === "/api/i18n/translate") {
    readJsonBody(req)
      .then((payload) => callGeminiTranslateTexts(payload))
      .then((translations) =>
        send(
          res,
          200,
          JSON.stringify({ ok: true, translations }),
          "application/json; charset=utf-8"
        )
      )
      .catch((err) => {
        console.error("[i18n/translate]", String(err && err.message ? err.message : err).slice(0, 300));
        send(res, 500, JSON.stringify({ ok: false, error: "translate_failed" }), "application/json; charset=utf-8");
      });
    return;
  }

  if (req.method === "GET") {
    const u = new URL(req.url || "/", "http://localhost");
    const incomingPath = decodeURIComponent(u.pathname || "/");

    if (incomingPath === "/admin-login.html" && !adminProtectionActive()) {
      const next = u.searchParams.get("next") || "/profile.html?entry=admin";
      res.writeHead(302, { Location: next });
      return res.end();
    }

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
      if (adminProtectionActive()) {
        res.writeHead(302, {
          Location: "/admin-login.html?next=" + encodeURIComponent("/profile.html?entry=admin"),
        });
      } else {
        res.writeHead(302, { Location: "/profile.html?entry=admin" });
      }
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
