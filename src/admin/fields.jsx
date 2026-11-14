/**
 * Shared admin controls. A settings patch is accepted or refused as one thing,
 * so a day box never holds a number the register will reject.
 */
export function DayBox({ id, label, value, onChange, hint, high }) {
  const type = (typed) => {
    const said = typed.replace(/\D/g, "").slice(0, 2);
    if (said !== "" && Number(said) > high) return;
    onChange(said);
  };

  return (
    <div className="row">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="well">
        <input
          id={id}
          className="scheme-input"
          value={value}
          onChange={(event) => type(event.target.value)}
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** A labelled on/off row. Every yes-or-no setting on this page is one of these. */
export function Toggle({ label, on, onToggle, onText = "Open", offText = "Closed" }) {
  return (
    <div className="row switch-row">
      <span className="switch-label">{label}</span>
      <button
        type="button"
        className={on ? "switch is-on" : "switch"}
        onClick={onToggle}
        aria-pressed={on}
      >
        {on ? onText : offText}
      </button>
    </div>
  );
}

/** Browser date control. Value is YYYY-MM-DD. */
export function DateBox({ id, label, value, onChange }) {
  return (
    <div className="row">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="well">
        <input
          id={id}
          type="date"
          className="scheme-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
