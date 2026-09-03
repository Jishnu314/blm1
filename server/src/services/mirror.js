// The Google Sheet copy: what this server still owes Google, and how it pays.
//
// The sheet is not the register any more — Postgres is. But the Dashboard tab, the
// pivot, the years of habit around that spreadsheet all still work, so every write
// here is pushed to the same Apps Script /exec URL in the same form-encoded language
// Code.gs already speaks. Neither .gs file needs a single change.
//
// The one rule that matters: A FAILED PUSH IS NEVER A FAILED REQUEST. The queue row
// goes in inside the same transaction as the write, so it cannot be lost, and the
// pushing happens afterwards on its own. Nothing an agent typed depends on Google
// being awake.
//
// A retry sends the NEWEST version, not the version that failed: kind='report' and
// kind='image' are read fresh out of their own tables at push time. Settings carry
// their body, because they are one global set — the queue drains in id order, so the
// last one to be sent is the last one that was saved, and the sheet ends up right.
//
// This file reads its own rows with its own SQL rather than calling the services,
// and that is on purpose: the services enqueue, so importing them back would be a
// circle. It is a few lines of duplication against a dependency that only points one
// way.

import { config } from "../config.js";
import { query } from "../db.js";
import { monthLabel } from "../lib/month.js";

const BATCH = 20;
const EVERY_MS = 60_000;
const GIVE_UP_AFTER_MS = 20_000;

/** No URL, no copy, nothing queued, nothing owed. */
export function mirrorEnabled() {
  return config.sheetWebhookUrl !== "";
}

/**
 * Owe the sheet one thing. Called with the transaction's own client, never the pool,
 * so the queue row and the write it describes land together or not at all.
 */
export async function enqueue(client, kind, ref = "", payload = "") {
  if (!mirrorEnabled()) return;
  await client.query(`insert into mirror_queue (kind, ref, payload) values ($1, $2, $3)`, [
    kind,
    String(ref),
    payload,
  ]);
}

/**
 * Push now, without being waited for.
 *
 * setTimeout rather than calling flush() directly, so the response goes back to the
 * phone first, and unref'd so a pending push can never be the reason the process
 * refuses to exit.
 */
export function kick() {
  if (!mirrorEnabled()) return;
  const soon = setTimeout(() => {
    flush().catch((problem) => console.error("Sheet copy:", problem.message));
  }, 0);
  soon.unref();
}

let running = false;

/**
 * Drain up to 20 rows that are due. Returns how many got through.
 *
 * It stops at the first failure rather than working down the list, for the same
 * reason the phone's outbox does: if one push failed then Google is unreachable and
 * the rest would only fail more slowly — and worse, carrying on lets a later row
 * overtake an earlier one. A delete that succeeds while the save before it is still
 * failing would put the row back in the sheet on the retry.
 */
export async function flush() {
  if (!mirrorEnabled() || running) return 0;
  running = true;
  try {
    const { rows } = await query(
      `select id, kind, ref, payload
         from mirror_queue
        where next_try_at <= now()
        order by id
        limit $1`,
      [BATCH]
    );

    let sent = 0;
    for (const row of rows) {
      try {
        await push(row);
      } catch (problem) {
        // `attempts` on the right of an UPDATE is still the old count, so the delay
        // is worked out from what this failure makes it: 30s, then 60s, up to five
        // minutes, and no further.
        await query(
          `update mirror_queue
              set attempts = attempts + 1,
                  last_error = $2,
                  next_try_at = now() + least(attempts + 1, 10) * interval '30 seconds'
            where id = $1`,
          [row.id, String(problem?.message || problem).slice(0, 500)]
        );
        break;
      }
      await query(`delete from mirror_queue where id = $1`, [row.id]);
      sent += 1;
    }
    return sent;
  } finally {
    running = false;
  }
}

/** Every minute, and once at boot for whatever the last run left behind. */
export function startFlusher(everyMs = EVERY_MS) {
  if (!mirrorEnabled()) {
    console.log("SHEET_WEBHOOK_URL is not set, so nothing is copied to the Google Sheet.");
    return () => {};
  }
  const timer = setInterval(() => {
    flush().catch((problem) => console.error("Sheet copy:", problem.message));
  }, everyMs);
  // So the interval cannot hold the process open on the way out.
  timer.unref();
  kick();
  return () => clearInterval(timer);
}

/* --- what gets sent ------------------------------------------------------- */

async function push(row) {
  if (row.kind === "report") {
    const body = await reportBody(row.ref);
    // Nothing to send is not a failure. A report that has been hard-deleted since
    // this row was queued is simply no longer owed.
    if (body) await post(body);
    return;
  }
  if (row.kind === "delete") {
    await post(new URLSearchParams({ action: "deleteReport", id: String(row.ref) }));
    return;
  }
  if (row.kind === "settings") {
    await post(settingsBody(row.payload));
    return;
  }
  if (row.kind === "image") {
    const body = await imageBody(row.ref);
    if (body) await post(body);
    return;
  }
  throw new Error(`Nothing knows how to send a "${row.kind}".`);
}

/**
 * One form-encoded POST to /exec.
 *
 * URLSearchParams with no headers of our own, exactly as the browser sent it: that
 * is what Code.gs's `e.parameter` reads. Apps Script answers a POST with a 302 to
 * googleusercontent.com and the real reply is there, which is why redirects are
 * followed.
 *
 * And the reply is read, not just its status: doPost catches its own exceptions and
 * answers 200 with { error: "…" }, so a script that failed looks like a success
 * unless somebody looks. A reply that is not JSON at all is usually Google's
 * sign-in page, which means the deployment is not shared with "Anyone".
 */
