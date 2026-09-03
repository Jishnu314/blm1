// A month is "2026-08", and the words are worked out from it — never stored.
//
// This is the same rule the browser follows in src/lib/month.js, and it exists
// because a spreadsheet does not keep what you typed: put "August 2026" in a cell
// and it stores 1 August 2026 as a date, so reading that cell back as text gives
// "Sat Aug 01 2026 00:00:00 GMT+0530 (India Standard Time)". That string reached the
// register once and was printed as the month.
//
// So: the API only ever accepts and returns the key, the label is built here when
// the sheet copy needs one, and monthKeyOf() is the funnel every doubtful value
// from the old sheet goes through on the way in.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Exactly "YYYY-MM", with a real month number in it. Nothing else passes. */
export function isMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value == null ? "" : value));
}

const MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/**
 * Whatever a sheet cell handed over, back to "2026-08". "" when it is not a month.
 *
 * The month name and the year are read out of the words rather than by parsing a
 * date, because a date is an instant and an instant belongs to two different days
 * depending on where you stand: midnight on 1 August in India is still 31 July in
 * London, and that reads back as July.
 *
 * An ISO stamp ("2026-08-31T10:22:00Z") is caught by the first branch, which is
 * why a row whose Month column is empty but whose Submitted at is not can still be
 * placed in a month.
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
  const index = MONTHS.findIndex(
    (name) => name.slice(0, 3).toLowerCase() === word[1].toLowerCase()
  );
  if (index < 0) return "";
  return `${year[1]}-${String(index + 1).padStart(2, "0")}`;
}

/**
 * "2026-08" → "August 2026". "" for anything that is not a month.
 *
 * Only the sheet copy uses this: Code.gs has a "Month label" column and the
 * Dashboard reads it, so the label is built at the moment of sending rather than
 * kept anywhere.
 */
export function monthLabel(key) {
  const bits = /^(\d{4})-(\d{2})$/.exec(String(key == null ? "" : key));
  if (!bits) return "";
  const index = Number(bits[2]) - 1;
  if (!(index >= 0 && index < 12)) return "";
  return `${MONTHS[index]} ${bits[1]}`;
}
