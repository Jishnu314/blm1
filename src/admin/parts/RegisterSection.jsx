import { ago, SPAN, entryTotal } from "../format.js";
import AgentChart from "../AgentChart.jsx";
import { describeKey } from "../../lib/month.js";
import { MoneyHead, EntryRow, Num, download, SheetMark } from "../registerView.jsx";
import { formatINR } from "../../lib/currency.js";

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function RegisterSection({ applyEdit, bin, binBusy, binNote, binOk, binOpen, chooseReportMonth, collected, confirming, drop, editing, effective, entries, monthKeys, now, paused, putBack, putting, read, reading, refresh, setConfirming, setEditing, setShowAll, showAll, shown, sums, teamMonths, teamScale, toggleBin, viewKey, viewLabel }) {
  return (
<section className="section">
              <div className="section-head">
                <h2 className="section-title">Every report</h2>
                <span className="section-note">
                  {shown.length} {shown.length === 1 ? "report" : "reports"}
                  {viewKey ? ` in ${viewLabel}` : ""} · figures in ₹
                </span>
              </div>

              {/* Where these figures came from and how old they are. It re-reads
                  itself every half minute, so this line is the difference between
                  trusting the screen and reloading the page to be sure. Three
                  states, not five: a read that has just failed and a read that has
                  not happened yet leave you in the same position — looking at the
                  register as it was, whenever that was. Being signed out is the one
                  failure named separately, because waiting will not fix it. */}
              <div className="read-line">
                <span
                  className={read.from === "server" ? "read-word" : "read-word is-stale"}
                  title={read.error || undefined}
                >
                  {read.signedOut
                    ? "Signed out — reload and sign in"
                    : reading
                      ? "Reading…"
                      : read.from === "server"
                        ? `Read ${ago(read.at, now)}`
                        : read.at
                          ? `As it was ${ago(read.at, now)}`
                          : "Not read yet"}
                </span>
                <button type="button" className="mini" onClick={refresh} disabled={reading}>
                  {reading ? "Reading…" : "Refresh"}
                </button>
              </div>
              {paused && (
                <p className="hint">
                  Holding still while you finish — nothing will move under you until you
                  save, cancel or keep.
                </p>
              )}

              {/* The register as a shape: every agent added together, month by
                  month, drawn with the same chart as the agent above — renewal,
                  new RD and new FD side by side, so a month says which kind of
                  money it was as well as how much. It always reads to the month
                  being collected, whichever month the list underneath is showing:
                  the picker chooses the rows you read, not the six months the
                  year is judged over. */}
              {entries.length > 0 && (
                <>
                  <div className="section-head chart-head">
                    <h3 className="chart-title">Every month</h3>
                    <span className="section-note">
                      everyone together · {SPAN} months to {effective.full} · figures in ₹
                    </span>
                  </div>

                  <AgentChart months={teamMonths} max={teamScale} name="Everyone together" selectedMonth={viewKey} onSelectMonth={chooseReportMonth} />
                </>
              )}

              {/* Look back at a month that has already been collected. */}
              {monthKeys.length > 1 && (
                <div className="month-pick">
                  <label className="month-pick-label" htmlFor="view-month">
                    Showing
                  </label>
                  <select
                    id="view-month"
                    className="scheme-input month-select"
                    value={viewKey}
                    onChange={(event) => chooseReportMonth(event.target.value)}
                  >
                    <option value="">All months</option>
                    {viewKey && !monthKeys.includes(viewKey) && (
                      <option value={viewKey}>{describeKey(viewKey)?.full || viewKey}</option>
                    )}
                    {[...monthKeys].reverse().map((key) => (
                      <option key={key} value={key}>
                        {describeKey(key)?.full || key}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {entries.length === 0 ? (
                <p className="hint">
                  Nothing yet. Every report any agent sends lands in the register and
                  shows up here, newest first.
                </p>
              ) : (
                <>
                  <div className="sheet-wrap">
                    <table className="sheet">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Month</th>
                          <MoneyHead />
                          <th className="acts">
                            <span className="sr-only">Edit or delete</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.length === 0 && viewKey && (
                          <tr>
                            <td className="empty-cell is-nil" colSpan={7}>No reports in {viewLabel}.</td>
                          </tr>
                        )}
                        {(showAll ? shown : shown.slice(0, 8)).map((entry) => (
                          <EntryRow
                            key={entry.id}
                            entry={entry}
                            mode={
                              editing === entry.id
                                ? "edit"
                                : confirming === entry.id
                                  ? "confirm"
                                  : "view"
                            }
                            on={{
                              edit: () => {
                                setConfirming("");
                                setEditing(entry.id);
                              },
                              cancel: () => setEditing(""),
                              save: (patch) => applyEdit(entry.id, patch),
                              ask: () => setConfirming(entry.id),
                              keep: () => setConfirming(""),
                              remove: () => drop(entry.id),
                            }}
                          />
                        ))}
                      </tbody>
                      {/* Every report added up, whether or not the list is cut
                          short — and nothing in the Month column, which has no
                          single month to name. */}
                      <tfoot>
                        <tr>
                          <td className="name-cell">Total</td>
                          <td />
                          <Num value={sums.renewal} col="renewal" />
                          <Num value={sums.rd} col="rd" />
                          <Num value={sums.fd} col="fd" />
                          <Num value={collected} col="total" />
                          <td className="acts" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="section-foot">
                    <button type="button" className="add" onClick={() => download(shown)}>
                      {viewKey ? `Download ${viewLabel} CSV` : "Download CSV"}
                    </button>
                    {shown.length > 8 && (
                      <button type="button" className="mini" onClick={() => setShowAll(!showAll)}>
                        {showAll ? "Show fewer" : `Show all ${shown.length}`}
                      </button>
                    )}
                  </div>
                </>
              )}
              {/* What the marks mean, spelled out beside the table rather than
                  left to be guessed at. Each one names the place the change was
                  made, because that is the question a mark on a row provokes. */}
              <dl className="legend">
                <dt className="legend-mark">
                  <span aria-hidden="true">✎</span>
                </dt>
                <dd className="legend-word">corrected here, on the web</dd>
                <dt className="legend-mark">
                  <SheetMark />
                </dt>
                <dd className="legend-word">
                  edited by hand in the old Google Sheet, before it became a copy
                </dd>
                <dt className="legend-mark">
                  <span aria-hidden="true">✱</span>
                </dt>
                <dd className="legend-word">not sent yet — this device is still trying</dd>
              </dl>
              <p className="hint">
                Edit corrects the row here, Delete asks once and then takes it out of the
                register — the row is kept, so a delete can be undone. The Google Sheet is
                a copy now: editing a figure there changes nothing, and the grid mark
                stays on old rows as history.
              </p>

              {/* The bin, shut until it is asked for. A list of reports that are not in
                  the register does not belong in the eye-line of the register, and
                  deleting one is rare enough that undoing one is rarer. Read as it
                  opens and after anything moves — never on the poll, so a page left
                  open all afternoon is not asking a sleeping server about an empty
                  bin every half minute. */}
              <div className="section-foot">
                <button
                  type="button"
                  className="mini"
                  onClick={toggleBin}
                  aria-expanded={binOpen}
                >
                  {binOpen ? "Hide deleted reports" : "Deleted reports"}
                </button>
                {binOpen && (
                  <span className="section-note">
                    {binBusy
                      ? "reading…"
                      : Array.isArray(bin)
                        ? bin.length === 0
                          ? "nothing deleted"
                          : `${bin.length} can be put back`
                        : ""}
                  </span>
                )}
              </div>

              {binOpen && (
                <>
                  {/* Not the same sentence as an empty bin, because they are opposite
                      facts and only one of them means everything is fine. */}
                  {bin === null && (
                    <p className="hint is-error">
                      {binNote ||
                        "The bin could not be read. The register itself is fine — try opening it again in a moment."}
                    </p>
                  )}
                  {Array.isArray(bin) && bin.length === 0 && (
                    <p className="hint">
                      Nothing has been deleted. A report taken out of the register waits
                      here rather than being destroyed, so it can always be put back.
                    </p>
                  )}
                  {Array.isArray(bin) && bin.length > 0 && (
                    <div className="bin">
                      {bin.map((one) => (
                        <div className="held" key={one.id}>
                          <span className="held-word bin-what">
                            <b className="bin-who">{one.name}</b>
                            {/* What it was worth and when it went, so a report can be
                                recognised without putting it back to look at it. */}
                            <span className="bin-when">
                              {one.monthLabel} · ₹{formatINR(String(entryTotal(one)))} ·
                              deleted {ago(one.deletedAt, now) || "earlier"}
                            </span>
                          </span>
                          {/* Disabled for every row while any one of them is in
                              flight, not just for the row being restored: two
                              restores at once each read the register back, and the
                              second answer would land without the first in it. */}
                          <button
                            type="button"
                            className="mini"
                            onClick={() => putBack(one)}
                            disabled={putting !== "" || binBusy}
                          >
                            {putting === one.id ? "Putting back…" : "Put it back"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {binNote !== "" && bin !== null && (
                    <p className={binOk ? "hint" : "hint is-error"}>{binNote}</p>
                  )}
                </>
              )}
            </section>
  );
}
