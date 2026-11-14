export function idsObject(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    return Object.fromEntries(
      Object.entries(parsed || {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : value ? [value] : [],
      ])
    );
  } catch {
    return {};
  }
}

export function ago(iso, now = new Date()) {
  const when = new Date(String(iso || ""));
  if (Number.isNaN(when.getTime())) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - when.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  return `at ${when.getHours()}:${String(when.getMinutes()).padStart(2, "0")}`;
}

export function ordinal(day) {
  const tail = ["th", "st", "nd", "rd"];
  const rest = day % 100;
  return `${day}${tail[(rest - 20) % 10] || tail[rest] || tail[0]}`;
}

export function prettyDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return value || "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

export const rowsSum = (rows) => (rows || []).reduce((total, row) => total + (row.amount || 0), 0);
export const entryTotal = (entry) => (entry.renewal || 0) + rowsSum(entry.rd) + rowsSum(entry.fd);
export const SPAN = 6;
export const monthTotal = (agent, key) =>
  (agent.months || []).find((month) => month.key === key)?.total || 0;
