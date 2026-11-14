// Saves a dated copy of the register (every report including deleted ones, the
// customer list, and the settings) to backups/ on THIS computer. Read-only: it never
// changes anything on the server.
//
//   Live register:  npm run backup
//   Test database:  npm run backup -- http://localhost:8787
//
// It asks for the admin password (or reads ADMIN_PASSWORD). The live address and key
// come from the .env file in this folder (VITE_API_URL, VITE_SUPABASE_ANON_KEY).

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...readEnv(path.join(root, ".env")), ...process.env };
const arg = process.argv[2];
const base = (arg || env.VITE_API_URL || "").replace(/\/+$/, "");
if (!base) {
  console.error("No address. Put VITE_API_URL in .env, or run: npm run backup -- http://localhost:8787");
  process.exit(2);
}
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(base).hostname);
const apiBase = local && !base.endsWith("/api") ? `${base}/api` : base;
const key = local ? "" : env.VITE_SUPABASE_ANON_KEY || "";

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a); });
  });
}

async function call(method, route, body, token) {
  const res = await fetch(apiBase + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { apikey: key } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status}): ${data?.error?.message || data?.message || text.slice(0, 200)}`);
  return data;
}

async function main() {
const password = env.ADMIN_PASSWORD || (await ask(`Admin password for ${local ? "TEST" : "LIVE"} register (${new URL(base).host}): `));
const login = await call("POST", "/admin/login", { password });
const token = login.token;
if (!token) throw new Error("Sign-in worked but no token came back.");

try {
  const [reports, customers, settings] = await Promise.all([
    call("GET", "/reports?includeDeleted=1", undefined, token),
    call("GET", "/admin/customers", undefined, token),
    call("GET", "/settings", undefined, token),
  ]);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(root, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `register-${local ? "test" : "live"}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({
    savedAt: new Date().toISOString(),
    source: new URL(base).host,
    reports: reports.reports,
    customers: customers.customers,
    settings: settings.settings,
  }, null, 2));
  console.log(`Saved ${reports.reports.length} reports and ${customers.customers.length} customers to ${path.relative(root, file)}`);
} finally {
  await call("POST", "/admin/logout", {}, token).catch(() => {});
}
}

main().catch((problem) => {
  console.error(`\nBackup did not finish: ${problem.message}`);
  if (/\(401\)/.test(problem.message)) {
    console.error("The server did not accept that password. Nothing was changed. Use the password you sign in with on the live /admin/ page.");
  }
  process.exitCode = 1;
});
