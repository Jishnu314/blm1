import { toDigits, formatINR } from "../lib/currency.js";
import { MAX_DEPOSIT_ROWS, MAX_SCHEME } from "../lib/rows.js";

/**
 * New RD or new FD: nothing at all until the agent taps "add", then one row per
 * deposit. Amount first, scheme name under it — that is the order the figures
 * arrive in when an agent reads from their own notes.
 *
 * The colour comes from `short`: "RD" and "FD" each have one, and it is carried
 * by the amounts, the add button and the swatch on the heading, so the section
 * matches its bars in the admin chart.
 *
 * Twenty rows is where "add" stops. The register refuses a twenty-first, so
 * offering one would be offering something that cannot be sent — and the cost of
 * finding that out afterwards is the whole report, not the extra row.
 */
export default function DepositSection({
  title,
  short,
  rows,
  errors,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  total,
}) {
  const kind = String(short).toLowerCase(); // "rd" | "fd"
  const full = rows.length >= MAX_DEPOSIT_ROWS;

  return (
    <section className={`section is-${kind}`}>
      <div className="section-head">
        <h2 className={`section-title key key-${kind}`}>{title}</h2>
        {rows.length === 0 && <span className="section-note">optional</span>}
      </div>

      {rows.map((row, index) => (
        <div className="deposit" key={row.id}>
          <div className="deposit-top">
            <div className={errors[row.id] ? "well plate is-small has-error" : "well plate is-small"}>
              <span className="rupee" aria-hidden="true">
                ₹
              </span>
              <input
                className="amount-input is-small"
                value={formatINR(row.digits)}
                onChange={(event) =>
                  onChangeRow(row.id, { digits: toDigits(event.target.value) })
                }
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                aria-label={`${short} ${index + 1} amount`}
              />
            </div>
            <button
              type="button"
              className="remove"
              onClick={() => onRemoveRow(row.id)}
              aria-label={`Remove ${short} ${index + 1}`}
            >
              ×
            </button>
          </div>

          <div className="well">
            <input
              className="scheme-input"
              value={row.scheme}
              onChange={(event) => onChangeRow(row.id, { scheme: event.target.value })}
              placeholder="Scheme name"
              autoComplete="off"
              /* The register takes 80 characters. The phone stops at 80 rather
                 than letting the 81st be typed and then refusing the report it
                 was part of. */
              maxLength={MAX_SCHEME}
              aria-label={`${short} ${index + 1} scheme name`}
            />
          </div>

          {errors[row.id] && <p className="hint is-error">{errors[row.id]}</p>}
        </div>
      ))}

      <div className="section-foot">
        {/* Gone rather than greyed out at the limit. A dead button is a thing to
            wonder about; a sentence saying twenty is the most is an answer. */}
        {full ? (
          <span className="section-note">
            {MAX_DEPOSIT_ROWS} is the most {short} rows one report can carry.
          </span>
        ) : (
          <button type="button" className="add" onClick={onAddRow}>
            + Add {short}
          </button>
        )}
        {total > 0 && (
          <span className="section-total">
            {short} total <strong>₹{formatINR(String(total))}</strong>
          </span>
        )}
      </div>
    </section>
  );
}
