import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public field = "") {
    super(message);
  }
}
const fail = (status: number, code: string, message: string, field = "") =>
  new HttpError(status, code, message, field);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const envelope = (error: HttpError) => ({ error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) } });
const text = (value: unknown) => String(value ?? "").trim();
const iso = (value: unknown) => {
  const d = new Date(String(value ?? ""));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};
const monthOK = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const reportIdOK = (v: string) => /^[A-Za-z0-9_-]{1,64}$/.test(v);
const settingKeys = new Set([
  "reportMonth", "graceDays", "credit", "open", "message", "showRd", "showFd", "autoWindow",
  "opensOnDay", "closesAfterDay", "popupOn", "popupMode", "popupFrom", "popupTo", "popupTitle",
  "popupText", "popupImage", "boardOn", "boardTitle", "boardPlayers",
]);
const defaults: Record<string, unknown> = {
  reportMonth: null, graceDays: 7, credit: "Jishnu · SLIA", open: true, message: "", showRd: true,
  showFd: true, autoWindow: false, opensOnDay: 28, closesAfterDay: 7, popupOn: false, popupMode: "always",
  popupFrom: "", popupTo: "", popupTitle: "", popupText: "", popupImage: "", boardOn: false,
  boardTitle: "", boardPlayers: "[]",
};

function normalizeReport(row: Record<string, any>) {
  const deposits = [...(row.deposits || [])].sort((a, b) => a.position - b.position || a.id - b.id);
  const of = (kind: string) => deposits.filter((d) => d.kind === kind)
    .map((d) => ({ amount: Number(d.amount), scheme: d.scheme }));
  return {
    id: row.id, name: row.name, month: row.month, renewal: Number(row.renewal),
    rd: of("rd"), fd: of("fd"), submittedAt: iso(row.submitted_at),
    editedAt: row.edited_at ? iso(row.edited_at) : "", editedIn: row.edited_in || "",
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
  };
}

function validateReport(input: any, withId = true) {
  const b = input && typeof input === "object" ? input : {};
  const name = text(b.name);
  if (!name || name.length > 80) throw fail(400, "invalid_input", "Say who this is for (up to 80 characters).", "name");
  const month = text(b.month);
  if (!monthOK(month)) throw fail(400, "invalid_input", "The month should be written as 2026-08.", "month");
  const id = text(b.id);
  if (withId && !reportIdOK(id)) throw fail(400, "invalid_input", "That report has no usable id.", "id");
  const money = (v: unknown, field: string) => {
    if (v === undefined || v === null || v === "") return 0;
    const n = typeof v === "number" ? v : /^\d+$/.test(text(v)) ? Number(v) : NaN;
    if (!Number.isSafeInteger(n) || n < 0 || n > 999_999_999)
      throw fail(400, "invalid_input", "Every amount must be a whole number from 0 to 999,999,999.", field);
    return n;
  };
  const deposits = (value: unknown, field: string) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 20)
      throw fail(400, "invalid_input", "At most 20 rows here.", field);
    return value.map((r, i) => {
      const scheme = text(r?.scheme);
      if (scheme.length > 80) throw fail(400, "invalid_input", "A scheme name is too long.", `${field}[${i}].scheme`);
      return { amount: money(r?.amount, `${field}[${i}].amount`), scheme };
    });
  };
  return {
    id, name, month, renewal: money(b.renewal, "renewal"), rd: deposits(b.rd, "rd"), fd: deposits(b.fd, "fd"),
    submittedAt: iso(b.submittedAt),
  };
}

