import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api.js";
import "./ReportsDashboard.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const currentYear = new Date().getFullYear();
const money = (value) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const reportTotal = (report) =>
  Number(report.renewal || 0) +
  [...(report.rd || []), ...(report.fd || [])].reduce((sum, row) => sum + Number(row.amount || 0), 0);

function reportMonthIndex(month) {
  const match = /^(\d{4})-(\d{1,2})$/.exec(String(month || ""));
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : null;
}

function getCustomerMonthlyCategories(customers, year) {
  const totals = { renewal: Array(12).fill(0), newRd: Array(12).fill(0), newFd: Array(12).fill(0) };
  for (const customer of customers) {
    const joined = new Date(customer.joinedDate);
    if (customer.schemeType === "FD") {
      if (!Number.isNaN(joined.getTime()) && joined.getFullYear() === year)
        totals.newFd[joined.getMonth()] += Number(customer.amount || 0);
      continue;
    }
    for (const [key, monthPaid] of Object.entries(customer.paid || {})) {
      if (!monthPaid) continue;
      const match = /^(\d{4})-([a-z]{3})$/i.exec(key);
      const month = match ? MONTHS.findIndex((one) => one.toLowerCase() === match[2].toLowerCase()) : -1;
      if (!match || Number(match[1]) !== year || month < 0) continue;
      const isJoinedMonth = !Number.isNaN(joined.getTime()) && joined.getFullYear() === year && joined.getMonth() === month;
      totals[isJoinedMonth ? "newRd" : "renewal"][month] += Number(customer.amount || 0);
    }
  }
  return totals;
}

