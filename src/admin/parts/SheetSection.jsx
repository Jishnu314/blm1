

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function SheetSection({ connectSheet, health, healthBusy, held, importSheet, mirror, oldest, readHealth, setSheetUrl, sheetBusy, sheetNote, sheetNoteOk, sheetUrl, sheetWord }) {
  return (
<section className="section">
              <div className="section-head">
                <h2 className="section-title">Google Sheet connection</h2>
                {sheetWord && <span className="section-note">{sheetWord}</span>}
              </div>
              <p className="hint">
                Paste the deployed Apps Script web app link ending in <code>/exec</code>. A normal
                spreadsheet link or the temporary <code>/dev</code> link will not connect.
              </p>
              <div className="row">
                <label className="label" htmlFor="sheet-web-app-url">Apps Script web app URL</label>
                <div className="well">
                  <input
                    id="sheet-web-app-url"
                    className="scheme-input"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={sheetUrl}
                    onChange={(event) => setSheetUrl(event.target.value)}
                  />
                </div>
              </div>
              {sheetNote && <p className={sheetNoteOk ? "hint" : "hint is-error"} role="status">{sheetNote}</p>}
              <div className="section-foot">
                <button type="button" className="add" onClick={connectSheet} disabled={sheetBusy || !sheetUrl.trim()}>
                  {sheetBusy ? "Connecting…" : "Save and connect"}
                </button>
                <button type="button" className="mini" onClick={importSheet} disabled={sheetBusy || !mirror?.configured}>
                  {sheetBusy ? "Working…" : "Import existing reports"}
                </button>
              </div>
              <p className="hint">
                Import adds reports that are not already in the register. Repeating the import is safe.
                New form submissions and customer-ledger changes are copied after connection. The
                public Apps Script endpoint does not return the private Customers tab.
              </p>
              <hr className="section-rule" />
              <div className="section-head">
                <h2 className="section-title">Register status</h2>
              </div>
              {health === undefined ? (
                <p className="hint">Asking the server…</p>
              ) : health === null ? (
                <p className="hint is-error">
                  The server did not answer this, so the table below may be this
                  device's last copy rather than the register itself.
                </p>
              ) : (
                <>
                  <p className="hint">
                    The register holds {held} report{held === 1 ? "" : "s"}
                    {oldest ? `, the oldest from ${oldest}` : ""}. Deleted ones are not
                    counted.
                  </p>
                  {!mirror.configured ? (
                    <p className="hint">Connect the Sheet above to copy reports and import existing rows.</p>
                  ) : mirror.queue > 0 ? (
                    <p className="hint">
                      {mirror.queue} thing{mirror.queue === 1 ? "" : "s"} still to copy
                      to the sheet. It tries again by itself every minute, so a number
                      that is falling needs nothing from you.
                    </p>
                  ) : (
                    <p className="hint">The sheet copy is up to date.</p>
                  )}
                  {/* The server's own sentence. A copy that is failing says why here
                      rather than only in a log nobody opens. */}
                  {mirror.lastError && (
                    <p className="hint is-error">The sheet last said: {mirror.lastError}</p>
                  )}
                </>
              )}
              <div className="section-foot">
                <button
                  type="button"
                  className="add"
                  onClick={readHealth}
                  disabled={healthBusy}
                >
                  {healthBusy ? "Asking…" : "Check again"}
                </button>
              </div>
            </section>
  );
}
