// The settings the admin controls, at runtime.
//
// Three layers, in order of authority:
//   1. src/config.js  — the defaults baked into the build
//   2. this device     — what was last seen or last saved, in localStorage
//   3. the server      — GET /api/settings, which is what every agent reads
//
// Layer 2 used to be the honest limit of a form with no server: a new report month
// reached only the phone it was typed on, and everything needed to fix that was
// sitting here waiting on a webhook address. It is not a layer of authority any
// more, it is a cache, and it is kept for two reasons. loadSettings() has to
// answer on the first frame without waiting for a round trip, and a phone with no
// signal has to open the form at all.
//
// So loadSettings() is synchronous and never fails, saveSettings() writes the
// cache before it tries the server — and puts it back if the server refuses the
// value — and fetchSettings() quietly improves on both a moment later.

import {
  REPORT_MONTH,
  GRACE_DAYS,
  CREDIT,
  COLLECTION_OPEN,
  FORM_MESSAGE,
  SHOW_RD,
  SHOW_FD,
  AUTO_WINDOW,
  OPENS_ON_DAY,
  CLOSES_AFTER_DAY,
  POPUP_ON,
  POPUP_MODE,
  POPUP_FROM,
  POPUP_TO,
  POPUP_TITLE,
  POPUP_TEXT,
  POPUP_IMAGE,
  BOARD_ON,
  BOARD_TITLE,
  BOARD_PLAYERS,
} from "../config.js";
import { apiGet, apiSend, isUnauthorised, isRefusal } from "./api.js";
import { serialisePlayers } from "./board.js";

const CACHE_KEY = "monthly-report/settings";

export const DEFAULTS = {
  reportMonth: REPORT_MONTH, // null = work it out from today's date
  graceDays: GRACE_DAYS,
  credit: CREDIT,
  open: COLLECTION_OPEN,
  message: FORM_MESSAGE,
  showRd: SHOW_RD,
  showFd: SHOW_FD,
  autoWindow: AUTO_WINDOW,
  opensOnDay: OPENS_ON_DAY,
  closesAfterDay: CLOSES_AFTER_DAY,
  // The popup that greets an agent. popupImage holds a pointer and never the
  // picture: "/api/images/12" for one uploaded here, a full web address, the name
  // of a file in public/ads/, or a leftover "drive:ID" from the Drive era.
  //
  // It used to be allowed to hold the picture itself — a base64 data: copy that
  // stayed on the one device — because a spreadsheet cell stops at 50,000
  // characters and a poster does not fit. That wall is gone: the bytes go to
  // POST /api/images and Postgres holds them. The rule outlives the wall it was
  // built for, and for better reasons than the wall ever was. A settings value
  // carrying its own picture would be copied into every phone's localStorage on
  // every read, would be sent back up on every save, and on the device that made
  // it would still be a poster nobody else could see.
  popupOn: POPUP_ON,
  popupMode: POPUP_MODE,
  popupFrom: POPUP_FROM,
  popupTo: POPUP_TO,
  popupTitle: POPUP_TITLE,
  popupText: POPUP_TEXT,
  popupImage: POPUP_IMAGE,
  // The game board. boardPlayers is a JSON list of hand-typed names and points —
  // about a kilobyte, so unlike a picture it rides along comfortably in the
  // settings that already travel to every agent's phone.
  boardOn: BOARD_ON,
  boardTitle: BOARD_TITLE,
  boardPlayers: BOARD_PLAYERS,
};

/**
 * How long each typed setting may be, matching `SETTING_RULES` in
 * server/src/lib/validate.js.
 *
 * They are here so the boxes on the admin page can stop at the limit rather than
 * let it be passed and have the server refuse the whole save — one long
 * announcement would take every other setting down with it, since a patch is
 * accepted or refused as one thing.
 *
 * If a limit changes on the server it changes here too. Nothing checks that they
 * agree, which is the honest weakness of keeping the same number in two places; the
 * alternative was the page asking the server what its own limits are, and that is a
 * round trip and a cache for something that changes once a year.
 */
export const LIMITS = {
  credit: 80,
  message: 500,
  popupTitle: 120,
  popupText: 2000,
  popupImage: 300,
  boardTitle: 120,
};

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(settings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode: the form still runs on the baked-in defaults.
  }
}

/** Synchronous, safe to call during the first render. */
export function loadSettings() {
  return { ...DEFAULTS, ...readCache() };
}

/**
 * On can be said in several ways, and it still can be.
 *
 * The server sends real JSON booleans now, so `value === true` answers almost
 * every call. Everything after that line is for the settings row that came out of
 * the old Settings tab, where the cells were meant to be typed into by hand and
 * held the words: "yes" and "no", or 1 and 0 in an older sheet, or "on" or "TRUE"
 * from somebody in a hurry. All of them read as on. Anything else at all is off,
 * which means an empty cell is off and a typo is off — never quietly on.
 */
export const flag = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  const said = String(value == null ? "" : value).trim().toLowerCase();
  return said === "yes" || said === "y" || said === "1" || said === "on" || said === "true";
};

/**
 * Read a settings object the server sent, key by key, into what the app holds.
 * Anything the server did not mention is left exactly as it was here.
 *
 * The types are asserted rather than trusted, which is worth the lines: API.md
 * promises every key and the right type on every answer, and the server keeps
 * that promise — but a payload believed is how a total quietly becomes a string,
 * and this same reader has to cope with a settings row first typed into a
 * spreadsheet by hand.
 */
