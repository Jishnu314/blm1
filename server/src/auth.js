// Admin password and session. Local demo returns a bearer token, same as production.

import crypto from "node:crypto";
import { query } from "./db.js";
import { config } from "./config.js";
import { ApiError } from "./lib/http.js";
import { laterIso, nowIso } from "./lib/time.js";

const COOKIE = "mr_session";
const DAYS = 30;
const MAX_AGE = DAYS * 24 * 60 * 60;
const SESSION_MS = DAYS * 24 * 60 * 60 * 1000;

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password, salt, { n, r, p, length }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, length, { N: n, r, p }, (problem, key) => {
      if (problem) reject(problem);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, { n: N, r: R, p: P, length: KEY_LENGTH });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const bits = String(stored || "").split("$");
    if (bits.length !== 6 || bits[0] !== "scrypt") return false;

    const n = Number(bits[1]);
    const r = Number(bits[2]);
    const p = Number(bits[3]);
    const salt = Buffer.from(bits[4], "hex");
    const want = Buffer.from(bits[5], "hex");
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (salt.length === 0 || want.length === 0) return false;

    const got = await derive(String(password), salt, { n, r, p, length: want.length });
    if (got.length !== want.length) return false;
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

export async function setPassword(password) {
  const hash = await hashPassword(password);
  const at = nowIso();
  await query(
    `insert into admin_account (id, password_hash, updated_at)
          values (1, $1, $2)
     on conflict (id) do update
             set password_hash = excluded.password_hash,
                 updated_at = excluded.updated_at`,
    [hash, at]
  );
}

export async function hasPassword() {
  const { rows } = await query(`select 1 as ok from admin_account where id = 1`);
  return rows.length > 0;
}

async function storedHash() {
  const { rows } = await query(`select password_hash from admin_account where id = 1`);
  return rows.length > 0 ? rows[0].password_hash : "";
}

export async function checkPassword(password) {
  const hash = await storedHash();
  if (hash === "") return false;
  return verifyPassword(password, hash);
}

export async function bootstrapAdmin() {
  if (await hasPassword()) {
    if (config.demoMode) {
      console.log(`Demo database: ${config.sqlitePath}`);
      console.log(`Demo admin password (if unchanged): ${config.demoPassword}`);
    }
    return;
  }

  const password = config.adminPassword || (config.demoMode ? config.demoPassword : "");
  if (password === "") {
    console.log(
      "There is no admin password yet, so the admin pages will refuse to sign anyone in.\n" +
        '  Set one with:  npm run set-password -- "a long one you will remember"'
    );
    return;
  }

  await setPassword(password);
  if (config.demoMode && !config.adminPassword) {
    console.log(`Demo database: ${config.sqlitePath}`);
    console.log(`Demo admin password: ${config.demoPassword}`);
  } else {
    console.log("Admin password created from ADMIN_PASSWORD.");
  }
}

const fingerprint = (token) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession() {
  const token = crypto.randomBytes(32).toString("base64url");
  const at = nowIso();
  await query(`delete from admin_sessions where expires_at <= $1`, [at]);
  await query(
    `insert into admin_sessions (token_hash, created_at, expires_at, last_seen_at)
          values ($1, $2, $3, $2)`,
    [fingerprint(token), at, laterIso(SESSION_MS)]
  );
  return token;
}

function tokenFrom(req) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }
  return String(req.cookies?.[COOKIE] || "");
}

export async function readSession(req) {
  const token = tokenFrom(req);
  if (token === "") return "";

  const at = nowIso();
  const result = await query(
    `update admin_sessions
        set expires_at = $2,
            last_seen_at = $3
      where token_hash = $1
        and expires_at > $3`,
    [fingerprint(token), laterIso(SESSION_MS), at]
  );
  return result.rowCount > 0 ? token : "";
}

export async function destroySession(token) {
  if (!token) return;
  await query(`delete from admin_sessions where token_hash = $1`, [fingerprint(token)]);
}

export async function destroyOtherSessions(token) {
  await query(`delete from admin_sessions where token_hash <> $1`, [fingerprint(String(token || ""))]);
}

export function cookies(req, res, next) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (name === "") continue;
    const value = part.slice(at + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  req.cookies = out;
  next();
}

function cookieFor(value, maxAge) {
  const sameSite = config.sessionSameSite[0].toUpperCase() + config.sessionSameSite.slice(1);
  const bits = [`${COOKIE}=${value}`, "HttpOnly", "Path=/", `SameSite=${sameSite}`, `Max-Age=${maxAge}`];
  if (config.isProduction) bits.push("Secure");
  return bits.join("; ");
}

export function setSessionCookie(res, token) {
  res.set("Set-Cookie", cookieFor(token, MAX_AGE));
}

export function clearSessionCookie(res) {
  res.set("Set-Cookie", cookieFor("", 0));
}

export function requireAdmin(req, res, next) {
  readSession(req)
    .then((token) => {
      if (token === "") {
        next(new ApiError("unauthorised", 401, "Sign in first."));
        return;
      }
      req.sessionToken = token;
      next();
    })
    .catch(next);
}
