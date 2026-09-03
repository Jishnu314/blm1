// Signing in to the admin page.
//
// This replaces a code compared in the browser. The difference is not the number
// of characters: the old PIN sat in the built JavaScript, so anyone who opened the
// page could read it out of the bundle, and it protected nothing but the *sight*
// of the page — the register itself was readable by anyone holding the webhook
// address. Now the password is only ever checked on the server, and the register
// route refuses to answer at all without the session cookie it hands back.
//
// Nothing in here holds the session. The cookie is HttpOnly, which means this file
// cannot read it even if it wanted to, and that is the point — no script on the
// page can copy it out. All these four calls do is ask the server what it thinks.

import { apiGet, apiSend, ApiError } from "./api.js";

/** Is this browser signed in? Answers false rather than throwing. */
export async function whoAmI() {
  try {
    const data = await apiGet("/api/admin/me");
    return { signedIn: Boolean(data?.signedIn), reachable: true };
  } catch {
    // Could not ask — the server may be asleep or this phone may be offline.
    // Not signed in, but say so separately: "wrong password" and "no answer"
    // deserve different words on screen.
    return { signedIn: false, reachable: false };
  }
}

/**
 * Try a password.
 *
 * A wrong password and a rate-limited attempt are told apart, because one is
 * "try again" and the other is "wait" — but a wrong password is never told how
 * wrong it was.
 *
 * A refused *shape* is a third thing again, and it used to come out as "could not
 * reach the server", which is the one explanation that is certainly untrue: the
 * server answered, and what it said was that nothing had been typed. Its own
 * sentence is shown instead.
 */
export async function signIn(password) {
  try {
    await apiSend("POST", "/api/admin/login", { password });
    return { ok: true, note: "" };
  } catch (problem) {
    if (problem instanceof ApiError && problem.status === 401) {
      return { ok: false, note: "Not that." };
    }
    if (problem instanceof ApiError && problem.status === 429) {
      return { ok: false, note: "Too many tries. Wait a few minutes." };
    }
    if (problem instanceof ApiError && problem.code === "invalid_input") {
      return { ok: false, note: problem.message };
    }
    return { ok: false, note: "Could not reach the server just now." };
  }
}

/** Sign this browser out. Other devices stay signed in. */
export async function signOut() {
  try {
    await apiSend("POST", "/api/admin/logout");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Change the password. The server signs every other device out when this
 * succeeds, which is the whole reason to have it here rather than in a script:
 * if you ever think somebody else has it, this is the way to shut them out.
 */
export async function changePassword(current, next) {
  try {
    await apiSend("POST", "/api/admin/password", { current, next });
    return { ok: true, note: "Changed. Every other device has been signed out." };
  } catch (problem) {
    if (problem instanceof ApiError && problem.status === 401) {
      return { ok: false, note: "That is not the current password." };
    }
    if (problem instanceof ApiError && problem.code === "invalid_input") {
      return { ok: false, note: problem.message };
    }
    return { ok: false, note: "Could not reach the server just now." };
  }
}

/** What the server is doing behind the page — the sheet copy, mostly. */
export async function serverStatus() {
  try {
    return await apiGet("/api/admin/status");
  } catch {
    return null;
  }
}
