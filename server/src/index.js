// Booting up, and shutting down without dropping anything.
//
// In order: read the environment, make sure the tables exist, make sure there is an
// admin password (or say clearly how to set one), listen, then start the two timers.
//
// The migration runs on every boot because schema.sql is safe to re-run, so a deploy
// is one step and nobody has to remember a second one. And nothing here refuses to
// start over a missing admin password: the form is the part agents need, and the form
// does not need an admin.

import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { bootstrapAdmin } from "./auth.js";
import { buildApp } from "./app.js";
import { startFlusher } from "./services/mirror.js";
import { startRateLimitSweeper } from "./lib/rateLimit.js";

const GIVE_UP_AFTER_MS = 10_000;

async function main() {
  await migrate();
  await bootstrapAdmin();

  const app = buildApp();
  const server = app.listen(config.port, () => {
    console.log(`The register is listening on http://localhost:${config.port} (${config.nodeEnv}).`);
  });

  const stopFlusher = startFlusher();
  const stopSweeper = startRateLimitSweeper();

  let stopping = false;

  /**
   * Render sends SIGTERM on every deploy and gives a short grace period.
   *
   * So: stop taking new connections, let the ones in flight finish, put the pool down,
   * and go. Anything the sheet is still owed is in mirror_queue and will be picked up
   * by the next boot — the queue is the reason shutdown can be this blunt.
   */
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} — finishing up.`);

    // Not unref'd: this timer exists precisely to fire when something is stuck.
    const giveUp = setTimeout(() => {
      console.error("Shutting down took too long. Going anyway.");
      process.exit(1);
    }, GIVE_UP_AFTER_MS);

    await new Promise((done) => server.close(() => done()));
    stopFlusher();
    stopSweeper();
    try {
      await pool.end();
    } catch (problem) {
      console.error("The connection pool did not close cleanly:", problem.message);
    }

    clearTimeout(giveUp);
    process.exit(0);
  }

  process.on("SIGTERM", () => {
    stop("SIGTERM").catch((problem) => console.error(problem));
  });
  process.on("SIGINT", () => {
    stop("SIGINT").catch((problem) => console.error(problem));
  });
}

main().catch((problem) => {
  // A boot that failed is worth the whole error: it is almost always the database URL
  // or the database not being there, and the message says which.
  console.error("The server could not start:", problem.message);
  process.exit(1);
});