async function post(body) {
  const res = await fetch(config.sheetWebhookUrl, {
    method: "POST",
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(GIVE_UP_AFTER_MS),
  });
  const said = await res.text();
  if (!res.ok) throw new Error(`Sheet replied ${res.status}`);

  let parsed;
  try {
    parsed = JSON.parse(said);
  } catch {
    throw new Error("The sheet did not answer with JSON — check the deployment is open to Anyone.");
  }
  if (parsed && parsed.error) throw new Error(String(parsed.error).slice(0, 400));
}

const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);

/** "LIC Jeevan Anand 5000 | Bhima Deposit 12000" — one readable sheet cell. */
const describeRows = (rows) => rows.map((row) => `${row.scheme} ${row.amount || 0}`).join(" | ");

/**
 * The report as it is right now, in the exact parameter names Code.gs reads and the
 * browser used to send (see reportBody in src/lib/entries.js). Null if it is gone.
 */
async function reportBody(id) {
  const found = await query(
    `select id, name, month, renewal, submitted_at from reports where id = $1`,
    [String(id)]
  );
  if (found.rows.length === 0) return null;
  const row = found.rows[0];

  const held = await query(
    `select kind, amount, scheme from deposits where report_id = $1 order by position, id`,
    [String(id)]
  );
  const of = (kind) =>
    held.rows
      .filter((one) => one.kind === kind)
      .map((one) => ({ amount: Number(one.amount), scheme: one.scheme }));
  const rd = of("rd");
  const fd = of("fd");

  return new URLSearchParams({
    action: "saveReport",
    id: row.id,
    name: row.name,
    renewal: String(Number(row.renewal)),
    rdCount: String(rd.length),
    rdTotal: String(sum(rd)),
    rdDetail: describeRows(rd),
    fdCount: String(fd.length),
    fdTotal: String(sum(fd)),
    fdDetail: describeRows(fd),
    // The same rows again, exactly as entered, for anything that wants structure.
    rdJson: JSON.stringify(rd),
    fdJson: JSON.stringify(fd),
    month: row.month,
    // Built from the key, never stored: the sheet has a "Month label" column and the
    // Dashboard reads it.
    monthLabel: monthLabel(row.month),
    submittedAt: row.submitted_at.toISOString(),
  });
}

const words = (on) => (on ? "yes" : "no");
const digits = (value, fallback) => (Number.isFinite(Number(value)) ? String(Number(value)) : String(fallback));

/**
 * The settings tab's body, in the words a spreadsheet cell wants.
 *
 * "yes" and "no" rather than true and false because those cells are meant to be
 * typed into by hand, and the client's flag() reads the words either way.
 */
function settingsBody(payload) {
  let held = {};
  try {
    const parsed = JSON.parse(String(payload || "{}"));
    if (parsed && typeof parsed === "object") held = parsed;
  } catch {
    // An unreadable payload would send twenty empty cells and wipe the tab, so it
    // is worth failing over instead.
    throw new Error("The queued settings could not be read.");
  }

  return new URLSearchParams({
    action: "saveSettings",
    reportMonth: held.reportMonth || "",
    graceDays: digits(held.graceDays, 7),
    credit: String(held.credit || ""),
    open: words(held.open),
    message: String(held.message || ""),
    showRd: words(held.showRd),
    showFd: words(held.showFd),
    autoWindow: words(held.autoWindow),
    opensOnDay: digits(held.opensOnDay, 28),
    closesAfterDay: digits(held.closesAfterDay, 7),
    popupOn: words(held.popupOn),
    popupMode: held.popupMode === "window" ? "window" : "always",
    popupFrom: String(held.popupFrom || ""),
    popupTo: String(held.popupTo || ""),
    popupTitle: String(held.popupTitle || ""),
    popupText: String(held.popupText || ""),
    // A pointer, whatever kind: "/api/images/12", a web address, or an old drive:ID.
    // The sheet gets the pointer we hold, not the picture.
    popupImage: String(held.popupImage || ""),
    boardOn: words(held.boardOn),
    boardTitle: String(held.boardTitle || ""),
    boardPlayers: String(held.boardPlayers || "[]"),
  });
}

/**
 * The picture, back out of Postgres and into the data URL savePicture_ expects. The
 * bytes live here now; Drive gets a copy so the old folder keeps filling up as it
 * always did.
 */
async function imageBody(ref) {
  const id = String(ref);
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await query(`select name, mime, data from images where id = $1::bigint`, [id]);
  if (rows.length === 0) return null;
  return new URLSearchParams({
    action: "saveImage",
    name: rows[0].name,
    data: `data:${rows[0].mime};base64,${rows[0].data.toString("base64")}`,
  });
}

/* --- what the admin page asks about --------------------------------------- */

export async function queueDepth() {
  const { rows } = await query(`select count(*) as owed from mirror_queue`);
  return Number(rows[0].owed);
}

/** The most recent thing that went wrong, or "" if nothing has. */
export async function lastError() {
  const { rows } = await query(
    `select last_error from mirror_queue where last_error <> '' order by id desc limit 1`
  );
  return rows.length > 0 ? String(rows[0].last_error) : "";
}
