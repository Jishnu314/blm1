import { useEffect, useMemo, useRef, useState } from "react";
import { MONTHS, describeKey, reportMonth, isCollectionOpen } from "../lib/month.js";
import { loadSettings, saveSettings, fetchSettings, LIMITS } from "../lib/settings.js";
import { saveCorrection, removeEntry, restoreEntry } from "../lib/submit.js";
import {
  fetchReports,
  fetchDeleted,
  mergeRegister,
  marksOf,
  readCache,
  readOutbox,
  flushOutbox,
} from "../lib/entries.js";
import { whoAmI, signIn, signOut, changePassword, serverStatus } from "../lib/auth.js";
import { formatINR, toDigits } from "../lib/currency.js";
import { byAgent, tallest, monthWindow, monthsPresent, upTo, sumMonths } from "../lib/report.js";
import { popupState, imageSrc } from "../lib/popup.js";
import { parsePlayers, serialisePlayers, rankPlayers, boardState } from "../lib/board.js";
import { nextRowId, MAX_NAME } from "../lib/rows.js";
import { upload as uploadPicture, list as listPictures, remove as removePicture } from "../lib/images.js";
import Popup from "../components/Popup.jsx";
import Board from "../components/Board.jsx";
import AgentChart from "./AgentChart.jsx";
import EntryEditor from "./EntryEditor.jsx";

/**
 * How often the register asks the server again.
 *
 * Half a minute is short enough that a report an agent sends appears while you are
 * still looking at the page, and long enough that leaving this page open all day is
 * a couple of thousand reads rather than a couple of hundred thousand. The poll
 * stops entirely while a row is open for editing — see the effect below.
 */
const POLL_MS = 30000;

/**
 * "just now" / "4 minutes ago" / "at 09:14" — how old the figures on screen are.
 *
 * Said in words rather than as a timestamp because the only question it answers is
 * whether to trust what you are reading, and "3 minutes ago" answers that without
 * any arithmetic. Past the hour it gives the clock time instead, since "at 09:14"
 * is more use than "412 minutes ago".
 */
function ago(iso, now = new Date()) {
  const when = new Date(String(iso || ""));
  if (Number.isNaN(when.getTime())) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - when.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  return `at ${when.getHours()}:${String(when.getMinutes()).padStart(2, "0")}`;
}

/** 28 → "28th". Used in the plain-English line under the collection window. */
function ordinal(day) {
  const tail = ["th", "st", "nd", "rd"];
  const rest = day % 100;
  return `${day}${tail[(rest - 20) % 10] || tail[rest] || tail[0]}`;
}

/**
 * A day-of-the-month box: two digits, and never a number the register will refuse.
 *
 * `high` is the register's own ceiling for this particular setting — 28 for the
 * grace days, 31 for the window. A keystroke that would take the box past it is
 * dropped rather than shown, because a settings patch is accepted or refused as one
 * thing: a single 40 in here would come back refused and take the other twenty
 * settings on the page with it.
 *
 * Dropping the keystroke is honest here and would not be honest in the year box a
 * few rows down. A year has to pass through "2", "20" and "202" on the way to
 * "2026", so that box has to be allowed to be wrong for a moment and Save waits
 * instead. A day never has to pass through a wrong value — every day this takes is
 * one or two digits — so this box can simply never hold one.
 */
