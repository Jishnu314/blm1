// Turning a pile of submitted reports into "what did each agent do, month by
// month". Pure functions over the entry shape written by lib/submit.js, so the
// same code will work on rows read back from the sheet later.

import { describeKey } from "./month.js";

const sumRows = (rows) => (rows || []).reduce((total, row) => total + (row.amount || 0), 0);

/** "Anil  Kumar" and "anil kumar" are the same agent. */
const identity = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

function blankMonth(key, label) {
  return { key, label, renewal: 0, rd: 0, fd: 0, count: 0 };
}

/** Renewal, RD, FD, the total and the number of reports across some months. */
export function sumMonths(months = []) {
  return months.reduce(
    (running, month) => ({
      renewal: running.renewal + (month.renewal || 0),
      rd: running.rd + (month.rd || 0),
      fd: running.fd + (month.fd || 0),
      total: running.total + (month.total || 0),
      reports: running.reports + (month.count || 0),
    }),
    { renewal: 0, rd: 0, fd: 0, total: 0, reports: 0 }
  );
}

/**
 * The months up to and including `endKey`, in the order they came in.
 *
 * The admin can pin the collection back to an earlier month to reopen it for a
 * late report. When they do, the whole per-agent view reads as it did at the end
 * of that month: the chart already ends there, and this is what keeps the table
 * and the totals beside it from quietly counting a later month the chart does
 * not draw. Nothing is hidden — a later month is still one pick away in the
 * register's month switcher.
 */
export function upTo(months = [], endKey = "") {
  if (!realKey.test(endKey)) return months;
  return months.filter((month) => String(month.key || "") <= endKey);
}

/**
 * One row per agent, each with their months oldest-first and their totals.
 * Two reports for the same month are added together — the count says so.
 */
export function byAgent(entries = []) {
  const agents = new Map();

  for (const entry of entries) {
    const name = String(entry.name || "").trim();
    if (!name) continue;

    const id = identity(name);
    if (!agents.has(id)) agents.set(id, { name, months: new Map() });
    const agent = agents.get(id);

    const monthKey = entry.month || "";
    const label = entry.monthLabel || describeKey(monthKey)?.full || monthKey || "—";
    const month = agent.months.get(monthKey) || blankMonth(monthKey, label);
    month.renewal += entry.renewal || 0;
    month.rd += sumRows(entry.rd);
    month.fd += sumRows(entry.fd);
    month.count += 1;
    agent.months.set(monthKey, month);
  }

  return [...agents.values()]
    .map((agent) => {
      const months = [...agent.months.values()]
        .map((month) => ({ ...month, total: month.renewal + month.rd + month.fd }))
        .sort((a, b) => a.key.localeCompare(b.key));
      return { id: identity(agent.name), name: agent.name, months, ...sumMonths(months) };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * Every agent added together: one row per month, oldest first.
 *
 * Deliberately the same shape as one agent's months, so the register's chart is
 * the very same chart as an agent's — three schemes side by side, one bar each —
 * and there is no second way of drawing a month to keep in step with the first.
 */
export function byMonth(entries = []) {
  const months = new Map();

  for (const entry of entries) {
    const key = entry.month || "";
    const label = entry.monthLabel || describeKey(key)?.full || key || "—";
    const month = months.get(key) || blankMonth(key, label);
    month.renewal += entry.renewal || 0;
    month.rd += sumRows(entry.rd);
    month.fd += sumRows(entry.fd);
    month.count += 1;
    months.set(key, month);
  }

  return [...months.values()]
    .map((month) => ({ ...month, total: month.renewal + month.rd + month.fd }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The tallest single bar in the lists actually being drawn, so every agent's
 * chart shares one scale.
 *
 * It is the tallest *scheme*, not the tallest month: the three schemes stand
 * side by side in the chart rather than stacked, so a month total is not a
 * height any bar ever reaches, and scaling to one would leave the whole plot
 * sitting low with the top quarter always empty.
 */
export function tallest(lists = []) {
  let top = 0;
  for (const months of lists) {
    for (const month of months || []) {
      top = Math.max(top, month.renewal || 0, month.rd || 0, month.fd || 0);
    }
  }
  return top;
}

const realKey = /^\d{4}-\d{2}$/;

/** The newest month key that is a real "2026-08", or "" if there is none. */
function lastRealKey(months) {
  for (let index = months.length - 1; index >= 0; index -= 1) {
    if (realKey.test(months[index].key)) return months[index].key;
  }
  return "";
}

/**
 * Exactly `count` months ending at `endKey`, oldest first.
 *
 * A fixed window is what makes the chart readable: one report then draws as one
 * bar among six named months instead of a single slab filling the card, and a
 * month nobody reported is an empty slot rather than a missing one. Months older
 * than the window still appear in the table underneath, so nothing is lost.
 */
export function monthWindow(months = [], endKey = "", count = 6) {
  const end = realKey.test(endKey) ? endKey : lastRealKey(months);
  if (!end) return months.slice(-count);

  const found = new Map(months.map((month) => [month.key, month]));
  const [endYear, endMonth] = end.split("-").map(Number);
  const slots = [];

  for (let back = count - 1; back >= 0; back -= 1) {
    let index = endMonth - 1 - back;
    let year = endYear;
    while (index < 0) {
      index += 12;
      year -= 1;
    }
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const label = describeKey(key)?.full || key;
    slots.push(found.get(key) || { ...blankMonth(key, label), total: 0 });
  }
  return slots;
}

/**
 * Every month that has at least one report, oldest first.
 *
 * This is what the admin's month switcher offers. Only months that exist are
 * listed — there is nothing to inspect in a month nobody reported, and offering
 * one would just be a way to reach an empty table.
 */
export function monthsPresent(entries = []) {
  const keys = new Set();
  for (const entry of entries) {
    if (realKey.test(String(entry.month || ""))) keys.add(entry.month);
  }
  return [...keys].sort();
}