function validateSettings(raw: any) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0)
    throw fail(400, "invalid_input", "There was nothing to change.", "settings");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!settingKeys.has(key)) throw fail(400, "invalid_input", `There is no setting called "${key}".`, key);
    if (["open", "showRd", "showFd", "autoWindow", "popupOn", "boardOn"].includes(key)) {
      if (typeof value !== "boolean") throw fail(400, "invalid_input", "This setting must be true or false.", key);
      out[key] = value;
    } else if (["graceDays", "opensOnDay", "closesAfterDay"].includes(key)) {
      const n = Number(value); const low = key === "opensOnDay" ? 1 : 0; const high = key === "graceDays" ? 28 : 31;
      if (!Number.isInteger(n) || n < low || n > high) throw fail(400, "invalid_input", "That number is outside the allowed range.", key);
      out[key] = n;
    } else {
      const v = value == null ? "" : String(value);
      const max = key === "boardPlayers" ? 20_000 : key === "message" ? 500 : key === "popupText" ? 2000 :
        ["credit"].includes(key) ? 80 : ["popupTitle", "boardTitle"].includes(key) ? 120 : 300;
      if (v.length > max)
        throw fail(400, "invalid_input", "That value is too long.", key);
      if (key === "popupMode") { out[key] = v === "window" ? "window" : "always"; continue; }
      if (key === "reportMonth" && v !== "" && !monthOK(v)) throw fail(400, "invalid_input", "The report month should be written as 2026-08.", key);
      if (["popupFrom", "popupTo"].includes(key) && v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v))
        throw fail(400, "invalid_input", "Use a date such as 2026-09-01.", key);
      if (key === "boardPlayers") {
        try { if (!Array.isArray(JSON.parse(v || "[]"))) throw new Error(); }
        catch { throw fail(400, "invalid_input", "The board list should be a JSON array.", key); }
      }
      if (key === "popupImage" && /^data:/i.test(v)) throw fail(400, "invalid_input", "Upload the picture first.", key);
      out[key] = key === "reportMonth" && v === "" ? null : key === "boardPlayers" && v === "" ? "[]" : v;
    }
  }
  return out;
}

