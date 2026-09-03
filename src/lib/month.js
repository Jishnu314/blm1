import { REPORT_MONTH, GRACE_DAYS, AUTO_WINDOW, OPENS_ON_DAY, CLOSES_AFTER_DAY } from "../config.js";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The four shapes of one month, from a year and a 0-11 index.
 *
 * `year` may be a number or the four digits as a string — describeKey passes the
 * digits it matched so that nothing is lost on the way through, and every field
 * here is built by interpolation, which treats the two the same.
 */
function describe(year, monthIndex) {
  return {
    // "2026-08" — sorts correctly and is easy to group by in a sheet
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    name: MONTHS[monthIndex],
    year: String(year),
    full: `${MONTHS[monthIndex]} ${year}`,
  };
}

/**
 * "2026-08" → { key, name, year, full }, or null if it is not a real month.
 *
 * The year has to be four digits, and that is the whole reason this reads the key
 * with a pattern instead of splitting it on the dash. A year box on its way to
 * 2026 holds "2", then "20", then "202", and every one of those is a perfectly
 * good number: the split accepted 202 and handed back a month whose key was
 * "202-09". The register takes YYYY-MM and nothing else, so that key came back
 * refused — and sent as part of a settings patch it took the other twenty settings
 * down with it, because a patch is accepted or refused as one thing. Half a year
 * is not a month yet. It is null, and the caller keeps whatever it already had.
 *
 * The month is still read forgivingly — "2026-8" describes August — because the
 * key is rebuilt here rather than passed through, so an unpadded month out of the
 * old sheet comes back padded instead of refused. The year is passed on as the
 * digits given rather than as a number, so a key that arrived with a leading zero
 * leaves with it.
 */
export function describeKey(key) {
  const bits = /^(\d{4})-(\d{1,2})$/.exec(String(key == null ? "" : key).trim());
  if (!bits) return null;
  const month = Number(bits[2]);
  if (!(month >= 1 && month <= 12)) return null;
  return describe(bits[1], month - 1);
}

const MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/**
 * Whatever a spreadsheet cell handed us, back to "2026-08".
 *
 * A sheet does not keep what you typed. Type `August 2026` or `2026-08` into a
 * cell and it stores 1 August 2026 as a *date*, so reading it as text gives
 * "Sat Aug 01 2026 00:00:00 GMT+0530 (India Standard Time)". That string was
 * appearing in the register.
 *
 * The month name and the year are read straight out of the words rather than by
 * parsing a date, because a date is an instant and an instant belongs to two
 * different days depending on where you stand: midnight on 1 August in India is
 * still 31 July in London, and that reads back as July.
 */
export function monthKeyOf(value) {
  const text = String(value == null ? "" : value).trim().replace(/^'/, "");
  const plain = /^(\d{4})-(\d{1,2})/.exec(text);
  if (plain) {
    const month = Number(plain[2]);
    if (month >= 1 && month <= 12) return `${plain[1]}-${String(month).padStart(2, "0")}`;
    return "";
  }

  const word = MONTH_WORD.exec(text);
  const year = /\b(\d{4})\b/.exec(text);
  if (!word || !year) return "";
  const index = MONTHS.findIndex((name) => name.slice(0, 3).toLowerCase() === word[1].toLowerCase());
  if (index < 0) return "";
  return `${year[1]}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * The month being reported — not necessarily the month we are standing in.
 * Reports are collected across the boundary (August's figures come in around
 * 31 Aug to 5 Sep), so the first `graceDays` days of a month still belong to the
 * month before. A pinned month overrides all of this.
 *
 * Settings come from the admin at runtime; config.js supplies the fallback.
 */
export function reportMonth(now = new Date(), settings = {}) {
  const pinned = settings.reportMonth !== undefined ? settings.reportMonth : REPORT_MONTH;
  if (pinned) {
    const described = describeKey(pinned);
    if (described) return described;
  }

  const graceDays = Number.isFinite(Number(settings.graceDays))
    ? Number(settings.graceDays)
    : GRACE_DAYS;

  let year = now.getFullYear();
  let monthIndex = now.getMonth();
  if (now.getDate() <= graceDays) {
    monthIndex -= 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
  }
  return describe(year, monthIndex);
}

const pick = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/**
 * Is the form accepting reports right now?
 *
 * The master switch wins: if the admin closed collection, it is closed. Past
 * that, with the window turned on the form is open from `opensOnDay` of one
 * month through `closesAfterDay` of the next — the days figures actually arrive
 * in — and closed in the quiet middle of the month. A pinned month is a
 * deliberate reopening, so it ignores the window.
 */
export function isCollectionOpen(now = new Date(), settings = {}) {
  if (settings.open === false) return false;

  const auto = settings.autoWindow !== undefined ? settings.autoWindow : AUTO_WINDOW;
  if (!auto) return true;

  const pinned = settings.reportMonth !== undefined ? settings.reportMonth : REPORT_MONTH;
  if (pinned) return true;

  const from = pick(settings.opensOnDay, OPENS_ON_DAY);
  const until = pick(settings.closesAfterDay, CLOSES_AFTER_DAY);
  const day = now.getDate();
  return day >= from || day <= until;
}
