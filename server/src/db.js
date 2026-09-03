// The one connection to Postgres, and the three ways anything here talks to it.
//
// A pool rather than a connection because a web server has many requests in flight
// and one connection would serialise them all. It is kept small on purpose: a free
// Postgres allows very few connections, and a pool that opens more than the
// database will grant fails in a way that looks like the database being down.
//
// migrate() runs schema.sql, which is written to be safe to re-run, so it happens
// on every boot and nobody has to remember a deploy step. Running this file
// directly (`npm run migrate`) does the same thing and then stops.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.ssl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pool that loses a connection while it is idle emits this instead of throwing
// somewhere unhelpful. It is not fatal — the next query opens a fresh connection.
pool.on("error", (problem) => {
  console.error("Postgres connection dropped:", problem.message);
});

/** One statement. Returns pg's own result, so `.rows` and `.rowCount` are there. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Several statements, all or nothing.
 *
 * The work gets the client, not the pool, so everything inside really is one
 * transaction. A rollback that itself fails is swallowed: the original problem is
 * the one worth reporting, and the client is being thrown away anyway.
 */
export async function tx(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (problem) {
    try {
      await client.query("rollback");
    } catch {
      // Nothing useful to do about it.
    }
    throw problem;
  } finally {
    client.release();
  }
}

/** Make sure every table exists. Safe to call as often as you like. */
export async function migrate() {
  const sql = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  // No parameters, so pg sends this as one simple query and Postgres accepts the
  // whole file at once.
  await pool.query(sql);
}

// `npm run migrate` — the tables, then out.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  migrate()
    .then(() => {
      console.log("Tables are in place.");
      return pool.end();
    })
    .catch((problem) => {
      console.error("Could not set up the tables:", problem.message);
      process.exit(1);
    });
}
