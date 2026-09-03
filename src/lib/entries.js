// The register lives on the server.
//
// That is the second change of mind in this file's short life. localStorage used
// to BE the register and the sheet was a copy it posted to; then the sheet was
// the truth; now Postgres behind /api is, and the Google Sheet is a copy the
// SERVER keeps up to date — see server/API.md. This device holds two things,
// neither of which is the register:
//
//   the outbox   what this phone typed and could not send. Retried on every load
//                and after every successful call. Marked ✱ in the register until
//                it lands, so nothing is ever silently lost.
//   the last read  the newest list the server gave us. Kept only so a phone with
//                no signal shows the register it saw this morning rather than an
//                empty table — and it says how old it is.
//
// Both are disposable. Clear this browser's storage and you lose nothing except
// reports that had not been sent yet.
//
// Retrying is still safe, for a better reason than before. The sheet upserted by
// id; POST /api/reports inserts and refuses to overwrite, handing back the row it
// already holds with created:false. Either way the same report sent twice is one
// row, which is what keeps the outbox a dozen lines instead of a synchronisation
// problem. What that route will not do is rewrite — the id is minted on the phone,
// so if POST could overwrite, anyone who guessed an id could rewrite somebody
// else's figures. Corrections therefore go to PUT, which needs the admin session,
// and that is the one thing the outbox has to be careful about below.

import { apiGet, apiSend, isUnauthorised, isRefusal } from "./api.js";
import { describeKey, monthKeyOf } from "./month.js";

const OUTBOX_KEY = "monthly-report/outbox";
const CACHE_KEY = "monthly-report/last-read";

/* --- this device's two scraps of paper ----------------------------------- */

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode, or storage full. The register is on the server; this was a
    // convenience. Failing to write it must never fail the report.
  }
}

