// Bring what is already in the Google Sheet into Postgres, once.
//
//   node --env-file=.env scripts/import-sheet.mjs
//   npm run import-sheet
//
// It reads the same ?action=reports the app used to read on every page load, and inserts
// what it finds with `on conflict (id) do nothing`. That last part is the whole design:
// running this twice imports nothing the second time, so it is safe to run again after
// a few more rows arrive, and safe to run when you are not sure whether you already did.
//
// Nothing is queued back to the sheet. These rows came FROM the sheet — pushing them
// back would be twenty minutes of writes to change nothing.
//
// A sheet cell can hold anything, including something a person typed in a hurry, so
// every value is read defensively rather than believed. A row with no name is not a
// report; it is a row somebody started and abandoned.

import { migrate, pool, tx } from "../src/db.js";
import { config } from "../src/config.js";
import { monthKeyOf } from "../src/lib/month.js";

if (config.sheetWebhookUrl === "") {
  console.error(
    "SHEET_WEBHOOK_URL is not set, so there is no sheet to read.\n" +
      "  Put the Apps Script /exec URL in server/.env and run this again.\n"
  );
  process.exit(1);
}

/** A figure out of a cell. Never NaN, never negative, never a float. */
function figure(value) {
  const number = Math.round(Number(value) || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  // Beyond this a JS number is not exact anyway, and a bigint column would refuse it.
  return Math.min(number, Number.MAX_SAFE_INTEGER);
}

function deposits(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => ({
    amount: figure(row?.amount),
    scheme: String(row?.scheme || "").trim().slice(0, 80),
  }));
}

/** A date cell or an ISO string, as a Date. Null when it is neither. */
function stamp(value) {
  const said = String(value == null ? "" : value).trim();
  if (said === "") return null;
  const at = new Date(said);
  return Number.isNaN(at.getTime()) ? null : at;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

async function readSheet() {
  const res = await fetch(`${config.sheetWebhookUrl}?action=reports&t=${Date.now()}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`The sheet replied ${res.status}`);
  const data = await res.json();
  if (data && data.error) throw new Error(String(data.error));
  return Array.isArray(data?.reports) ? data.reports : [];
}

async function run() {
  await migrate();

  const rows = await readSheet();
  console.log(`The sheet handed back ${rows.length} row${rows.length === 1 ? "" : "s"}.`);

  let inserted = 0;
  let already = 0;
  let skipped = 0;

  for (const raw of rows) {
    const name = String(raw?.name || "").trim();
    const id = String(raw?.id || "").trim();

    if (name === "") {
      skipped += 1;
      continue;
    }
    if (!ID.test(id)) {
      // Without a usable id the row could never be corrected or removed through the
      // API, and there would be no way to avoid importing it twice.
      console.warn(`  skipped "${name}": its id is not one this API can use (${id || "empty"})`);
      skipped += 1;
      continue;
    }

    // The month is worked out from whichever column holds something readable. A sheet
    // turns "August 2026" into a date behind your back, so the label is as likely to be
    // a date string as the month column is.
    const month = monthKeyOf(raw?.month) || monthKeyOf(raw?.monthLabel);
    const said = String(raw?.editedIn || "").trim().toLowerCase();
    const editedIn = said === "web" || said === "sheet" ? said : "";
    const rd = deposits(raw?.rd);
    const fd = deposits(raw?.fd);

    const landed = await tx(async (client) => {
      const done = await client.query(
        `insert into reports (id, name, name_key, month, renewal, submitted_at, edited_at, edited_in)
              values ($1, $2, $3, $4, $5, coalesce($6, now()), $7, $8)
         on conflict (id) do nothing
           returning id`,
        [
          id,
          name,
          name.toLowerCase(),
          month,
          figure(raw?.renewal),
          stamp(raw?.submittedAt),
          stamp(raw?.editedAt),
          editedIn,
        ]
      );
      if (done.rowCount === 0) return false;

      const all = [
        ...rd.map((row, index) => ["rd", row, index]),
        ...fd.map((row, index) => ["fd", row, index]),
      ];
      for (const [kind, row, position] of all) {
        await client.query(
          `insert into deposits (report_id, kind, amount, scheme, position) values ($1, $2, $3, $4, $5)`,
          [id, kind, row.amount, row.scheme, position]
        );
      }
      return true;
    });

    if (landed) inserted += 1;
    else already += 1;
  }

  console.log(
    `\nBrought in ${inserted}.\n` +
      `Already here: ${already}.\n` +
      `Skipped: ${skipped}.\n\n` +
      "Safe to run again whenever you like — nothing already here is touched."
  );
}

try {
  await run();
} catch (problem) {
  console.error("The import stopped:", problem.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
