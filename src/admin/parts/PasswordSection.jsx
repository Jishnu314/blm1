

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function PasswordSection({ changeIt, pwBusy, pwNext, pwNote, pwNow, setPwNext, setPwNote, setPwNow }) {
  return (
<section className="section">
              <div className="section-head">
                <h2 className="section-title">The password for this page</h2>
              </div>
              <div className="row">
                <label className="label" htmlFor="pw-now">
                  The one you use now
                </label>
                <div className="well">
                  <input
                    id="pw-now"
                    className="scheme-input"
                    type="password"
                    value={pwNow}
                    onChange={(event) => {
                      setPwNow(event.target.value);
                      setPwNote("");
                    }}
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <div className="row">
                <label className="label" htmlFor="pw-next">
                  The new one
                </label>
                <div className="well">
                  <input
                    id="pw-next"
                    className="scheme-input"
                    type="password"
                    value={pwNext}
                    onChange={(event) => {
                      setPwNext(event.target.value);
                      setPwNote("");
                    }}
                    autoComplete="new-password"
                    /* The server refuses anything longer, and a password box that
                       silently held more than could be sent would refuse a password
                       the admin believes they have set. */
                    maxLength={200}
                  />
                </div>
              </div>
              <div className="section-foot">
                {/* Ten is the server's minimum, and the line below already says so,
                    which is what makes waiting for the tenth character an answer
                    rather than a dead button. */}
                <button
                  type="button"
                  className="add"
                  onClick={changeIt}
                  disabled={pwBusy || pwNow === "" || pwNext.length < 10}
                >
                  {pwBusy ? "Changing…" : "Change it"}
                </button>
              </div>
              <p className="hint">
                {pwNote ||
                  "At least ten characters. Changing it signs every other device out — which is what to do if you ever think somebody else has it."}
              </p>
            </section>
  );
}
