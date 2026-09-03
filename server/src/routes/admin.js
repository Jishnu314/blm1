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
import { loginInput, passwordChangeInput } from "../lib/validate.js";
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
import { lastError, mirrorEnabled, queueDepth } from "../services/mirror.js";
import { reportsSummary } from "../services/reports.js";

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

admin.get(
  "/status",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { reports, since } = await reportsSummary();
    const configured = mirrorEnabled();
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
