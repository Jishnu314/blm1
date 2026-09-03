// The admin's password, the admin's session, and the cookie that carries it.
//
// Three decisions are encoded here and each replaces something the old app did:
//
//   The password is hashed with scrypt from node:crypto, not bcrypt. bcrypt is a
//   native build, and a native build is a thing that fails on a Windows box at the
//   worst moment. scrypt is in Node, needs nothing installed, and the parameters
//   travel inside the stored hash so raising them later does not lock anyone out.
//
//   The cookie is HttpOnly. That is the whole point of moving off the PIN in
//   src/config.js: a PIN in the bundle can be read out of the bundle. No JavaScript
//   on the page can read this cookie, so the token cannot be copied out of a phone
//   somebody borrowed.
//
//   What is stored is sha256(token), never the token. Somebody who reads the
//   sessions table gets a list of hashes, not a drawer of working keys.

import crypto from "node:crypto";
import { query } from "./db.js";
import { config } from "./config.js";
import { ApiError } from "./lib/http.js";

const COOKIE = "mr_session";
const DAYS = 30;
const MAX_AGE = DAYS * 24 * 60 * 60; // 2592000, the number in API.md
const SESSION_LIFETIME = `${DAYS} days`;

/* --- the password --------------------------------------------------------- */

// 2^14 rounds is the usual scrypt starting point and costs about 16 MB of memory
// per attempt, which is what makes guessing expensive. They are stored with the
// hash so a hash made today still verifies after these change.
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

/** "scrypt$16384$8$1$<salt hex>$<key hex>" — self-describing, so it can be re-read. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, { n: N, r: R, p: P, length: KEY_LENGTH });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Does this password match that stored hash?
 *
 * Returns false rather than throwing on a stored hash it cannot read — a corrupted
 * row should mean "that password is wrong", not a 500 that tells a stranger the
 * account exists and is broken. timingSafeEqual needs two buffers of the same
 * length, so the lengths are checked first, and they are compared as bytes rather
 * than as strings because === on a hex string leaks how much of it matched.
 */
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

/** Write the one admin row, whether or not it was there before. */
export async function setPassword(password) {
  const hash = await hashPassword(password);
  await query(
    `insert into admin_account (id, password_hash)
          values (1, $1)
     on conflict (id) do update
             set password_hash = excluded.password_hash,
                 updated_at = now()`,
    [hash]
  );
}

export async function hasPassword() {
  const { rows } = await query(`select 1 from admin_account where id = 1`);
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

/**
 * On boot: make the account from ADMIN_PASSWORD if there is not one yet.
 *
 * If there is no account and no ADMIN_PASSWORD, the server keeps serving and says
 * what to do. That is deliberate — the form is the part agents need, and it does not
 * need an admin. Only the admin routes are shut, and they answer 401, which is the
 * truth.
 */
export async function bootstrapAdmin() {
  if (await hasPassword()) return;

  if (config.adminPassword === "") {
    console.log(
      "There is no admin password yet, so the admin pages will refuse to sign anyone in.\n" +
        '  Set one with:  npm run set-password -- "a long one you will remember"'
    );
    return;
  }

  await setPassword(config.adminPassword);
  console.log("Admin password created from ADMIN_PASSWORD.");
}

/* --- the session ---------------------------------------------------------- */

const fingerprint = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * A new session. The token is returned once, to be put in the cookie, and never
 * stored anywhere in a form that could be used.
 *
 * Expired rows are cleared out here because signing in is the only moment sessions
 * are created, so it is the only moment the table can grow — a sweep on a timer
 * would be a timer that exists to tidy something that was already tidy.
 */
export async function createSession() {
  const token = crypto.randomBytes(32).toString("base64url");
  await query(`delete from admin_sessions where expires_at <= now()`);
  await query(
    `insert into admin_sessions (token_hash, expires_at)
          values ($1, now() + interval '${SESSION_LIFETIME}')`,
    [fingerprint(token)]
  );
  return token;
}

/**
 * Is this request signed in? Returns the token, or "".
 *
 * The check and the extension are one statement: a valid session is stamped and
 * pushed 30 days out in the same round trip that proves it is valid, so an admin who
 * uses the page never gets signed out and a database that is far away is only
 * visited once. `expires_at > now()` in the WHERE is what makes an expired row
 * unusable without anything having to have deleted it yet.
 */
export async function readSession(req) {
  const token = String(req.cookies?.[COOKIE] || "");
  if (token === "") return "";

  const { rows } = await query(
    `update admin_sessions
        set expires_at = now() + interval '${SESSION_LIFETIME}',
            last_seen_at = now()
      where token_hash = $1
        and expires_at > now()
  returning token_hash`,
    [fingerprint(token)]
  );
  return rows.length > 0 ? token : "";
}

export async function destroySession(token) {
  if (!token) return;
  await query(`delete from admin_sessions where token_hash = $1`, [fingerprint(token)]);
}

/** Used when the password changes: every other device is signed out. */
export async function destroyOtherSessions(token) {
  await query(`delete from admin_sessions where token_hash <> $1`, [fingerprint(String(token || ""))]);
}

/* --- the cookie ----------------------------------------------------------- */

/**
 * req.headers.cookie into an object, in a few lines, because that is all
 * cookie-parser would have done and this server has two dependencies.
 */
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
      // A cookie somebody else set, with a stray % in it. Keep it as it came.
      out[name] = value;
    }
  }
  req.cookies = out;
  next();
}

function cookieFor(value, maxAge) {
  const bits = [`${COOKIE}=${value}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  // Secure only in production: on http://localhost a Secure cookie is dropped by
  // the browser and nobody can sign in while developing.
  if (config.isProduction) bits.push("Secure");
  return bits.join("; ");
}

export function setSessionCookie(res, token) {
  res.set("Set-Cookie", cookieFor(token, MAX_AGE));
}

export function clearSessionCookie(res) {
  res.set("Set-Cookie", cookieFor("", 0));
}

/* --- the gate ------------------------------------------------------------- */

/**
 * Everything that shows or changes the whole register goes through here.
 *
 * Reading the register is admin-only, which it never was: with the sheet as the
 * register the /exec URL sat in the published JavaScript, and anybody holding it
 * could read every agent's figures.
 */
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
