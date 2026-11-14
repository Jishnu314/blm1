// SQLite register for local demo and tests. One file, no Postgres.

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const inTx = new AsyncLocalStorage();

function adapt(sql, params = []) {
  const order = [];
  const text = String(sql)
    .replace(/\$(\d+)(?:::[\w[\]]+)?/g, (_, n) => {
      order.push(Number(n) - 1);
      return "?";
    })
    .replace(/\s+for update\b/gi, "");
  return { text, values: order.length ? order.map((index) => params[index]) : params || [] };
}

let db = null;
let lock = Promise.resolve();

function exclusive(work) {
  const run = lock.then(work, work);
  lock = run.then(() => undefined, () => undefined);
  return run;
}

export function openDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  db = new Database(config.sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function isRead(sql) {
  const text = sql.trim();
  return /^\s*(select|with|pragma)\b/i.test(text) || /\breturning\b/i.test(text);
}

function runQuery(sql, params = []) {
  const database = openDb();
  const { text, values } = adapt(sql, params);
  const stmt = database.prepare(text);
  if (isRead(text)) {
    const rows = stmt.all(...values);
    return { rows, rowCount: rows.length };
  }
  const info = stmt.run(...values);
  return { rows: [], rowCount: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
}

export function query(sql, params = []) {
  if (inTx.getStore()) return Promise.resolve(runQuery(sql, params));
  return exclusive(() => runQuery(sql, params));
}

query.query = query;

function runner() {
  return {
    query: (sql, params = []) => Promise.resolve(runQuery(sql, params)),
  };
}

export function tx(work) {
  const body = () =>
    inTx.run(true, async () => {
      const database = openDb();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(runner());
        database.exec("COMMIT");
        return result;
      } catch (problem) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Original error matters more.
        }
        throw problem;
      }
    });

  if (inTx.getStore()) return body();
  return exclusive(body);
}

export async function migrate() {
  const database = openDb();
  const sql = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  database.exec(sql);
}

export function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}

export const pool = { end: async () => closeDb() };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  migrate()
    .then(async () => {
      const { seedIfEmpty } = await import("./seed.js");
      seedIfEmpty();
      console.log(`Tables are in place at ${config.sqlitePath}`);
      closeDb();
    })
    .catch((problem) => {
      console.error("Could not set up the tables:", problem.message);
      process.exit(1);
    });
}
