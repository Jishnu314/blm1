// The settings, which are the only thing the form reads and the only thing the admin
// changes that every agent's phone sees at once.
//
// They are stored as text, one row per key, and cast on the way out. That is a
// deliberate trade: the table can be looked at and typed into like the Settings tab
// it replaces, a new setting is a new row rather than a migration, and the cost is
// that every read has to say what type it wanted. It says so here, once.
//
// GET /api/settings always answers with every key at the right type, even on an empty
// database, because the form should not have to carry a second copy of the defaults
// to fall back on.

import { query, tx } from "../db.js";
import { isMonthKey } from "../lib/month.js";
import { enqueue, kick } from "./mirror.js";

/** The same words the sheet accepts, so a tab set up before this still reads right. */
const flag = (text) => {
  const said = String(text || "").trim().toLowerCase();
  return said === "yes" || said === "y" || said === "1" || said === "on" || said === "true";
};

const whole = (text, low, high, fallback) => {
  const number = Number(String(text || "").trim());
  if (!Number.isInteger(number) || number < low || number > high) return fallback;
  return number;
};

const A_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every key, its default, and how its text becomes its type.
 *
 * The defaults match src/config.js, so a fresh database behaves exactly like the
 * build did before there was a server. A stored value that has gone bad — somebody
 * typed a word into graceDays — falls back to the default rather than reaching the
 * form as NaN.
 */
const KEYS = {
  // null means "work the month out from today", which is what the form does with it.
  reportMonth: { fallback: null, read: (text) => (isMonthKey(text) ? text : null) },
  graceDays: { fallback: 7, read: (text) => whole(text, 0, 28, 7) },
  credit: { fallback: "Jishnu · SLIA", read: (text) => text },
  open: { fallback: true, read: flag },
  message: { fallback: "", read: (text) => text },
  showRd: { fallback: true, read: flag },
  showFd: { fallback: true, read: flag },
  autoWindow: { fallback: false, read: flag },
  opensOnDay: { fallback: 28, read: (text) => whole(text, 1, 31, 28) },
  closesAfterDay: { fallback: 7, read: (text) => whole(text, 0, 31, 7) },
  popupOn: { fallback: false, read: flag },
  popupMode: { fallback: "always", read: (text) => (text === "window" ? "window" : "always") },
  popupFrom: { fallback: "", read: (text) => (A_DAY.test(text) ? text : "") },
  popupTo: { fallback: "", read: (text) => (A_DAY.test(text) ? text : "") },
  popupTitle: { fallback: "", read: (text) => text },
  popupText: { fallback: "", read: (text) => text },
  // Always a pointer: "", "/api/images/12", a web address, or an old "drive:ID".
  popupImage: { fallback: "", read: (text) => text },
  boardOn: { fallback: false, read: flag },
  boardTitle: { fallback: "", read: (text) => text },
  // Kept as the JSON string it arrived as; whoever draws the board parses it, and an
  // unreadable list is an empty board rather than a crash.
  boardPlayers: { fallback: "[]", read: (text) => (text === "" ? "[]" : text) },
};

/** Anything, as the one text column. null and undefined are both "nothing". */
function store(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** The rows of the table, as the settings object. A key with no row keeps its default. */
function cast(rows) {
  const held = new Map(rows.map((row) => [row.key, row.value]));
  const settings = {};
  for (const [key, rule] of Object.entries(KEYS)) {
    settings[key] = held.has(key) ? rule.read(String(held.get(key) ?? "")) : rule.fallback;
  }
  return settings;
}

/** Every setting, every time, at the right type. */
export async function readSettings() {
  const { rows } = await query(`select key, value from settings`);
  return cast(rows);
}

/**
 * Save what changed, and answer with the whole set afterwards, so the admin page can
 * hold what came back and never has to guess what the merge did.
 *
 * The sheet copy carries the full set rather than the patch, because writeSettings_
 * in Code.gs writes the keys it is given and the tab should always end up matching
 * what this server holds.
 */
export async function writeSettings(patch) {
  const settings = await tx(async (client) => {
    for (const [key, value] of Object.entries(patch)) {
      await client.query(
        `insert into settings (key, value)
              values ($1, $2)
         on conflict (key) do update
                 set value = excluded.value,
                     updated_at = now()`,
        [key, store(value)]
      );
    }

    const { rows } = await client.query(`select key, value from settings`);
    const after = cast(rows);
    await enqueue(client, "settings", "", JSON.stringify(after));
    return after;
  });

  kick();
  return settings;
}
