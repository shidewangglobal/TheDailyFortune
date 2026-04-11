#!/usr/bin/env node
/**
 * Gọi lặp POST /api/fortune/analyze để thử Gemini + playbook (local).
 *
 * Cách dùng:
 *   1) Tạo file .env ở thư mục gốc project: GEMINI_API_KEY=...
 *   2) (Tuỳ chọn) GEMINI_PLAYBOOK_HOT_RELOAD=1 trong .env để sửa file docs/*.md không cần restart server.
 *   3) Terminal 1: npm start
 *   4) Terminal 2:
 *        npm run gemini:trial
 *        npm run gemini:trial -- --n=5 --sleep=4
 *        npm run gemini:trial -- --loop --sleep=5    (Ctrl+C để dừng)
 *
 * Biến môi trường: BASE=http://localhost:4180, FIXTURE=path/to.json
 */

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const defaultFixture = path.join(root, "fixtures", "gemini-sample-payload.json");

function parseArgs(argv) {
  const out = { n: 1, sleepSec: 3, loop: false, base: process.env.BASE || "http://localhost:4180" };
  for (const a of argv) {
    if (a.startsWith("--n=")) out.n = Math.max(1, parseInt(a.slice(4), 10) || 1);
    if (a.startsWith("--sleep=")) out.sleepSec = Math.max(0, parseInt(a.slice(8), 10) || 0);
    if (a === "--loop") out.loop = true;
    if (a.startsWith("--base=")) out.base = a.slice(7).replace(/\/$/, "");
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runOnce(base, payload, index) {
  const url = `${base}/api/fortune/analyze`;
  const t0 = Date.now();
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  const ms = Date.now() - t0;
  const text = j && j.analysis ? String(j.analysis) : "";
  const words = text.split(/\s+/).filter(Boolean).length;
  console.log("\n========== Lần " + index + " (" + ms + " ms) ==========");
  console.log("HTTP", r.status, "| ok:", !!(j && j.ok), "| từ (ước):", words);
  if (!r.ok || !j.ok) {
    console.log("Lỗi / fallback:", j.error || j.errorCode || JSON.stringify(j).slice(0, 400));
  }
  if (text) {
    console.log("\n--- Bài luận (rút gọn 900 ký tự đầu) ---\n");
    console.log(text.length > 900 ? text.slice(0, 900) + "…" : text);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fixturePath = process.env.FIXTURE || defaultFixture;
  if (!fs.existsSync(fixturePath)) {
    console.error("Không thấy fixture:", fixturePath);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  console.log("Base:", opts.base);
  console.log("Fixture:", fixturePath);
  console.log(opts.loop ? "Chế độ: lặp vô hạn (--loop), Ctrl+C để dừng" : "Số lần: " + opts.n + ", nghỉ " + opts.sleepSec + "s giữa các lần");

  let i = 0;
  while (true) {
    i += 1;
    await runOnce(opts.base, payload, i);
    if (!opts.loop && i >= opts.n) break;
    if (opts.sleepSec > 0) await sleep(opts.sleepSec * 1000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