export default function ReportsDashboard() {
  const [year, setYear] = useState(currentYear);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(new Date().getMonth());
  const [reports, setReports] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [reportData, customerData] = await Promise.all([
        apiGet("/api/reports"),
        apiGet("/api/admin/customers"),
      ]);
      setReports(Array.isArray(reportData.reports) ? reportData.reports : []);
      setCustomers(Array.isArray(customerData.customers) ? customerData.customers : []);
      setUpdatedAt(new Date());
    } catch (problem) {
      setError(problem.message || "Could not load the report data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => {
    const found = new Set([currentYear]);
    for (const report of reports) {
      const parsed = reportMonthIndex(report.month);
      if (parsed) found.add(parsed.year);
    }
    for (const customer of customers) {
      const date = new Date(customer.joinedDate);
      if (!Number.isNaN(date.getTime())) found.add(date.getFullYear());
      for (const key of Object.keys(customer.paid || {})) {
        const match = /^(\d{4})-/.exec(key);
        if (match) found.add(Number(match[1]));
      }
    }
    return [...found].filter(Number.isFinite).sort((a, b) => b - a);
  }, [reports, customers]);

  const monthly = useMemo(() => {
    const agent = Array(12).fill(0);
    const renewal = Array(12).fill(0);
    const newRd = Array(12).fill(0);
    const newFd = Array(12).fill(0);
    const count = Array(12).fill(0);
    for (const report of reports) {
      const parsed = reportMonthIndex(report.month);
      if (!parsed || parsed.year !== year) continue;
      const total = reportTotal(report);
      agent[parsed.month] += total;
      renewal[parsed.month] += Number(report.renewal || 0);
      newRd[parsed.month] += (report.rd || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      newFd[parsed.month] += (report.fd || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      count[parsed.month] += 1;
    }
    const customer = getCustomerMonthlyCategories(customers, year);
    return MONTHS.map((name, index) => ({
      name, agent: agent[index], renewal: renewal[index], newRd: newRd[index], newFd: newFd[index],
      customerRenewal: customer.renewal[index], customerNewRd: customer.newRd[index], customerNewFd: customer.newFd[index],
      customer: customer.renewal[index] + customer.newRd[index] + customer.newFd[index],
      combined: agent[index] + customer.renewal[index] + customer.newRd[index] + customer.newFd[index], reports: count[index],
    }));
  }, [reports, customers, year]);

  const rows = monthly.slice(0, 12);
  const selectedMonth = rows[selectedMonthIndex] || rows[0];
  const agentTotals = rows.reduce((sum, row) => sum + row.agent, 0);
  const customerTotals = rows.reduce((sum, row) => sum + row.customer, 0);
  const combinedTotal = agentTotals + customerTotals;
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.renewal, row.newRd, row.newFd, row.customerRenewal, row.customerNewRd, row.customerNewFd]));
  const chartHeight = 190;
  const series = [
    { key: "renewal", label: "Agent renewal", className: "renewal-bar" },
    { key: "newRd", label: "Agent new RD", className: "rd-bar" },
    { key: "newFd", label: "Agent new FD", className: "fd-bar" },
    { key: "customerRenewal", label: "Customer renewal", className: "customer-renewal-bar" },
    { key: "customerNewRd", label: "Customer new RD", className: "customer-rd-bar" },
    { key: "customerNewFd", label: "Customer new FD", className: "customer-fd-bar" },
  ];

  return (
    <div className="reports-dashboard">
      <header className="reports-head">
        <div>
          <p className="reports-eyebrow">COLLECTION OVERVIEW</p>
          <h1>Reports</h1>
          <p>Agent submissions and customer collections, together by month.</p>
        </div>
        <div className="reports-actions">
          <label>
            <span>Report year</span>
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {[...new Set([year, ...years])].sort((a, b) => b - a).map((one) => <option key={one}>{one}</option>)}
            </select>
          </label>
          <label>
            <span>Month totals</span>
            <select value={selectedMonthIndex} onChange={(event) => setSelectedMonthIndex(Number(event.target.value))}>
              {MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
          </label>
          <button type="button" onClick={load} disabled={loading}>{loading ? "Updating…" : "Refresh"}</button>
        </div>
      </header>

      {error && <div className="reports-error" role="alert">{error} <button type="button" onClick={load}>Try again</button></div>}

      <section className="reports-month-totals" aria-label={`${selectedMonth.name} ${year} totals`}>
        <h2>{selectedMonth.name} {year} totals</h2>
        <p><strong>New RD</strong><span>Agents ₹{money(selectedMonth.newRd)} + customers ₹{money(selectedMonth.customerNewRd)} = <b>₹{money(selectedMonth.newRd + selectedMonth.customerNewRd)}</b></span></p>
        <p><strong>New FD</strong><span>Agents ₹{money(selectedMonth.newFd)} + customers ₹{money(selectedMonth.customerNewFd)} = <b>₹{money(selectedMonth.newFd + selectedMonth.customerNewFd)}</b></span></p>
        <p><strong>Renewals</strong><span>Agents ₹{money(selectedMonth.renewal)} + customers ₹{money(selectedMonth.customerRenewal)} = <b>₹{money(selectedMonth.renewal + selectedMonth.customerRenewal)}</b></span></p>
        <p className="reports-month-grand-total"><strong>Total collected</strong><span>Agents ₹{money(selectedMonth.newRd + selectedMonth.newFd + selectedMonth.renewal)} + customers ₹{money(selectedMonth.customerNewRd + selectedMonth.customerNewFd + selectedMonth.customerRenewal)} = <b>₹{money(selectedMonth.newRd + selectedMonth.newFd + selectedMonth.renewal + selectedMonth.customerNewRd + selectedMonth.customerNewFd + selectedMonth.customerRenewal)}</b></span></p>
      </section>

      <section className="reports-panel">
        <div className="reports-panel-heading">
          <div><h2>Monthly collection</h2><p>Compare agent and customer renewals, new RD, and new FD by month.</p></div>
          <div className="reports-legend">{series.map((item) => <span key={item.key}><i className={item.className} />{item.label}</span>)}</div>
        </div>
        {loading && !updatedAt ? <p className="reports-message">Loading report history…</p> : (
          <div className="reports-chart-scroll">
            <div className="reports-chart" role="group" aria-label={rows.map((row) => `${row.name}: agent renewal ₹${money(row.renewal)}, agent new RD ₹${money(row.newRd)}, agent new FD ₹${money(row.newFd)}, customer renewal ₹${money(row.customerRenewal)}, customer new RD ₹${money(row.customerNewRd)}, customer new FD ₹${money(row.customerNewFd)}`).join("; ")}>
              {rows.map((row) => (
                <button type="button" className={`reports-chart-month${selectedMonthIndex === MONTHS.indexOf(row.name) ? " is-selected" : ""}`} key={row.name} aria-label={`Show ${row.name} totals`} aria-pressed={selectedMonthIndex === MONTHS.indexOf(row.name)} onClick={() => setSelectedMonthIndex(MONTHS.indexOf(row.name))}>
                  <div className="reports-bars">
                    {series.map((item) => <div key={item.key} className={`reports-bar ${item.className}`} style={{ height: `${Math.max(row[item.key] ? 3 : 0, row[item.key] / maxValue * chartHeight)}px` }} title={`${item.label}: ₹${money(row[item.key])}`} />)}
                  </div>
                  <div className="reports-chart-tooltip" aria-hidden="true">
                    <strong>{row.name} {year}</strong>
                    {series.map((item) => <span key={item.key}><i className={item.className} />{item.label}<b>{row[item.key] ? `₹${money(row[item.key])}` : "—"}</b></span>)}
                    <em>Total <b>₹{money(row.combined)}</b></em>
                  </div>
                  <span>{row.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="reports-updated">{updatedAt ? `Updated at ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " "}</p>
      </section>

      <section className="reports-panel history-panel">
        <div className="reports-panel-heading"><div><h2>Monthly history</h2><p>Combined figures are the sum of both sources.</p></div></div>
        <div className="reports-table-wrap">
          <table>
            <thead><tr><th>Month</th><th>Agent reports</th><th>Agent renewal</th><th>Agent new RD</th><th>Agent new FD</th><th>Agents total</th><th>Customer renewal</th><th>Customer new RD</th><th>Customer new FD</th><th>Customers total</th><th>Combined</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name} {year}</th>
                <td>{row.reports}</td><td>₹{money(row.renewal)}</td><td>₹{money(row.newRd)}</td><td>₹{money(row.newFd)}</td><td>₹{money(row.agent)}</td><td>₹{money(row.customerRenewal)}</td><td>₹{money(row.customerNewRd)}</td><td>₹{money(row.customerNewFd)}</td><td>₹{money(row.customer)}</td><td className="combined-cell">₹{money(row.combined)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><th scope="row">Year total</th><td>{rows.reduce((sum, row) => sum + row.reports, 0)}</td><td>₹{money(rows.reduce((sum, row) => sum + row.renewal, 0))}</td><td>₹{money(rows.reduce((sum, row) => sum + row.newRd, 0))}</td><td>₹{money(rows.reduce((sum, row) => sum + row.newFd, 0))}</td><td>₹{money(agentTotals)}</td><td>₹{money(rows.reduce((sum, row) => sum + row.customerRenewal, 0))}</td><td>₹{money(rows.reduce((sum, row) => sum + row.customerNewRd, 0))}</td><td>₹{money(rows.reduce((sum, row) => sum + row.customerNewFd, 0))}</td><td>₹{money(customerTotals)}</td><td>₹{money(combinedTotal)}</td></tr></tfoot>
          </table>
        </div>
      </section>

    </div>
  );
}

