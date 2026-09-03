import { useEffect, useRef, useState } from "react";
import AmountField from "./components/AmountField.jsx";
import DepositSection from "./components/DepositSection.jsx";
import Receipt from "./components/Receipt.jsx";
import Popup from "./components/Popup.jsx";
import Board from "./components/Board.jsx";
import { reportMonth, isCollectionOpen } from "./lib/month.js";
import { toNumber } from "./lib/currency.js";
import { sendEntry, flushOutbox } from "./lib/submit.js";
import { loadSettings, fetchSettings } from "./lib/settings.js";
import { shouldShow, markSeen, readSeen, popupLive } from "./lib/popup.js";
import { boardLive } from "./lib/board.js";
import { thud } from "./lib/haptics.js";
import { blankRow, MAX_DEPOSIT_ROWS, MAX_NAME } from "./lib/rows.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A row the agent tapped "add" on but never filled — dropped, not complained about. */
const isBlank = (row) => row.digits === "" && row.scheme.trim() === "";

/** Rows worth sending: amount and scheme both present. */
function cleanRows(rows) {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => ({ amount: toNumber(row.digits), scheme: row.scheme.trim() }));
}

function sumRows(rows) {
  return rows.reduce((total, row) => total + (toNumber(row.digits) || 0), 0);
}

/** One message per half-filled row, keyed by row id. */
function rowErrors(rows, short) {
  const found = {};
  for (const row of rows) {
    if (isBlank(row)) continue;
    if (row.digits === "") found[row.id] = `Enter the ${short} amount.`;
    else if (row.scheme.trim() === "") found[row.id] = "Type the scheme name.";
  }
  return found;
}

/**
 * Where a refusal's `field` belongs on this form.
 *
 * The server names the field in its own words — "name", "renewal", "rd[2].scheme" —
 * because those are the names in API.md. Two of them are boxes this form can point
 * at. The deposit rows are not: the server counts them by position and this form
 * keys them by row id, and a message put against the wrong row would be worse than
 * one put against none. Those are left to the sentence on the receipt, which names
 * the row itself.
 */
function errorFor(field, note) {
  if (field === "name") return { name: note };
  if (field === "renewal") return { amount: note };
  return {};
}

