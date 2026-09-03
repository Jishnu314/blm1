import { formatINR, toNumber } from "../lib/currency.js";

function Seal() {
  return (
    <div className="seal" aria-hidden="true">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 12.6l5 5L20 6.5"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * The seal's opposite, and the only mark on this screen that is not good news.
 *
 * A tick that has to be read carefully is worse than no tick, so a refused report
 * does not get one dimmed or greyed — it gets a different mark entirely.
 */
function Bang() {
  return (
    <div className="seal is-refused" aria-hidden="true">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="2.2" />
        <path d="M12 7.2v6.4" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M12 17v.1" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** One line of the breakdown, with the colour that kind of money is drawn in. */
function Line({ label, value, kind }) {
  return (
    <div className="receipt-line">
      <span className={`key key-${kind}`}>{label}</span>
      <strong>₹{formatINR(String(value)) || "0"}</strong>
    </div>
  );
}

/** What the agent sees the moment their report is in. */
export default function Receipt({
  name,
  digits,
  rdCount = 0,
  rdTotal = 0,
  fdCount = 0,
  fdTotal = 0,
  monthLabel,
  synced,
  refused = false,
  note: refusal = "",
  onAgain,
  onFix,
}) {
  // Three states, not two, because the receipt now appears before the server has
  // answered. `synced` is null while the send is still in the air: the agent is
  // already reading their figures and does not need to sit and watch a dimmed
  // screen for however long the round trip takes.
  //
  // Never "saved on this device" as though that were the end of it. A report the
  // server has not taken yet is being held, and held is a promise: the phone sends
  // it by itself the moment it can.
  //
  // There used to be a fourth line here, for "there is no register to send to" —
  // the webhook address was something that might simply never have been filled in.
  // The register is part of the app now, so the only reason a report waits is that
  // this phone could not reach it, and that comes right on its own.
  const waiting = synced == null;
  const note = waiting
    ? "Going into the register now."
    : synced
      ? "It is in the register."
      : "Held on this phone. It goes into the register by itself as soon as you are back online.";

  // The big number is everything this agent brought in this month; the lines
  // under it say where it came from.
  const renewal = toNumber(digits) || 0;
  const total = renewal + rdTotal + fdTotal;

  // A refused report is not a receipt, so it does not get the shape of one.
  //
  // This branch exists because the alternative was a lie the agent had no way to
  // catch: the server had refused the report outright, and the screen showed the
  // seal, the total in green, and a line promising the phone would send it later.
  // It never would. Everything the celebration says — the tick, the figures set in
  // the accent colour, "Thanks" — reads as done, and dimming any of it would not
  // undo that. So none of it is shown.
  //
  // Nothing is lost by leaving: App keeps the name, the amount and every row while
  // the receipt is up, and only clears them when the agent asks for a fresh form.
  if (refused) {
    return (
      <div className="receipt panel" role="alert">
        <Bang />
        <p className="eyebrow">{monthLabel}</p>
        <h1 className="receipt-name">Not recorded</h1>
        {/* The server's own sentence, shown as it stands. It was written for
            whoever typed the box, and rewording it here could only make it
            vaguer — this page does not know what the rule was. */}
        <p className="receipt-note is-error">
          {refusal || "The register would not accept this report."}
        </p>
        <p className="receipt-note">
          Nothing has been sent and nothing has been lost — your figures are still on
          the form. Change what it asks for and send it again.
        </p>
        <button type="button" className="send" onClick={onFix || onAgain}>
          Go back and fix it
        </button>
      </div>
    );
  }

  return (
    <div className="receipt panel" role="status">
      <Seal />
      <p className="eyebrow">{monthLabel}</p>
      <h1 className="receipt-name">Thanks, {name}</h1>
      <div className="receipt-amount">₹{formatINR(String(total)) || "0"}</div>
      <p className="receipt-label">Total for the month</p>

      <div className="receipt-lines">
        <Line label="Renewal" value={renewal} kind="renewal" />
        {rdCount > 0 && (
          <Line
            label={`New RD · ${rdCount} ${rdCount === 1 ? "scheme" : "schemes"}`}
            value={rdTotal}
            kind="rd"
          />
        )}
        {fdCount > 0 && (
          <Line
            label={`New FD · ${fdCount} ${fdCount === 1 ? "scheme" : "schemes"}`}
            value={fdTotal}
            kind="fd"
          />
        )}
      </div>

      <p className="receipt-note">Recorded for {monthLabel}. {note}</p>
      <button type="button" className="ghost" onClick={onAgain}>
        Send another report
      </button>
    </div>
  );
}
