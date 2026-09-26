// Shared API client for the form and admin pages. Production calls the Supabase
// Edge Function; local development may use Vite's proxy to the legacy Express API.
// The anon key is public and only identifies the Supabase project. The secret
// service key and admin password stay on the Edge Function.

/**
 * What to put in front of every path:
 *
 *   development  Vite proxies /api to the server on 8787 (see vite.config.js),
 *                so the browser only ever sees localhost:5173.
 *   production   GitHub Actions sets this to the Supabase Edge Function URL.
 *
 * VITE_API_URL is blank for local Vite proxy development. In production it ends
 * with /functions/v1/api; client paths append /api/... after that.
 */
export const API_BASE = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
const SESSION_KEY = "renewal-register-admin-session";

/**
 * A failure with the server's own words in it.
 *
 * API.md promises every failure arrives as { error: { code, message, field } }
 * and never as HTML, so `message` is something that can be shown as it stands.
 * But a promise about the server is not a promise about everything between here
 * and it: a dev proxy that is not running, a captive portal, or a hosting layer
 * having a bad day all answer with HTML, or with nothing. So there is always a
 * readable message, and `code` falls back to a plain description of what
 * happened rather than to undefined.
 *
 *   code    "invalid_input", "unauthorised", … or "network" / "bad_response"
 *   status  the HTTP status, or 0 when the request never got an answer at all
 *   field   which typed value the server objected to, when it named one
 */
export class ApiError extends Error {
  constructor(message, { code = "", status = 0, field = "" } = {}) {
    super(message || "The server could not be reached.");
    this.name = "ApiError";
    this.code = code || (status ? `http_${status}` : "network");
    this.status = status;
    this.field = field;
  }
}

/**
 * The body as JSON, or null if it is not JSON at all.
 *
 * Read as text first and parsed here rather than handed to res.json(), because
 * res.json() throws the same way for an empty body as for a page of HTML, and
 * those two want different words said about them.
 */
async function readBody(res) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(method, path, body) {
  const sending = body !== undefined;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(sending ? { "Content-Type": "application/json" } : {}),
        ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
        ...(sessionStorage.getItem(SESSION_KEY)
          ? { Authorization: `Bearer ${sessionStorage.getItem(SESSION_KEY)}` }
          : {}),
      },
      body: sending ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only rejects when the request never happened at all: no signal, no
    // server listening, DNS gone. Nothing was read, so nothing can be said about
    // what the server thinks — only that we did not reach it.
    throw new ApiError("The server could not be reached. Check the connection and try again.", {
      code: "network",
      status: 0,
    });
  }

  // 204 has no body by definition, and asking for one would be a lie either way.
  if (res.status === 204) return {};

  const data = await readBody(res);

  if (!res.ok) {
    // `typeof null` is "object", which is exactly the sort of thing that turns a
    // failed request into a second, stranger failure. Checked for its own sake.
    const said = data && data.error && typeof data.error === "object" ? data.error : null;
    throw new ApiError(said?.message || `The server answered ${res.status}.`, {
      code: said?.code || "",
      status: res.status,
      field: said?.field || "",
    });
  }

  // A 200 that is not JSON is not an answer this app can use. In development it
  // is usually the Vite page itself, served because the proxy is not up.
  if (data === null) {
    throw new ApiError("The server's answer could not be read.", {
      code: "bad_response",
      status: res.status,
    });
  }

  return data;
}

/** Ask for something. Throws ApiError on anything that is not a 2xx of JSON. */
export async function apiGet(path) {
  return request("GET", path);
}

/** Change something: POST, PUT or DELETE, with a JSON body when there is one. */
export async function apiSend(method, path, body) {
  return request(method, path, body);
}

/**
 * Was that failure "you are not signed in"?
 *
 * Worth its own name because two callers have to tell it apart from "no signal",
 * and they do opposite things about them. No signal comes right by waiting; a 401
 * never does, so the outbox stops trying and the admin page puts the login back
 * up instead of showing a stale table as though the wind were to blame.
 */
export const isUnauthorised = (problem) => problem instanceof ApiError && problem.status === 401;

/**
 * Did the server understand the request and refuse it?
 *
 * This is the distinction the app was missing, and it was expensive. Everything
 * used to be folded into "could not be reached", which meant a 400 was retried
 * forever, reported as a signal problem, and — in the case of settings — left in
 * this browser's storage looking like the current value. Three lies from one
 * missing question.
 *
 * 400 is "what you typed is not usable" and 404 is "there is nothing here to
 * change". Neither comes right by waiting, so neither belongs in the outbox: an
 * action the server will never accept sits at the head of the queue and blocks
 * everything behind it on every single load.
 *
 * Deliberately NOT in this list: 401, which a sign-in fixes; 429, which waiting
 * fixes; and every 5xx, which is the server's problem and may well be over by the
 * next attempt.
 */
export const isRefusal = (problem) =>
  problem instanceof ApiError && (problem.status === 400 || problem.status === 404);