export default function App() {
  const [name, setName] = useState("");
  const [digits, setDigits] = useState("");
  const [rd, setRd] = useState([]);
  const [fd, setFd] = useState([]);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | sending | done
  const [result, setResult] = useState(null);
  // What the admin set: which month, how long the grace runs, whether we are open.
  const [settings, setSettings] = useState(loadSettings);
  // Decided once, on open — not during every render, or it would spring back up
  // the moment the agent typed a digit. Once a day per agent, and again straight
  // away if the admin has since changed what it says.
  const [showPopup, setShowPopup] = useState(() =>
    shouldShow(loadSettings(), new Date(), readSeen())
  );
  const nameRef = useRef(null);
  const amountRef = useRef(null);
  // Which box to put the cursor in once the form is back on screen after a
  // refusal. It has to wait for a render: at the moment goFix() runs, the receipt
  // is still what is mounted and both refs above point at nothing.
  const [toFocus, setToFocus] = useState("");
  // Which send the receipt on screen belongs to. A reply that arrives after the
  // agent has already started their next report must not touch the new receipt.
  const attemptRef = useRef(0);

  // Anything this phone could not send gets another try on every open, and the
  // server gets to correct our idea of the report month.
  useEffect(() => {
    flushOutbox();
    fetchSettings().then((fresh) => {
      if (!fresh) return;
      setSettings(fresh);
      // Re-asked rather than only turned on: the admin may have raised a new
      // announcement, or taken one down, since this device last heard.
      setShowPopup(shouldShow(fresh, new Date(), readSeen()));
    });
  }, []);

  // The cursor, put in the box a refusal named, on the render after the form comes
  // back. Cleared as soon as it is used so that the next ordinary render does not
  // steal focus from wherever the agent has since moved it.
  useEffect(() => {
    if (status !== "idle" || toFocus === "") return;
    if (toFocus === "name") nameRef.current?.focus();
    else if (toFocus === "renewal") amountRef.current?.focus();
    setToFocus("");
  }, [status, toFocus]);

  /** Closing it is what records that this agent has seen today's announcement. */
  function closePopup() {
    markSeen(settings);
    setShowPopup(false);
  }

  const announcement = showPopup ? (
    <Popup settings={settings} onClose={closePopup} />
  ) : null;

  // Closing the popup must not be the same as losing it: an agent who tapped
  // past it, or who saw it yesterday, can put it back up. Rendered whenever
  // there is a live announcement — including while it is up — so that closing
  // the popup never shifts the form underneath it.
  const seeAgain = popupLive(settings, new Date()) ? (
    <button type="button" className="again" onClick={() => setShowPopup(true)}>
      See the announcement
    </button>
  ) : null;

  const month = reportMonth(new Date(), settings);

  // The standing, when there is one to show. Switched on and holding at least one
  // name — an empty board is not the same as a board that is off, but it looks
  // the same, because there is nothing to say. It goes on the closed screen too:
  // a month is usually tallied after collection shuts, which is exactly when the
  // names get typed in.
  const standing = boardLive(settings) ? <Board settings={settings} /> : null;

  const rdTotal = sumRows(rd);
  const fdTotal = sumRows(fd);

  function editRows(setRows) {
    return {
      change: (id, patch) =>
        setRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row))),
      // The new row's id is read off the rows it is joining, so this updater gives
      // the same answer however many times React runs it.
      //
      // The limit is checked here as well as in DepositSection, which hides the
      // button at twenty. Two guards for one rule, on purpose: the hidden button is
      // what an agent sees, and this is what makes twenty true rather than merely
      // un-offered.
      add: () =>
        setRows((rows) => (rows.length >= MAX_DEPOSIT_ROWS ? rows : [...rows, blankRow(rows)])),
      remove: (id) => setRows((rows) => rows.filter((row) => row.id !== id)),
    };
  }
  const rdEdit = editRows(setRd);
  const fdEdit = editRows(setFd);

  async function handleSubmit(event) {
    event.preventDefault();
    if (status === "sending") return;

    const found = {
      rd: rowErrors(rd, "RD"),
      fd: rowErrors(fd, "FD"),
    };
    if (name.trim().length < 2) {
      found.name = "Type your name so we know whose figures these are.";
    }
    if (digits === "") {
      found.amount = "Enter the amount — put 0 if there was no renewal.";
    }
    setErrors(found);

    const blocked =
      found.name ||
      found.amount ||
      Object.keys(found.rd).length > 0 ||
      Object.keys(found.fd).length > 0;
    if (blocked) {
      thud();
      if (found.name) nameRef.current?.focus();
      else if (found.amount) amountRef.current?.focus();
      return;
    }

    // Half-tapped empty rows disappear rather than travelling to the register.
    setRd((rows) => rows.filter((row) => !isBlank(row)));
    setFd((rows) => rows.filter((row) => !isBlank(row)));

    setStatus("sending");

    // The agent waited two to four seconds here, and almost none of it was ours: a
    // POST to an Apps Script /exec URL was a cold start, a redirect the browser
    // followed, and only then the script opening the spreadsheet. That is the
    // server's problem now — it pushes the copy to the sheet in its own time, and a
    // slow Google no longer shows up as a slow phone.
    //
    // The send is still not waited for, and it still should not be. Our own server
    // sleeps on a free plan and wakes on the first request, a phone on 3G in a
    // building is a phone on 3G in a building, and neither is worth holding a form
    // still for. The screen dims only long enough to read as a deliberate press,
    // and the receipt comes up with its last line saying the report is on its way.
    // When the server answers, that line becomes "It is in the register" — or, if
    // it could not be reached, "Held on this phone", which is the truth and is
    // already recoverable: attempt() has queued it and flushOutbox() sends it on
    // the next load.
    //
    // Nothing is claimed that is not known. The figures on the receipt are the
    // agent's own typing, so they are right the instant they are shown; only the
    // one line about where the report has got to has to wait, and it says so.
    const mine = attemptRef.current + 1;
    attemptRef.current = mine;
    const sending = sendEntry({
      name,
      renewal: toNumber(digits),
      rd: cleanRows(rd),
      fd: cleanRows(fd),
      month: month.key,
      monthLabel: month.full,
    });

    await wait(420);
    setResult({
      name: name.trim(),
      digits,
      rdCount: cleanRows(rd).length,
      rdTotal,
      fdCount: cleanRows(fd).length,
      fdTotal,
      synced: null,
    });
    setStatus("done");

    const outcome = await sending;
    if (attemptRef.current !== mine) return;
    // A refusal travels on the result rather than being acted on here, because the
    // receipt is already up: the agent is reading their own figures, and the honest
    // thing is to correct that screen rather than to snatch it away and leave them
    // wondering what they saw. Receipt shows the server's sentence and offers one
    // button back to the form. See its `refused` branch.
    setResult((was) =>
      was
        ? {
            ...was,
            synced: outcome.synced,
            refused: outcome.refused,
            note: outcome.note,
            field: outcome.field,
          }
        : was
    );
    if (outcome.refused) thud();
  }

  /**
   * Back to the form after a refusal, with everything still in it.
   *
   * Nothing is cleared, and that is the difference between this and startAgain():
   * the report was never recorded, so there is nothing to start again from. The
   * name, the amount and every row are exactly where the agent left them, with the
   * server's message now against the box it named.
   */
  function goFix() {
    const field = String(result?.field || "");
    setErrors(errorFor(field, String(result?.note || "")));
    setResult(null);
    setStatus("idle");
    setToFocus(field);
  }

  function startAgain() {
    setName("");
    setDigits("");
    setRd([]);
    setFd([]);
    setErrors({});
    setResult(null);
    setStatus("idle");
  }

  if (!isCollectionOpen(new Date(), settings)) {
    return (
      <div className="app">
        {announcement}
        <main className="card">
          <div className="panel">
            <p className="eyebrow">
              <span className="dot" aria-hidden="true" />
              Monthly report collection
            </p>
            <h1 className="month">
              {month.name}
              <span className="month-year">{month.year}</span>
            </h1>
            <p className="lede">
              Collection is closed for now. Your leader will reopen it when the next
              month's figures are due.
            </p>
            {seeAgain}
          </div>
          {standing}
        </main>
        <p className="credit">{settings.credit}</p>
      </div>
    );
  }

  return (
    <div className="app">
      {announcement}
      <main className={status === "sending" ? "card is-sending" : "card"}>
        {status === "done" && result ? (
          <Receipt
            {...result}
            monthLabel={month.full}
            onAgain={startAgain}
            onFix={goFix}
          />
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <header className="head">
              <p className="eyebrow">
                <span className="dot" aria-hidden="true" />
                Monthly report collection
              </p>
              <h1 className="month">
                {month.name}
                <span className="month-year">{month.year}</span>
              </h1>
              <p className="lede">Your figures for this month.</p>
              {seeAgain}
            </header>

            {/* Whatever the admin wants every agent to read first. Deliberately
                not a .panel — it should not look like part of the form. */}
            {String(settings.message || "").trim() !== "" && (
              <aside className="notice">
                <p className="notice-tag">Announcement</p>
                <p className="notice-text">{settings.message}</p>
              </aside>
            )}

            {/* Above the questions, below the announcement: seen on the way in,
                and not standing between an agent and the figure they came to
                type. */}
            {standing}

            {/* The two answers we must have, in one card. */}
            <div className="panel">
              <div className="field">
                <label className="label" htmlFor="agent-name">
                  Your name
                </label>
                <input
                  id="agent-name"
                  ref={nameRef}
                  className="well name-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    // "next" on the phone keyboard should mean next, not submit.
                    if (event.key === "Enter") {
                      event.preventDefault();
                      amountRef.current?.focus();
                    }
                  }}
                  placeholder="e.g. Anil Kumar"
                  autoComplete="name"
                  enterKeyHint="next"
                  /* The register takes 80 characters and refuses the report over
                     that. Stopping the typing is kinder than refusing the report:
                     nobody's name is 81 characters, so the only way to reach this
                     is a phone's keyboard repeating, and that should cost nothing. */
                  maxLength={MAX_NAME}
                  aria-describedby="name-hint"
                />
                <p id="name-hint" className={errors.name ? "hint is-error" : "hint"}>
                  {errors.name || "The name your team knows you by."}
                </p>
              </div>

              <AmountField
                digits={digits}
                onChange={setDigits}
                error={errors.amount}
                inputRef={amountRef}
              />
            </div>

            {settings.showRd !== false && (
              <DepositSection
                title="New RD"
                short="RD"
                rows={rd}
                errors={errors.rd || {}}
                onChangeRow={rdEdit.change}
                onAddRow={rdEdit.add}
                onRemoveRow={rdEdit.remove}
                total={rdTotal}
              />
            )}

            {settings.showFd !== false && (
              <DepositSection
                title="New FD"
                short="FD"
                rows={fd}
                errors={errors.fd || {}}
                onChangeRow={fdEdit.change}
                onAddRow={fdEdit.add}
                onRemoveRow={fdEdit.remove}
                total={fdTotal}
              />
            )}

            <button type="submit" className="send" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send my report"}
            </button>
          </form>
        )}
      </main>
      <p className="credit">{settings.credit}</p>
    </div>
  );
}
