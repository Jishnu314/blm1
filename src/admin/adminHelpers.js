// Small pure helpers and constants used by the admin page. Moved out of AdminApp.jsx.
import { MONTHS } from "../lib/month.js";
import { parsePlayers, serialisePlayers } from "../lib/board.js";
import { nextRowId } from "../lib/rows.js";


/**
 * How often the register asks the server again.
 *
 * Half a minute is short enough that a report an agent sends appears while you are
 * still looking at the page, and long enough that leaving this page open all day is
 * a couple of thousand reads rather than a couple of hundred thousand. The poll
 * stops entirely while a row is open for editing — see the effect below.
 */
export const POLL_MS = 30000;

/** "2026-09-15" → "15 September 2026". Half-typed dates come back untouched. */
export function prettyDate(value) {
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
export function popupLine(state, popup) {
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
export const POPUP_WORD = {
  off: "off",
  empty: "nothing in it",
  waiting: "not started",
  ended: "finished",
  live: "showing",
};

/** The same, for the board. "empty" is on but holding nobody. */
export const BOARD_WORD = {
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
export const blankPlayer = (rows = []) => ({ id: nextRowId(rows, "p"), name: "", points: "" });

/** Saved settings -> editable rows. */
export const playerRows = (raw) =>
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
export function changedOnly(now, was = {}) {
  const patch = {};
  for (const key of Object.keys(now)) {
    const canonical = (value) => (key === "boardPlayers" ? serialisePlayers(value) : value);
    const mine = canonical(now[key]);
    if (mine !== canonical(was[key])) patch[key] = mine;
  }
  return patch;
}
