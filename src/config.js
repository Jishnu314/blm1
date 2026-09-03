// The defaults baked into the build.
//
// This file used to BE the admin screen — edit it and restart the app. It is not
// that any more. Every value here is a starting point: the admin page writes what
// it changes to the server (PUT /api/settings), the server is what every agent's
// phone reads, and a value that has been changed there is the one that wins.
//
// So editing this file changes what a browser sees before it has heard from the
// server, and nothing else. That is still worth having — the form renders on the
// first frame and works with no signal — but it is all it is.

/**
 * Which month the form is collecting for.
 *
 *   null       — work it out automatically (see GRACE_DAYS below)
 *   "2026-08"  — pin it to August 2026, no matter what today's date is
 *
 * Pin it whenever you are collecting late, or reopening a closed month.
 */
export const REPORT_MONTH = null;

/**
 * Collection runs across the month boundary: the August report is filled in
 * between about 31 August and 5 September. So for the first few days of a
 * month, the month being reported is the PREVIOUS one. Day 1 up to and
 * including this day counts as last month.
 */
export const GRACE_DAYS = 7;

/** Shown at the foot of the form. */
export const CREDIT = "Jishnu · SLIA";

/** One line shown to agents above the questions. Empty means nothing is shown. */
export const FORM_MESSAGE = "";

/** Which optional sections the form offers this month. */
export const SHOW_RD = true;
export const SHOW_FD = true;

/**
 * The collection window, for when you would rather not remember to open and
 * close the form by hand.
 *
 * Off by default. Turned on, the form accepts reports from OPENS_ON_DAY of one
 * month up to and including CLOSES_AFTER_DAY of the next — 28 to 7 covers the
 * "31 August to 5 September" run — and shows the closed notice in between.
 * A pinned REPORT_MONTH ignores the window, so pinning is how you reopen a
 * month late.
 */
export const AUTO_WINDOW = false;
export const OPENS_ON_DAY = 28;
export const CLOSES_AFTER_DAY = 7;

/** Collection can be closed once the month is tallied. Admin can flip this. */
export const COLLECTION_OPEN = true;

/**
 * The popup that greets an agent when they open the form — a picture, a heading,
 * a few words, or any two of the three. Empty of all three and nothing pops up,
 * whatever the switch says.
 *
 * POPUP_MODE decides when it stops:
 *   "always"  — it keeps showing until you turn POPUP_ON off yourself
 *   "window"  — it is live from POPUP_FROM to POPUP_TO and closes itself after
 *
 * Dates are plain "YYYY-MM-DD", and both ends count as live days.
 *
 * POPUP_IMAGE takes any of four things, and never the picture itself:
 *   ""                        nothing — the popup is words only
 *   "poster-aug.jpg"          a file you dropped in public/ads/
 *   "https://…/poster.jpg"    a picture already on the web
 *   "/api/images/12"          one uploaded from the admin page, which is what an
 *                             upload becomes now. ("drive:1AbC…" is what it used
 *                             to become, and still resolves.)
 */
export const POPUP_ON = false;
export const POPUP_MODE = "always";
export const POPUP_FROM = "";
export const POPUP_TO = "";
export const POPUP_TITLE = "";
export const POPUP_TEXT = "";
export const POPUP_IMAGE = "";

/**
 * The game board: who is winning this month.
 *
 * The names and the points are TYPED BY HAND in the admin — they are never worked
 * out from the reports. That is deliberate: the board says what you decide it
 * says, the same way it works in the FORM app.
 *
 * BOARD_PLAYERS is a JSON list, because that is how it travels in one settings
 * cell to every phone:
 *
 *   [{"name":"Anil","points":142000},{"name":"Beena","points":142000}]
 *
 * Most points first, and equal points share a place — two people level at the top
 * are both first, both take a gold, and the next one is third. The top three
 * stand on the podium; however many more you type are behind "See all N".
 *
 * BOARD_TITLE is the heading over it. Left empty it reads "Top performers".
 */
export const BOARD_ON = false;
export const BOARD_TITLE = "";
export const BOARD_PLAYERS = "[]";

