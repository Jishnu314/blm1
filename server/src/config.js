// Environment for the local demo API. There is no Postgres here: the register is
// a SQLite file on this machine. Production is the Supabase path in PUBLISH.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..");

function loadDotEnv() {
  const file = path.join(serverRoot, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at < 1) continue;
    const name = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

loadDotEnv();

if (process.env.DATABASE_URL) {
  console.warn(
    "DATABASE_URL is ignored. This local API uses a SQLite file on this PC and will not open any remote or production database."
  );
}

function text(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function truthy(name) {
  const said = text(name).toLowerCase();
  return said === "1" || said === "true" || said === "yes" || said === "on";
}

function port() {
  const asked = Number(text("PORT", "8787"));
  if (Number.isInteger(asked) && asked > 0 && asked < 65536) return asked;
  console.warn("PORT is not a usable port number, so 8787 is being used instead.");
  return 8787;
}

const nodeEnv = text("NODE_ENV", "development");
const corsOrigins = text("CORS_ORIGINS")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const defaultSameSite = nodeEnv === "production" && corsOrigins.length > 0 ? "none" : "lax";
const sessionSameSite = (text("COOKIE_SAME_SITE") || defaultSameSite).toLowerCase();
if (!["lax", "strict", "none"].includes(sessionSameSite)) {
  throw new Error("COOKIE_SAME_SITE must be lax, strict, or none");
}

const defaultSqlite = path.join(serverRoot, "data", "demo.sqlite");
const sqlitePath = path.resolve(text("SQLITE_PATH", defaultSqlite));
const demoMode = text("DEMO_MODE", "1") !== "0";

export const config = {
  sqlitePath,
  demoMode,
  demoPassword: "demo-admin-10",
  port: port(),
  nodeEnv,
  isProduction: nodeEnv === "production",
  sessionSameSite,
  corsOrigins,
  adminPassword: text("ADMIN_PASSWORD"),
  // The local test server never copies to the real Google Sheet, so test reports
  // cannot land in the live register. Opt in on purpose with ALLOW_SHEET_IN_DEMO=1.
  allowSheetInDemo: truthy("ALLOW_SHEET_IN_DEMO"),
  sheetWebhookUrl: demoMode && !truthy("ALLOW_SHEET_IN_DEMO") ? "" : text("SHEET_WEBHOOK_URL"),
  trustProxy: truthy("TRUST_PROXY"),
};
