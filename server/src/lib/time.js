/** SQLite stores timestamps as text. Always hand ISO-8601 to callers. */
export function asIso(value) {
  if (!value) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  const text = String(value);
  const parsed = text.includes("T") ? new Date(text) : new Date(text.replace(" ", "T") + "Z");
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

export function nowIso() {
  return new Date().toISOString();
}

export function laterIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}
