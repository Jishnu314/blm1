// Every rule in API.md, in one file, one function per shape.
//
// Two habits worth naming, because they are deliberate and they are not the same:
//
//   Strict about identity.   An `id` is either a usable id or the request fails.
//                            POST /api/reports promises never to overwrite, and
//                            that promise is made of the id — minting a missing one
//                            here would turn an offline retry into two rows.
//   Forgiving about values.  A figure sent as "5000" becomes 5000, "yes" becomes
//                            true. The contract says money comes BACK as a number,
//                            never that a phone is punished for sending text. What
//                            leaves this server is exactly the documented type; what
//                            arrives is read as generously as it can be read
//                            without guessing.
//
// A rejection always names the field, because "invalid_input" on its own tells the
// person holding the phone nothing.

import { ApiError } from "./http.js";
import { isMonthKey } from "./month.js";

const MAX_MONEY = 999_999_999;
const MAX_ROWS = 20;

function bad(message, field = "") {
  return new ApiError("invalid_input", 400, message, field);
}

function asText(value) {
  return String(value == null ? "" : value);
}

/**
 * A whole number of rupees.
 *
 * Missing, null and "" all mean nothing was entered, which for money means zero —
 * the form leaves the renewal box empty when there is nothing to report, and 0 is
 * an allowed figure anyway, so there is no difference to preserve. Anything else
 * that is not a plain run of digits is a mistake and is said to be one.
 */
export function money(value, field, what) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "boolean") throw bad(`${what} must be a number.`, field);

  const number =
    typeof value === "number" ? value : /^\d+$/.test(asText(value).trim()) ? Number(asText(value)) : NaN;

  if (!Number.isInteger(number)) throw bad(`${what} must be a whole number of rupees.`, field);
  if (number < 0) throw bad(`${what} cannot be less than nothing.`, field);
  if (number > MAX_MONEY) throw bad(`${what} is larger than this form will take.`, field);
  return number;
}

/** A string, trimmed, no longer than `max`. */
export function line(value, field, what, max) {
  const said = asText(value).trim();
  if (said.length > max) throw bad(`${what} is longer than ${max} characters.`, field);
  return said;
}

/** true / false, and the words a spreadsheet-era client still sends. */
export function yesNo(value, field, what) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "object") throw bad(`${what} must be true or false.`, field);
  const said = asText(value).trim().toLowerCase();
  if (said === "yes" || said === "y" || said === "1" || said === "on" || said === "true") return true;
  if (said === "no" || said === "n" || said === "0" || said === "off" || said === "false" || said === "") {
    return false;
  }
  throw bad(`${what} must be true or false.`, field);
}

/** A whole number between `low` and `high`, both ends allowed. */
export function counting(value, field, what, low, high) {
  const number = typeof value === "number" ? value : Number(asText(value).trim());
  if (!Number.isInteger(number)) throw bad(`${what} must be a whole number.`, field);
  if (number < low || number > high) throw bad(`${what} must be between ${low} and ${high}.`, field);
  return number;
}

/** An id minted on a phone: up to 64 of A–Z a–z 0–9 - _ and nothing else. */
export function reportId(value, field = "id") {
  const said = asText(value).trim();
  if (said === "") throw bad("That report has no id.", field);
  if (said.length > 64) throw bad("That id is longer than 64 characters.", field);
  if (!/^[A-Za-z0-9_-]+$/.test(said)) {
    throw bad("An id may only hold letters, numbers, - and _.", field);
  }
  return said;
}

/**
 * When the report was submitted. Missing or unreadable falls back to this clock,
 * because a report with no timestamp sorts to the top of the register for ever and
 * an agent's phone with a wrong date is not a reason to refuse their figures.
 */