function DayBox({ id, label, value, onChange, hint, high }) {
  const type = (typed) => {
    const said = typed.replace(/\D/g, "").slice(0, 2);
    if (said !== "" && Number(said) > high) return;
    onChange(said);
  };

  return (
    <div className="row">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="well">
        <input
          id={id}
          className="scheme-input"
          value={value}
          onChange={(event) => type(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** A labelled on/off row. Every yes-or-no setting on this page is one of these. */
function Toggle({ label, on, onToggle, onText = "Open", offText = "Closed" }) {
  return (
    <div className="row switch-row">
      <span className="switch-label">{label}</span>
      <button
        type="button"
        className={on ? "switch is-on" : "switch"}
        onClick={onToggle}
        aria-pressed={on}
      >
        {on ? onText : offText}
      </button>
    </div>
  );
}

/**
 * A calendar date. The browser's own date control, not a typed box: it already
 * knows what a month looks like, and on a phone it puts up the calendar wheel.
 * The value it hands back is "YYYY-MM-DD", which is exactly what popup.js reads.
 */
function DateBox({ id, label, value, onChange }) {
  return (
    <div className="row">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="well">
        <input
          id={id}
          type="date"
          className="scheme-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

/** "2026-09-15" → "15 September 2026". Half-typed dates come back untouched. */
function prettyDate(value) {
  const bits = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!bits) return "";
  const name = MONTHS[Number(bits[2]) - 1];
  if (!name) return "";
  return `${Number(bits[3])} ${name} ${bits[1]}`;
}

/**
 * One sentence saying what the popup is doing right now — the same five states
 * popup.js decides the form's behaviour from, so the admin cannot be told one
 * thing while the agents get another.
 */
function popupLine(state, popup) {
  const to = prettyDate(popup.popupTo);
  const from = prettyDate(popup.popupFrom);
  switch (state) {
    case "off":
      return "Nothing pops up. Agents go straight to the form.";
    case "empty":
      return "Nothing to show yet — add a picture, a heading or a few words below.";
    case "waiting":
      return `Waiting. It starts on ${from} and nothing is showing until then.`;
    case "ended":
      return `Over. It closed itself on ${to} — change the dates, or switch to “until I turn it off”.`;
    default:
      return popup.popupMode === "window" && to !== ""
        ? `Showing now, and it closes itself after ${to}.`
        : "Showing to every agent who opens the form, until you turn it off.";
  }
}

/** The word in the corner of the section head. */
const POPUP_WORD = {
  off: "off",
  empty: "nothing in it",
  waiting: "not started",
  ended: "finished",
  live: "showing",
};

/** The same, for the board. "empty" is on but holding nobody. */
const BOARD_WORD = {
  off: "off",
  empty: "nobody on it",
  live: "showing",
};

// One row of the board's editor. The id is only for React's sake — it keeps a
// half-typed name attached to its own box while rows are added and dropped.
//
// It is read off the rows it is joining rather than counted, for the reason
// src/lib/rows.js sets out at length: a counter kept beside a component is reset
// by Vite's hot reload while React keeps the rows, and by React re-running an
// updater to check it is pure. Either way the next row is handed an id a row
// already has, both rows answer to it, and typing in one writes into both.
const blankPlayer = (rows = []) => ({ id: nextRowId(rows, "p"), name: "", points: "" });

/** Saved settings -> editable rows. */
const playerRows = (raw) =>
  parsePlayers(raw).map((one, index) => ({
    id: `p${index + 1}`,
    name: one.name,
    points: String(one.points || ""),
  }));

/**
 * Only the settings that differ — the patch PUT /api/settings actually wants.
 *
 * This is what stops a page that has been open since breakfast from pushing twenty
 * settings it merely happens to be holding over a change made from another device
 * at ten. The server merges a patch key by key, so anything left out of one is left
 * alone; anything put into one is asserted to be this admin's intention.
 *
 * Every value here is a string, a number, a boolean or null, so !== is the whole
 * comparison. boardPlayers is the one exception: both sides hold it as JSON text,
 * and it is normalised through the same serialiser before comparing so that a list
 * nobody has touched cannot look changed because the two sides wrote it out
 * differently.
 */
function changedOnly(now, was = {}) {
  const patch = {};
  for (const key of Object.keys(now)) {
    const canonical = (value) => (key === "boardPlayers" ? serialisePlayers(value) : value);
    const mine = canonical(now[key]);
    if (mine !== canonical(was[key])) patch[key] = mine;
  }
  return patch;
}

/**
 * The door. Deliberately says nothing about what is behind it.
 *
 * What changed under it: this used to compare the typed code with a string in the
 * bundle, and being past it was remembered in sessionStorage. Both were theatre —
 * anyone could read the code out of the published JavaScript, and the register was
 * readable by anyone who had the webhook address whether they came through here or
 * not. Now the password goes to the server, the server keeps the session in a
 * cookie this page cannot read, and every route behind this door refuses to answer
 * without it. Getting past this form is no longer something a browser can decide.
 */
function Lock({ onUnlock, reachable }) {
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote("");
    const outcome = await signIn(password);
    setBusy(false);
    if (outcome.ok) {
      onUnlock();
      return;
    }
    setNote(outcome.note);
    setPassword("");
  }

  return (
    <div className="app">
      <form className="card lock panel" onSubmit={submit} noValidate>
        <label className="label" htmlFor="admin-password">
          Password
        </label>
        <div className={note ? "well has-error" : "well"}>
          <input
            id="admin-password"
            className="pin-input"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setNote("");
            }}
            autoComplete="current-password"
            autoFocus
            /* The server refuses a password over 200 characters, and being told
               "that is not the password" because the box quietly held 300 would be
               the least helpful true sentence on the page. */
            maxLength={200}
            aria-describedby="password-hint"
          />
        </div>
        <p id="password-hint" className={note ? "hint is-error" : "hint"}>
          {note || (reachable === false ? "The server has not answered yet." : " ")}
        </p>
        <button type="submit" className="send" disabled={busy}>
          {busy ? "Checking…" : "Open"}
        </button>
      </form>
    </div>
  );
}

const rowsSum = (rows) => (rows || []).reduce((total, row) => total + (row.amount || 0), 0);

/** Renewal plus every deposit — what one report is worth. */
const entryTotal = (entry) => (entry.renewal || 0) + rowsSum(entry.rd) + rowsSum(entry.fd);

/** How many months the chart shows, ending at the month being collected. */
const SPAN = 6;

/** What one agent brought in for a single month — 0 if they did not report. */
const monthTotal = (agent, key) =>
  (agent.months || []).find((month) => month.key === key)?.total || 0;

/**
 * Nothing in this column. A blank cell was ambiguous — it reads as "not filled
 * in yet" rather than "nothing came in" — so the cell says it outright with an ×.
 * The word beside it is for a screen reader, which would otherwise announce the
 * symbol as "times".
 */
function Nil() {
  return (
    <>
      <span aria-hidden="true">×</span>
      <span className="sr-only">nothing</span>
    </>
  );
}

/** One figure in a table, or an × where there is nothing to show. */
function Num({ value, col }) {
  return (
    <td className={value > 0 ? `num c-${col}` : `num c-${col} is-nil`}>
      {value > 0 ? formatINR(String(value)) : <Nil />}
    </td>
  );
}

/** The four money columns, in the same order and the same colours everywhere. */
function MoneyHead() {
  return (
    <>
      <th className="c-renewal">
        <span className="key key-renewal">Renewal</span>
      </th>
      <th className="c-rd">
        <span className="key key-rd">New RD</span>
      </th>
      <th className="c-fd">
        <span className="key key-fd">New FD</span>
      </th>
      <th className="c-total">Total</th>
    </>
  );
}

/**
 * A deposit column for one report: every RD (or FD) the agent typed on its own
 * line, with the scheme name they wrote beside it. Two RDs are two lines, not
 * one lump — that is the detail the agent took the trouble to enter. When there
 * is more than one, the cell adds them up under a rule, and that subtotal is
 * what the row's Total and the column's Total are made of.
 */
function Deposits({ rows, col, kind }) {
  const list = (rows || []).filter(
    (row) => (row.amount || 0) > 0 || String(row.scheme || "").trim() !== ""
  );
  if (list.length === 0) {
    return (
      <td className={`num c-${col} is-nil`}>
        <Nil />
      </td>
    );
  }

  return (
    <td className={`num c-${col}`}>
      <span className="deps">
        {list.map((row, index) => (
          <span className="dep" key={index}>
            <em className="dep-name" title={row.scheme || ""}>
              {String(row.scheme || "").trim() || "—"}
            </em>
            <b className="dep-num">{formatINR(String(row.amount || 0))}</b>
          </span>
        ))}
        {list.length > 1 && (
          <span className="dep is-sum">
            <em className="dep-name">
              {list.length} {kind}s
            </em>
            <b className="dep-num">{formatINR(String(rowsSum(rows)))}</b>
          </span>
        )}
      </span>
    </td>
  );
}

/**
 * The spreadsheet mark: a row that was last edited by hand in the old Google
 * Sheet, back when the sheet was the register.
 *
 * It cannot appear on anything new. The sheet is a copy now, so there is nowhere
 * left to make that kind of edit — the mark survives as history on imported rows.
 *
 * Drawn rather than written, because there is no character that reads as "a
 * spreadsheet" in every font a phone might have. Monochrome on purpose — colour on
 * this page means money, and a mark is not money.
 */
function SheetMark() {
  return (
    <svg
      className="flag-grid"
      viewBox="0 0 12 12"
      width="11"
      height="11"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1.6" width="10" height="8.8" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1 4.9h10M5.2 4.9v5.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

/**
 * Where this row was last touched, and whether the server has it yet.
 *
 * Two separate facts, so a row can carry both marks: a correction made here that
 * has not reached the server is a pencil and a ✱. A report nobody has corrected
 * carries nothing at all — that is the ordinary case, and marking it would make
 * the marks worthless.
 *
 * Which mark to draw is not decided here. marksOf() reads the row's own "edited
 * in" field, which the server writes and this page cannot: a mark the app could
 * set is a mark the app could clear.
 */
function Marks({ entry }) {
  const marks = marksOf(entry);
  if (marks.length === 0) return null;
  return (
    <>
      {marks.includes("web") && (
        <span className="flag" title="Last corrected here, on the web">
          <span aria-hidden="true">✎</span>
          <span className="sr-only">corrected on the web</span>
        </span>
      )}
      {marks.includes("sheet") && (
        <span className="flag" title="Was edited by hand in the old Google Sheet">
          <SheetMark />
          <span className="sr-only">edited in the old sheet</span>
        </span>
      )}
      {marks.includes("pending") && (
        <span className="flag" title="Not sent yet — this device is still trying">
          <span aria-hidden="true">✱</span>
          <span className="sr-only">not sent yet</span>
        </span>
      )}
    </>
  );
}

/**
 * One report as a row of the register. Three states: read it, correct it, or
 * confirm the delete — the delete asks in the row rather than throwing a
 * browser dialog at you, and the editor opens across the whole row.
 */
function EntryRow({ entry, mode, on }) {
  if (mode === "edit") {
    return (
      <tr className="is-editing">
        <td className="edit-cell" colSpan={7}>
          <EntryEditor entry={entry} onSave={on.save} onCancel={on.cancel} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="name-cell">
        {entry.name}
        <Marks entry={entry} />
      </td>
      <td className="month-cell">{entry.monthLabel}</td>
      <Num value={entry.renewal || 0} col="renewal" />
      <Deposits rows={entry.rd} col="rd" kind="RD" />
      <Deposits rows={entry.fd} col="fd" kind="FD" />
      <Num value={entryTotal(entry)} col="total" />
      <td className="acts">
        {mode === "confirm" ? (
          <>
            <button type="button" className="mini is-danger" onClick={on.remove}>
              Delete it
            </button>
            <button type="button" className="mini" onClick={on.keep}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="mini" onClick={on.edit}>
              Edit
            </button>
            <button type="button" className="mini" onClick={on.ask}>
              Delete
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function toCsv(entries) {
  const head = [
    "submittedAt", "month", "name", "renewal", "total",
    "rdCount", "rdTotal", "rdDetail", "fdCount", "fdTotal", "fdDetail",
    // Where the row was last touched, and whether the server has it yet — the same
    // two facts the marks in the register stand for.
    "editedAt", "editedIn", "stored",
  ];
  const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const detail = (rows) => (rows || []).map((row) => `${row.scheme} ${row.amount || 0}`).join(" | ");

  const lines = [head.join(",")];
  for (const entry of entries) {
    lines.push([
      entry.submittedAt, entry.month, entry.name, entry.renewal,
      entryTotal(entry),
      (entry.rd || []).length, rowsSum(entry.rd), detail(entry.rd),
      (entry.fd || []).length, rowsSum(entry.fd), detail(entry.fd),
      entry.editedAt || "", entry.editedIn || "", entry.pending ? "no" : "yes",
    ].map(cell).join(","));
  }
  return lines.join("\r\n");
}

function download(entries) {
  const url = URL.createObjectURL(new Blob([toCsv(entries)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthly-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function Panel({ onSignOut }) {
  // The cache, read once per render and used only to seed the boxes below. It is
  // this device's last-known copy, not the register: the server's own set arrives a
  // moment later in the effect further down and replaces it.
  const saved = loadSettings();
  const now = new Date();
  const startFrom = describeKey(saved.reportMonth) || reportMonth(now, saved);

  const [mode, setMode] = useState(saved.reportMonth ? "pinned" : "auto");
  const [monthIndex, setMonthIndex] = useState(MONTHS.indexOf(startFrom.name));
  const [year, setYear] = useState(Number(startFrom.year));
  const [graceDays, setGraceDays] = useState(String(saved.graceDays));
  const [credit, setCredit] = useState(saved.credit);
  const [open, setOpen] = useState(saved.open);
  const [message, setMessage] = useState(saved.message || "");
  const [showRd, setShowRd] = useState(saved.showRd !== false);
  const [showFd, setShowFd] = useState(saved.showFd !== false);
  const [autoWindow, setAutoWindow] = useState(Boolean(saved.autoWindow));
  const [opensOn, setOpensOn] = useState(String(saved.opensOnDay));
  const [closesAfter, setClosesAfter] = useState(String(saved.closesAfterDay));
  const [note, setNote] = useState("");
  // Whether that note is good news. "Not saved" set in the same quiet grey as
  // "Saved" is a line that gets skimmed past, and the one time it matters is the
  // time it must not be.
  const [noteOk, setNoteOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Changing the password. Held apart from every other box on this page because it
  // commits on its own button, not on Save.
  const [pwNow, setPwNow] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwNote, setPwNote] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  // The popup announcement. Held apart from `message` on purpose: that is the
  // standing line in the green bar, this is the thing that must not be skimmed
  // past, and jishn wanted both, each with its own box.
  const [popupOn, setPopupOn] = useState(Boolean(saved.popupOn));
  const [popupMode, setPopupMode] = useState(
    saved.popupMode === "window" ? "window" : "always"
  );
  const [popupFrom, setPopupFrom] = useState(saved.popupFrom || "");
  const [popupTo, setPopupTo] = useState(saved.popupTo || "");
  const [popupTitle, setPopupTitle] = useState(saved.popupTitle || "");
  const [popupText, setPopupText] = useState(saved.popupText || "");
  const [popupImage, setPopupImage] = useState(saved.popupImage || "");
  const [picNote, setPicNote] = useState("");
  const [picBusy, setPicBusy] = useState(false);
  // The whole announcement waiting for a "yes, take it down". Asked in the box
  // itself, like the register's own delete, rather than in a browser dialog.
  const [askWipe, setAskWipe] = useState(false);
  // undefined = never asked, null = could not ask, [] = asked and there are none.
  const [shelf, setShelf] = useState(undefined);
  const [shelfBusy, setShelfBusy] = useState(false);
  // The one picture on the shelf waiting for a "yes, delete it" — an id, so only
  // ever one at a time, and the question is asked in words under the shelf where
  // there is room to name the file. This delete is the only one on the page that
  // cannot be undone by pressing Cancel: the bytes leave the server.
  const [dropping, setDropping] = useState("");
  const [picked, setPicked] = useState("");
  // The game board. Typed by hand and nothing to do with the reports below —
  // jishn decides what it says, which is why it is a list of boxes and not a
  // calculation. It rides to every phone in the settings, like the popup.
  const [boardOn, setBoardOn] = useState(Boolean(saved.boardOn));
  const [boardTitle, setBoardTitle] = useState(saved.boardTitle || "");
  const [players, setPlayers] = useState(() => playerRows(saved.boardPlayers));

  // What the server last told us it holds, and whether this admin has touched a
  // setting yet. Both exist for one reason: this page is not the only thing that
  // can change a setting.
  //
  // `known` is what Save measures against, so only the keys this admin actually
  // changed are sent. It starts as the cache — the best guess available on the
  // first frame — and becomes the server's own set the moment it answers, and
  // again after every accepted save.
  //
  // `touched` decides whether that answer is allowed into the boxes. On a server
  // that sleeps between visits the answer can be twenty seconds coming, and an
  // announcement half typed in that time must not be wiped by it. Refs rather than
  // state, both of them: nothing on the page draws itself differently for either,
  // and re-rendering on the first keystroke to record that a keystroke happened
  // would be a render for nobody.
  const known = useRef(saved);
  const touched = useRef(false);

  /**
   * "This admin has started changing something." Hung on the five settings
   * sections below rather than on each of the twenty-two controls inside them,
   * which is two attributes instead of twenty-two and cannot be forgotten when a
   * control is added.
   *
   * On the capture phase so it runs whatever a child's own handler does, and so a
   * click on a toggle counts: the toggles are buttons, and a button never fires
   * onChange. Deliberately not hung on the whole column — the link and password
   * sections live there too, and neither is part of what Save sends.
   */
  const mark = () => {
    touched.current = true;
  };

  // The register comes from the server. This page holds three things about that
  // read and none of them is the register itself: the rows the server last gave
  // us, this device's unsent outbox, and how the last read went. `entries` is the
  // two lists merged — which is why editing a report has to move the chart above
  // it as well, and does, without either of them being told.
  const [storedRows, setStoredRows] = useState(() => readCache().reports);
  const [outbox, setOutbox] = useState(readOutbox);
  // from: "" not asked yet · "server" it answered · "cache" it did not, so these
  // are the rows it gave us last time · "nowhere" not that either.
  // signedOut: the read came back 401, so the session has run out and the login
  // has to come back up — a stale table with no explanation would be worse.
  const [read, setRead] = useState(() => ({
    at: readCache().at,
    from: "",
    error: "",
    signedOut: false,
  }));
  const [reading, setReading] = useState(false);
  // What the server says about itself: how much the register holds, and whether the
  // Google Sheet copy is keeping up. undefined = not asked yet, null = asked and got
  // no answer. Read once on open and again on a button — not on the poll, because a
  // free server that sleeps between visits should be woken for the register, not for
  // a line about the register.
  const [health, setHealth] = useState(undefined);
  const [healthBusy, setHealthBusy] = useState(false);
  const [editing, setEditing] = useState(""); // id of the report being corrected
  const [confirming, setConfirming] = useState(""); // id waiting for "yes, delete"
  const [showAll, setShowAll] = useState(false);
  // The bin: reports that were deleted and can be put back. Kept apart from the
  // register above rather than mixed into it with a flag, because every total, every
  // agent's line and the whole chart are counted off `entries` — a deleted report in
  // there would make all of them quietly wrong. It is also read separately, only when
  // it is opened, so the ordinary use of this page does not pay for it.
  //
  // undefined = never opened · null = opened and the server did not answer · a list.
  const [binOpen, setBinOpen] = useState(false);
  const [bin, setBin] = useState(undefined);
  const [binBusy, setBinBusy] = useState(false);
  const [binNote, setBinNote] = useState("");
  const [binOk, setBinOk] = useState(true);
  const [putting, setPutting] = useState(""); // id being put back right now
  // null until the admin picks one, and "" once they choose every month.
  const [view, setView] = useState(null);

  const entries = useMemo(() => mergeRegister(storedRows, outbox), [storedRows, outbox]);

  /**
   * Send whatever is waiting, then read the register back.
   *
   * In that order on purpose: a correction still in the outbox would otherwise be
   * shown as pending immediately after a read that already contained it.
   */
  async function refresh() {
    setReading(true);
    await flushOutbox();
    setOutbox(readOutbox());
    const got = await fetchReports();
    setStoredRows(got.reports);
    setRead({
      at: got.at,
      from: got.from,
      error: got.error,
      signedOut: Boolean(got.unauthorised),
    });
    setReading(false);
  }

  // The poll below re-reads through this rather than closing over `refresh`,
  // which is a different function on every render — an interval that captured
  // the first one would go on calling it with stale setters forever.
  const latest = useRef(refresh);
  latest.current = refresh;

  /**
   * Ask the server how it is: what the register holds, and whether the sheet copy
   * is keeping up. null on no answer, so the section below can say that rather than
   * show a zero it made up.
   */
  async function readHealth() {
    setHealthBusy(true);
    const got = await serverStatus();
    setHealthBusy(false);
    setHealth(got);
  }

  // Read once on open: the register itself, and how the server says it is doing.
  useEffect(() => {
    latest.current();
    readHealth();
  }, []);

  // Then keep reading, so a report an agent sends turns up here by itself — but
  // never while a row is open for editing or waiting to be deleted. A read landing
  // under an open editor would replace the row being corrected with the server's
  // version of it, and the admin would be typing into last minute's figures.
  // Closing the editor starts the clock again.
  const paused = editing !== "" || confirming !== "";
  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [paused]);

  /**
   * Write a settings set the server sent into all twenty-two boxes on this page.
   *
   * Every line here mirrors a useState initialiser near the top of this component,
   * and the two have to be kept in step by hand. That duplication is deliberate and
   * it is not free: the alternative was remounting this whole panel on a changing
   * `key` so the initialisers ran again — one line instead of twenty-two — but that
   * also throws away the register table's own state below, closes whatever month was
   * being inspected, and re-fetches the reports for nothing.
   */
  function seedFrom(fresh) {
    const from = describeKey(fresh.reportMonth) || reportMonth(new Date(), fresh);
    setMode(fresh.reportMonth ? "pinned" : "auto");
    setMonthIndex(Math.max(0, MONTHS.indexOf(from.name)));
    setYear(Number(from.year));
    setGraceDays(String(fresh.graceDays));
    setCredit(fresh.credit);
    setOpen(fresh.open);
    setMessage(fresh.message || "");
    setShowRd(fresh.showRd !== false);
    setShowFd(fresh.showFd !== false);
    setAutoWindow(Boolean(fresh.autoWindow));
    setOpensOn(String(fresh.opensOnDay));
    setClosesAfter(String(fresh.closesAfterDay));
    setPopupOn(Boolean(fresh.popupOn));
    setPopupMode(fresh.popupMode === "window" ? "window" : "always");
    setPopupFrom(fresh.popupFrom || "");
    setPopupTo(fresh.popupTo || "");
    setPopupTitle(fresh.popupTitle || "");
    setPopupText(fresh.popupText || "");
    setPopupImage(fresh.popupImage || "");
    setBoardOn(Boolean(fresh.boardOn));
    setBoardTitle(fresh.boardTitle || "");
    setPlayers(playerRows(fresh.boardPlayers));
  }

  // Ask the register what the settings actually are, once, on open.
  //
  // The boxes above opened on this device's cache, which is only the last thing
  // *this* browser saw or saved. Pin a month from the laptop and the phone's admin
  // page would go on showing automatic until something was saved from it — and that
  // save, before this effect existed, would have pushed the phone's twenty stale
  // keys back over the laptop's change.
  //
  // The answer is refused entry once anything has been typed. On a server that
  // sleeps between visits it can be twenty seconds coming, which is long enough to
  // have written half an announcement, and having it vanish mid-sentence would be
  // the page's own doing. `known` is still updated in that case: the diff base
  // should be the truth even when the boxes are deliberately not.
  useEffect(() => {
    let alive = true;
    fetchSettings().then((fresh) => {
      if (!alive || !fresh) return;
      known.current = fresh;
      if (!touched.current) seedFrom(fresh);
    });
    return () => {
      alive = false;
    };
  }, []);

  const agents = useMemo(() => byAgent(entries), [entries]);

  // The months that actually have reports, oldest first — what the switcher
  // offers. No empty months in the list: there is nothing to inspect in one.
  const monthKeys = useMemo(() => monthsPresent(entries), [entries]);

  const pinnedKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  // Whether that key is one the register would take. A year box on its way to 2026
  // holds 2, then 20, then 202, and "202-09" is not a month: the server refuses it
  // and — because a settings patch is accepted or refused as one thing — every
  // other setting on this page goes down with it. So Save waits for the fourth
  // digit, and the line under the year box says what it is waiting for.
  const pinnedOk = describeKey(pinnedKey) !== null;
  const canSave = mode !== "pinned" || pinnedOk;
  // Exactly what an agent's phone will do with the settings as they now stand.
  const draft = {
    reportMonth: mode === "pinned" ? pinnedKey : null,
    graceDays: Number(graceDays) || 0,
    open,
    autoWindow,
    opensOnDay: Number(opensOn) || 1,
    closesAfterDay: Number(closesAfter) || 0,
  };
  // describeKey returns null while the year box is half-typed, so fall back.
  const effective =
    (mode === "pinned" ? describeKey(pinnedKey) : reportMonth(now, draft)) ||
    reportMonth(now, { reportMonth: null, graceDays: draft.graceDays });
  const openNow = isCollectionOpen(now, draft);

  // The popup exactly as an agent's phone would read it, so the preview and the
  // status line below are the real thing rather than a description of it.
  const popupDraft = {
    popupOn,
    popupMode,
    popupFrom,
    popupTo,
    popupTitle,
    popupText,
    popupImage,
  };
  const popState = popupState(popupDraft, now);
  // A picture uploaded before there was a server is carried inline: hundreds of
  // thousands of characters, so it must never be poured into a text box. Nothing
  // can produce one of these any more — an upload now goes to the server and comes
  // back as a short /api/images/12 — but a browser that saved settings under the
  // old build may still be holding one, so it is still recognised rather than
  // printed as gibberish.
  const picIsInline = /^data:/i.test(popupImage);

  // What the picture is, in words, whatever it came from. An id is not worth
  // reading out; a link is, so it is shown as typed.
  const picWord = picIsInline
    ? "Held on this device from before the server"
    : /^\/api\/images\//i.test(popupImage)
      ? "Uploaded here"
      : /^drive:/i.test(popupImage)
        ? "One from the old Drive folder"
        : popupImage;

  /** Take the picture off — uploaded, a link, or an old one, all the same. */
  function dropPicture() {
    setPopupImage("");
    setPicNote("");
  }

  // The shelf picture whose × has been pressed — looked up in the list rather than
  // held, so a shelf re-read while the question was on screen cannot leave the
  // question attached to a picture that is no longer in it.
  const armed = Array.isArray(shelf) ? shelf.find((one) => one.id === dropping) : null;

  // GET /api/admin/status, in words.
  //
  // `mirror` is null until the server has answered, which is not the same fact as a
  // sheet that is not set up, so the section says which. The oldest report is shown
  // as a month and not as the timestamp it arrives as: the exact second a figure was
  // submitted is not something anybody needs off a status line, and the month is what
  // the rest of this page is counted in.
  const mirror = health ? health.sheet || {} : null;
  const held = Number(health?.reports) || 0;
  const oldest = describeKey(String(health?.since || "").slice(0, 7))?.full || "";
  const sheetWord = !mirror
    ? ""
    : !mirror.configured
      ? "no copy"
      : mirror.queue > 0
        ? `${mirror.queue} waiting`
        : "up to date";

  // Is there an announcement at all? The switch is not part of this: something
  // switched off is still written down, which is exactly the trap — turning it off
  // hides the boxes and leaves the words sitting there.
  const popHasSomething = Boolean(
    popupTitle.trim() || popupText.trim() || popupImage || popupFrom || popupTo
  );

  /**
   * Take the whole announcement down: heading, words, picture, both dates, and the
   * switch with them. Nothing leaves an agent's phone until Save, like every other
   * box on this page — this only empties the draft.
   */
  function wipePopup() {
    setPopupTitle("");
    setPopupText("");
    setPopupImage("");
    setPicNote("");
    setPopupFrom("");
    setPopupTo("");
    setPopupMode("always");
    setPopupOn(false);
    setShelf(undefined);
    setAskWipe(false);
  }

  // The board as a phone would read it. parsePlayers takes the rows as they are,
  // so the preview below is the real component on the real list — a name typed
  // half a second ago is already on the podium.
  const boardDraft = { boardOn, boardTitle, boardPlayers: players };
  const standing = rankPlayers(players);

  /** Change, add and drop a board row. */
  function editPlayer(id, patch) {
    setPlayers((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  // The cards read as this month's standing: whoever has brought in the most for
  // the month being collected comes first, and what they have brought in up to
  // that month only breaks a tie. Someone who has not reported yet falls to the
  // end. Every figure here stops at the collected month, so pinning back to July
  // shows July's standing rather than mixing August into it.
  const ranked = useMemo(
    () =>
      agents
        .map((one) => {
          const listed = upTo(one.months, effective.key);
          return { ...one, listed, sofar: sumMonths(listed), mine: monthTotal(one, effective.key) };
        })
        .sort(
          (one, two) =>
            two.mine - one.mine ||
            two.sofar.total - one.sofar.total ||
            one.name.localeCompare(two.name)
        ),
    [agents, effective.key]
  );
  const agent = ranked.find((one) => one.id === picked) || ranked[0] || null;

  // The page opens on the month being collected — that is what you came to look
  // at. Two things fall back to every month: no reports for it yet, and the
  // month you were reading losing its last report while you read it.
  const wanted = view === null ? effective.key : view;
  const viewKey = monthKeys.includes(wanted) ? wanted : "";
  const viewLabel = viewKey ? describeKey(viewKey)?.full || viewKey : "";
  const shown = viewKey ? entries.filter((entry) => entry.month === viewKey) : entries;

  // The three kinds of money, added up over the reports being shown.
  const sums = shown.reduce(
    (running, entry) => ({
      renewal: running.renewal + (entry.renewal || 0),
      rd: running.rd + rowsSum(entry.rd),
      fd: running.fd + rowsSum(entry.fd),
    }),
    { renewal: 0, rd: 0, fd: 0 }
  );
  const collected = sums.renewal + sums.rd + sums.fd;

  // Every agent is charted over the same six months, ending at the month being
  // collected, and the tallest bar inside that window sets the scale for all of
  // them — so two agents can be compared without doing arithmetic.
  const windows = useMemo(
    () => agents.map((one) => monthWindow(one.months, effective.key, SPAN)),
    [agents, effective.key]
  );
  const months = agent ? monthWindow(agent.months, effective.key, SPAN) : [];
  const scale = tallest(windows);

  const formLink = useMemo(() => {
    try {
      return new URL("../form/", window.location.href).href;
    } catch {
      return "/form/";
    }
  }, []);

  async function save() {
    // The button above is already disabled for this, and this is what makes it
    // true. Worth the four lines: one half-typed year would take the twenty other
    // settings on this page with it, and the sentence would be the server's own
    // rather than one that says where to look.
    if (!canSave) {
      setNoteOk(false);
      setNote("Not saved — the pinned month needs all four digits of the year.");
      return;
    }
    setBusy(true);
    // Every setting as the boxes now hold it, in the shape the register holds it.
    // The whole set is built so the comparison below is a comparison rather than a
    // guess about which boxes were touched — but only the keys that differ are sent.
    const whole = {
      reportMonth: mode === "pinned" ? pinnedKey : null,
      graceDays: Number(graceDays) || 0,
      credit,
      open,
      message,
      showRd,
      showFd,
      autoWindow,
      opensOnDay: Number(opensOn) || 1,
      closesAfterDay: Number(closesAfter) || 0,
      ...popupDraft,
      boardOn,
      boardTitle,
      // Stored as a JSON string, so this page, the server and the sheet copy are
      // never three different shapes of the same list.
      boardPlayers: serialisePlayers(players),
    };
    const patch = changedOnly(whole, known.current);
    // A poster from before there was a server, carried inline as a data: URL of a
    // few hundred thousand characters. The register refuses those outright, so
    // leaving it in the patch would mean this admin could never save any setting
    // again — a picture nobody chose today taking down a month they did. It is
    // dropped instead. Nothing is lost that was not already lost: that poster only
    // ever existed on this one device, and the moment a real one is uploaded the key
    // becomes a short /api/images/12 and travels normally.
    if (/^data:/i.test(String(patch.popupImage || ""))) delete patch.popupImage;
    // Nothing differs, so there is nothing to send. Said rather than swallowed: an
    // admin who pressed Save is owed an answer, and "Saved" would be a small lie
    // about a round trip that never happened.
    if (Object.keys(patch).length === 0) {
      setBusy(false);
      setNoteOk(true);
      setNote("Nothing to save — no setting has changed.");
      return;
    }
    const outcome = await saveSettings(patch);
    setBusy(false);
    // Four outcomes, wanting four different things said, and the new one is the
    // refusal: nobody's connection is at fault, the server read these settings and
    // named one it will not take. settings.js has already put this browser's copy
    // back the way it was, so nothing has changed anywhere — but the boxes above
    // still hold what was typed, which is right, because that is what has to change
    // before Save can work.
    //
    // The sentence is the server's own. It says which setting and what the limit
    // was, and rewording it here could only make it vaguer.
    if (outcome.refused) {
      setNoteOk(false);
      setNote(`Not saved. ${outcome.note}`);
    } else if (outcome.unauthorised) {
      setNoteOk(false);
      setNote("Not saved — this browser has been signed out. Reload the page and sign in again.");
    } else if (outcome.synced) {
      // The server merged the patch and sent back the whole set. That answer — not
      // what this page sent, and not what it happens to be holding — becomes the base
      // the next Save is measured against, so a key another device changed while this
      // one sat open is now known here rather than overwritten by the next save.
      known.current = outcome.settings;
      touched.current = false;
      setNoteOk(true);
      setNote("Saved. Every agent sees this.");
    } else {
      setNoteOk(false);
      setNote(
        "Not saved — the server could not be reached. Nothing has changed for the agents; try again."
      );
    }
  }

  /**
   * Shrink the chosen picture, upload it, and point the popup at it.
   *
   * The shrinking is the part agents feel: a 4 MB phone photo becomes a few hundred
   * KB before it ever has to load on the form. The upload keeps its own copy on the
   * server, so choosing the same poster again next month is a click, not a hunt
   * through the phone's gallery.
   */
  async function choosePicture(event) {
    const file = event.target.files?.[0];
    // The same file chosen twice in a row must still fire the change event.
    event.target.value = "";
    if (!file) return;
    setPicBusy(true);
    setPicNote("Shrinking the picture…");
    const outcome = await uploadPicture(file);
    setPicBusy(false);
    setPicNote(outcome.note);
    if (outcome.ok) {
      setPopupImage(outcome.value);
      // One more picture on the server means the shelf on screen is out of date.
      if (shelf !== undefined) setShelf(undefined);
    }
  }

  /** Read back every picture uploaded so far. */
  async function openShelf() {
    setShelfBusy(true);
    const found = await listPictures();
    setShelfBusy(false);
    setShelf(found);
    // A shelf just re-read is a different list; an × armed against the old one
    // would be armed against whatever now sits in that place.
    setDropping("");
  }

  /**
   * Arm the × on one picture — unless deleting it would break the announcement
   * agents are reading right now.
   *
   * The picture leaves the server for good, and the settings are not touched with
   * it: src/lib/images.js deliberately refuses to make that decision quietly, and
   * this is where it is made out loud. Two ways it would go wrong, each with its own
   * sentence, because "cannot delete that" without the reason is a dead end:
   *
   *   the box points at it   — Save would then point every phone at a picture that
   *                            is not there. Take it off the announcement first.
   *   the cache points at it — the box has already been changed but not saved, so
   *                            the agents are still being shown this one. Save
   *                            first; then it is nobody's poster and can go.
   */
  function askDrop(one) {
    if (one.url === popupImage) {
      setPicNote(
        "That is the picture on the announcement. Take it off there first — then it can be deleted."
      );
      return;
    }
    if (one.url === saved.popupImage) {
      setPicNote(
        "The agents are still being shown this one — the change here has not been saved yet. Press Save, then it can be deleted."
      );
      return;
    }
    setPicNote("");
    setDropping(one.id);
  }

  /** Yes, delete it. The bytes go from the server; nothing else on the page moves. */
  async function dropFromShelf(one) {
    setShelfBusy(true);
    const outcome = await removePicture(one.id);
    setShelfBusy(false);
    setDropping("");
    if (!outcome.ok) {
      setPicNote(outcome.note);
      return;
    }
    setPicNote(`${one.name} is off the shelf.`);
    // Taken out of the list here rather than by re-reading the shelf: one fewer
    // round trip, and the tile going as the answer arrives is the answer.
    setShelf((rows) => (Array.isArray(rows) ? rows.filter((row) => row.id !== one.id) : rows));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(formLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  /**
   * Change the password.
   *
   * Both boxes are cleared on success and only the new one on failure, so a wrong
   * current password does not mean typing the new one out again. The server does
   * the judging — length, whether the current one is right, and signing the other
   * devices out — and this only says what it answered.
   */
  async function changeIt() {
    if (pwBusy) return;
    setPwBusy(true);
    setPwNote("");
    const outcome = await changePassword(pwNow, pwNext);
    setPwBusy(false);
    setPwNote(outcome.note);
    setPwNext("");
    if (outcome.ok) setPwNow("");
  }

  /**
   * Apply a correction: close the editor, send the whole report, and read the
   * register back.
   *
   * The editor closes first, before the server has answered, because a correction
   * that cannot be sent is queued rather than lost. The one case that is not true of
   * is a refusal — the server reading the correction and naming something in it that
   * it will not take — and that one is said out loud, because otherwise the row
   * simply snaps back to the figure it held and reads as an edit undone by nothing.
   *
   * Read back rather than patched in place because the pencil is the server's to
   * write: this page has no business deciding that a row was edited on the web.
   */
  async function applyEdit(id, patch) {
    const entry = entries.find((one) => one.id === id);
    setEditing("");
    if (!entry) return;
    const outcome = await saveCorrection(entry, patch);
    if (outcome.synced) {
      await refresh();
      return;
    }
    if (outcome.refused) {
      setNoteOk(false);
      setNote(`That correction was not made. ${outcome.note}`);
    }
    setOutbox(readOutbox());
  }

  /**
   * Take one report out of the register.
   *
   * It is kept, not destroyed: the row is marked deleted and stops appearing here,
   * and it turns up in the bin under the table, where it can be put back. That undo
   * did not exist while the Google Sheet was the register — the sheet's own version
   * history was the only way back.
   *
   * A refusal here is almost always a 404, which means this report is already out of
   * the register: deleted from another device, or never sent from this phone at all.
   * The register is the answer either way, so it is read back rather than argued
   * with, and the row goes — which is what was asked for.
   */
  async function drop(id) {
    setConfirming("");
    if (editing === id) setEditing("");
    const outcome = await removeEntry(id);
    if (outcome.refused) {
      setNoteOk(false);
      setNote(`${outcome.note} The register has been read again.`);
    }
    if (outcome.synced || outcome.refused) {
      await refresh();
      // The report just deleted belongs in the bin now. If the bin is open, showing
      // it without that report would read as the delete having gone somewhere else.
      if (binOpen) await readBin();
      return;
    }
    setOutbox(readOutbox());
  }

  /**
   * Read the bin.
   *
   * Every time it is opened, and again after anything moves in or out of it — never
   * on the poll. Two admins can be deleting and restoring at once, and a stale bin is
   * the one thing that makes this section actively misleading: a report offered for
   * restoring that is already back, or one missing that is in there.
   *
   * No answer is `null` and not an empty list. "The bin is empty" and "the bin could
   * not be read" are opposite facts and the section says which.
   */
  async function readBin() {
    setBinBusy(true);
    const got = await fetchDeleted();
    setBinBusy(false);
    if (got.error !== "") {
      setBin(null);
      setBinOk(false);
      setBinNote(got.unauthorised ? "Signed out — reload the page and sign in again." : "");
      return;
    }
    setBin(got.reports);
    // A note saying it could not be read is not true any more. A note saying a report
    // was put back still is, so only the failures are cleared — which is what asking
    // binOk rather than clearing unconditionally distinguishes.
    if (!binOk) {
      setBinOk(true);
      setBinNote("");
    }
  }

  /**
   * Put one deleted report back in the register.
   *
   * The row was never destroyed, so this is the same report coming back — same id,
   * same figures, same submitted time, in its own place in the list rather than at the
   * top of it. The sheet copy is brought back by the server.
   *
   * Nothing about this is queued, so unlike a correction it can simply fail to happen:
   * the outcome is read for all three answers. A refusal is a 404 and means the bin on
   * screen is out of date, so it is read again — the report is either already back or
   * was never there.
   */
  async function putBack(entry) {
    setPutting(entry.id);
    const outcome = await restoreEntry(entry.id);
    setPutting("");

    if (outcome.synced) {
      // Taken out of the list here as well as read back, so the row goes the moment
      // the answer arrives rather than a round trip later.
      setBin((rows) => (Array.isArray(rows) ? rows.filter((row) => row.id !== entry.id) : rows));
      setBinOk(true);
      setBinNote(`${entry.name}'s ${entry.monthLabel} report is back in the register.`);
      await refresh();
      // The register holds one more report than it did a moment ago.
      readHealth();
      return;
    }
    setBinOk(false);
    if (outcome.refused) {
      setBinNote(`${outcome.note} The bin has been read again.`);
      await readBin();
      return;
    }
    setBinNote(
      outcome.unauthorised
        ? "Signed out — reload the page and sign in again. Nothing has moved."
        : "The server could not be reached, so nothing has moved. Press it again in a moment."
    );
  }

  /** Open the bin, reading it as it opens; closing it says nothing more. */
  function toggleBin() {
    if (binOpen) {
      setBinOpen(false);
      return;
    }
    setBinOpen(true);
    setBinNote("");
    setBinOk(true);
    readBin();
  }

  return (
    <div className="app admin">
      <main className="card">
        <header className="head">
          <div className="head-text">
            <p className="eyebrow">
              <span className="dot" aria-hidden="true" />
              Manage collection
            </p>
            <h1 className="month">
              {effective.name}
              <span className="month-year">{effective.year}</span>
            </h1>
            <p className="lede">
              {openNow
                ? "This is the month agents are filling in right now."
                : "Collection is closed. Agents see a notice instead of the form."}
            </p>
          </div>

          {/* Save belongs up here, opposite the month: it is the one thing on the
              page that commits everything, and at the bottom of a long left
              column it was below the fold on most of the settings. */}
          <div className="head-act">
            <button type="button" className="send" onClick={save} disabled={busy || !canSave}>
              {busy ? "Saving…" : "Save"}
            </button>
            {note && (
              <p className={noteOk ? "hint save-note" : "hint save-note is-error"} role="status">
                {note}
              </p>
            )}

            <p className="hint save-note">
              <button type="button" className="mini" onClick={onSignOut}>
                Sign out
              </button>
            </p>
          </div>
        </header>

        <div className="grid">
          <div className="column">
            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Which month</h2>
              </div>
              <div className="choice">
                <button
                  type="button"
                  className={mode === "auto" ? "chip is-on" : "chip"}
                  onClick={() => setMode("auto")}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  className={mode === "pinned" ? "chip is-on" : "chip"}
                  onClick={() => setMode("pinned")}
                >
                  Pin a month
                </button>
              </div>
              {mode === "auto" ? (
                <DayBox
                  id="grace"
                  label="Days at the start of a month that still report the month before"
                  value={graceDays}
                  onChange={setGraceDays}
                  high={28}
                  hint="August's figures arrive up to about 5 September, so 7 is safe. 28 is the most the register takes."
                />
              ) : (
                <div className="row">
                  <label className="label" htmlFor="pin-month">
                    Collect for
                  </label>
                  <div className="pair">
                    <div className="well">
                      <select
                        id="pin-month"
                        className="scheme-input"
                        value={monthIndex}
                        onChange={(event) => setMonthIndex(Number(event.target.value))}
                      >
                        {MONTHS.map((name, index) => (
                          <option key={name} value={index}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="well">
                      <input
                        className="scheme-input"
                        value={year}
                        onChange={(event) =>
                          setYear(Number(event.target.value.replace(/\D/g, "").slice(0, 4)) || 0)
                        }
                        inputMode="numeric"
                        aria-label="Year"
                      />
                    </div>
                  </div>
                  <p className={pinnedOk ? "hint" : "hint is-error"}>
                    {pinnedOk
                      ? "Stays on this month until you switch back to automatic, and is always open — this is how you reopen a month for a late report."
                      : "Type all four digits of the year. Save is waiting for it: the register only takes a month written as 2026-08, and it would refuse every other setting on this page along with it."}
                  </p>
                </div>
              )}
            </section>

            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">The form</h2>
              </div>
              <Toggle label="Accepting reports" on={open} onToggle={() => setOpen(!open)} />
              <Toggle
                label="Ask for new RD"
                on={showRd}
                onToggle={() => setShowRd(!showRd)}
                onText="Shown"
                offText="Hidden"
              />
              <Toggle
                label="Ask for new FD"
                on={showFd}
                onToggle={() => setShowFd(!showFd)}
                onText="Shown"
                offText="Hidden"
              />
              <div className="row">
                <label className="label" htmlFor="message">
                  A line for the agents to read
                </label>
                <div className="well">
                  <input
                    id="message"
                    className="scheme-input"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="e.g. August figures by 5 September please"
                    autoComplete="off"
                    maxLength={LIMITS.message}
                  />
                </div>
                <p className="hint">Left empty, nothing is shown.</p>
              </div>
              <div className="row">
                <label className="label" htmlFor="credit">
                  Footer line
                </label>
                <div className="well">
                  <input
                    id="credit"
                    className="scheme-input"
                    value={credit}
                    onChange={(event) => setCredit(event.target.value)}
                    autoComplete="off"
                    maxLength={LIMITS.credit}
                  />
                </div>
              </div>
            </section>

            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Open and close by itself</h2>
                <span className="section-note">{autoWindow ? "on" : "off"}</span>
              </div>
              <Toggle
                label="Use a collection window"
                on={autoWindow}
                onToggle={() => setAutoWindow(!autoWindow)}
                onText="On"
                offText="Off"
              />
              {autoWindow && (
                <>
                  <div className="pair is-even">
                    <DayBox
                      id="opens"
                      label="Opens on day"
                      value={opensOn}
                      onChange={setOpensOn}
                      high={31}
                    />
                    <DayBox
                      id="closes"
                      label="Closes after day"
                      value={closesAfter}
                      onChange={setClosesAfter}
                      high={31}
                    />
                  </div>
                  <p className="hint">
                    Open from the {ordinal(Number(opensOn) || 1)} to the{" "}
                    {ordinal(Number(closesAfter) || 0)}, closed in between. Today it is{" "}
                    {openNow ? "open" : "closed"}.
                  </p>
                </>
              )}
            </section>

            {/* --- the popup ------------------------------------------ */}
            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Popup announcement</h2>
                <span className="section-note">{POPUP_WORD[popState]}</span>
              </div>
              <Toggle
                label="Pop it up on the form"
                on={popupOn}
                onToggle={() => setPopupOn(!popupOn)}
                onText="On"
                offText="Off"
              />
              {/* Outside the switch on purpose. Off only stops it popping up — the
                  heading, the words and the picture are all still written down, and
                  with the switch off the boxes are hidden, so there was no way to
                  get rid of them. This is that way. It asks first, in place. */}
              {popHasSomething && (
                <>
                  {askWipe && (
                    <p className="hint">
                      The heading, the words, the picture and both dates all go, and
                      the switch goes off with them. Nothing leaves an agent's phone
                      until you save.
                    </p>
                  )}
                  <div className="section-foot">
                    {askWipe ? (
                      <>
                        {/* Far apart on purpose: the red one is not the one a thumb
                            should find by accident. */}
                        <button type="button" className="add is-danger" onClick={wipePopup}>
                          Yes, take it down
                        </button>
                        <button
                          type="button"
                          className="add"
                          onClick={() => setAskWipe(false)}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="add is-danger"
                          onClick={() => setAskWipe(true)}
                        >
                          Delete the announcement
                        </button>
                        <span className="section-total">
                          {popupOn ? "" : "switched off, still written down"}
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}
              {popupOn && (
                <>
                  {/* Deliberately not "Open" and "Closed": those two words belong
                      to the collection switch two boxes up, and reusing them here
                      would read as the same setting. */}
                  <div className="choice">
                    <button
                      type="button"
                      className={popupMode === "always" ? "chip is-on" : "chip"}
                      onClick={() => setPopupMode("always")}
                    >
                      Until I turn it off
                    </button>
                    <button
                      type="button"
                      className={popupMode === "window" ? "chip is-on" : "chip"}
                      onClick={() => setPopupMode("window")}
                    >
                      Between two dates
                    </button>
                  </div>
                  {popupMode === "window" && (
                    <div className="pair is-even">
                      <DateBox
                        id="pop-from"
                        label="First day"
                        value={popupFrom}
                        onChange={setPopupFrom}
                      />
                      <DateBox
                        id="pop-to"
                        label="Last day"
                        value={popupTo}
                        onChange={setPopupTo}
                      />
                    </div>
                  )}
                  <p className="hint">{popupLine(popState, popupDraft)}</p>
                  <p className="hint">
                    Each agent gets it once a day. Change the words or the picture and it
                    comes up again straight away, even for someone who has already seen
                    today's.
                  </p>
                  <div className="row">
                    <label className="label" htmlFor="pop-title">
                      Heading
                    </label>
                    <div className="well">
                      <input
                        id="pop-title"
                        className="scheme-input"
                        value={popupTitle}
                        onChange={(event) => setPopupTitle(event.target.value)}
                        placeholder="e.g. New RD scheme from 1 October"
                        autoComplete="off"
                        maxLength={LIMITS.popupTitle}
                      />
                    </div>
                  </div>
                  <div className="row">
                    <label className="label" htmlFor="pop-text">
                      What it says
                    </label>
                    <div className="well">
                      <textarea
                        id="pop-text"
                        className="scheme-input note-input"
                        value={popupText}
                        onChange={(event) => setPopupText(event.target.value)}
                        rows={3}
                        placeholder="A line or two. Press Enter for a new line."
                        maxLength={LIMITS.popupText}
                      />
                    </div>
                    <p className="hint">
                      A picture, a heading, a few words — any one of the three is enough.
                      With none of them nothing pops up, whatever the switch says.
                    </p>
                  </div>
                  <div className="row">
                    {popupImage ? (
                      // A picture that is already chosen is shown in words with the
                      // way off it, whatever it came from — an upload, a link, or one
                      // left over from the Drive era. The text box was only ever for
                      // typing one in, and an inline picture cannot go in a box at
                      // all: it is the picture itself, hundreds of thousands of
                      // characters.
                      <>
                        <p className="label">Picture</p>
                        <div className="held">
                          <span className="held-word">{picWord}</span>
                          <button
                            type="button"
                            className="add is-danger"
                            onClick={dropPicture}
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="label" htmlFor="pop-image">
                          Picture
                        </label>
                        <div className="well">
                          <input
                            id="pop-image"
                            className="scheme-input"
                            value={popupImage}
                            onChange={(event) => setPopupImage(event.target.value)}
                            placeholder="https://… , or choose a picture below"
                            autoComplete="off"
                            spellCheck="false"
                            maxLength={LIMITS.popupImage}
                          />
                        </div>
                      </>
                    )}
                    <div className="section-foot">
                      {/* A label wrapping a hidden file input: the browser's own
                          file picker, wearing the same button as everything else. */}
                      <label className="add is-file">
                        {picBusy ? "Working…" : "Choose a picture"}
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/*"
                          onChange={choosePicture}
                          disabled={picBusy}
                        />
                      </label>
                      <button
                        type="button"
                        className="add"
                        onClick={openShelf}
                        disabled={shelfBusy}
                      >
                        {shelfBusy ? "Looking…" : "Ones uploaded before"}
                      </button>
                    </div>
                    {picNote && <p className="hint">{picNote}</p>}
                  </div>
                  {shelf !== undefined &&
                    (shelf === null ? (
                      <p className="hint">
                        The pictures could not be read just now. Check the connection
                        and try again.
                      </p>
                    ) : shelf.length === 0 ? (
                      <p className="hint">Nothing uploaded yet.</p>
                    ) : (
                      <>
                        <div className="shelf">
                          {shelf.map((one) => {
                            // The address the server gave, not one built here. A guess
                            // at the shape of it is a broken picture on every phone.
                            const ref = one.url;
                            return (
                              // A tile is two buttons now — use this one, or delete it
                              // — so they are siblings inside a wrapper. A button
                              // inside a button is not something a browser keeps.
                              <div className="shelf-item" key={one.id}>
                                <button
                                  type="button"
                                  className={popupImage === ref ? "shelf-pic is-on" : "shelf-pic"}
                                  onClick={() => {
                                    setPopupImage(ref);
                                    setPicNote(`Using ${one.name}.`);
                                  }}
                                  aria-pressed={popupImage === ref}
                                >
                                  <img src={imageSrc(ref)} alt="" loading="lazy" />
                                  <span className="shelf-name">{one.name}</span>
                                </button>
                                <button
                                  type="button"
                                  className={
                                    dropping === one.id ? "shelf-drop is-on" : "shelf-drop"
                                  }
                                  onClick={() => askDrop(one)}
                                  disabled={shelfBusy}
                                  aria-label={`Delete ${one.name} from the shelf`}
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {/* The question goes under the shelf, where a tile 88px wide
                            has no room for it, and it names the file so it is plainly
                            the one whose × was pressed. */}
                        {armed && (
                          <>
                            <p className="hint is-error">
                              Delete {armed.name}? It leaves the server for good —
                              the one thing on this page that Cancel cannot put back.
                            </p>
                            <div className="section-foot">
                              {/* Far apart, like the announcement's own delete: the
                                  red one is not the one a thumb finds by accident. */}
                              <button
                                type="button"
                                className="add is-danger"
                                onClick={() => dropFromShelf(armed)}
                                disabled={shelfBusy}
                              >
                                {shelfBusy ? "Deleting…" : "Yes, delete it"}
                              </button>
                              <button
                                type="button"
                                className="add"
                                onClick={() => setDropping("")}
                                disabled={shelfBusy}
                              >
                                Keep it
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    ))}

                  {/* The very same card the agents get, sitting on the page. Not a
                      drawing of it — the component itself, reading the boxes above. */}
                  <p className="label preview-label">What an agent will see</p>
                  {popState === "empty" ? (
                    <p className="hint">Nothing yet.</p>
                  ) : (
                    <Popup settings={popupDraft} preview />
                  )}
                </>
              )}
            </section>

            {/* --- the game board ------------------------------------- */}
            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Game board</h2>
                <span className="section-note">{BOARD_WORD[boardState(boardDraft)]}</span>
              </div>
              <Toggle
                label="Put the standing on the form"
                on={boardOn}
                onToggle={() => setBoardOn(!boardOn)}
                onText="On"
                offText="Off"
              />
              {boardOn && (
                <>
                  <p className="hint">
                    You type these yourself — the board never works itself out from the
                    reports, so it says exactly what you decide it says. Most points
                    first. Two people level are both first and both take a gold. The top
                    three stand on the podium; however many more you type sit behind
                    “See all”.
                  </p>
                  <div className="row">
                    <label className="label" htmlFor="board-title">
                      Heading
                    </label>
                    <div className="well">
                      <input
                        id="board-title"
                        className="scheme-input"
                        value={boardTitle}
                        onChange={(event) => setBoardTitle(event.target.value)}
                        placeholder="Top performers"
                        autoComplete="off"
                        maxLength={LIMITS.boardTitle}
                      />
                    </div>
                  </div>

                  {/* Headed once, above the rows, rather than labelling every row:
                      the two boxes are a name and a figure and now say so, and ten
                      people do not repeat the same two words ten times. */}
                  {players.length > 0 && (
                    <div className="player-head" aria-hidden="true">
                      <p className="label">Name</p>
                      <p className="label">Points</p>
                      <span />
                    </div>
                  )}

                  {players.map((row, index) => (
                    <div key={row.id} className="player">
                      <div className="well">
                        <input
                          className="scheme-input"
                          value={row.name}
                          onChange={(event) => editPlayer(row.id, { name: event.target.value })}
                          placeholder={index === 0 ? "e.g. Anil Kumar" : "Name"}
                          autoComplete="off"
                          /* The register refuses the whole list past 20,000
                             characters, and it is the only limit it puts on the
                             board. Eighty per name — the same as every other name
                             in this app — puts that wall beyond about 170 people,
                             which is further than any board this is for. The points
                             box needs no limit: toDigits() already stops at nine
                             digits, the largest figure the register takes. */
                          maxLength={MAX_NAME}
                          aria-label={`Name ${index + 1}`}
                        />
                      </div>
                      <div className="well">
                        <input
                          className="scheme-input player-points"
                          value={row.points}
                          onChange={(event) =>
                            editPlayer(row.id, { points: toDigits(event.target.value) })
                          }
                          inputMode="numeric"
                          placeholder="0"
                          autoComplete="off"
                          aria-label={`Points ${index + 1}`}
                        />
                      </div>
                      <button
                        type="button"
                        className="drop"
                        onClick={() => setPlayers((rows) => rows.filter((one) => one.id !== row.id))}
                        aria-label={`Take ${row.name.trim() || "this row"} off the board`}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <div className="section-foot">
                    <button
                      type="button"
                      className="add"
                      onClick={() => setPlayers((rows) => [...rows, blankPlayer(rows)])}
                    >
                      Add someone
                    </button>
                    <span className="section-total">
                      {standing.length === 0
                        ? "nobody yet"
                        : `${standing.length} on the board`}
                    </span>
                  </div>

                  {/* The component itself, on the list as it stands — not a drawing
                      of it. A row with no name is left out here exactly as it is on
                      an agent's phone. */}
                  <p className="label preview-label">What an agent will see</p>
                  {standing.length === 0 ? (
                    <p className="hint">Nobody on it yet. Add a name and a figure above.</p>
                  ) : (
                    <Board settings={boardDraft} preview />
                  )}
                </>
              )}
            </section>

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">The link agents open</h2>
              </div>
              <p className="link-line">{formLink}</p>
              <div className="section-foot">
                <button type="button" className="add" onClick={copyLink}>
                  Copy link
                </button>
                {copied && <span className="section-note">copied</span>}
              </div>
              <p className="hint">
                Send this one. Nothing on it points at this page.
              </p>
            </section>

            {/* The only place this page says anything about the machinery behind it,
                and it answers the two questions that used to need a shell and a
                password: how much is actually in the register, and is the Google
                Sheet copy keeping up. Nothing here can be changed — that is why it
                sits outside Save, and why the only button on it asks again. */}
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Behind the page</h2>
                {sheetWord && <span className="section-note">{sheetWord}</span>}
              </div>
              {health === undefined ? (
                <p className="hint">Asking the server…</p>
              ) : health === null ? (
                <p className="hint is-error">
                  The server did not answer this, so the table below may be this
                  device's last copy rather than the register itself.
                </p>
              ) : (
                <>
                  <p className="hint">
                    The register holds {held} report{held === 1 ? "" : "s"}
                    {oldest ? `, the oldest from ${oldest}` : ""}. Deleted ones are not
                    counted.
                  </p>
                  {!mirror.configured ? (
                    <p className="hint">
                      No sheet copy is set up, so the Dashboard tab is not being
                      updated. Every report is still in the register — the copy is a
                      convenience, never the record.
                    </p>
                  ) : mirror.queue > 0 ? (
                    <p className="hint">
                      {mirror.queue} thing{mirror.queue === 1 ? "" : "s"} still to copy
                      to the sheet. It tries again by itself every minute, so a number
                      that is falling needs nothing from you.
                    </p>
                  ) : (
                    <p className="hint">The sheet copy is up to date.</p>
                  )}
                  {/* The server's own sentence. A copy that is failing says why here
                      rather than only in a log nobody opens. */}
                  {mirror.lastError && (
                    <p className="hint is-error">The sheet last said: {mirror.lastError}</p>
                  )}
                </>
              )}
              <div className="section-foot">
                <button
                  type="button"
                  className="add"
                  onClick={readHealth}
                  disabled={healthBusy}
                >
                  {healthBusy ? "Asking…" : "Check again"}
                </button>
              </div>
            </section>

            {/* The password, changeable from here rather than from a shell.
                It sits outside the Save button on purpose: everything else on this
                page is a draft until Save, and a password that was "nearly changed"
                is the worst of both. This one commits itself, alone, immediately. */}
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">The password for this page</h2>
              </div>
              <div className="row">
                <label className="label" htmlFor="pw-now">
                  The one you use now
                </label>
                <div className="well">
                  <input
                    id="pw-now"
                    className="scheme-input"
                    type="password"
                    value={pwNow}
                    onChange={(event) => {
                      setPwNow(event.target.value);
                      setPwNote("");
                    }}
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <div className="row">
                <label className="label" htmlFor="pw-next">
                  The new one
                </label>
                <div className="well">
                  <input
                    id="pw-next"
                    className="scheme-input"
                    type="password"
                    value={pwNext}
                    onChange={(event) => {
                      setPwNext(event.target.value);
                      setPwNote("");
                    }}
                    autoComplete="new-password"
                    /* The server refuses anything longer, and a password box that
                       silently held more than could be sent would refuse a password
                       the admin believes they have set. */
                    maxLength={200}
                  />
                </div>
              </div>
              <div className="section-foot">
                {/* Ten is the server's minimum, and the line below already says so,
                    which is what makes waiting for the tenth character an answer
                    rather than a dead button. */}
                <button
                  type="button"
                  className="add"
                  onClick={changeIt}
                  disabled={pwBusy || pwNow === "" || pwNext.length < 10}
                >
                  {pwBusy ? "Changing…" : "Change it"}
                </button>
              </div>
              <p className="hint">
                {pwNote ||
                  "At least ten characters. Changing it signs every other device out — which is what to do if you ever think somebody else has it."}
              </p>
            </section>
          </div>

          <div className="column">
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Each agent, month by month</h2>
                <span className="section-note">
                  {agents.length} {agents.length === 1 ? "agent" : "agents"}
                </span>
              </div>

              {agents.length === 0 ? (
                <p className="hint">
                  {read.signedOut
                    ? "This browser has been signed out, so the register cannot be read. Reload the page and sign in again."
                    : "No reports yet, so there is nothing to chart. This reads every agent's months from the server, whichever phone they were sent from."}
                </p>
              ) : (
                <>
                  {/* The big figure on a card is what that agent brought in for the
                      month being collected — that is the question you open this page
                      with. The small line is everything up to that month. */}
                  <div className="agents">
                    {ranked.map((one) => (
                      <button
                        key={one.id}
                        type="button"
                        className={one.id === agent.id ? "agent is-on" : "agent"}
                        onClick={() => setPicked(one.id)}
                      >
                        <span className="agent-name">{one.name}</span>
                        <span className={one.mine > 0 ? "agent-total" : "agent-total is-none"}>
                          {one.mine > 0 ? `₹${formatINR(String(one.mine))}` : "—"}
                        </span>
                        <span className="agent-when">
                          in {effective.name} · ₹{formatINR(String(one.sofar.total))} to date
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="section-head chart-head">
                    <h3 className="chart-title">{agent.name}</h3>
                    <span className="section-note">
                      {SPAN} months to {effective.full} · figures in ₹
                    </span>
                  </div>

                  <AgentChart months={months} max={scale} name={agent.name} />

                  {/* The same months as exact figures — the chart is the shape,
                      this is the number you read out to someone. It stops where
                      the chart stops: with the collection pinned to July, a report
                      that counts for August is not part of July's standing. It is
                      still there to read in the register below. */}
                  <div className="sheet-wrap">
                    <table className="sheet">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <MoneyHead />
                          <th>Reports</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agent.listed.map((month) => (
                          <tr key={month.key}>
                            <td className="name-cell">{month.label}</td>
                            <Num value={month.renewal} col="renewal" />
                            <Num value={month.rd} col="rd" />
                            <Num value={month.fd} col="fd" />
                            <Num value={month.total} col="total" />
                            <td className="num c-count">{month.count}</td>
                          </tr>
                        ))}
                        {agent.listed.length === 0 && (
                          <tr>
                            <td className="name-cell">—</td>
                            <td className="empty-cell is-nil" colSpan={5}>
                              Nothing up to {effective.full}. Their later reports are in the
                              register below.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="name-cell">Total</td>
                          <Num value={agent.sofar.renewal} col="renewal" />
                          <Num value={agent.sofar.rd} col="rd" />
                          <Num value={agent.sofar.fd} col="fd" />
                          <Num value={agent.sofar.total} col="total" />
                          <td className="num c-count">{agent.sofar.reports}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Every report</h2>
                <span className="section-note">
                  {shown.length} {shown.length === 1 ? "report" : "reports"}
                  {viewKey ? ` in ${viewLabel}` : ""} · figures in ₹
                </span>
              </div>

              {/* Where these figures came from and how old they are. It re-reads
                  itself every half minute, so this line is the difference between
                  trusting the screen and reloading the page to be sure. Three
                  states, not five: a read that has just failed and a read that has
                  not happened yet leave you in the same position — looking at the
                  register as it was, whenever that was. Being signed out is the one
                  failure named separately, because waiting will not fix it. */}
              <div className="read-line">
                <span
                  className={read.from === "server" ? "read-word" : "read-word is-stale"}
                  title={read.error || undefined}
                >
                  {read.signedOut
                    ? "Signed out — reload and sign in"
                    : reading
                      ? "Reading…"
                      : read.from === "server"
                        ? `Read ${ago(read.at, now)}`
                        : read.at
                          ? `As it was ${ago(read.at, now)}`
                          : "Not read yet"}
                </span>
                <button type="button" className="mini" onClick={refresh} disabled={reading}>
                  {reading ? "Reading…" : "Refresh"}
                </button>
              </div>
              {paused && (
                <p className="hint">
                  Holding still while you finish — nothing will move under you until you
                  save, cancel or keep.
                </p>
              )}

              {/* Look back at a month that has already been collected. */}
              {monthKeys.length > 1 && (
                <div className="month-pick">
                  <label className="month-pick-label" htmlFor="view-month">
                    Showing
                  </label>
                  <select
                    id="view-month"
                    className="scheme-input month-select"
                    value={viewKey}
                    onChange={(event) => {
                      setView(event.target.value);
                      setShowAll(false);
                      setEditing("");
                      setConfirming("");
                    }}
                  >
                    <option value="">All months</option>
                    {[...monthKeys].reverse().map((key) => (
                      <option key={key} value={key}>
                        {describeKey(key)?.full || key}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {entries.length === 0 ? (
                <p className="hint">
                  Nothing yet. Every report any agent sends lands in the register and
                  shows up here, newest first.
                </p>
              ) : (
                <>
                  <div className="sheet-wrap">
                    <table className="sheet">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Month</th>
                          <MoneyHead />
                          <th className="acts">
                            <span className="sr-only">Edit or delete</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAll ? shown : shown.slice(0, 8)).map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            mode={
                              editing === entry.id
                                ? "edit"
                                : confirming === entry.id
                                  ? "confirm"
                                  : "view"
                            }
                            on={{
                              edit: () => {
                                setConfirming("");
                                setEditing(entry.id);
                              },
                              cancel: () => setEditing(""),
                              save: (patch) => applyEdit(entry.id, patch),
                              ask: () => setConfirming(entry.id),
                              keep: () => setConfirming(""),
                              remove: () => drop(entry.id),
                            }}
                          />
                        ))}
                      </tbody>
                      {/* Every report added up, whether or not the list is cut
                          short — and nothing in the Month column, which has no
                          single month to name. */}
                      <tfoot>
                        <tr>
                          <td className="name-cell">Total</td>
                          <td />
                          <Num value={sums.renewal} col="renewal" />
                          <Num value={sums.rd} col="rd" />
                          <Num value={sums.fd} col="fd" />
                          <Num value={collected} col="total" />
                          <td className="acts" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="section-foot">
                    <button type="button" className="add" onClick={() => download(shown)}>
                      {viewKey ? `Download ${viewLabel} CSV` : "Download CSV"}
                    </button>
                    {shown.length > 8 && (
                      <button type="button" className="mini" onClick={() => setShowAll(!showAll)}>
                        {showAll ? "Show fewer" : `Show all ${shown.length}`}
                      </button>
                    )}
                  </div>
                </>
              )}
              {/* What the marks mean, spelled out beside the table rather than
                  left to be guessed at. Each one names the place the change was
                  made, because that is the question a mark on a row provokes. */}
              <dl className="legend">
                <dt className="legend-mark">
                  <span aria-hidden="true">✎</span>
                </dt>
                <dd className="legend-word">corrected here, on the web</dd>
                <dt className="legend-mark">
                  <SheetMark />
                </dt>
                <dd className="legend-word">
                  edited by hand in the old Google Sheet, before it became a copy
                </dd>
                <dt className="legend-mark">
                  <span aria-hidden="true">✱</span>
                </dt>
                <dd className="legend-word">not sent yet — this device is still trying</dd>
              </dl>
              <p className="hint">
                Edit corrects the row here, Delete asks once and then takes it out of the
                register — the row is kept, so a delete can be undone. The Google Sheet is
                a copy now: editing a figure there changes nothing, and the grid mark
                stays on old rows as history.
              </p>

              {/* The bin, shut until it is asked for. A list of reports that are not in
                  the register does not belong in the eye-line of the register, and
                  deleting one is rare enough that undoing one is rarer. Read as it
                  opens and after anything moves — never on the poll, so a page left
                  open all afternoon is not asking a sleeping server about an empty
                  bin every half minute. */}
              <div className="section-foot">
                <button
                  type="button"
                  className="mini"
                  onClick={toggleBin}
                  aria-expanded={binOpen}
                >
                  {binOpen ? "Hide deleted reports" : "Deleted reports"}
                </button>
                {binOpen && (
                  <span className="section-note">
                    {binBusy
                      ? "reading…"
                      : Array.isArray(bin)
                        ? bin.length === 0
                          ? "nothing deleted"
                          : `${bin.length} can be put back`
                        : ""}
                  </span>
                )}
              </div>

              {binOpen && (
                <>
                  {/* Not the same sentence as an empty bin, because they are opposite
                      facts and only one of them means everything is fine. */}
                  {bin === null && (
                    <p className="hint is-error">
                      {binNote ||
                        "The bin could not be read. The register itself is fine — try opening it again in a moment."}
                    </p>
                  )}
                  {Array.isArray(bin) && bin.length === 0 && (
                    <p className="hint">
                      Nothing has been deleted. A report taken out of the register waits
                      here rather than being destroyed, so it can always be put back.
                    </p>
                  )}
                  {Array.isArray(bin) && bin.length > 0 && (
                    <div className="bin">
                      {bin.map((one) => (
                        <div className="held" key={one.id}>
                          <span className="held-word bin-what">
                            <b className="bin-who">{one.name}</b>
                            {/* What it was worth and when it went, so a report can be
                                recognised without putting it back to look at it. */}
                            <span className="bin-when">
                              {one.monthLabel} · ₹{formatINR(String(entryTotal(one)))} ·
                              deleted {ago(one.deletedAt, now) || "earlier"}
                            </span>
                          </span>
                          {/* Disabled for every row while any one of them is in
                              flight, not just for the row being restored: two
                              restores at once each read the register back, and the
                              second answer would land without the first in it. */}
                          <button
                            type="button"
                            className="mini"
                            onClick={() => putBack(one)}
                            disabled={putting !== "" || binBusy}
                          >
                            {putting === one.id ? "Putting back…" : "Put it back"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {binNote !== "" && bin !== null && (
                    <p className={binOk ? "hint" : "hint is-error"}>{binNote}</p>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>
      <p className="credit">Admin · /admin</p>
    </div>
  );
}

/**
 * The page, or the login, decided by the server rather than by this browser.
 *
 * Three states, and the third one is the reason this is not a boolean: until
 * /api/admin/me answers, neither the login nor the register is the right thing to
 * show. Flashing the login at somebody who is already signed in teaches them to
 * type the password into anything that asks.
 *
 * Nothing is remembered here. The old build kept "unlocked" in localStorage, which
 * meant the lock could be picked with two words in a console. Now the answer comes
 * from a cookie this page cannot read, and asking again on every load costs one
 * request.
 */
export default function AdminApp() {
  const [signedIn, setSignedIn] = useState(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const answer = await whoAmI();
      if (!alive) return;
      setSignedIn(answer.signedIn);
      setReachable(answer.reachable);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (signedIn === null) {
    return (
      <div className="app">
        <p className="credit">Asking the server…</p>
      </div>
    );
  }

  if (!signedIn) {
    return <Lock onUnlock={() => setSignedIn(true)} reachable={reachable} />;
  }

  // Signing out is the server's business too: it deletes that one session row, so
  // the cookie left in this browser stops meaning anything. Other devices stay in.
  return (
    <Panel
      onSignOut={async () => {
        await signOut();
        setSignedIn(false);
      }}
    />
  );
}
