// Turns a backup file (made by `npm run backup`) into ONE SQL file you can paste into
// a Supabase project's SQL Editor. Nothing here talks to any server: it only reads
// the backup and writes text, so it cannot touch live data by itself.
//
//   npm run restore-sql                         newest file in backups/
//   npm run restore-sql -- backups/some.json    a specific backup
//
// Output: backups/restore-<same name>.sql   (private: keep it out of GitHub)
//
// Run it in the NEW project only AFTER migrations 001, 002 and 003 have been run.
// It can be run twice safely: reports with the same id are updated in place, their
// RD/FD lines are replaced (never doubled), and settings/customers are overwritten
// with the backup's values.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "backups");

let file = process.argv[2];
if (!file) {
  const found = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^register-.*\.json$/.test(f)).sort()
    : [];
  if (!found.length) {
    console.error("No backup found in backups/. Run `npm run backup` first.");
    process.exit(2);
  }
  file = path.join(dir, found[found.length - 1]);
}
file = path.resolve(file);

const backup = JSON.parse(fs.readFileSync(file, "utf8"));
const reports = Array.isArray(backup.reports) ? backup.reports : [];
const customers = Array.isArray(backup.customers) ? backup.customers : [];
const settings = backup.settings && typeof backup.settings === "object" ? backup.settings : {};

// SQL text literal: double any single quote. Backslashes need no care in a normal
// string. A NUL byte cannot be stored, so drop it.
const q = (value) => `'${String(value ?? "").replace(/\u0000/g, "").replace(/'/g, "''")}'`;
const when = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "null";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Not a date: ${text}`);
  return `${q(parsed.toISOString())}::timestamptz`;
};
const whole = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n));
};
const nameKey = (name) => String(name).trim().replace(/\s+/g, " ").toLowerCase();

const seen = new Set();
for (const r of reports) {
  if (!r.id || !r.name || !r.month) throw new Error(`A report is missing id, name or month: ${JSON.stringify(r).slice(0, 120)}`);
  if (seen.has(r.id)) throw new Error(`The backup has the same report id twice: ${r.id}`);
  seen.add(r.id);
}

const out = [];
out.push(`-- Restore of ${path.basename(file)}`);
out.push(`-- Saved from ${backup.source || "unknown"} at ${backup.savedAt || "unknown"}`);
out.push(`-- ${reports.length} reports, ${customers.length} customers, ${Object.entries(settings).filter(([, v]) => v !== null && v !== undefined).length} settings.`);
out.push("-- Run in the NEW project's SQL Editor after migrations 001, 002 and 003.");
out.push("begin;");
out.push("");

if (reports.length) {
  out.push("insert into public.reports (id, name, name_key, agent_id, month, renewal, submitted_at, edited_at, edited_in, deleted_at) values");
  out.push(
    reports
      .map(
        (r) =>
          `  (${q(r.id)}, ${q(String(r.name).trim())}, ${q(nameKey(r.name))}, ${q(r.agentId || "")}, ${q(r.month)}, ${whole(r.renewal)}, ` +
          `${r.submittedAt ? when(r.submittedAt) : "now()"}, ${when(r.editedAt)}, ${q(r.editedIn || "")}, ${when(r.deletedAt)})`
      )
      .join(",\n")
  );
  out.push(
    "on conflict (id) do update set name = excluded.name, name_key = excluded.name_key, agent_id = excluded.agent_id, month = excluded.month,",
    "  renewal = excluded.renewal, submitted_at = excluded.submitted_at, edited_at = excluded.edited_at,",
    "  edited_in = excluded.edited_in, deleted_at = excluded.deleted_at;"
  );
  out.push("");

  // Replace the RD/FD lines for exactly these reports, so a second run never doubles them.
  out.push(`delete from public.deposits where report_id in (${reports.map((r) => q(r.id)).join(", ")});`);
  const lines = [];
  for (const r of reports) {
    for (const kind of ["rd", "fd"]) {
      (Array.isArray(r[kind]) ? r[kind] : []).forEach((line, at) => {
        lines.push(`  (${q(r.id)}, ${q(kind)}, ${whole(line.amount)}, ${q(line.scheme || "")}, ${at})`);
      });
    }
  }
  if (lines.length) {
    out.push("insert into public.deposits (report_id, kind, amount, scheme, position) values");
    out.push(lines.join(",\n") + ";");
  }
  out.push("");
}

out.push("insert into public.customer_ledger (id, customers) values");
out.push(`  (1, ${q(JSON.stringify(customers))}::jsonb)`);
out.push("on conflict (id) do update set customers = excluded.customers, updated_at = now();");
out.push("");

// Settings are stored as text. Booleans become true/false, empty "month not chosen"
// is skipped (that is the default), and the Google Sheet link is never in a backup.
const entries = Object.entries(settings).filter(([, v]) => v !== null && v !== undefined);
if (entries.length) {
  out.push("insert into public.settings (key, value) values");
  out.push(entries.map(([k, v]) => `  (${q(k)}, ${q(typeof v === "boolean" ? String(v) : String(v))})`).join(",\n"));
  out.push("on conflict (key) do update set value = excluded.value, updated_at = now();");
  out.push("");
}

out.push("commit;");
out.push("");
out.push("-- Check: these three numbers should match the backup.");
out.push(
  `select (select count(*) from public.reports) as reports,  -- expect ${reports.length}`,
  `       (select count(*) from public.deposits) as deposit_lines,  -- expect ${reports.reduce((n, r) => n + (r.rd?.length || 0) + (r.fd?.length || 0), 0)}`,
  `       (select jsonb_array_length(customers) from public.customer_ledger where id = 1) as customers;  -- expect ${customers.length}`
);

fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `restore-${path.basename(file, ".json").replace(/^register-/, "")}.sql`);
fs.writeFileSync(target, out.join("\n") + "\n");
console.log(`Wrote ${path.relative(root, target)}`);
console.log(`  ${reports.length} reports (${reports.filter((r) => r.deletedAt).length} deleted ones kept), ${customers.length} customers, ${entries.length} settings`);
