import React, { useEffect, useState } from "react";
import { apiGet, apiSend } from "../lib/api.js";
import "./CustomerLedger.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REAL_NOW = new Date();
const REAL_CURRENT_MONTH_IDX = REAL_NOW.getMonth();
const REAL_CURRENT_YEAR = REAL_NOW.getFullYear();
const REAL_CURRENT_MONTH = MONTHS[REAL_CURRENT_MONTH_IDX];

const PAYMENT_MODES = [
  { id: "monthly", label: "Monthly", interval: 1 },
  { id: "quarterly", label: "Quarterly", interval: 3 },
  { id: "halfyearly", label: "Half-yearly", interval: 6 },
  { id: "yearly", label: "Yearly", interval: 12 },
];

const TERM_OPTIONS = [1, 2, 3, 4, 5, 6];
const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => REAL_CURRENT_YEAR - 2 + i);
const STORAGE_KEY = "customer-ledger";
const PENDING_KEY = "customer-ledger-pending-sync";

function normalizeCustomers(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed.map((c) => ({
      ...c,
      joinedDate: new Date(c.joinedDate),
      expiryDate: new Date(c.expiryDate),
      claimedDate: c.claimedDate ? new Date(c.claimedDate) : null,
      paid: c.paid || {},
      edited: c.edited || {},
    }));
}

function loadCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeCustomers(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function monthKey(year, monthIdx) {
  return `${year}-${MONTHS[monthIdx]}`;
}
function paymentProgress(customer) {
  const termMonths = Math.max(1, Math.round(Number(customer.periodYears || 1) * 12));
  if (customer.schemeType !== "RD") return { paid: 0, term: termMonths };
  const markedInstallments = Object.values(customer.paid || {}).filter(Boolean).length;
  const interval = Math.max(1, Number(customer.intervalMonths || 1));
  return { paid: Math.min(termMonths, markedInstallments * interval), term: termMonths };
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
// Formats a raw digit string for display with Indian comma grouping,
// e.g. "300000" -> "3,00,000". Leaves the underlying state as plain digits.
function toIndianGrouped(raw) {
  if (!raw) return "";
  const [intPart, decPart] = raw.split(".");
  const num = parseInt(intPart, 10);
  if (isNaN(num)) return raw;
  const grouped = num.toLocaleString("en-IN");
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

export default function CustomerLedger() {
  const [customers, setCustomers] = useState(loadCustomers);
  const [savedCustomers, setSavedCustomers] = useState(loadCustomers);
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("loading");
  const [viewYear, setViewYear] = useState(REAL_CURRENT_YEAR);
  const [currentMonth, setCurrentMonth] = useState(REAL_CURRENT_MONTH); // "marking as" month, for fixing mistakes
  const [searchTerm, setSearchTerm] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [schemeNameInput, setSchemeNameInput] = useState("");
  const [schemeType, setSchemeType] = useState("RD");
  const [paymentMode, setPaymentMode] = useState("monthly");
  const [amountInput, setAmountInput] = useState("");
  const [termYears, setTermYears] = useState(1);
  const [isCustomTerm, setIsCustomTerm] = useState(false);
  const [customTerm, setCustomTerm] = useState("");
  const [joinedMonthIdx, setJoinedMonthIdx] = useState(REAL_CURRENT_MONTH_IDX);
  const [joinedYearInput, setJoinedYearInput] = useState(REAL_CURRENT_YEAR);
  const [editingCustomerId, setEditingCustomerId] = useState(null);

  const [editingCell, setEditingCell] = useState(null); // `${rowId}-${key}`
  const [editDraft, setEditDraft] = useState("");
  const [detailCustomer, setDetailCustomer] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [monthDetailIdx, setMonthDetailIdx] = useState(null);

  useEffect(() => {
    let active = true;
    const localCustomers = loadCustomers();
    apiGet("/api/admin/customers").then((data) => {
      if (!active) return;
      const remote = Array.isArray(data?.customers) ? data.customers : [];
      let pendingLocal = false;
      try { pendingLocal = localStorage.getItem(PENDING_KEY) === "1"; } catch { /* use the server copy */ }
      // On first sign-in, or after an offline edit, bring this browser's pending
      // ledger to Supabase. Otherwise use the shared cloud list.
      const chosen = data?.configured && !pendingLocal ? remote : localCustomers;
      const normalized = normalizeCustomers(chosen);
      setCustomers(normalized);
      setSavedCustomers(normalized);
      setSyncStatus("saved");
      setSyncReady(true);
    }).catch(() => {
      if (!active) return;
      setSyncStatus("local");
      setSyncReady(true);
    });
    return () => { active = false; };
  }, []);

  const hasUnsavedChanges = JSON.stringify(customers) !== JSON.stringify(savedCustomers);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  async function saveChanges() {
    if (!hasUnsavedChanges || syncStatus === "saving") return;
    const snapshot = normalizeCustomers(JSON.parse(JSON.stringify(customers)));
    setSyncStatus("saving");
    try {
      await apiSend("PUT", "/api/admin/customers", { customers: JSON.parse(JSON.stringify(snapshot)) });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        localStorage.removeItem(PENDING_KEY);
      } catch { /* the server copy is saved */ }
      setSavedCustomers(snapshot);
      setSyncStatus("saved");
    } catch {
      // A deliberate Save still works offline: keep this confirmed copy locally
      // and offer it to the server next time the ledger is opened.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        localStorage.setItem(PENDING_KEY, "1");
      } catch { /* keep the confirmed copy in memory */ }
      setSavedCustomers(snapshot);
      setSyncStatus("local");
    }
  }

  function discardChanges() {
    if (!hasUnsavedChanges) return;
    if (!window.confirm("Discard all customer changes that have not been saved?")) return;
    setCustomers(normalizeCustomers(JSON.parse(JSON.stringify(savedCustomers))));
    setSyncStatus("saved");
    setEditingCell(null);
    setShowModal(false);
    setDetailCustomer(null);
    setConfirmDeleteId(null);
  }

  if (!syncReady) {
    return <div style={styles.page} role="status">Loading shared customer data…</div>;
  }

  // Pass a customer to prefill the form and edit it; omit to add a new one.
  function openModal(customer) {
    if (customer) {
      setEditingCustomerId(customer.id);
      setNameInput(customer.name);
      setSchemeNameInput(customer.schemeName);
      setSchemeType(customer.schemeType);
      setPaymentMode(customer.paymentMode || "monthly");
      setAmountInput(String(customer.amount));
      const isWhole = customer.periodYears % 1 === 0 && TERM_OPTIONS.includes(customer.periodYears);
      setIsCustomTerm(!isWhole);
      setTermYears(isWhole ? customer.periodYears : 1);
      setCustomTerm(isWhole ? "" : String(customer.periodYears));
      setJoinedMonthIdx(customer.joinedDate.getMonth());
      setJoinedYearInput(customer.joinedDate.getFullYear());
    } else {
      setEditingCustomerId(null);
      setNameInput("");
      setSchemeNameInput("");
      setSchemeType("RD");
      setPaymentMode("monthly");
      setAmountInput("");
      setTermYears(1);
      setIsCustomTerm(false);
      setCustomTerm("");
      setJoinedMonthIdx(REAL_CURRENT_MONTH_IDX);
      setJoinedYearInput(viewYear);
    }
    setShowModal(true);
  }

  function addCustomer() {
    const name = nameInput.trim();
    if (!name) return;
    const amount = parseFloat(amountInput) || 0;
    const periodYears = isCustomTerm ? parseFloat(customTerm) || 1 : termYears;
    const joinedDate = new Date(joinedYearInput, joinedMonthIdx, 1);
    const expiryDate = new Date(joinedDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + Math.floor(periodYears));
    expiryDate.setMonth(expiryDate.getMonth() + Math.round((periodYears % 1) * 12));
    const intervalMonths = PAYMENT_MODES.find((p) => p.id === paymentMode)?.interval || 1;
    const schemeName = schemeNameInput.trim() || "General";

    if (editingCustomerId) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === editingCustomerId
            ? {
                ...c,
                name,
                schemeName,
                schemeType,
                paymentMode: schemeType === "RD" ? paymentMode : null,
                intervalMonths: schemeType === "RD" ? intervalMonths : null,
                amount,
                periodYears,
                joinedDate,
                expiryDate,
              }
            : c
        )
      );
      setShowModal(false);
      setEditingCustomerId(null);
      return;
    }

    setCustomers((prev) => [
      ...prev,
      {
        id: Date.now(),
        name,
        schemeName,
        schemeType,
        paymentMode: schemeType === "RD" ? paymentMode : null,
        intervalMonths: schemeType === "RD" ? intervalMonths : null,
        amount,
        periodYears,
        joinedDate,
        expiryDate,
        paid: {},
        edited: {},
        claimed: false,
        claimedDate: null,
      },
    ]);
    setShowModal(false);
  }

  function removeCustomer(id) {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
    setConfirmDeleteId(null);
  }

  // 'before-join' | 'expired' | 'skip' (not a due interval) | 'due'
  function dueStatus(c, year, monthIdx) {
    const colDate = new Date(year, monthIdx, 1);
    const joinMonth = startOfMonth(c.joinedDate);
    const expiryMonth = startOfMonth(c.expiryDate);
    if (colDate < joinMonth) return "before-join";
    if (colDate >= expiryMonth) return "expired";
    const monthsSinceJoin =
      (year - c.joinedDate.getFullYear()) * 12 + (monthIdx - c.joinedDate.getMonth());
    if (monthsSinceJoin % (c.intervalMonths || 1) !== 0) return "skip";
    return "due";
  }

  // Single click on a due cell: toggle blank <-> marked-paid-this-month
  function toggleCell(rowId, year, monthIdx) {
    const key = monthKey(year, monthIdx);
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== rowId) return c;
        const isMarked = !!c.paid[key];
        return {
          ...c,
          paid: { ...c.paid, [key]: isMarked ? "" : currentMonth },
          edited: { ...c.edited, [key]: false },
        };
      })
    );
  }

  function startManualEdit(rowId, key, current) {
    setEditingCell(`${rowId}-${key}`);
    setEditDraft(current);
  }

  function commitManualEdit(rowId, key) {
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== rowId) return c;
        const newValue = editDraft.trim();
        const changed = newValue !== (c.paid[key] || "");
        return {
          ...c,
          paid: { ...c.paid, [key]: newValue },
          edited: { ...c.edited, [key]: changed ? true : !!c.edited[key] },
        };
      })
    );
    setEditingCell(null);
  }

  function toggleClaimed(rowId) {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === rowId
          ? { ...c, claimed: !c.claimed, claimedDate: !c.claimed ? new Date() : null }
          : c
      )
    );
  }

  const paidCount = (c) => Object.values(c.paid).filter(Boolean).length;
  const collectedFor = (c) => (c.schemeType === "FD" ? c.amount : paidCount(c) * c.amount);
  const grandCollected = customers.reduce((sum, c) => sum + collectedFor(c), 0);

  // Amount collected in month m of the viewed year:
  // - RD: sums by the month payment actually happened (stamped), so advance
  //   payments land correctly even against a different due column.
  // - FD: the whole deposit counts against the month the customer joined,
  //   since that's a one-time lump sum collected at signup.
  const monthCollectedAmount = (m) =>
    customers.reduce((sum, c) => {
      if (c.schemeType === "FD") {
        const joinedThisMonth =
          c.joinedDate.getFullYear() === viewYear && MONTHS[c.joinedDate.getMonth()] === m;
        return joinedThisMonth ? sum + c.amount : sum;
      }
      const count = Object.entries(c.paid).filter(
        ([k, v]) => k.startsWith(`${viewYear}-`) && v === m
      ).length;
      return sum + count * c.amount;
    }, 0);
  const yearCollected = MONTHS.reduce((sum, month) => sum + monthCollectedAmount(month), 0);

  // New signups (by join date, within the viewed year), split by scheme type
  const newSignupsForMonthIdx = (idx) => {
    const inMonth = (type) =>
      customers.filter(
        (c) =>
          c.schemeType === type &&
          c.joinedDate.getFullYear() === viewYear &&
          c.joinedDate.getMonth() === idx
      );
    const rd = inMonth("RD");
    const fd = inMonth("FD");
    return {
      rdCount: rd.length,
      rdSum: rd.reduce((s, c) => s + c.amount, 0),
      fdCount: fd.length,
      fdSum: fd.reduce((s, c) => s + c.amount, 0),
    };
  };

  // What's still owed for a given real-calendar due month (RD only, ongoing only —
  // a completed scheme no longer counts toward what's pending)
  const remainingForMonthIdx = (year, idx) =>
    customers.reduce((sum, c) => {
      if (c.schemeType !== "RD" || c.claimed) return sum;
      if (dueStatus(c, year, idx) !== "due") return sum;
      const key = monthKey(year, idx);
      return c.paid[key] ? sum : sum + c.amount;
    }, 0);

  const fmt = (n) => n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fmtDate = (d) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const daysUntil = (d) => Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
  const periodLabel = (years) => (years === 1 ? "1 yr" : `${years % 1 === 0 ? years : years.toFixed(1)} yrs`);
  const paymentModeLabel = (id) => PAYMENT_MODES.find((p) => p.id === id)?.label || "";
  const schemeNameOptions = [...new Set(customers.map((c) => c.schemeName))];
  const ongoingCustomers = customers.filter((c) => !c.claimed);
  const visibleCustomers = ongoingCustomers.filter((c) =>
    `${c.name} ${c.schemeName} ${c.schemeType}`.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  return (
    <div className="customer-ledger-page" style={styles.page}>
      <div className="customer-ledger-shell">
      <div className="customer-ledger-toolbar" style={styles.toolbar}>
        <div>
          <div className="customer-ledger-eyebrow">CUSTOMER MANAGEMENT</div>
          <h1 style={styles.title}>Customer ledger</h1>
          <p style={styles.subtitle}>
            Track customer schemes. Changes take effect when you save them.
          </p>
          <p className={`ledger-save-status ledger-save-status--${syncStatus}`} role="status">
            <span className="ledger-save-dot" />
            {syncStatus === "loading" ? "Loading shared customer data…" :
              syncStatus === "saving" ? "Saving changes…" :
                hasUnsavedChanges ? "Unsaved changes — save to apply" :
                  syncStatus === "saved" ? "All changes saved" : "Offline — saved on this device for now"}
          </p>
        </div>
        <div className="ledger-toolbar-controls">
        <label className="ledger-control" style={styles.monthPicker}>
          <span style={styles.summaryLabel}>Payment year</span>
          <select aria-label="Payment year" style={styles.monthSelect} value={viewYear} onChange={(e) => setViewYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="ledger-control" style={styles.monthPicker}>
          <span style={styles.summaryLabel}>Payment received in</span>
          <select aria-label="Payment received in month" style={styles.monthSelect} value={currentMonth} onChange={(e) => setCurrentMonth(e.target.value)}>
            {MONTHS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        </div>
        <div className="ledger-month-summary" aria-label={`Unpaid amounts by month for ${viewYear}`}>
          <div className="ledger-month-summary-title">Still due in {viewYear}</div>
          <div className="ledger-month-grid" style={styles.miniCal}>
          {MONTHS.map((m, idx) => {
            const isFuture =
              viewYear > REAL_CURRENT_YEAR ||
              (viewYear === REAL_CURRENT_YEAR && idx > REAL_CURRENT_MONTH_IDX);
            if (isFuture) {
              return (
                <div key={m} style={styles.miniCalCell} title="Not due yet">
                  <span style={styles.miniCalMonth}>{m}</span>
                  <span style={styles.miniCalFuture}>–</span>
                </div>
              );
            }
            const remaining = remainingForMonthIdx(viewYear, idx);
            return (
              <div key={m} style={styles.miniCalCell} title={remaining === 0 ? "Fully collected" : `${fmt(remaining)} pending`}>
                <span style={styles.miniCalMonth}>{m}</span>
                {remaining === 0 ? (
                  <span style={styles.miniCalTick}>✓</span>
                ) : (
                  <span style={styles.miniCalPending}>{fmt(remaining)}</span>
                )}
              </div>
            );
          })}
          </div>
        </div>
        <div className="ledger-edit-actions">
          <button type="button" className="ledger-save-button" onClick={saveChanges} disabled={!hasUnsavedChanges || syncStatus === "saving"}>
            {syncStatus === "saving" ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className="ledger-discard-button" onClick={discardChanges} disabled={!hasUnsavedChanges || syncStatus === "saving"}>
            Discard
          </button>
          <button type="button" className="ledger-add-button" style={styles.addBtn} onClick={() => openModal()}><span aria-hidden="true">＋</span> Add customer</button>
        </div>
      </div>

      <section className="ledger-stats" aria-label="Customer summary">
        <article className="ledger-stat-card"><span>Active schemes</span><strong>{ongoingCustomers.length}</strong><small>customers being tracked</small></article>
        <article className="ledger-stat-card ledger-stat-card--due"><span>Still due this month</span><strong>₹{fmt(remainingForMonthIdx(REAL_CURRENT_YEAR, REAL_CURRENT_MONTH_IDX))}</strong><small>{REAL_CURRENT_MONTH} {REAL_CURRENT_YEAR}</small></article>
        <article className="ledger-stat-card ledger-stat-card--collected"><span>Collected in {viewYear}</span><strong>₹{fmt(yearCollected)}</strong><small>across all customer schemes</small></article>
      </section>

      <div className="ledger-section-heading">
        <div><h2 style={styles.completedTitle}>Ongoing schemes</h2><p>Click a customer name for details. Select a due month, then save to record payment received in {currentMonth}.</p></div>
        <label className="ledger-search"><span className="sr-only">Search ongoing customers</span><span aria-hidden="true">⌕</span><input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search name or scheme" /></label>
      </div>
      <div style={styles.tableWrap}>
        <table className="ledger-table" style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, ...styles.stickyCol, textAlign: "left" }}>Name</th>
              <th style={{ ...styles.th, textAlign: "left" }}>Scheme</th>
              <th style={styles.th}>Amount</th>
              <th style={styles.th}>Paid</th>
              {MONTHS.map((m, idx) => (
                <th
                  key={m}
                  style={{
                    ...styles.th,
                    ...(viewYear === REAL_CURRENT_YEAR && idx === REAL_CURRENT_MONTH_IDX
                      ? styles.currentMonthHead
                      : {}),
                  }}
                >
                  {m}
                </th>
              ))}
              <th style={{ ...styles.th, ...styles.totalCol }}>Collected</th>
              <th style={{ ...styles.th, width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.length === 0 && (
              <tr>
                <td colSpan={18} style={styles.emptyRow}>
                  {ongoingCustomers.length === 0
                    ? "No customers yet. Add one to start tracking payments."
                    : searchTerm ? "No customers match your search. Try another name or scheme." : "No ongoing customers — everyone's completed or claimed."}
                </td>
              </tr>
            )}
            {visibleCustomers.map((c) => (
              <tr key={c.id}>
                <td
                  style={{ ...styles.td, ...styles.stickyCol, ...styles.nameCell, textAlign: "left", fontWeight: 600 }}
                  title={`Scheme: ${c.schemeName} (${c.schemeType}) · Period: ${periodLabel(c.periodYears)} · Joined: ${fmtDate(c.joinedDate)} · Expires: ${fmtDate(c.expiryDate)}`}
                  onClick={() => setDetailCustomer(c)}
                >
                  {c.name}
                </td>
                <td style={{ ...styles.td, textAlign: "left" }}>
                  <div>{c.schemeName}</div>
                  <span style={{ ...styles.badge, ...(c.schemeType === "FD" ? styles.badgeFD : styles.badgeRD) }}>
                    {c.schemeType === "RD" ? paymentModeLabel(c.paymentMode) : "Fixed deposit"}
                  </span>
                  {c.claimed && (
                    <span style={{ ...styles.badge, ...styles.badgeDone }}>
                      {c.schemeType === "RD" ? "Completed" : "Claimed"}
                    </span>
                  )}
                </td>
                <td style={styles.td}>{fmt(c.amount)}{c.schemeType === "RD" ? "/mo" : ""}</td>
                <td className="ledger-paid-progress" style={styles.td} title={c.schemeType === "RD" ? `${paymentProgress(c).paid} of ${paymentProgress(c).term} months paid` : "Fixed deposit"}>
                  {c.schemeType === "RD" ? `${paymentProgress(c).paid}/${paymentProgress(c).term}` : "—"}
                </td>

                {c.schemeType === "FD" ? (
                  <td colSpan={12} style={styles.fdCellOuter}>
                    <div style={styles.fdCellInner}>
                      <span>Deposit {fmt(c.amount)} · Matures {fmtDate(c.expiryDate)}</span>
                      <button
                        style={{ ...styles.claimBtn, ...(c.claimed ? styles.claimedBtn : {}) }}
                        onClick={() => toggleClaimed(c.id)}
                      >
                        {c.claimed ? `Claimed ${fmtDate(c.claimedDate)}` : "Mark claimed"}
                      </button>
                    </div>
                  </td>
                ) : (
                  MONTHS.map((m, idx) => {
                    const key = monthKey(viewYear, idx);
                    const status = dueStatus(c, viewYear, idx);
                    if (status === "before-join") {
                      return (
                        <td key={m} style={{ ...styles.td, ...styles.paidCell, ...styles.lockedCell }}>X</td>
                      );
                    }
                    if (status === "expired") {
                      return (
                        <td key={m} style={{ ...styles.td, ...styles.paidCell, ...styles.lockedCell }}>—</td>
                      );
                    }
                    if (status === "skip") {
                      return (
                        <td key={m} style={{ ...styles.td, ...styles.paidCell, ...styles.skipCell }}>·</td>
                      );
                    }
                    const value = c.paid[key];
                    const isEditing = editingCell === `${c.id}-${key}`;
                    return (
                      <td
                        key={m}
                        style={{
                          ...styles.td,
                          ...styles.paidCell,
                          ...(value ? styles.paidCellMarked : {}),
                          ...(viewYear === REAL_CURRENT_YEAR && idx === REAL_CURRENT_MONTH_IDX ? styles.currentMonthCol : {}),
                          position: "relative",
                        }}
                        onClick={() => !isEditing && toggleCell(c.id, viewYear, idx)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startManualEdit(c.id, key, value);
                        }}
                        title={c.edited[key] ? "Manually edited" : ""}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            style={styles.cellInput}
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => commitManualEdit(c.id, key)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitManualEdit(c.id, key);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                          />
                        ) : (
                          <>
                            {value || "—"}
                            {c.edited[key] && <span style={styles.editedBadge}>✎</span>}
                          </>
                        )}
                      </td>
                    );
                  })
                )}

                <td style={{ ...styles.td, ...styles.totalCol, fontWeight: 600 }}>{fmt(collectedFor(c))}</td>
                <td style={styles.td}>
                  <button style={styles.removeBtn} onClick={() => setConfirmDeleteId(c.id)} title="Remove">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {customers.length > 0 && (
            <tfoot>
              <tr>
                <td style={{ ...styles.tf, ...styles.stickyCol, textAlign: "left" }}>Total</td>
                <td style={styles.tf}></td>
                <td style={styles.tf}></td>
                <td style={styles.tf}></td>
                {MONTHS.map((m, idx) => {
                  const s = newSignupsForMonthIdx(idx);
                  return (
                    <td
                      key={m}
                      style={{ ...styles.tf, ...styles.tfHoverable }}
                      onClick={() => setMonthDetailIdx(idx)}
                      title={`New RD: ${s.rdCount} (${fmt(s.rdSum)}/mo)\nNew FD: ${s.fdCount} (${fmt(s.fdSum)})`}
                    >
                      {fmt(monthCollectedAmount(m))}
                    </td>
                  );
                })}
                <td style={{ ...styles.tf, ...styles.totalCol }}>{fmt(grandCollected)}</td>
                <td style={styles.tf}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {customers.some((c) => c.claimed) && (
        <div style={styles.completedSection}>
          <h2 style={styles.completedTitle}>Completed / claimed</h2>
          <div style={styles.completedGrid}>
            {customers
              .filter((c) => c.claimed)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="completed-customer-card"
                  style={styles.completedCard}
                  onClick={() => setDetailCustomer(c)}
                  aria-label={`View details for ${c.name}`}
                >
                  <div style={styles.completedName}>{c.name}</div>
                  <div style={styles.completedAmount}>{fmt(c.amount)}</div>
                  <div style={styles.completedDate}>
                    {c.schemeType === "RD" ? "Completed on" : "Claimed on"} {fmtDate(c.claimedDate)}
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {showModal && (
        <div style={styles.overlay} onClick={() => setShowModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>{editingCustomerId ? "Edit customer" : "Add customer"}</h2>

            <label style={styles.label}>Name</label>
            <input
              autoFocus
              style={styles.input}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Alex"
            />

            <label style={styles.label}>Scheme name</label>
            <input
              style={styles.input}
              value={schemeNameInput}
              onChange={(e) => setSchemeNameInput(e.target.value)}
              placeholder="e.g. Parivar"
              list="scheme-names"
            />
            <datalist id="scheme-names">
              {schemeNameOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            <label style={styles.label}>Scheme type</label>
            <div style={styles.toggleRow}>
              {["RD", "FD"].map((t) => (
                <button
                  key={t}
                  type="button"
                  style={{ ...styles.toggleBtn, ...(schemeType === t ? styles.toggleBtnActive : {}) }}
                  onClick={() => setSchemeType(t)}
                >
                  {t === "RD" ? "Monthly (RD)" : "Fixed deposit"}
                </button>
              ))}
            </div>

            {schemeType === "RD" && (
              <>
                <label style={styles.label}>Payment mode</label>
                <div style={styles.toggleRow}>
                  {PAYMENT_MODES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      style={{ ...styles.toggleBtnSm, ...(paymentMode === p.id ? styles.toggleBtnActive : {}) }}
                      onClick={() => setPaymentMode(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p style={styles.hintText}>
                  Customer typically pays every {PAYMENT_MODES.find((p) => p.id === paymentMode)?.interval} month(s) at once.
                </p>
              </>
            )}

            <label style={styles.label}>{schemeType === "RD" ? "Monthly installment amount" : "Deposit amount"}</label>
            <input
              style={styles.input}
              value={toIndianGrouped(amountInput)}
              onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 2,000"
              inputMode="decimal"
            />

            <label style={styles.label}>Term (years)</label>
            <div style={styles.toggleRow}>
              {TERM_OPTIONS.map((y) => (
                <button
                  key={y}
                  type="button"
                  style={{ ...styles.toggleBtnSm, ...(!isCustomTerm && termYears === y ? styles.toggleBtnActive : {}) }}
                  onClick={() => {
                    setTermYears(y);
                    setIsCustomTerm(false);
                  }}
                >
                  {y}yr
                </button>
              ))}
              <button
                type="button"
                style={{ ...styles.toggleBtnSm, ...(isCustomTerm ? styles.toggleBtnActive : {}) }}
                onClick={() => setIsCustomTerm(true)}
              >
                Custom
              </button>
            </div>
            {isCustomTerm && (
              <input
                style={{ ...styles.input, marginTop: 8 }}
                value={customTerm}
                onChange={(e) => setCustomTerm(e.target.value)}
                placeholder="Years, e.g. 2.5"
                inputMode="decimal"
              />
            )}

            <label style={styles.label}>Joined month ({joinedYearInput})</label>
            <select
              style={styles.input}
              value={joinedMonthIdx}
              onChange={(e) => setJoinedMonthIdx(Number(e.target.value))}
            >
              {MONTHS.map((m, idx) => (
                <option key={m} value={idx}>{m}</option>
              ))}
            </select>

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={styles.addBtn} onClick={addCustomer}>{editingCustomerId ? "Save changes" : "Add"}</button>
            </div>
          </div>
        </div>
      )}

      {detailCustomer && (
        <div style={styles.overlay} onClick={() => setDetailCustomer(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>{detailCustomer.name}</h2>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Scheme</span>
              <span style={styles.detailValue}>{detailCustomer.schemeName} ({detailCustomer.schemeType})</span>
            </div>
            {detailCustomer.schemeType === "RD" && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Payment mode</span>
                <span style={styles.detailValue}>{paymentModeLabel(detailCustomer.paymentMode)}</span>
              </div>
            )}
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>{detailCustomer.schemeType === "RD" ? "Installment" : "Deposit"}</span>
              <span style={styles.detailValue}>{fmt(detailCustomer.amount)}</span>
            </div>
            {detailCustomer.schemeType === "RD" && (
              <div style={styles.detailRow}>
                <span style={styles.detailLabel}>Months paid</span>
                <span style={styles.detailValue}>{paymentProgress(detailCustomer).paid}/{paymentProgress(detailCustomer).term}</span>
              </div>
            )}
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Period</span>
              <span style={styles.detailValue}>{periodLabel(detailCustomer.periodYears)}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Joined</span>
              <span style={styles.detailValue}>{fmtDate(detailCustomer.joinedDate)}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Expires</span>
              <span
                style={{
                  ...styles.detailValue,
                  ...(daysUntil(detailCustomer.expiryDate) < 0
                    ? { color: "#B9483F" }
                    : daysUntil(detailCustomer.expiryDate) <= 30
                    ? { color: "#9A6A1E" }
                    : {}),
                }}
              >
                {fmtDate(detailCustomer.expiryDate)}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>{detailCustomer.schemeType === "RD" ? "Completed" : "Claimed"}</span>
              <span style={styles.detailValue}>
                {detailCustomer.claimed ? fmtDate(detailCustomer.claimedDate) : "Not yet"}
              </span>
            </div>
            <div style={styles.modalActions}>
              <button
                style={{ ...styles.cancelBtn, ...(detailCustomer.claimed ? {} : styles.completeBtn) }}
                onClick={() => {
                  toggleClaimed(detailCustomer.id);
                  setDetailCustomer(null);
                }}
              >
                {detailCustomer.claimed
                  ? "Undo"
                  : detailCustomer.schemeType === "RD"
                  ? "Mark as completed"
                  : "Mark claimed"}
              </button>
              <button
                style={styles.cancelBtn}
                onClick={() => {
                  openModal(detailCustomer);
                  setDetailCustomer(null);
                }}
              >
                Edit
              </button>
              <button style={styles.cancelBtn} onClick={() => setDetailCustomer(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId !== null && (
        <div style={styles.overlay} onClick={() => setConfirmDeleteId(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Remove customer?</h2>
            <p style={styles.hintText}>
              This deletes {customers.find((c) => c.id === confirmDeleteId)?.name}'s record and all
              their payment history. This can't be undone.
            </p>
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
              <button style={styles.deleteBtn} onClick={() => removeCustomer(confirmDeleteId)}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {monthDetailIdx !== null && (
        <div style={styles.overlay} onClick={() => setMonthDetailIdx(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>New signups — {MONTHS[monthDetailIdx]} {viewYear}</h2>
            {(() => {
              const s = newSignupsForMonthIdx(monthDetailIdx);
              return (
                <>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>New RD ({s.rdCount})</span>
                    <span style={styles.detailValue}>{fmt(s.rdSum)}/mo</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>New FD ({s.fdCount})</span>
                    <span style={styles.detailValue}>{fmt(s.fdSum)}</span>
                  </div>
                </>
              );
            })()}
            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setMonthDetailIdx(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: "'IBM Plex Mono', 'SF Mono', Consolas, monospace",
    background: "#F7F6F2",
    minHeight: "100vh",
    padding: "32px 24px",
    color: "#1C1C1A",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
    maxWidth: 1300,
    margin: "0 auto 20px",
    flexWrap: "wrap",
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" },
  subtitle: { fontSize: 12.5, color: "#6B6862", margin: "6px 0 0", maxWidth: 420, lineHeight: 1.4 },
  summaryLabel: { fontSize: 11, color: "#6B6862", marginBottom: 2 },
  miniCal: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gridTemplateRows: "repeat(2, auto)",
    gap: 4,
    padding: "6px 12px",
    borderLeft: "1px solid #DEDCD3",
    borderRight: "1px solid #DEDCD3",
  },
  miniCalCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: 46,
    padding: "3px 2px",
    borderRadius: 5,
    background: "#F7F6F2",
  },
  miniCalMonth: { fontSize: 9.5, color: "#8A877D", fontWeight: 600 },
  miniCalTick: { fontSize: 13, color: "#2F6B3A", fontWeight: 700, lineHeight: 1.4 },
  miniCalPending: { fontSize: 9.5, color: "#B9483F", fontWeight: 700, lineHeight: 1.4 },
  miniCalFuture: { fontSize: 12, color: "#C7C4BA", fontWeight: 700, lineHeight: 1.4 },
  monthPicker: { display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 2 },
  monthSelect: {
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 600,
    padding: "6px 8px",
    border: "1px solid #DEDCD3",
    borderRadius: 6,
    background: "#FFFFFF",
    cursor: "pointer",
  },
  addBtn: {
    background: "#1C1C1A",
    color: "#F7F6F2",
    border: "none",
    borderRadius: 6,
    padding: "9px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  },
  tableWrap: {
    maxWidth: 1300,
    margin: "0 auto",
    overflowX: "auto",
    border: "1px solid #DEDCD3",
    borderRadius: 8,
    background: "#FFFFFF",
  },
  completedSection: {
    maxWidth: 1300,
    margin: "24px auto 0",
  },
  completedTitle: { fontSize: 15, fontWeight: 700, margin: "0 0 10px", maxWidth: 1300, marginLeft: "auto", marginRight: "auto" },
  completedGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 10,
  },
  completedCard: {
    background: "#FFFFFF",
    border: "1px solid #DEDCD3",
    borderRadius: 8,
    padding: "12px 14px",
  },
  completedName: { fontWeight: 700, fontSize: 14 },
  completedAmount: { fontSize: 18, fontWeight: 700, margin: "4px 0", color: "#2F6B3A" },
  completedDate: { fontSize: 11.5, color: "#6B6862" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13.5 },
  th: {
    background: "#EFEDE6",
    padding: "10px 10px",
    textAlign: "right",
    fontWeight: 600,
    borderBottom: "1px solid #DEDCD3",
    borderLeft: "1px solid #EDEBE3",
    whiteSpace: "nowrap",
  },
  currentMonthHead: { background: "#E3E9E1" },
  td: {
    padding: "9px 10px",
    textAlign: "right",
    borderBottom: "1px solid #EFEDE6",
    borderLeft: "1px solid #F3F1EA",
    whiteSpace: "nowrap",
  },
  paidCell: { cursor: "pointer", textAlign: "center", color: "#8A877D", userSelect: "none" },
  paidCellMarked: { background: "#EAF3E9", color: "#2F6B3A", fontWeight: 600 },
  lockedCell: { cursor: "not-allowed", color: "#C7C4BA", background: "#FAFAF7" },
  skipCell: { cursor: "not-allowed", color: "#D8D5CC", background: "#FCFBF8" },
  editedBadge: { position: "absolute", top: 1, right: 2, fontSize: 8, color: "#9A6A1E" },
  currentMonthCol: { boxShadow: "inset 0 0 0 9999px rgba(70,110,70,0.03)" },
  fdCellOuter: {
    padding: "9px 12px",
    borderBottom: "1px solid #EFEDE6",
    borderLeft: "1px solid #F3F1EA",
    background: "#FBF8F1",
    whiteSpace: "nowrap",
  },
  fdCellInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 13,
    color: "#6B5D3E",
    width: "100%",
  },
  claimBtn: {
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 10px",
    borderRadius: 5,
    border: "1px solid #DEDCD3",
    background: "#FFFFFF",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  claimedBtn: { background: "#EAF3E9", color: "#2F6B3A", borderColor: "#C9DEC8" },
  badge: {
    display: "inline-block",
    fontSize: 10.5,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
    marginTop: 2,
  },
  badgeRD: { background: "#E9EEF7", color: "#3B5A85" },
  badgeFD: { background: "#F5EBDD", color: "#8A5A22" },
  badgeDone: { background: "#EAF3E9", color: "#2F6B3A", marginLeft: 4 },
  tf: { padding: "10px 10px", textAlign: "right", borderTop: "2px solid #DEDCD3", fontWeight: 700, background: "#F7F6F2" },
  tfHoverable: { cursor: "pointer" },
  stickyCol: { position: "sticky", left: 0, background: "#FFFFFF", zIndex: 1 },
  nameCell: { cursor: "pointer" },
  totalCol: { background: "#FBF3E9", fontVariantNumeric: "tabular-nums" },
  emptyRow: { padding: "28px 12px", textAlign: "center", color: "#8A877D" },
  cellInput: {
    width: 44,
    textAlign: "center",
    border: "1px solid #1C1C1A",
    borderRadius: 4,
    padding: "2px 4px",
    fontFamily: "inherit",
    fontSize: 13,
  },
  removeBtn: { background: "transparent", border: "none", color: "#B9483F", fontSize: 16, cursor: "pointer", lineHeight: 1 },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(28,28,26,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    padding: 16,
  },
  modal: {
    background: "#FFFFFF",
    borderRadius: 10,
    padding: 24,
    width: 340,
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  modalTitle: { margin: "0 0 16px", fontSize: 17, fontWeight: 700 },
  detailRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #EFEDE6", fontSize: 13.5 },
  detailLabel: { color: "#6B6862" },
  detailValue: { fontWeight: 600 },
  label: { display: "block", fontSize: 12, color: "#6B6862", marginBottom: 4, marginTop: 12 },
  hintText: { fontSize: 11.5, color: "#8A877D", margin: "6px 0 0" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 10px",
    border: "1px solid #DEDCD3",
    borderRadius: 6,
    fontSize: 14,
    fontFamily: "inherit",
  },
  toggleRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  toggleBtn: {
    flex: "1 1 45%",
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 600,
    padding: "10px 8px",
    borderRadius: 6,
    border: "1px solid #DEDCD3",
    background: "#FFFFFF",
    color: "#1C1C1A",
    cursor: "pointer",
    textAlign: "center",
  },
  toggleBtnSm: {
    flex: "1 1 30%",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 600,
    padding: "7px 6px",
    borderRadius: 6,
    border: "1px solid #DEDCD3",
    background: "#FFFFFF",
    color: "#1C1C1A",
    cursor: "pointer",
    textAlign: "center",
  },
  toggleBtnActive: { background: "#1C1C1A", color: "#F7F6F2", borderColor: "#1C1C1A" },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, flexWrap: "wrap" },
  cancelBtn: {
    background: "transparent",
    border: "1px solid #DEDCD3",
    borderRadius: 6,
    padding: "9px 16px",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  deleteBtn: {
    background: "#B9483F",
    color: "#FFFFFF",
    border: "none",
    borderRadius: 6,
    padding: "9px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  completeBtn: {
    background: "#2F6B3A",
    color: "#FFFFFF",
    borderColor: "#2F6B3A",
    fontWeight: 600,
  },
};
