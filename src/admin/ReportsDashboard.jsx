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

function getCustomerMonthTotals(customers, year) {
  const totals = Array(12).fill(0);
  for (const customer of customers) {
    if (customer.schemeType === "FD") {
      const joined = new Date(customer.joinedDate);
      if (!Number.isNaN(joined.getTime()) && joined.getFullYear() === year)
        totals[joined.getMonth()] += Number(customer.amount || 0);
      continue;
    }
    for (const [key, monthPaid] of Object.entries(customer.paid || {})) {
      if (!monthPaid) continue;
      const match = /^(\d{4})-([a-z]{3})$/i.exec(key);
      const month = match ? MONTHS.findIndex((one) => one.toLowerCase() === match[2].toLowerCase()) : -1;
      if (match && Number(match[1]) === year && month >= 0) totals[month] += Number(customer.amount || 0);
    }
  }
  return totals;
}

export default function ReportsDashboard() {
  const [year, setYear] = useState(currentYear);
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
    const count = Array(12).fill(0);
    const agents = new Map();
    for (const report of reports) {
      const parsed = reportMonthIndex(report.month);
      if (!parsed || parsed.year !== year) continue;
      const total = reportTotal(report);
      agent[parsed.month] += total;
      count[parsed.month] += 1;
      agents.set(report.name, (agents.get(report.name) || 0) + total);
    }
    const customer = getCustomerMonthTotals(customers, year);
    return MONTHS.map((name, index) => ({
      name, agent: agent[index], customer: customer[index],
      combined: agent[index] + customer[index], reports: count[index],
    })).concat({ agents });
  }, [reports, customers, year]);

  const rows = monthly.slice(0, 12);
  const agentTotals = rows.reduce((sum, row) => sum + row.agent, 0);
  const customerTotals = rows.reduce((sum, row) => sum + row.customer, 0);
  const combinedTotal = agentTotals + customerTotals;
  const topAgents = [...(monthly[12]?.agents || new Map())]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.agent, row.customer]));
  const chartHeight = 190;

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
          <button type="button" onClick={load} disabled={loading}>{loading ? "Updating…" : "Refresh"}</button>
        </div>
      </header>

      {error && <div className="reports-error" role="alert">{error} <button type="button" onClick={load}>Try again</button></div>}

      <section className="reports-summary" aria-label="Year summary">
        <article><span>Agent submissions</span><strong>₹{money(agentTotals)}</strong><small>{rows.reduce((sum, row) => sum + row.reports, 0)} reports in {year}</small></article>
        <article className="customer-total"><span>Customer collections</span><strong>₹{money(customerTotals)}</strong><small>Recorded payments in {year}</small></article>
        <article className="combined-total"><span>Combined total</span><strong>₹{money(combinedTotal)}</strong><small>Agents + customers</small></article>
      </section>

      <section className="reports-panel">
        <div className="reports-panel-heading">
          <div><h2>Monthly collection</h2><p>Compare agent reports with customer payment history.</p></div>
          <div className="reports-legend"><span><i className="agent-key" />Agents</span><span><i className="customer-key" />Customers</span></div>
        </div>
        {loading && !updatedAt ? <p className="reports-message">Loading report history…</p> : (
          <div className="reports-chart-scroll">
            <div className="reports-chart" role="img" aria-label={rows.map((row) => `${row.name}: agents ₹${money(row.agent)}, customers ₹${money(row.customer)}`).join("; ")}>
              {rows.map((row) => (
                <div className="reports-chart-month" key={row.name}>
                  <div className="reports-bars">
                    <div className="reports-bar agents-bar" style={{ height: `${Math.max(row.agent ? 3 : 0, row.agent / maxValue * chartHeight)}px` }} title={`Agents: ₹${money(row.agent)}`} />
                    <div className="reports-bar customers-bar" style={{ height: `${Math.max(row.customer ? 3 : 0, row.customer / maxValue * chartHeight)}px` }} title={`Customers: ₹${money(row.customer)}`} />
                  </div>
                  <span>{row.name}</span>
                </div>
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
            <thead><tr><th>Month</th><th>Agent reports</th><th>Agents</th><th>Customers</th><th>Combined</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name} {year}</th>
                <td>{row.reports}</td><td>₹{money(row.agent)}</td><td>₹{money(row.customer)}</td><td className="combined-cell">₹{money(row.combined)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr><th scope="row">Year total</th><td>{rows.reduce((sum, row) => sum + row.reports, 0)}</td><td>₹{money(agentTotals)}</td><td>₹{money(customerTotals)}</td><td>₹{money(combinedTotal)}</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className="reports-panel">
        <div className="reports-panel-heading"><div><h2>Agent totals</h2><p>Submitted report totals for {year}.</p></div></div>
        {topAgents.length === 0 ? <p className="reports-message">No agent reports for this year yet.</p> : (
          <ol className="agent-totals">{topAgents.map((agent, index) => (
            <li key={agent.name}><span className="agent-rank">{index + 1}</span><span className="agent-name">{agent.name}</span><strong>₹{money(agent.amount)}</strong></li>
          ))}</ol>
        )}
      </section>
    </div>
  );
}

