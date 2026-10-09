// TEGTAT / ENEREL — Cloudflare Workers API (нэг файлд багтсан, импортгүй).
// Энэ файл repo-ийн ҮНДСЭН хавтсанд байна. wrangler.jsonc → "main": "api-worker.js".
// D1 binding нэр: DB. Нууц түлхүүр, нууц үг энэ файлд байхгүй.

// Shared helpers for ENEREl game API (Cloudflare Pages Functions).
// Files starting with "_" are not exposed as routes.

const MAX_NAME_LENGTH = 16;
const MAX_SCORE = 12000; // must match MAX_POSSIBLE_SCORE in game.js and CHECK in schema.sql
const NAME_PATTERN = /^[\p{L}\p{N} _.\-']+$/u;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function errorResponse(status, code, message) {
  return json({ ok: false, error: code, message }, status);
}

function normalizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns an error message (string) or null when valid.
function validateName(name) {
  if (!name) return "Нэрээ оруулна уу.";
  if ([...name].length > MAX_NAME_LENGTH) return `Нэр ${MAX_NAME_LENGTH} тэмдэгтээс хэтрэхгүй.`;
  if (!NAME_PATTERN.test(name)) return "Нэрэнд зөвхөн үсэг, тоо, зай, _ . - ' ашиглана.";
  return null;
}

function validateScore(value, max = MAX_SCORE) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Оноо тоо байх ёстой.";
  if (!Number.isInteger(value)) return "Оноо бүхэл тоо байх ёстой.";
  if (value < 0) return "Оноо сөрөг байж болохгүй.";
  if (value > max) return "Оноо боломжит дээд хэмжээнээс их байна.";
  return null;
}

function dbMissing() {
  return errorResponse(
    503,
    "db_not_bound",
    "D1 database холбогдоогүй байна. Workers → Settings → Bindings дээр DB нэртэй D1 binding нэмнэ үү."
  );
}


