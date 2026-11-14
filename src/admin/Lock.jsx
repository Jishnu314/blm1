import { useState } from "react";
import { signIn } from "../lib/auth.js";
import { ENV } from "../lib/environment.js";

export default function Lock({ onUnlock, reachable }) {
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote("");
    const outcome = await signIn(password);
    setBusy(false);
    if (outcome.ok) {
      onUnlock();
      return;
    }
    setNote(outcome.note);
    setPassword("");
  }

  return (
    <div className="app">
      <form className="card lock panel" onSubmit={submit} noValidate>
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          {ENV.adminTitle}
        </p>
        <label className="label" htmlFor="admin-password">
          Password
        </label>
        <div className={note ? "well has-error" : "well"}>
          <input
            id="admin-password"
            className="pin-input"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setNote("");
            }}
            autoComplete="current-password"
            autoFocus
            maxLength={200}
            aria-describedby="password-hint"
          />
        </div>
        <p id="password-hint" className={note ? "hint is-error" : "hint"}>
          {note ||
            (reachable === false
              ? ENV.live
                ? "The server did not answer. Check the connection and try again."
                : "The local server has not answered yet. Run npm run demo."
              : ENV.live
                ? "Live register. Sign in with the admin password."
                : "Test database on this PC. Demo password: demo-admin-10 — this is not the live register.")}
        </p>
        <button type="submit" className="send" disabled={busy}>
          {busy ? "Checking…" : "Open"}
        </button>
      </form>
    </div>
  );
}
