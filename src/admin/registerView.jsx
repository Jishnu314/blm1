import { formatINR } from "../lib/currency.js";
import { marksOf } from "../lib/entries.js";
import { entryTotal, rowsSum } from "./format.js";
import EntryEditor from "./EntryEditor.jsx";

function Nil() {
  return (
    <>
      <span aria-hidden="true">×</span>
      <span className="sr-only">nothing</span>
    </>
  );
}

export function Num({ value, col }) {
  return (
    <td className={value > 0 ? `num c-${col}` : `num c-${col} is-nil`}>
      {value > 0 ? formatINR(String(value)) : <Nil />}
    </td>
  );
}

export function MoneyHead() {
  return (
    <>
      <th className="c-renewal">
        <span className="key key-renewal">Renewal</span>
      </th>
      <th className="c-rd">
        <span className="key key-rd">New RD</span>
      </th>
      <th className="c-fd">
        <span className="key key-fd">New FD</span>
      </th>
      <th className="c-total">Total</th>
    </>
  );
}

export function Deposits({ rows, col, kind }) {
  const list = (rows || []).filter(
    (row) => (row.amount || 0) > 0 || String(row.scheme || "").trim() !== ""
  );
  if (list.length === 0) {
    return (
      <td className={`num c-${col} is-nil`}>
        <Nil />
      </td>
    );
  }

  return (
    <td className={`num c-${col}`}>
      <span className="deps">
        {list.map((row, index) => (
          <span className="dep" key={index}>
            <em className="dep-name" title={row.scheme || ""}>
              {String(row.scheme || "").trim() || "—"}
            </em>
            <b className="dep-num">{formatINR(String(row.amount || 0))}</b>
          </span>
        ))}
        {list.length > 1 && (
          <span className="dep is-sum">
            <em className="dep-name">
              {list.length} {kind}s
            </em>
            <b className="dep-num">{formatINR(String(rowsSum(rows)))}</b>
          </span>
        )}
      </span>
    </td>
  );
}

export function SheetMark() {
  return (
    <svg
      className="flag-grid"
      viewBox="0 0 12 12"
      width="11"
      height="11"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1.6" width="10" height="8.8" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1 4.9h10M5.2 4.9v5.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function Marks({ entry }) {
  const marks = marksOf(entry);
  if (marks.length === 0) return null;
  return (
    <>
      {marks.includes("web") && (
        <span className="flag" title="Last corrected here, on the web">
          <span aria-hidden="true">✎</span>
          <span className="sr-only">corrected on the web</span>
        </span>
      )}
      {marks.includes("sheet") && (
        <span className="flag" title="Was edited by hand in the old Google Sheet">
          <SheetMark />
          <span className="sr-only">edited in the old sheet</span>
        </span>
      )}
      {marks.includes("pending") && (
        <span className="flag" title="Not sent yet — this device is still trying">
          <span aria-hidden="true">✱</span>
          <span className="sr-only">not sent yet</span>
        </span>
      )}
    </>
  );
}

export function EntryRow({ entry, mode, on }) {
  if (mode === "edit") {
    return (
      <tr className="is-editing">
        <td className="edit-cell" colSpan={7}>
          <EntryEditor entry={entry} onSave={on.save} onCancel={on.cancel} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="name-cell">
        {entry.name}
        <Marks entry={entry} />
      </td>
      <td className="month-cell">{entry.monthLabel}</td>
      <Num value={entry.renewal || 0} col="renewal" />
      <Deposits rows={entry.rd} col="rd" kind="RD" />
      <Deposits rows={entry.fd} col="fd" kind="FD" />
      <Num value={entryTotal(entry)} col="total" />
      <td className="acts">
        {mode === "confirm" ? (
          <>
            <button type="button" className="mini is-danger" onClick={on.remove}>
              Delete it
            </button>
            <button type="button" className="mini" onClick={on.keep}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" className="mini" onClick={on.edit}>
              Edit
            </button>
            <button type="button" className="mini" onClick={on.ask}>
              Delete
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function toCsv(entries) {
  const head = [
    "submittedAt", "month", "name", "renewal", "total",
    "rdCount", "rdTotal", "rdDetail", "fdCount", "fdTotal", "fdDetail",
    "editedAt", "editedIn", "stored",
  ];
  const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const detail = (rows) => (rows || []).map((row) => `${row.scheme} ${row.amount || 0}`).join(" | ");

  const lines = [head.join(",")];
  for (const entry of entries) {
    lines.push([
      entry.submittedAt, entry.month, entry.name, entry.renewal,
      entryTotal(entry),
      (entry.rd || []).length, rowsSum(entry.rd), detail(entry.rd),
      (entry.fd || []).length, rowsSum(entry.fd), detail(entry.fd),
      entry.editedAt || "", entry.editedIn || "", entry.pending ? "no" : "yes",
    ].map(cell).join(","));
  }
  return lines.join("\r\n");
}

export function download(entries) {
  const url = URL.createObjectURL(new Blob([toCsv(entries)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthly-report-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