const ROUTES = {
  "/api/save-score": (() => {
// POST /api/save-score  { "name": "BAT", "score": 4200 }
// Validates input on the server and stores ONLY name, score, created_at in D1.

const MAX_BODY_BYTES = 1024;
const SAME_NAME_COOLDOWN_MS = 5000;

async function onRequestPost({ request, env }) {
  if (!env.DB) return dbMissing();

  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Content-Type нь application/json байх ёстой.");
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return errorResponse(400, "bad_body", "Хүсэлтийн биеийг уншиж чадсангүй.");
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return errorResponse(413, "body_too_large", "Хүсэлт хэт том байна.");
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse(400, "invalid_json", "JSON буруу байна.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "invalid_body", "JSON объект илгээнэ үү.");
  }

  const name = normalizeName(body.name);
  const nameError = validateName(name);
  if (nameError) return errorResponse(400, "invalid_name", nameError);

  const score = body.score;
  const scoreError = validateScore(score);
  if (scoreError) return errorResponse(400, "invalid_score", scoreError);

  try {
    // Simple anti-spam: same nickname cannot save twice within 5 seconds.
    const since = new Date(Date.now() - SAME_NAME_COOLDOWN_MS).toISOString();
    const recent = await env.DB
      .prepare("SELECT id FROM game_scores WHERE name = ?1 AND created_at > ?2 LIMIT 1")
      .bind(name, since)
      .first();
    if (recent) {
      return errorResponse(429, "too_many_requests", "Хэт ойр ойрхон хадгалж байна. Түр хүлээгээд дахин оролдоно уу.");
    }

    const createdAt = new Date().toISOString();
    const result = await env.DB
      .prepare("INSERT INTO game_scores (name, score, created_at) VALUES (?1, ?2, ?3)")
      .bind(name, score, createdAt)
      .run();
    const id = result.meta && result.meta.last_row_id;

    const rankRow = await env.DB
      .prepare(
        `SELECT COUNT(*) AS better FROM game_scores
         WHERE score > ?1 OR (score = ?1 AND (created_at < ?2 OR (created_at = ?2 AND id < ?3)))`
      )
      .bind(score, createdAt, id)
      .first();
    const rank = (rankRow ? Number(rankRow.better) : 0) + 1;

    return json({ ok: true, id, name, score, created_at: createdAt, rank }, 201);
  } catch (err) {
    console.error("save-score failed", err);
    return errorResponse(500, "db_error", "Оноо хадгалах үед алдаа гарлаа.");
  }
}

async function onRequest({ request }) {
  // Any method other than POST (onRequestPost takes precedence for POST)
  return errorResponse(405, "method_not_allowed", "Зөвхөн POST хүсэлт зөвшөөрнө.");
}

return { onRequestGet: typeof onRequestGet === "function" ? onRequestGet : undefined, onRequestPost: typeof onRequestPost === "function" ? onRequestPost : undefined, onRequest };
})(),
  "/api/leaderboard": (() => {
// GET /api/leaderboard  →  { ok: true, scores: [{ id, name, score, created_at }, ...] }  (TOP 10)

async function onRequestGet({ env }) {
  if (!env.DB) return dbMissing();
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT id, name, score, created_at FROM game_scores
         ORDER BY score DESC, created_at ASC, id ASC
         LIMIT 10`
      )
      .all();
    return json({ ok: true, scores: results || [] });
  } catch (err) {
    console.error("leaderboard failed", err);
    return errorResponse(500, "db_error", "Leaderboard уншихад алдаа гарлаа.");
  }
}

async function onRequest() {
  return errorResponse(405, "method_not_allowed", "Зөвхөн GET хүсэлт зөвшөөрнө.");
}

return { onRequestGet: typeof onRequestGet === "function" ? onRequestGet : undefined, onRequestPost: typeof onRequestPost === "function" ? onRequestPost : undefined, onRequest };
})(),
  "/api/tegtat/save-score": (() => {
// POST /api/tegtat/save-score  { "name": "BAT", "score": 2450 }
// TEGTAT 3D driving game. Stores ONLY name, score, created_at in D1 table tegtat_scores.

const TEGTAT_MAX_SCORE = 5000; // must match MAX_SCORE in tegtat.js and CHECK in schema.sql
const MAX_BODY_BYTES = 1024;
const SAME_NAME_COOLDOWN_MS = 5000;

async function onRequestPost({ request, env }) {
  if (!env.DB) return dbMissing();
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    return errorResponse(415, "unsupported_media_type", "Content-Type нь application/json байх ёстой.");
  }
  let text;
  try { text = await request.text(); } catch { return errorResponse(400, "bad_body", "Хүсэлтийн биеийг уншиж чадсангүй."); }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return errorResponse(413, "body_too_large", "Хүсэлт хэт том байна.");
  let body;
  try { body = JSON.parse(text); } catch { return errorResponse(400, "invalid_json", "JSON буруу байна."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse(400, "invalid_body", "JSON объект илгээнэ үү.");

  const name = normalizeName(body.name);
  const nameError = validateName(name);
  if (nameError) return errorResponse(400, "invalid_name", nameError);
  const score = body.score;
  const scoreError = validateScore(score, TEGTAT_MAX_SCORE);
  if (scoreError) return errorResponse(400, "invalid_score", scoreError);

  try {
    const since = new Date(Date.now() - SAME_NAME_COOLDOWN_MS).toISOString();
    const recent = await env.DB.prepare("SELECT id FROM tegtat_scores WHERE name = ?1 AND created_at > ?2 LIMIT 1").bind(name, since).first();
    if (recent) return errorResponse(429, "too_many_requests", "Хэт ойр ойрхон хадгалж байна. Түр хүлээгээд дахин оролдоно уу.");

    const createdAt = new Date().toISOString();
    const result = await env.DB.prepare("INSERT INTO tegtat_scores (name, score, created_at) VALUES (?1, ?2, ?3)").bind(name, score, createdAt).run();
    const id = result.meta && result.meta.last_row_id;
    const rankRow = await env.DB.prepare(
      `SELECT COUNT(*) AS better FROM tegtat_scores
       WHERE score > ?1 OR (score = ?1 AND (created_at < ?2 OR (created_at = ?2 AND id < ?3)))`
    ).bind(score, createdAt, id).first();
    const rank = (rankRow ? Number(rankRow.better) : 0) + 1;
    return json({ ok: true, id, name, score, created_at: createdAt, rank }, 201);
  } catch (err) {
    console.error("tegtat save-score failed", err);
    return errorResponse(500, "db_error", "Оноо хадгалах үед алдаа гарлаа.");
  }
}

async function onRequest() {
  return errorResponse(405, "method_not_allowed", "Зөвхөн POST хүсэлт зөвшөөрнө.");
}

return { onRequestGet: typeof onRequestGet === "function" ? onRequestGet : undefined, onRequestPost: typeof onRequestPost === "function" ? onRequestPost : undefined, onRequest };
})(),
  "/api/tegtat/leaderboard": (() => {
// GET /api/tegtat/leaderboard → { ok: true, scores: [{ id, name, score, created_at }] } (TOP 10)

async function onRequestGet({ env }) {
  if (!env.DB) return dbMissing();
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, score, created_at FROM tegtat_scores
       ORDER BY score DESC, created_at ASC, id ASC
       LIMIT 10`
    ).all();
    return json({ ok: true, scores: results || [] });
  } catch (err) {
    console.error("tegtat leaderboard failed", err);
    return errorResponse(500, "db_error", "Leaderboard уншихад алдаа гарлаа.");
  }
}

async function onRequest() {
  return errorResponse(405, "method_not_allowed", "Зөвхөн GET хүсэлт зөвшөөрнө.");
}

return { onRequestGet: typeof onRequestGet === "function" ? onRequestGet : undefined, onRequestPost: typeof onRequestPost === "function" ? onRequestPost : undefined, onRequest };
})(),
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const mod = ROUTES[path];
    if (mod) {
      const m = request.method.toUpperCase();
      const handler = (m === "GET" && mod.onRequestGet) || (m === "POST" && mod.onRequestPost) || mod.onRequest;
      try {
        return await handler({ request, env, params: {}, waitUntil: (p) => ctx.waitUntil(p), data: {} });
      } catch (err) {
        console.error("api error", err);
        return errorResponse(500, "server_error", "Серверт алдаа гарлаа.");
      }
    }
    if (path.startsWith("/api/")) return errorResponse(404, "not_found", "Ийм API байхгүй.");
    return env.ASSETS.fetch(request);
  },
};
