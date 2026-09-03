// The Express app: what is mounted, in what order, and why the order matters.
//
// One process serves three things on one origin — /form/, /admin/ and /api/* — which
// is what removes CORS from this project entirely and takes the /exec URL out of the
// published JavaScript. In development Vite serves the pages and proxies /api here,
// which is the same arrangement with the first two swapped out.
//
// The order below is load-bearing:
//
//   1. the API routers, so nothing can shadow them
//   2. the built pages, if there are any
//   3. a catch-all for /api that answers with the JSON envelope
//   4. a catch-all for everything else, which answers with the same envelope
//   5. the error middleware, last, because that is how Express finds it
//
// Step 3 exists so a missing route under /api can never fall through and answer a
// phone with HTML. A client that asked for JSON and got a page cannot tell you what
// went wrong, and that is a bad half-hour.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { query } from "./db.js";
import { cookies } from "./auth.js";
import { apiNotFound, asyncRoute, errorHandler } from "./lib/http.js";
import { reports } from "./routes/reports.js";
import { settings } from "./routes/settings.js";
import { images } from "./routes/images.js";
import { admin } from "./routes/admin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The Vite build, one level up from server/. Absent in development, and that is fine. */
const PAGES = path.join(here, "..", "..", "dist");

export function buildApp() {
  const app = express();

  // Nothing is gained by telling the world which server this is.
  app.disable("x-powered-by");

  // Behind Render's proxy every request otherwise looks like it came from the proxy,
  // and the rate limits would be shared by everybody instead of being per phone.
  if (config.trustProxy) app.set("trust proxy", 1);

  // 4mb because a shrunk poster arrives as a data URL inside the JSON body: a few
  // hundred kilobytes of picture, a third more once base64 has had its way with it.
  // The real limit on a picture is 2mb of decoded bytes, checked in validate.js.
  app.use(express.json({ limit: "4mb" }));
  app.use(cookies);

  /**
   * Is this thing working? Always 200, even when the database is not — a health check
   * that fails during a blip is a health check that gets the process killed.
   */
  app.get(
    "/api/health",
    asyncRoute(async (req, res) => {
      let database = true;
      try {
        await query(`select 1`);
      } catch (problem) {
        database = false;
        console.error("Health check could not reach Postgres:", problem.message);
      }
      res.json({ ok: database, at: new Date().toISOString(), database });
    })
  );

  app.use("/api/reports", reports);
  app.use("/api/settings", settings);
  app.use("/api/images", images);
  app.use("/api/admin", admin);

  if (fs.existsSync(PAGES)) {
    console.log(`Serving the built pages from ${PAGES}`);
    app.use(express.static(PAGES));
  } else {
    console.log(
      `No built pages at ${PAGES} — serving the API only.\n` +
        `  Run "npm run build" in the project root if you want one process to serve both.`
    );
  }

  // Explicit, even though the handler below would catch it too: this is the line that
  // guarantees /api never answers with a page.
  app.use("/api", apiNotFound);
  // And the same envelope for anything else, rather than Express's "Cannot GET /x".
  app.use(apiNotFound);

  app.use(errorHandler);
  return app;
}
