// A rate limit that lives in this process's memory, and is honest about it.
//
// Two routes need one: the form's send, so a script cannot fill the register, and
// the login, so a password cannot be guessed at machine speed. Both are counted per
// IP per route — one agent hammering the form must not close the door on another.
//
// What "in memory" costs, said out loud: the counts reset when the process restarts
// or is deployed, and a second instance would keep its own tally. On one small
// Render instance that is exactly right and costs nothing. If this ever runs on two
// instances, the counts belong in Postgres instead.
//
// req.ip is only the real phone when Express has been told to trust the proxy in
// front of it (TRUST_PROXY=1). Without that, everybody behind Render's proxy shares
// one bucket — which is why config.js has that variable at all.

import { ApiError } from "./http.js";

/** name|ip → { hits, resetAt } */
const seen = new Map();

/**
 * Throw away everything whose window has passed.
 *
 * A limiter that only ever adds to a Map is a slow memory leak, and the sweep is
 * cheap because expired keys are the overwhelming majority.
 */
function sweep(now) {
  for (const [key, bucket] of seen) {
    if (bucket.resetAt <= now) seen.delete(key);
  }
}

let sweeper = null;

/** Called once from index.js. The timer is unref'd so it cannot hold the process open. */
export function startRateLimitSweeper(everyMs = 10 * 60 * 1000) {
  if (sweeper) return () => {};
  sweeper = setInterval(() => sweep(Date.now()), everyMs);
  sweeper.unref();
  return () => {
    clearInterval(sweeper);
    sweeper = null;
  };
}

/**
 * Middleware. `limit` requests per `windowMs` per IP, counted under `name`.
 *
 * The window is fixed rather than sliding: the first request starts a clock, and
 * when the clock runs out the count starts again. A sliding window is fairer and
 * more code; for "30 reports in ten minutes" nobody will ever notice the difference.
 */
export function rateLimit({ name, limit, windowMs, message }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    const key = `${name}|${req.ip || "unknown"}`;
    const bucket = seen.get(key);

    if (!bucket || bucket.resetAt <= now) {
      seen.set(key, { hits: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.hits += 1;
    if (bucket.hits <= limit) {
      next();
      return;
    }

    const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    next(new ApiError("too_many", 429, message, "", seconds));
  };
}
