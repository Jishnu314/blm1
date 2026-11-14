import { DayBox } from "../fields.jsx";
import { MONTHS } from "../../lib/month.js";

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function WhichMonthSection({ graceDays, mark, mode, monthIndex, pinnedOk, setGraceDays, setMode, setMonthIndex, setYear, year }) {
  return (
<section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Which month</h2>
              </div>
              <div className="choice">
                <button
                  type="button"
                  className={mode === "auto" ? "chip is-on" : "chip"}
                  onClick={() => setMode("auto")}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  className={mode === "pinned" ? "chip is-on" : "chip"}
                  onClick={() => setMode("pinned")}
                >
                  Pin a month
                </button>
              </div>
              {mode === "auto" ? (
                <DayBox
                  id="grace"
                  label="Days at the start of a month that still report the month before"
                  value={graceDays}
                  onChange={setGraceDays}
                  high={28}
                  hint="August's figures arrive up to about 5 September, so 7 is safe. 28 is the most the register takes."
                />
              ) : (
                <div className="row">
                  <label className="label" htmlFor="pin-month">
                    Collect for
                  </label>
                  <div className="pair">
                    <div className="well">
                      <select
                        id="pin-month"
                        className="scheme-input"
                        value={monthIndex}
                        onChange={(event) => setMonthIndex(Number(event.target.value))}
                      >
                        {MONTHS.map((name, index) => (
                          <option key={name} value={index}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="well">
                      <input
                        className="scheme-input"
                        value={year}
                        onChange={(event) =>
                          setYear(Number(event.target.value.replace(/\D/g, "").slice(0, 4)) || 0)
                        }
                        inputMode="numeric"
                        aria-label="Year"
                      />
                    </div>
                  </div>
                  <p className={pinnedOk ? "hint" : "hint is-error"}>
                    {pinnedOk
                      ? "Stays on this month until you switch back to automatic, and is always open — this is how you reopen a month for a late report."
                      : "Type all four digits of the year. Save is waiting for it: the register only takes a month written as 2026-08, and it would refuse every other setting on this page along with it."}
                  </p>
                </div>
              )}
            </section>
  );
}
