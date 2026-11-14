import { formatINR } from "../../lib/currency.js";
import { SPAN } from "../format.js";
import AgentChart from "../AgentChart.jsx";
import { MoneyHead, Num } from "../registerView.jsx";

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function AgentsSection({ agent, agentIdAddOpen, agentIdDrafts, agentIdNote, agentIdSaving, agentIds, agents, applyAgentId, chooseReportMonth, effective, months, ranked, read, scale, setAgentIdAddOpen, setAgentIdDrafts, setPicked, viewKey }) {
  return (
<section className="section">
              <div className="section-head">
                <h2 className="section-title">Each agent, month by month</h2>
                <span className="section-note">
                  {agents.length} {agents.length === 1 ? "agent" : "agents"}
                </span>
              </div>

              {agents.length === 0 ? (
                <p className="hint">
                  {read.signedOut
                    ? "This browser has been signed out, so the register cannot be read. Reload the page and sign in again."
                    : "No reports yet, so there is nothing to chart. This reads every agent's months from the server, whichever phone they were sent from."}
                </p>
              ) : (
                <>
                  {/* The big figure on a card is what that agent brought in for the
                      month being collected — that is the question you open this page
                      with. The small line is everything up to that month. */}
                  <div className="agents">
                    {ranked.map((one) => {
                      const rosterKey = one.name.trim().toLowerCase().replace(/\s+/g, " ");
                      const ids = agentIds[rosterKey] || [];
                      const shownIds = one.agentId ? [one.agentId] : ids;
                      const addingId = !ids.length || (!one.agentId && agentIdAddOpen[rosterKey]);
                      return <div key={one.id} className={one.id === agent.id ? "agent-card is-on" : "agent-card"}>
                        <button
                          type="button"
                          className="agent"
                          onClick={() => setPicked(one.id)}
                        >
                          <span className="agent-name">{one.name}</span>
                          {shownIds.map((id) => <span className="agent-id-badge" key={id}>ID {id}</span>)}
                        </button>
                        {addingId ? <div className="agent-id-field">
                          <span>ID</span>
                          <input
                            value={agentIdDrafts[rosterKey] || ""}
                            disabled={agentIdSaving === rosterKey}
                            maxLength={32}
                            placeholder="Add ID"
                            aria-label={`Agent ID for ${one.name}`}
                            onChange={(event) => {
                              setAgentIdDrafts((current) => ({ ...current, [rosterKey]: event.target.value }));
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <button
                            type="button"
                            className="agent-id-apply"
                            disabled={!String(agentIdDrafts[rosterKey] || "").trim() || Boolean(agentIdSaving)}
                            onClick={() => applyAgentId(rosterKey)}
                          >{agentIdSaving === rosterKey ? "Saving" : "Apply"}</button>
                        </div> : !one.agentId && <button type="button" className="agent-id-add" onClick={() => {
                          setAgentIdDrafts((current) => ({ ...current, [rosterKey]: "" }));
                          setAgentIdAddOpen((current) => ({ ...current, [rosterKey]: true }));
                        }}>Add another ID</button>}
                        <button
                          type="button"
                          className="agent agent-details"
                          onClick={() => setPicked(one.id)}
                          aria-label={`View ${one.name}`}
                        >
                          <span className={one.mine > 0 ? "agent-total" : "agent-total is-none"}>
                            {one.mine > 0 ? `₹${formatINR(String(one.mine))}` : "—"}
                          </span>
                          <span className="agent-when">
                            in {effective.name} · ₹{formatINR(String(one.sofar.total))} to date
                          </span>
                        </button>
                      </div>;
                    })}
                  </div>
                  {agentIdNote && <p className="agent-id-note" role="status">{agentIdNote}</p>}

                  <div className="section-head chart-head">
                    <h3 className="chart-title">{agent.name}</h3>
                    <span className="section-note">
                      {SPAN} months to {effective.full} · figures in ₹
                    </span>
                  </div>

                  <AgentChart months={months} max={scale} name={agent.name} selectedMonth={viewKey} onSelectMonth={chooseReportMonth} />

                  {/* The same months as exact figures — the chart is the shape,
                      this is the number you read out to someone. It stops where
                      the chart stops: with the collection pinned to July, a report
                      that counts for August is not part of July's standing. It is
                      still there to read in the register below. */}
                  <div className="sheet-wrap">
                    <table className="sheet">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <MoneyHead />
                          <th>Reports</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agent.listed.map((month) => (
                          <tr key={month.key}>
                            <td className="name-cell">{month.label}</td>
                            <Num value={month.renewal} col="renewal" />
                            <Num value={month.rd} col="rd" />
                            <Num value={month.fd} col="fd" />
                            <Num value={month.total} col="total" />
                            <td className="num c-count">{month.count}</td>
                          </tr>
                        ))}
                        {agent.listed.length === 0 && (
                          <tr>
                            <td className="name-cell">—</td>
                            <td className="empty-cell is-nil" colSpan={5}>
                              Nothing up to {effective.full}. Their later reports are in the
                              register below.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="name-cell">Total</td>
                          <Num value={agent.sofar.renewal} col="renewal" />
                          <Num value={agent.sofar.rd} col="rd" />
                          <Num value={agent.sofar.fd} col="fd" />
                          <Num value={agent.sofar.total} col="total" />
                          <td className="num c-count">{agent.sofar.reports}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </section>
  );
}