function absorb(given, here) {
  const sent = given && typeof given === "object" ? given : {};
  const said = (key) => sent[key] !== undefined;
  return {
    ...here,
    ...(said("reportMonth") ? { reportMonth: sent.reportMonth || null } : {}),
    ...(said("graceDays") ? { graceDays: Number(sent.graceDays) } : {}),
    ...(said("credit") ? { credit: String(sent.credit) } : {}),
    ...(said("open") ? { open: flag(sent.open) } : {}),
    ...(said("message") ? { message: String(sent.message) } : {}),
    ...(said("showRd") ? { showRd: flag(sent.showRd) } : {}),
    ...(said("showFd") ? { showFd: flag(sent.showFd) } : {}),
    ...(said("autoWindow") ? { autoWindow: flag(sent.autoWindow) } : {}),
    ...(said("opensOnDay") ? { opensOnDay: Number(sent.opensOnDay) } : {}),
    ...(said("closesAfterDay") ? { closesAfterDay: Number(sent.closesAfterDay) } : {}),
    ...(said("popupOn") ? { popupOn: flag(sent.popupOn) } : {}),
    ...(said("popupMode")
      ? { popupMode: sent.popupMode === "window" ? "window" : "always" }
      : {}),
    ...(said("popupFrom") ? { popupFrom: String(sent.popupFrom || "") } : {}),
    ...(said("popupTo") ? { popupTo: String(sent.popupTo || "") } : {}),
    ...(said("popupTitle") ? { popupTitle: String(sent.popupTitle || "") } : {}),
    ...(said("popupText") ? { popupText: String(sent.popupText || "") } : {}),
    // Taken as sent, with no guard keeping a local copy alive: the picture is on
    // the server now, so an empty popupImage means the admin cleared it and every
    // agent should see it cleared.
    ...(said("popupImage") ? { popupImage: String(sent.popupImage || "") } : {}),
    ...(said("boardOn") ? { boardOn: flag(sent.boardOn) } : {}),
    ...(said("boardTitle") ? { boardTitle: String(sent.boardTitle || "") } : {}),
    // Kept as the string it arrived as; parsePlayers reads it wherever it is used,
    // and an unreadable list is an empty board rather than a crash.
    ...(said("boardPlayers") ? { boardPlayers: String(sent.boardPlayers || "[]") } : {}),
  };
}

/**
 * Save what the admin changed.
 * Returns { ok, synced, refused, note, field, settings, unauthorised }.
 *
 * Only the patch is sent, never the merged whole. That is what stops a page that
 * has been open since breakfast from pushing twenty stale keys back over a change
 * made from another device at ten — it can only overwrite what it actually
 * touched. The server merges and answers with the full set, and what comes back is
 * held as the truth rather than guessed at, so this page never has to work out
 * what the merge did.
 *
 * The local cache is written first, before the call, and that order is the point:
 * a save has to show on screen at once, and a save that could not be sent is still
 * what this admin wants to be looking at.
 *
 * Except when the server refuses it. That is the case this function used to get
 * wrong, and it got it wrong twice over: a 400 was reported as "could not be
 * reached", and the value the server had just rejected was left sitting in
 * localStorage where loadSettings() would hand it back on the next load as though
 * it were current. The form would then run on a setting the register does not have
 * and nobody would be told. So a refusal puts the cache back exactly as it was and
 * hands over the server's own sentence to be shown.
 *
 * The three outcomes, then:
 *
 *   synced:true                 the register has it. `settings` is the server's
 *                               full set, merged by the server.
 *   synced:false                it could not be sent. The cache holds the change,
 *                               the screen shows it, and it is this admin's to try
 *                               again. NOT queued — unlike a report, a setting has
 *                               no outbox: the newest value is the only one that
 *                               matters and re-pressing Save is the retry.
 *   refused:true                the server said no. Nothing changed anywhere,
 *                               including here. `note` says why and `field` names
 *                               the control.
 */
export async function saveSettings(patch) {
  const sending = { ...patch };
  // boardPlayers leaves here as a JSON string whichever way the admin page held
  // it — an array would arrive as an array and be refused as the wrong type.
  if (sending.boardPlayers !== undefined) {
    sending.boardPlayers = serialisePlayers(sending.boardPlayers);
  }
  // Held so a refusal can be undone. Read before the write, not after.
  const before = loadSettings();
  const next = { ...before, ...sending };
  writeCache(next);
  try {
    const data = await apiSend("PUT", "/api/settings", { settings: sending });
    const settings = absorb(data?.settings, next);
    writeCache(settings);
    return {
      ok: true,
      synced: true,
      refused: false,
      note: "",
      field: "",
      settings,
      unauthorised: false,
    };
  } catch (problem) {
    if (isRefusal(problem)) {
      writeCache(before);
      return {
        ok: false,
        synced: false,
        refused: true,
        note: String(problem.message || "The server would not accept that."),
        field: String(problem.field || ""),
        settings: before,
        unauthorised: false,
      };
    }
    return {
      ok: true,
      synced: false,
      refused: false,
      note: "",
      field: "",
      settings: next,
      unauthorised: isUnauthorised(problem),
    };
  }
}

/**
 * Ask the server what the settings are. Returns them, or null if it could not be
 * reached — in which case the caller keeps what loadSettings() already gave it.
 *
 * Public, deliberately. An agent's phone needs the month, the notice and the
 * board, and this is the one thing shaped like the register that it may read.
 */
export async function fetchSettings() {
  try {
    const data = await apiGet("/api/settings");
    const next = absorb(data?.settings, loadSettings());
    writeCache(next);
    return next;
  } catch {
    return null;
  }
}

