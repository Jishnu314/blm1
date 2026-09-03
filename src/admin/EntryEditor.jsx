import { useState } from "react";
import { toDigits, formatINR, toNumber } from "../lib/currency.js";
import { MONTHS, describeKey } from "../lib/month.js";
import { blankRow, MAX_DEPOSIT_ROWS, MAX_NAME, MAX_SCHEME } from "../lib/rows.js";

/**
 * Stored rows ({ amount, scheme }) become editable rows (digit strings).
 *
 * The ids are the row's own position, so opening the same report twice gives the
 * same ids and no counter is kept anywhere. See src/lib/rows.js for why a counter
 * beside the component was a bug rather than a style.
 */
const toRows = (rows = []) =>
  rows.map((row, index) => ({
    id: `e${index + 1}`,
    digits: String(row.amount || ""),
    scheme: row.scheme || "",
  }));

/** …and back again, dropping any row left empty. */
const fromRows = (rows) =>
  rows
    .filter((row) => row.digits !== "" || row.scheme.trim() !== "")
    .map((row) => ({ amount: toNumber(row.digits) || 0, scheme: row.scheme.trim() }));

const sum = (rows) => rows.reduce((total, row) => total + (toNumber(row.digits) || 0), 0);

/**
 * One deposit being corrected: scheme, amount, and the × that drops it.
 *
 * The same two limits the agent's own form keeps — 80 characters of scheme name,
 * twenty rows — because the register applies them to a correction exactly as it
 * applies them to a report. A correction refused costs more than a report refused:
 * the admin has already retyped the figures from somebody's message.
 */
function Lines({ title, kind, short, rows, setRows }) {
  const change = (id, patch) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const full = rows.length >= MAX_DEPOSIT_ROWS;

  return (
    <div className="row">
      <span className={`label key key-${kind}`}>{title}</span>
      {rows.map((row, index) => (
        <div className="line" key={row.id}>
          <div className="well">
            <input
              className="scheme-input"
              value={row.scheme}
              onChange={(event) => change(row.id, { scheme: event.target.value })}
              placeholder="Scheme name"
              autoComplete="off"
              maxLength={MAX_SCHEME}
              aria-label={`${short} ${index + 1} scheme name`}
            />
          </div>
          <div className="well">
            <input
              className="scheme-input line-amount"
              value={formatINR(row.digits)}
              onChange={(event) => change(row.id, { digits: toDigits(event.target.value) })}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              aria-label={`${short} ${index + 1} amount`}
            />
          </div>
          <button
            type="button"
            className="drop"
            onClick={() => setRows(rows.filter((one) => one.id !== row.id))}
            aria-label={`Remove ${short} ${index + 1}`}
          >
            ×
          </button>
        </div>
      ))}
      {/* Replaced by the reason rather than greyed out, as on the agent's form. */}
      {full ? (
        <p className="hint">
          {MAX_DEPOSIT_ROWS} is the most {short} rows one report can carry.
        </p>
      ) : (
        <button
          type="button"
          className="mini"
          onClick={() => setRows([...rows, blankRow(rows, "e")])}
        >
          + Add {short}
        </button>
      )}
    </div>
  );
}

/**
 * The admin correcting one report in place: name, month, renewal and every
 * deposit line. Nothing is written until Save changes is pressed, so Cancel is
 * always safe.
 */
export default function EntryEditor({ entry, onSave, onCancel }) {
  const from = describeKey(entry.month) || { name: MONTHS[0], year: String(new Date().getFullYear()) };

  const [name, setName] = useState(entry.name || "");
  const [digits, setDigits] = useState(String(entry.renewal || ""));
  const [monthIndex, setMonthIndex] = useState(Math.max(0, MONTHS.indexOf(from.name)));
  const [year, setYear] = useState(String(from.year));
  const [rd, setRd] = useState(toRows(entry.rd));
  const [fd, setFd] = useState(toRows(entry.fd));

  const total = (toNumber(digits) || 0) + sum(rd) + sum(fd);
  // An empty year box means "leave the year as it was", not year zero.
  const monthKey = `${Number(year) || from.year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const described = describeKey(monthKey);
  // A year still being typed — "202" — is not a month the register will take, and
  // it must not be quietly rounded back to the month the report already had
  // either: the admin would press Save, hear nothing, and find the month
  // unchanged. So Save waits, and the line under the year box says what for.
  const monthOk = described !== null;

  function submit() {
    // Save is already disabled for this. The guard stays because a disabled button
    // is what the admin sees and this is what makes it true.
    if (!monthOk) return;
    onSave({
      name: name.trim() || entry.name,
      renewal: toNumber(digits) || 0,
      rd: fromRows(rd),
      fd: fromRows(fd),
      month: described.key,
      monthLabel: described.full,
    });
  }

  return (
    <div className="editor">
      <div className="row">
        <label className="label" htmlFor={`name-${entry.id}`}>
          Name
        </label>
        <div className="well">
          <input
            id={`name-${entry.id}`}
            className="scheme-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            maxLength={MAX_NAME}
          />
        </div>
      </div>

      <div className="row">
        <label className="label" htmlFor={`month-${entry.id}`}>
          Month it counts for
        </label>
        <div className="pair">
          <div className="well">
            <select
              id={`month-${entry.id}`}
              className="scheme-input"
              value={monthIndex}
              onChange={(event) => setMonthIndex(Number(event.target.value))}
            >
              {MONTHS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="well">
            <input
              className="scheme-input"
              value={year}
              onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              aria-label="Year"
            />
          </div>
        </div>
        {!monthOk && (
          <p className="hint is-error">
            Type all four digits of the year — the register only takes a month
            written as 2026-08.
          </p>
        )}
      </div>

      <div className="row">
        <label className="label key key-renewal" htmlFor={`renewal-${entry.id}`}>
          Renewal
        </label>
        <div className="well">
          <input
            id={`renewal-${entry.id}`}
            className="scheme-input line-amount"
            value={formatINR(digits)}
            onChange={(event) => setDigits(toDigits(event.target.value))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
          />
        </div>
      </div>

      <Lines title="New RD" kind="rd" short="RD" rows={rd} setRows={setRd} />
      <Lines title="New FD" kind="fd" short="FD" rows={fd} setRows={setFd} />

      <div className="editor-foot">
        <button type="button" className="add" onClick={submit} disabled={!monthOk}>
          Save changes
        </button>
        <button type="button" className="mini" onClick={onCancel}>
          Cancel
        </button>
        <span className="section-total">
          total <strong>₹{formatINR(String(total)) || "0"}</strong>
        </span>
      </div>
    </div>
  );
}
