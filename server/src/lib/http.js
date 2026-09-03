// One failure envelope, for every failure.
//
//   { "error": { "code": "invalid_input", "message": "Say who this is for.", "field": "name" } }
//
// The point is that a caller never has to guess. A 500 does not answer with
// Express's HTML error page, a missing route does not answer with "Cannot GET
// /api/reprots", and nothing under /api ever answers with anything but JSON — the
// phone reads `error.message` and shows it, whatever went wrong.
//
// `field` is only there when something typed is at fault and we know which thing.

/**
 * A failure we meant. Anything else reaching the error middleware is a bug.
 *
 * The code and the status travel together because the contract pairs them, and
 * pairing them here means no route can answer 404 with the word "unauthorised".
 * `field` is the name of the thing that was typed wrong, when there is one;
 * `retryAfter` is seconds, and only the rate limiter sets it.
 */
export class ApiError extends Error {
  constructor(code, status, message, field = "", retryAfter = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.field = field;
    this.retryAfter = retryAfter;
  }
}

/**
 * Express 4 does not catch a rejected promise, so an async handler that throws
 * hangs the request until the browser gives up. Every async route is wrapped.
 */
export function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** Anything under /api that no route claimed. Mounted after the static files. */
export function apiNotFound(req, res, next) {
  next(new ApiError("not_found", 404, "There is nothing at that address."));
}

/**
 * Postgres being unreachable is not a bug in this code, and answering 500 makes it
 * look like one. These are the codes that mean "the database could not be reached"
 * — connection refused, name not resolving, the server shutting down underneath us,
 * too many clients. A wrong password or a database that does not exist is a
 * different mistake, but from the caller's side the answer is the same: not now.
 */
const DATABASE_IS_AWAY = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
  "08000", // connection exception
  "08001", // client cannot connect
  "08003", // connection does not exist
  "08006", // connection failure
  "28P01", // password authentication failed
  "3D000", // no such database
  "53300", // too many connections
  "57P01", // admin shut the server down
  "57P02", // crash shutdown
  "57P03", // cannot connect now, still starting up
]);

function databaseIsAway(problem) {
  if (problem && DATABASE_IS_AWAY.has(String(problem.code))) return true;
  // pg's pool says this in words rather than in a code when it runs out of time
  // waiting for a free connection.
  return /timeout exceeded when trying to connect/i.test(String(problem?.message || ""));
}

/**
 * Body-parser's own failures, in our language.
 *
 * A body over the 4mb limit and a body that is not JSON are both "what you sent is
 * not usable", which is exactly what invalid_input means. There is no 413 in the
 * contract and inventing one would leave a client with a status it does not handle.
 */
function bodyProblem(problem) {
  if (problem?.type === "entity.too.large") {
    return new ApiError("invalid_input", 400, "That was too big to send in one go.");
  }
  if (problem?.type === "entity.parse.failed" || problem instanceof SyntaxError) {
    return new ApiError("invalid_input", 400, "That was not readable as JSON.");
  }
  return null;
}

/** The last middleware. Everything that went wrong anywhere ends up here. */
export function errorHandler(problem, req, res, next) {
  // Express's own guard: if the response has already begun there is nothing to say.
  if (res.headersSent) {
    next(problem);
    return;
  }

  const known = problem instanceof ApiError ? problem : bodyProblem(problem);

  if (known) {
    if (known.retryAfter > 0) res.set("Retry-After", String(known.retryAfter));
    res.status(known.status).json({
      error: {
        code: known.code,
        message: known.message,
        ...(known.field ? { field: known.field } : {}),
      },
    });
    return;
  }

  if (databaseIsAway(problem)) {
    console.error(`${req.method} ${req.originalUrl} — database unreachable:`, problem.message);
    res.status(503).json({
      error: {
        code: "unavailable",
        message: "The register could not be reached just now. Try again in a moment.",
      },
    });
    return;
  }

  // A real bug. The caller gets nothing useful — a stack trace in a response is
  // how a stranger learns what is worth attacking — and the log gets everything.
  console.error(`${req.method} ${req.originalUrl} —`, problem);
  res.status(500).json({
    error: { code: "server_error", message: "Something went wrong at this end." },
  });
}