export function when(value) {
  const said = asText(value).trim();
  if (said !== "") {
    const at = new Date(said);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return new Date();
}

/** The RD or FD list: at most 20 rows, each an amount and an optional scheme. */
export function depositRows(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw bad("That should be a list of deposits.", field);
  if (value.length > MAX_ROWS) throw bad(`At most ${MAX_ROWS} rows here.`, field);

  return value.map((row, index) => {
    const one = row && typeof row === "object" ? row : {};
    return {
      amount: money(one.amount, `${field}[${index}].amount`, "Every amount"),
      scheme: line(one.scheme, `${field}[${index}].scheme`, "A scheme name", 80),
    };
  });
}

/**
 * The body of a report, without its id — everything PUT and POST have in common.
 * `editedIn` is not read even if it is sent: a mark the app could set is a mark the
 * app could clear, so only this server writes it.
 */
export function reportBody(raw) {
  const body = raw && typeof raw === "object" ? raw : {};

  const name = line(body.name, "name", "That name", 80);
  if (name === "") throw bad("Say who this is for.", "name");

  const month = asText(body.month).trim();
  if (!isMonthKey(month)) throw bad("The month should be written as 2026-08.", "month");

  return {
    name,
    nameKey: name.toLowerCase(),
    month,
    renewal: money(body.renewal, "renewal", "The renewal figure"),
    rd: depositRows(body.rd, "rd"),
    fd: depositRows(body.fd, "fd"),
    submittedAt: when(body.submittedAt),
  };
}

/** POST /api/reports — the same body, plus the id the phone minted. */
export function newReport(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  return { id: reportId(body.id), ...reportBody(body) };
}

/* --- settings ------------------------------------------------------------- */

const A_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * One entry per settings key, so the list here and the table in API.md can be read
 * side by side. A key that is not in this object is not a setting — it is refused
 * rather than stored, because a typo silently becoming a row nobody reads is worse
 * than being told.
 */
const SETTING_RULES = {
  // null, and "" meaning the same thing, is "work the month out from today".
  reportMonth: (value) => {
    if (value === null || value === undefined) return null;
    const said = asText(value).trim();
    if (said === "") return null;
    if (!isMonthKey(said)) throw bad("The report month should be written as 2026-08.", "reportMonth");
    return said;
  },
  graceDays: (value) => counting(value, "graceDays", "The grace days", 0, 28),
  credit: (value) => line(value, "credit", "The footer line", 80),
  open: (value) => yesNo(value, "open", "Whether collection is open"),
  message: (value) => line(value, "message", "The announcement", 500),
  showRd: (value) => yesNo(value, "showRd", "Whether the RD section shows"),
  showFd: (value) => yesNo(value, "showFd", "Whether the FD section shows"),
  autoWindow: (value) => yesNo(value, "autoWindow", "The automatic window"),
  opensOnDay: (value) => counting(value, "opensOnDay", "The opening day", 1, 31),
  closesAfterDay: (value) => counting(value, "closesAfterDay", "The closing day", 0, 31),
  popupOn: (value) => yesNo(value, "popupOn", "Whether the popup shows"),
  // Anything that is not "window" is read as "always", exactly as the contract says.
  popupMode: (value) => (asText(value).trim().toLowerCase() === "window" ? "window" : "always"),
  popupFrom: (value) => aDay(value, "popupFrom", "The popup's first day"),
  popupTo: (value) => aDay(value, "popupTo", "The popup's last day"),
  popupTitle: (value) => line(value, "popupTitle", "The popup heading", 120),
  popupText: (value) => line(value, "popupText", "The popup words", 2000),
  popupImage: (value) => pointer(value),
  boardOn: (value) => yesNo(value, "boardOn", "Whether the board shows"),
  boardTitle: (value) => line(value, "boardTitle", "The board heading", 120),
  boardPlayers: (value) => players(value),
};

function aDay(value, field, what) {
  const said = asText(value).trim();
  if (said === "") return "";
  if (!A_DAY.test(said)) throw bad(`${what} should be written as 2026-09-01.`, field);
  return said;
}

/**
 * popupImage points AT a picture; it is never the picture.
 *
 * The 50,000-character spreadsheet cell that forced "drive:ID" is gone, but the rule
 * survives it: settings travel to every agent's phone on every load, and a poster
 * inlined into them would be sent again and again. A data: URL here is a mistake
 * worth naming rather than truncating to 300 characters of nonsense.
 */
function pointer(value) {
  const said = line(value, "popupImage", "The popup picture", 300);
  if (/^data:/i.test(said)) {
    throw bad("Upload the picture first, then point at the address it gives back.", "popupImage");
  }
  return said;
}

/** The board's hand-typed list. Kept as the string, but it has to be a JSON array. */
function players(value) {
  const said = line(value, "boardPlayers", "The board list", 20_000);
  if (said === "") return "[]";
  let parsed;
  try {
    parsed = JSON.parse(said);
  } catch {
    throw bad("The board list is not readable JSON.", "boardPlayers");
  }
  if (!Array.isArray(parsed)) throw bad("The board list should be a JSON array.", "boardPlayers");
  return said;
}

/**
 * PUT /api/settings — only what changed.
 *
 * A patch, not the whole set, so two admin tabs cannot undo each other's work by
 * each sending everything they happened to be holding.
 */
export function settingsPatch(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const keys = Object.keys(body);
  if (keys.length === 0) throw bad("There was nothing to change.", "settings");

  const patch = {};
  for (const key of keys) {
    const rule = SETTING_RULES[key];
    if (!rule) throw bad(`There is no setting called "${key}".`, key);
    patch[key] = rule(body[key]);
  }
  return patch;
}

/* --- pictures ------------------------------------------------------------- */

const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/images — the data URL the browser's shrink() already produces.
 *
 * A data URL rather than multipart on purpose: the admin page has the picture as a
 * data URL in its hand already, and taking it as one means there is no upload
 * dependency in this server at all.
 *
 * The size is checked after decoding, because base64 makes everything a third
 * bigger and a limit measured on the encoded text would be a limit on nothing in
 * particular. width and height are optional: shrink() knows them, and if they are
 * sent they are kept, but nothing here tries to read them out of the bytes.
 */
export function imageInput(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const said = asText(body.data).trim();
  const parts = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(said);
  if (!parts) throw bad("That was not a picture the app had prepared.", "data");

  const mime = parts[1].toLowerCase();
  if (!MIMES.has(mime)) throw bad("Only a JPG, a PNG or a WebP can go up.", "data");

  const data = Buffer.from(parts[2], "base64");
  if (data.length === 0) throw bad("That picture came through empty.", "data");
  if (data.length > MAX_IMAGE_BYTES) {
    throw bad("That picture is over 2 MB. Shrink it and try again.", "data");
  }

  const name = line(body.name, "name", "The file name", 120) || "poster.jpg";
  const size = (value, field) =>
    value === undefined || value === null || value === "" ? null : counting(value, field, "A picture size", 1, 100_000);

  return { name, mime, bytes: data.length, width: size(body.width, "width"), height: size(body.height, "height"), data };
}

/** An image id out of a URL. Only ever digits, because the column is a bigserial. */
export function imageId(value) {
  const said = asText(value).trim();
  if (!/^\d{1,18}$/.test(said)) return 0;
  return Number(said);
}

/* --- the admin ------------------------------------------------------------ */

export function loginInput(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const password = asText(body.password);
  if (password === "") throw bad("Type the password.", "password");
  if (password.length > 200) throw bad("That is longer than any password needs to be.", "password");
  return password;
}

export function passwordChangeInput(raw) {
  const body = raw && typeof raw === "object" ? raw : {};
  const current = asText(body.current);
  const next = asText(body.next);
  if (current === "") throw bad("Type the password you use now.", "current");
  if (next.length < 10) throw bad("A new password needs at least 10 characters.", "next");
  if (next.length > 200) throw bad("That is longer than any password needs to be.", "next");
  return { current, next };
}
