// Signing in, signing out, changing the password, and one line about the sheet.
//
// This replaces the PIN in src/config.js, and the difference is not the length of the
// secret. A PIN checked in the browser is in the bundle every agent downloads; this
// password is compared here and never leaves, and what the browser is given back is a
// cookie no JavaScript on the page can read.
//
// GET /me answers 200 either way, on purpose: the admin page asks it on open to decide
// whether to show the login form, and a 401 there would be noise in the console for
// something that is not an error.

import express from "express";
import { ApiError, asyncRoute } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { loginInput, newReport, passwordChangeInput } from "../lib/validate.js";
import {
  checkPassword,
  clearSessionCookie,
  createSession,
  destroyOtherSessions,
  destroySession,
  readSession,
  requireAdmin,
  setPassword,
  setSessionCookie,
} from "../auth.js";
import { lastError, queueDepth, sheetWebhookUrl } from "../services/mirror.js";
import { insertReport, reportsSummary } from "../services/reports.js";
import { query } from "../db.js";

export const admin = express.Router();

// Ten attempts per address per quarter of an hour. Slow enough that guessing is
// hopeless, generous enough that mistyping it four times is not a lockout.
const signingIn = rateLimit({
  name: "login",
  limit: 10,
  windowMs: 15 * 60 * 1000,
  message: "Too many attempts. Wait a quarter of an hour.",
});

/**
 * Every attempt waits, whether it was right or wrong.
 *
 * It is not a full defence — scrypt already makes the two paths take roughly the same
 * time, and this on top of it means a stopwatch is not worth pointing at the route.
 * The reply says the same thing every time either way: no hint about whether the
 * password was close, or whether there is an account at all.
 */
const PAUSE_MS = 300;
const pause = () => new Promise((done) => setTimeout(done, PAUSE_MS));

const wrong = () => new ApiError("unauthorised", 401, "That was not the right password.");

admin.post(
  "/login",
  signingIn,
  asyncRoute(async (req, res) => {
    const password = loginInput(req.body);
    const ok = await checkPassword(password);
    await pause();
    if (!ok) throw wrong();

    setSessionCookie(res, await createSession());
    res.json({ ok: true });
  })
);

admin.get(
  "/me",
  asyncRoute(async (req, res) => {
    res.json({ signedIn: (await readSession(req)) !== "" });
  })
);

admin.post(
  "/logout",
  requireAdmin,
  asyncRoute(async (req, res) => {
    // This session only. Another device stays signed in, because signing out of a
    // borrowed phone should not sign you out of your own.
    await destroySession(req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

admin.post(
  "/password",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { current, next } = passwordChangeInput(req.body);
    const ok = await checkPassword(current);
    await pause();
    if (!ok) throw wrong();

    await setPassword(next);
    // Changing the password signs every other device out. If it is being changed
    // because somebody else had it, leaving their session alive would be pointless.
    await destroyOtherSessions(req.sessionToken);
    res.json({ ok: true });
  })
);

const validAppsScriptUrl = (input) => {
  let url;
  try { url = new URL(String(input || "").trim()); } catch { throw new ApiError("invalid_input", 400, "Paste the Apps Script web app link ending in /exec.", "url"); }
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.port || url.username || url.password ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash)
    throw new ApiError("invalid_input", 400, "Use the deployed Apps Script web app URL ending in /exec. A /dev link or regular Sheet link will not connect.", "url");
  return url.toString();
};

async function sheetReports(url) {
  const probe = new URL(url); probe.searchParams.set("action", "reports");
  let response;
  try { response = await fetch(probe, { redirect: "follow", signal: AbortSignal.timeout(12000) }); }
  catch { throw new ApiError("sheet_unreachable", 400, "Google did not answer. Confirm the web app is deployed for anyone and try again."); }
  if (!response.ok) throw new ApiError("sheet_unreachable", 400, `Google answered ${response.status}. Check the Apps Script deployment and try again.`);
  const data = await response.json().catch(() => null);
  if (!Array.isArray(data?.reports)) throw new ApiError("sheet_format", 400, "The link did not return reports. Update the Apps Script Code.gs and deploy it as a web app.");
  return data.reports;
}

admin.get("/sheet", requireAdmin, asyncRoute(async (_req, res) => {
  const url = await sheetWebhookUrl();
  res.json({ configured: Boolean(url), url });
}));

admin.put("/sheet", requireAdmin, asyncRoute(async (req, res) => {
  const url = validAppsScriptUrl(req.body?.url);
  await sheetReports(url);
  await query(
    `insert into settings(key, value, updated_at) values ($1, $2, now())
     on conflict(key) do update set value = excluded.value, updated_at = now()`,
    ["sheetWebhookUrl", url]
  );
  res.json({ configured: true, url });
}));

admin.post("/sheet/import", requireAdmin, asyncRoute(async (_req, res) => {
  const url = await sheetWebhookUrl();
  if (!url) throw new ApiError("sheet_not_configured", 409, "Add and connect the Apps Script /exec link first.");
  const sourceRows = await sheetReports(url);
  if (sourceRows.length > 20000) throw new ApiError("sheet_too_large", 413, "This sheet has over 20,000 reports. Import it in smaller groups.");
  let imported = 0;
  let skipped = 0;
  for (const source of sourceRows) {
    try {
      const result = await insertReport(newReport(source));
      if (result.created) imported += 1;
      else skipped += 1;
    } catch (problem) {
      if (problem.status === 400) { skipped += 1; continue; }
      throw problem;
    }
  }
  res.json({ imported, skipped, total: sourceRows.length });
}));

admin.get(
  "/status",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { reports, since } = await reportsSummary();
    const configured = Boolean(await sheetWebhookUrl());
    res.json({
      // Enough to answer "is the Google Sheet copy keeping up?" without opening the
      // sheet. A queue that is not zero and an error that is not empty is the whole
      // diagnosis.
      sheet: {
        configured,
        queue: configured ? await queueDepth() : 0,
        lastError: configured ? await lastError() : "",
      },
      reports,
      since,
    });
  })
);
