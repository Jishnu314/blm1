// Start the local SQLite API and the Vite pages together.
// This never opens DATABASE_URL or any remote database.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cwd, args, extra = {}) {
  const child = spawn(npm, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DEMO_MODE: "1", USE_REMOTE_API: "0" },
    ...extra,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else if (code) process.exit(code);
  });
  return child;
}

console.log("Local demo only. SQLite file on this PC — production data is not used.");

const api = run(path.join(root, "server"), ["run", "dev"]);
const web = run(root, ["run", "dev"]);

function stop() {
  api.kill();
  web.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
