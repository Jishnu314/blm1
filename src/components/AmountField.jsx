import { toDigits, formatINR } from "../lib/currency.js";

/**
 * The amount, pressed into the surface like a stamped plate.
 * Typing happens on the device's own numeric keyboard — inputMode="numeric"
 * is what tells a phone to open the number pad instead of the letter one.
 * The digits are grouped (1,25,000) as they are typed.
 */
export default function AmountField({ digits, onChange, error, inputRef }) {
  const shown = formatINR(digits);

  return (
    <div className="field">
      <label className="label key key-renewal" htmlFor="renewal-amount">
        Renewal this month
      </label>

      <div className={error ? "well plate has-error" : "well plate"}>
        <span className="rupee" aria-hidden="true">
          ₹
        </span>
        <input
          id="renewal-amount"
          ref={inputRef}
          className="amount-input"
          value={shown}
          onChange={(event) => onChange(toDigits(event.target.value))}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0"
          aria-describedby="amount-hint"
        />
      </div>

      <p id="amount-hint" className={error ? "hint is-error" : "hint"}>
        {error || "Whole rupees."}
      </p>
    </div>
  );
}
