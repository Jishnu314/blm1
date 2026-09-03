// Amounts are kept as a plain digit string ("125000") the whole way through the
// app. That keeps the keypad, the native keyboard and the display in sync
// without ever fighting a half-parsed number like "12." or "0012".

const MAX_DIGITS = 9; // up to 99,99,99,999

/** Strip everything that is not a digit, drop leading zeros, cap the length. */
export function toDigits(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  return trimmed.slice(0, MAX_DIGITS);
}

/** "125000" -> "1,25,000" (Indian grouping). Empty string stays empty. */
export function formatINR(digits) {
  const clean = toDigits(digits);
  if (clean === "") return "";
  return new Intl.NumberFormat("en-IN").format(Number(clean));
}

/** "125000" -> 125000. Empty string -> null, so "not entered" stays distinct from 0. */
export function toNumber(digits) {
  const clean = toDigits(digits);
  return clean === "" ? null : Number(clean);
}

export { MAX_DIGITS };