const bytesToB64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const publicImageUrl = (key: string) => `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/register-images/${encodeURIComponent(key)}`;
const b64ToBytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const hex = (bytes: Uint8Array) => [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
async function digest(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 180_000 }, key, 256));
  return `pbkdf2$180000$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}
async function verifyPassword(password: string, encoded: string) {
  try {
    const [scheme, rounds, salt, expected] = encoded.split("$");
    if (scheme !== "pbkdf2" || Number(rounds) < 100_000) return false;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const got = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(salt), iterations: Number(rounds) }, key, 256));
    const want = b64ToBytes(expected);
    return got.length === want.length && got.every((v, i) => v === want[i]);
  } catch { return false; }
}
async function bootstrapAdmin() {
  const { data, error } = await db.from("admin_account").select("id,password_hash").eq("id", 1).maybeSingle();
  if (error) throw error;
  const initial = Deno.env.get("ADMIN_PASSWORD") || Deno.env.get("INITIAL_ADMIN_PASSWORD") || "";
  if (data && !String(data.password_hash).startsWith("scrypt$")) return;
  if (!initial) throw fail(503, "admin_not_configured", "Set the ADMIN_PASSWORD Edge Function secret, then try again.");
  const result = data
    ? await db.from("admin_account").update({ password_hash: await hashPassword(initial), updated_at: new Date().toISOString() }).eq("id", 1)
    : await db.from("admin_account").insert({ id: 1, password_hash: await hashPassword(initial) });
  const insertError = result.error;
  if (insertError && insertError.code !== "23505") throw insertError;
}
async function rateLimit(req: Request, scope: string, limit: number, seconds: number) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const bucket = `${scope}:${await digest(ip)}`;
  const { data, error } = await db.rpc("api_rate_limit", { p_bucket: bucket, p_limit: limit, p_seconds: seconds });
  if (error) throw error;
  if (!data) throw fail(429, "rate_limited", "Too many attempts. Wait a few minutes.");
}
async function adminToken(req: Request, required = true) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) { if (required) throw fail(401, "unauthorised", "Sign in first."); return ""; }
  const tokenHash = await digest(token);
  const { data, error } = await db.from("admin_sessions").update({ expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), last_seen_at: new Date().toISOString() })
    .eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).select("token_hash").maybeSingle();
  if (error) throw error;
  if (!data) { if (required) throw fail(401, "unauthorised", "Sign in first."); return ""; }
  return tokenHash;
}
async function currentPassword() {
  const { data, error } = await db.from("admin_account").select("password_hash").eq("id", 1).single();
  if (error) throw error;
  return String(data.password_hash);
}
async function readReport(id: string) {
  const { data, error } = await db.from("reports").select("*, deposits(id,kind,amount,scheme,position)").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? normalizeReport(data) : null;
}
async function queueMirror(kind: string, ref = "", payload = "") {
  if (!Deno.env.get("SHEET_WEBHOOK_URL")) return;
  const { error } = await db.from("mirror_queue").insert({ kind, ref: String(ref), payload });
  if (error) throw error;
  scheduleMirror();
}
function scheduleMirror() {
  if (!Deno.env.get("SHEET_WEBHOOK_URL")) return;
  // Supabase Edge Runtime keeps this work alive briefly after the response.
  // @ts-ignore EdgeRuntime is supplied by Supabase's Deno runtime.
  EdgeRuntime.waitUntil(drainMirror().catch((e: unknown) => console.error("Sheet copy:", e)));
}

const sum = (rows: any[]) => rows.reduce((s, row) => s + Number(row.amount || 0), 0);
const detail = (rows: any[]) => rows.map((row) => `${row.scheme} ${Number(row.amount || 0)}`).join(" | ");
function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number); const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleString("en", { month: "long", timeZone: "UTC" }) + ` ${y}`;
}
function reportMirror(report: any) {
  const rd = report.rd || []; const fd = report.fd || [];
  return new URLSearchParams({ action: "saveReport", id: report.id, name: report.name,
    renewal: String(report.renewal), rdCount: String(rd.length), rdTotal: String(sum(rd)), rdDetail: detail(rd),
    fdCount: String(fd.length), fdTotal: String(sum(fd)), fdDetail: detail(fd), rdJson: JSON.stringify(rd),
    fdJson: JSON.stringify(fd), month: report.month, monthLabel: monthLabel(report.month), submittedAt: report.submittedAt });
}
function settingsMirror(settings: Record<string, any>) {
  const v = (key: string) => String(settings[key] ?? ""); const yes = (key: string) => settings[key] ? "yes" : "no";
  return new URLSearchParams({ action: "saveSettings", reportMonth: v("reportMonth"), graceDays: v("graceDays"),
    credit: v("credit"), open: yes("open"), message: v("message"), showRd: yes("showRd"), showFd: yes("showFd"),
    autoWindow: yes("autoWindow"), opensOnDay: v("opensOnDay"), closesAfterDay: v("closesAfterDay"), popupOn: yes("popupOn"),
    popupMode: v("popupMode"), popupFrom: v("popupFrom"), popupTo: v("popupTo"), popupTitle: v("popupTitle"),
    popupText: v("popupText"), popupImage: v("popupImage"), boardOn: yes("boardOn"), boardTitle: v("boardTitle"),
    boardPlayers: v("boardPlayers") || "[]" });
}
async function settingsSnapshot() {
  const { data, error } = await db.from("settings").select("key,value"); if (error) throw error;
  const held = { ...defaults } as Record<string, any>;
  for (const row of data || []) {
    const key = row.key; const value = row.value;
    if (!(key in defaults)) continue;
    if (["open", "showRd", "showFd", "autoWindow", "popupOn", "boardOn"].includes(key)) held[key] = ["yes", "y", "1", "on", "true"].includes(String(value).toLowerCase());
    else if (["graceDays", "opensOnDay", "closesAfterDay"].includes(key)) held[key] = Number(value);
    else if (key === "reportMonth") held[key] = monthOK(String(value)) ? value : null;
    else held[key] = value;
  }
  return held;
}
async function mirrorBody(row: any) {
  if (row.kind === "delete") return new URLSearchParams({ action: "deleteReport", id: row.ref });
  if (row.kind === "settings") return settingsMirror(JSON.parse(row.payload));
  if (row.kind === "report") {
    const report = await readReport(row.ref); return report ? reportMirror(report) : null;
  }
  if (row.kind === "image") {
    const { data: image, error } = await db.from("stored_images").select("object_key,name,mime").eq("id", Number(row.ref)).maybeSingle();
    if (error) throw error; if (!image) return null;
    const { data: blob, error: downloadError } = await db.storage.from("register-images").download(image.object_key);
    if (downloadError) throw downloadError;
    const b64 = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
    return new URLSearchParams({ action: "saveImage", name: image.name, data: `data:${image.mime};base64,${b64}` });
  }
  throw new Error("Unknown sheet copy item.");
}
async function drainMirror() {
  const url = Deno.env.get("SHEET_WEBHOOK_URL"); if (!url) return;
  const { data: rows, error } = await db.from("mirror_queue").select("*").lte("next_try_at", new Date().toISOString()).order("id").limit(20);
  if (error) throw error;
  for (const row of rows || []) {
    try {
      const body = await mirrorBody(row);
      if (body) {
        const response = await fetch(url, { method: "POST", body, redirect: "follow", signal: AbortSignal.timeout(8000) });
        const said = await response.text(); if (!response.ok) throw new Error(`Sheet replied ${response.status}`);
        let parsed: any; try { parsed = JSON.parse(said); } catch { throw new Error("The Sheet did not answer with JSON."); }
        if (parsed?.error) throw new Error(String(parsed.error).slice(0, 400));
      }
      const { error: deleteError } = await db.from("mirror_queue").delete().eq("id", row.id); if (deleteError) throw deleteError;
    } catch (e) {
      const attempts = Number(row.attempts || 0) + 1;
      await db.from("mirror_queue").update({ attempts, last_error: String(e).slice(0, 500), next_try_at: new Date(Date.now() + Math.min(attempts, 10) * 30_000).toISOString() }).eq("id", row.id);
      break;
    }
  }
}

async function handle(req: Request) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const fullPath = new URL(req.url).pathname;
  // Supabase may pass the full gateway path or only the path below the function
  // name, depending on the invocation route. The browser client appends `/api/...`
  // to the function URL, so normalize any function prefix and repeated `/api`
  // prefixes before dispatching.
  let route = fullPath.replace(/^\/functions\/v1\/api(?=\/|$)/, "") || "/";
  while (route === "/api" || route.startsWith("/api/")) {
    route = route.slice(4) || "/";
  }
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? {} : await req.json().catch(() => ({}));
  scheduleMirror();

  if (route === "/health" && method === "GET") {
    const { error } = await db.from("reports").select("id", { head: true, count: "exact" });
    return json({ ok: !error, at: new Date().toISOString(), database: !error });
  }

  if (route === "/settings" && method === "GET") return json({ settings: await settingsSnapshot() });
  if (route === "/settings" && method === "PUT") {
    await adminToken(req); const patch = validateSettings(body?.settings);
    const { error } = await db.rpc("api_write_settings", { patch }); if (error) throw error;
    const settings = await settingsSnapshot(); await queueMirror("settings", "", JSON.stringify(settings));
    return json({ settings });
  }

  if (route === "/reports" && method === "GET") {
    await adminToken(req);
    let query = db.from("reports").select("*, deposits(id,kind,amount,scheme,position)").order("submitted_at", { ascending: false }).order("id", { ascending: false });
    const month = text(url.searchParams.get("month")); if (month) query = query.eq("month", month);
    const includeDeleted = url.searchParams.has("includeDeleted") && url.searchParams.get("includeDeleted") !== "0";
    if (!includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query; if (error) throw error;
    return json({ reports: (data || []).map(normalizeReport), at: new Date().toISOString() });
  }
  if (route === "/reports" && method === "POST") {
    await rateLimit(req, "reports", 30, 600);
    const report = validateReport(body?.report); const { data: created, error } = await db.rpc("api_create_report", { p: report });
    if (error) throw error;
    const saved = await readReport(report.id);
    if (created) await queueMirror("report", report.id);
    return json({ report: saved, created: Boolean(created) }, created ? 201 : 200);
  }
  const reportMatch = route.match(/^\/reports\/([^/]+)(?:\/(restore))?$/);
  if (reportMatch) {
    await adminToken(req); const id = decodeURIComponent(reportMatch[1]);
    if (!reportIdOK(id)) throw fail(400, "invalid_input", "That report id is not valid.", "id");
    if (method === "PUT" && !reportMatch[2]) {
      const report = validateReport(body?.report, false);
      const { data: changed, error } = await db.rpc("api_replace_report", { p_id: id, p: report }); if (error) throw error;
      if (!changed) throw fail(404, "not_found", "There is no report with that id.");
      const saved = await readReport(id); await queueMirror("report", id); return json({ report: saved });
    }
    if (method === "DELETE" && !reportMatch[2]) {
      const { data: result, error } = await db.rpc("api_delete_report", { p_id: id }); if (error) throw error;
      if (result === "missing") throw fail(404, "not_found", "There is no report with that id.");
      if (result === "done") await queueMirror("delete", id); return json({ ok: true });
    }
    if (method === "POST" && reportMatch[2]) {
      const { data: changed, error } = await db.rpc("api_restore_report", { p_id: id }); if (error) throw error;
      if (!changed) throw fail(404, "not_found", "There is no report with that id.");
      const saved = await readReport(id); await queueMirror("report", id); return json({ report: saved });
    }
  }

  if (route === "/images" && method === "POST") {
    await adminToken(req);
    const input = body && typeof body.data === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(body.data.trim()) : null;
    if (!input) throw fail(400, "invalid_input", "Only a JPG, PNG or WebP picture can go up.", "data");
    const bytes = b64ToBytes(input[2]); if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw fail(400, "invalid_input", "That picture must be under 2 MB.", "data");
    const mime = input[1].toLowerCase(); const name = text(body.name).slice(0, 120) || "poster.jpg";
    const dimension = (value: unknown, field: string) => {
      if (value === undefined || value === null || value === "") return null;
      const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > 100_000) throw fail(400, "invalid_input", "A picture dimension is invalid.", field);
      return n;
    };
    const key = `${crypto.randomUUID()}.${mime.split("/")[1]}`;
    const { data: row, error } = await db.from("stored_images").insert({ object_key: key, name, mime, bytes: bytes.length,
      width: dimension(body.width, "width"), height: dimension(body.height, "height") }).select("id,name,bytes,created_at").single();
    if (error) throw error;
    const { error: uploadError } = await db.storage.from("register-images").upload(key, bytes, { contentType: mime, upsert: false });
    if (uploadError) { await db.from("stored_images").delete().eq("id", row.id); throw uploadError; }
    const image = { id: Number(row.id), url: publicImageUrl(key), name: row.name, bytes: row.bytes, when: iso(row.created_at) };
    await queueMirror("image", String(row.id)); return json({ image }, 201);
  }
  if (route === "/images" && method === "GET") {
    await adminToken(req); const { data, error } = await db.from("stored_images").select("id,name,bytes,created_at").order("id", { ascending: false });
    if (error) throw error;
    return json({ images: (data || []).map((r) => ({ id: Number(r.id), url: publicImageUrl(r.object_key), name: r.name, bytes: Number(r.bytes), when: iso(r.created_at) })) });
  }
  const imageMatch = route.match(/^\/images\/(\d{1,18})$/);
  if (imageMatch && method === "GET") {
    const { data: row, error } = await db.from("stored_images").select("object_key,mime").eq("id", Number(imageMatch[1])).maybeSingle();
    if (error) throw error; if (!row) throw fail(404, "not_found", "There is no picture with that id.");
    const { data: blob, error: downloadError } = await db.storage.from("register-images").download(row.object_key);
    if (downloadError) throw fail(404, "not_found", "There is no picture with that id.");
    return new Response(blob, { headers: { ...cors, "Content-Type": row.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (imageMatch && method === "DELETE") {
    await adminToken(req);
    const { data: row, error } = await db.from("stored_images").select("object_key").eq("id", Number(imageMatch[1])).maybeSingle();
    if (error) throw error; if (!row) throw fail(404, "not_found", "There is no picture with that id.");
    const { error: removeError } = await db.storage.from("register-images").remove([row.object_key]); if (removeError) throw removeError;
    const { error: deleteError } = await db.from("stored_images").delete().eq("id", Number(imageMatch[1])); if (deleteError) throw deleteError;
    return json({ ok: true });
  }

  if (route === "/admin/login" && method === "POST") {
    await rateLimit(req, "login", 10, 900);
    const password = String(body?.password ?? ""); if (!password || password.length > 200) throw fail(400, "invalid_input", "Type a password.", "password");
    await bootstrapAdmin(); const hash = await currentPassword();
    if (!await verifyPassword(password, hash)) throw fail(401, "unauthorised", "That was not the right password.");
    const raw = crypto.getRandomValues(new Uint8Array(32)); const token = bytesToB64(raw).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const tokenHash = await digest(token); const { error } = await db.from("admin_sessions").insert({ token_hash: tokenHash, expires_at: new Date(Date.now() + 30 * 864e5).toISOString() });
    if (error) throw error; return json({ ok: true, token });
  }
  if (route === "/admin/me" && method === "GET") return json({ signedIn: Boolean(await adminToken(req, false)) });
  if (route === "/admin/logout" && method === "POST") {
    const tokenHash = await adminToken(req); const { error } = await db.from("admin_sessions").delete().eq("token_hash", tokenHash); if (error) throw error;
    return json({ ok: true });
  }
  if (route === "/admin/password" && method === "POST") {
    const tokenHash = await adminToken(req); const current = String(body?.current ?? ""); const next = String(body?.next ?? "");
    if (next.length < 10 || next.length > 200) throw fail(400, "invalid_input", "A new password needs at least 10 characters.", "next");
    if (!await verifyPassword(current, await currentPassword())) throw fail(401, "unauthorised", "That is not the current password.");
    const { error } = await db.from("admin_account").update({ password_hash: await hashPassword(next), updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw error;
    const { error: sessionsError } = await db.from("admin_sessions").delete().neq("token_hash", tokenHash); if (sessionsError) throw sessionsError;
    return json({ ok: true });
  }
  if (route === "/admin/customers" && method === "GET") {
    await adminToken(req);
    const { data, error } = await db.from("customer_ledger").select("customers").eq("id", 1).maybeSingle();
    if (error) throw error;
    return json({ customers: Array.isArray(data?.customers) ? data.customers : [], configured: Boolean(data) });
  }
  if (route === "/admin/customers" && method === "PUT") {
    await adminToken(req);
    const customers = body?.customers;
    if (!Array.isArray(customers) || customers.length > 3000 || JSON.stringify(customers).length > 1_500_000)
      throw fail(400, "invalid_input", "The customer list is too large or has an invalid format.", "customers");
    const { error } = await db.from("customer_ledger").upsert({ id: 1, customers, updated_at: new Date().toISOString() });
    if (error) throw error;
    return json({ ok: true });
  }
  if (route === "/admin/status" && method === "GET") {
    await adminToken(req);
    const [{ count, error: countError }, { data: first, error: firstError }, { count: queued, error: queueError }, { data: last, error: lastError }] = await Promise.all([
      db.from("reports").select("id", { count: "exact", head: true }).is("deleted_at", null),
      db.from("reports").select("submitted_at").is("deleted_at", null).order("submitted_at").limit(1),
      db.from("mirror_queue").select("id", { count: "exact", head: true }),
      db.from("mirror_queue").select("last_error").neq("last_error", "").order("id", { ascending: false }).limit(1),
    ]);
    if (countError || firstError || queueError || lastError) throw countError || firstError || queueError || lastError;
    return json({ sheet: { configured: Boolean(Deno.env.get("SHEET_WEBHOOK_URL")), queue: Deno.env.get("SHEET_WEBHOOK_URL") ? queued || 0 : 0, lastError: Deno.env.get("SHEET_WEBHOOK_URL") ? last?.[0]?.last_error || "" : "" }, reports: count || 0, since: first?.[0]?.submitted_at || "" });
  }

  throw fail(404, "not_found", "There is no API route here.");
}

Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (problem) {
    console.error(problem);
    if (problem instanceof HttpError) return json(envelope(problem), problem.status);
    const message = problem instanceof Error ? problem.message : "The request could not be completed.";
    return json({ error: { code: "server_error", message: "The server could not complete that request." } }, 500);
  }
});