/** Everything this device is still trying to send, oldest attempt first. */
export function readOutbox() {
  const list = readJson(OUTBOX_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function writeOutbox(list) {
  writeJson(OUTBOX_KEY, Array.isArray(list) ? list : []);
}

/**
 * Queue one thing to send. A second attempt at the same id replaces the first
 * rather than joining the queue behind it — the newest version of a report is the
 * only one worth sending.
 *
 * Two cases are not plain replacement, and both are the same problem seen twice:
 * an action the server cannot make sense of would fail forever and block the queue
 * behind it.
 *
 *   correct + a waiting save   what is kept is a "save" carrying the corrected
 *                              report. The server has never seen this id, so a PUT
 *                              would answer 404. A POST of the corrected version is
 *                              right either way: it is the only version anybody
 *                              needed, and the earlier one never left this phone.
 *
 *   delete + a waiting save    nothing at all is queued, and the save is dropped.
 *                              There is nothing on the server to delete, so the
 *                              DELETE would 404 forever. The report was typed and
 *                              then withdrawn without ever leaving this phone,
 *                              which is a report that never existed.
 */
export function queue(action) {
  const idOf = (one) => (one.kind === "delete" ? one.id : one.entry?.id);
  const id = idOf(action);
  const waiting = readOutbox();
  const standing = waiting.find((one) => idOf(one) === id);
  const rest = waiting.filter((one) => idOf(one) !== id);

  if (action.kind === "delete" && standing?.kind === "save") {
    writeOutbox(rest);
    return rest;
  }

  const kept =
    action.kind === "correct" && standing?.kind === "save" ? { ...action, kind: "save" } : action;
  const list = [...rest, { ...kept, queuedAt: new Date().toISOString() }];
  writeOutbox(list);
  return list;
}

/** The last list the server gave us, and when. */
export function readCache() {
  const held = readJson(CACHE_KEY, null);
  if (!held || !Array.isArray(held.reports)) return { reports: [], at: "" };
  return { reports: held.reports, at: String(held.at || "") };
}

export function writeCache(reports, at) {
  writeJson(CACHE_KEY, { reports, at });
}

/* --- what the register shows -------------------------------------------- */

/**
 * One deposit, whatever shape it arrived in.
 *
 * The amount must come back a number, not the string a sheet cell or a
 * hand-edited JSON cell would give: `total + "5000"` is "05000", and a total that
 * is quietly a string is the kind of wrong that looks right on screen.
 */
const depositRow = (row = {}) => ({
  amount: Number(row.amount) || 0,
  scheme: String(row.scheme || "").trim(),
});

/**
 * One report, read defensively.
 *
 * The server answers in exactly this shape and with the right types, so most of
 * the coercion below is now belt as well as braces — but not all of it: the rows
 * imported from the old Google Sheet came out of hand-typed cells, and the outbox
 * on this phone may hold something written by an older version of the app. A row
 * is read, never believed.
 */
export function normaliseReport(raw = {}) {
  const rows = (value) => (Array.isArray(value) ? value.map(depositRow) : []);
  // The month is worked out from the cell rather than believed, and the words are
  // then built from it. A sheet turns "August 2026" into a date behind your back,
  // so the label a cell hands back can be "Sat Aug 01 2026 00:00:00 GMT+0530
  // (India Standard Time)" — which is what the register used to print.
  const month = monthKeyOf(raw.month) || monthKeyOf(raw.monthLabel);
  const said = describeKey(month);
  return {
    id: String(raw.id || ""),
    name: String(raw.name || "").trim(),
    month,
    monthLabel: said ? said.full : String(raw.monthLabel || raw.month || ""),
    renewal: Number(raw.renewal) || 0,
    rd: rows(raw.rd),
    fd: rows(raw.fd),
    submittedAt: String(raw.submittedAt || ""),
    editedAt: String(raw.editedAt || ""),
    // "web" or "sheet", and nothing else means anything.
    editedIn: ["web", "sheet"].includes(String(raw.editedIn || "").toLowerCase())
      ? String(raw.editedIn).toLowerCase()
      : "",
    // When it was taken out of the register, or "" for the ordinary case. The server
    // only sends this field on a row that has been deleted, and only ever to
    // ?includeDeleted=1 — so on every row the register itself hands back it is "".
    // It used to be stripped here, which meant the admin page had no way to tell a
    // deleted report from a live one and no way to offer the undo the server has
    // always had.
    deletedAt: String(raw.deletedAt || ""),
  };
}

/**
 * The register's rows and this device's unsent ones, as one list.
 *
 * A queued save or correction stands in for the stored version of the same
 * report, so a correction you just made reads correctly even before it has been
 * sent; a queued delete takes the row out at once. All of them are marked
 * pending, because showing a figure the register does not have yet without
 * saying so would be a lie.
 *
 * Newest first, by when the report was submitted — not by when it was edited, so
 * correcting an old report does not jump it to the top of the list.
 *
 * Deleted rows are dropped, and that is not a formality. The register's own read
 * never asks for them, so ordinarily none arrive — but every total, every agent's
 * line and the chart are all counted off this one list, so if a deleted row ever did
 * reach it the figures would be wrong while looking perfectly reasonable. The bin is
 * read separately, by fetchDeleted, and kept out of here on purpose.
 */
export function mergeRegister(storedRows = [], outbox = readOutbox()) {
  const dropped = new Set(
    outbox.filter((one) => one.kind === "delete").map((one) => String(one.id))
  );
  const waiting = outbox
    // A save and a correction both carry the whole report, so both stand in for
    // the stored row. Only a delete takes one away.
    .filter((one) => one.kind !== "delete" && one.entry)
    .map((one) => ({ ...normaliseReport(one.entry), pending: true }));
  const replaced = new Set(waiting.map((one) => one.id));

  const stored = storedRows
    .map(normaliseReport)
    .filter(
      (one) =>
        one.name !== "" &&
        one.deletedAt === "" &&
        !dropped.has(one.id) &&
        !replaced.has(one.id)
    )
    .map((one) => ({ ...one, pending: false }));

  return [...stored, ...waiting.filter((one) => !dropped.has(one.id))].sort((one, two) =>
    String(two.submittedAt).localeCompare(String(one.submittedAt))
  );
}

/**
 * Which marks a row carries. Two separate facts, so a row may carry both: where it
 * was last corrected, and whether the register has it yet.
 *
 * A report that was never corrected carries no mark at all — that is the ordinary
 * case, and marking it would make the marks worthless.
 */
export function marksOf(entry = {}) {
  const marks = [];
  if (entry.editedIn === "web") marks.push("web");
  if (entry.editedIn === "sheet") marks.push("sheet");
  if (entry.pending) marks.push("pending");
  return marks;
}

/* --- talking to the server ----------------------------------------------- */

/** The rows as the API takes them: an amount and a scheme, and nothing else. */
const depositRows = (value) => (Array.isArray(value) ? value.map(depositRow) : []);

/**
 * One report as the API takes it.
 *
 * Every amount goes as a JSON number, never as the string a spreadsheet cell
 * needed. API.md is plain about it — money is a whole number of rupees as a
 * number — and a figure that arrives as "5000" is refused rather than quietly
 * coerced, so the coercion happens here, where an empty box becomes a nought
 * instead of a NaN.
 *
 * The whole URLSearchParams business this file used to do is gone: the counts,
 * the totals, the "LIC Jeevan Anand 5000 | …" cell. Those were the shape
 * Code.gs reads, and the server builds them now — it is the only thing that
 * talks to the sheet, so it is the only thing that has to know that language.
 *
 * monthLabel is not sent either. The words are worked out from the key on both
 * sides, because a spreadsheet turns "August 2026" into a date behind your back.
 */
const reportFor = (entry = {}) => ({
  report: {
    id: String(entry.id || ""),
    name: String(entry.name || "").trim(),
    month: String(entry.month || ""),
    renewal: Number(entry.renewal) || 0,
    rd: depositRows(entry.rd),
    fd: depositRows(entry.fd),
    // Optional, and the server prefers its own clock to an unreadable one.
    submittedAt: String(entry.submittedAt || ""),
  },
});

/** Write one report the register has not seen before. Public: this is the form's send. */
export async function pushReport(entry) {
  await apiSend("POST", "/api/reports", reportFor(entry));
}

/**
 * Rewrite one report the register already holds. Admin only.
 *
 * A separate call from pushReport rather than a flag on it, because POST will not
 * overwrite anything — see the top of this file for why that matters.
 */
export async function pushCorrection(entry) {
  const id = encodeURIComponent(String(entry?.id || ""));
  await apiSend("PUT", `/api/reports/${id}`, reportFor(entry));
}

/**
 * Take one report out of the register.
 *
 * The row is kept with a deletedAt and stops appearing, so this is undoable — which
 * it never was while the sheet was the register and Google's version history was the
 * only way back. pushRestore below is the way back, and the admin page offers it.
 */
export async function pushDelete(id) {
  await apiSend("DELETE", `/api/reports/${encodeURIComponent(String(id))}`);
}

/**
 * Put a deleted report back. Admin only.
 *
 * The row was never thrown away, so this sets its deletedAt back to nothing and the
 * report reappears in the register with its id, its figures and its original
 * submitted time intact — it is the same row, not a retyped copy of it. The sheet
 * copy is brought back with it by the server.
 *
 * A 404 means the id is not in the register at all. Restoring a report that was
 * never deleted is not an error: the server checks, changes nothing, and hands the
 * row back.
 */
export async function pushRestore(id) {
  await apiSend("POST", `/api/reports/${encodeURIComponent(String(id))}/restore`);
}

/**
 * Read the register.
 *
 * Never throws. A read that fails hands back the last list this device saw and
 * says where it came from, because an admin holding a phone in a bad-signal spot
 * is better served by this morning's figures labelled as this morning's than by
 * an empty table.
 *
 *   from "server"    these are the register's own rows, as of `at`
 *        "cache"     it could not be asked; these are the rows we last saw, and
 *                    `at` is when we saw them
 *        "nowhere"   it could not be asked and this device has never seen it
 *
 * `at` is the server's own clock, not this phone's. A phone with the date set
 * wrong would otherwise label the register with a time nobody else agrees with.
 *
 * `unauthorised` is the one failure worth naming: it means the admin session has
 * run out, and the page should put the login back up rather than show a stale
 * table as though the only trouble were signal.
 */
export async function fetchReports() {
  try {
    const data = await apiGet("/api/reports");
    const reports = (Array.isArray(data?.reports) ? data.reports : []).map(normaliseReport);
    const at = String(data?.at || "");
    writeCache(reports, at);
    return { reports, at, from: "server", error: "", unauthorised: false };
  } catch (problem) {
    const held = readCache();
    const seenBefore = held.at !== "" || held.reports.length > 0;
    return {
      ...held,
      from: seenBefore ? "cache" : "nowhere",
      error: String(problem.message || problem),
      unauthorised: isUnauthorised(problem),
    };
  }
}

/**
 * Read the bin: the reports that have been deleted and can be put back.
 *
 * A separate call rather than an option on fetchReports, for two reasons that both
 * come down to the cache. fetchReports writes what it read to this device, so that a
 * phone with no signal still shows a register; a list with deleted rows in it written
 * there would come back later as though those reports were live. And every total on
 * the admin page is counted off the list fetchReports returns, so the safest thing
 * that list can be is one that never contains a deleted row at all.
 *
 * Nothing is cached here and there is no falling back to what we saw last time.
 * Looking in the bin is a deliberate act, so "the server could not be asked" is the
 * honest answer to it — an old bin offered as the current one is how somebody
 * restores a report that was already restored, or fails to find one that is in there.
 *
 * ?includeDeleted=1 hands back the live rows as well; the deleted ones are picked out
 * here. That is one read instead of two, on the register's own route, already behind
 * the admin session.
 */
export async function fetchDeleted() {
  try {
    const data = await apiGet("/api/reports?includeDeleted=1");
    const reports = (Array.isArray(data?.reports) ? data.reports : [])
      .map(normaliseReport)
      .filter((one) => one.deletedAt !== "")
      // Most recently deleted first: the report somebody wants back is nearly always
      // the one they have just this moment deleted.
      .sort((one, two) => String(two.deletedAt).localeCompare(String(one.deletedAt)));
    return { reports, error: "", unauthorised: false };
  } catch (problem) {
    return {
      reports: [],
      error: String(problem.message || problem),
      unauthorised: isUnauthorised(problem),
    };
  }
}

/**
 * Try the outbox. Returns { sent, dropped }.
 *
 * Three things can happen to each action, and the difference between them is the
 * whole of this function.
 *
 *   it goes through     dropped from the queue. Obviously.
 *   it is refused       400 or 404: the server understood and said no. Dropped as
 *                       well, because it will be refused again on every load until
 *                       the end of time, and while it sits at the head of the queue
 *                       nothing behind it is ever tried. This is the case the
 *                       earlier version got wrong — one report the server would
 *                       never accept meant no report ever sent again.
 *   it does not arrive  no signal, no session, server asleep, rate limited. Kept,
 *                       and the loop stops: if one call failed for that reason the
 *                       rest would only fail more slowly.
 *
 * Order is kept, so a save queued before a delete of the same report cannot arrive
 * after it.
 *
 * A 401 stops it in the same way as no signal, and that is right: an admin
 * correction with no session will never succeed by being retried, but signing in
 * costs nothing and fixes it, so the action stays and goes the moment somebody does.
 */
export async function flushOutbox() {
  const list = readOutbox();
  const keep = [];
  let sent = 0;
  let dropped = 0;
  let stopped = false;

  for (const action of list) {
    if (stopped) {
      keep.push(action);
      continue;
    }
    try {
      if (action.kind === "delete") await pushDelete(action.id);
      else if (action.kind === "correct") await pushCorrection(action.entry);
      else await pushReport(action.entry);
      sent += 1;
    } catch (problem) {
      if (isRefusal(problem)) {
        dropped += 1;
        continue;
      }
      keep.push(action);
      stopped = true;
    }
  }

  if (sent > 0 || dropped > 0) writeOutbox(keep);
  return { sent, dropped };
}
