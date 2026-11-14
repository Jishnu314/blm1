import AmountField from "./AmountField.jsx";
import { MAX_NAME } from "../lib/rows.js";

export default function NameCard({
  name,
  setName,
  nameRef,
  amountRef,
  digits,
  setDigits,
  errors,
  matchedAgentIds,
  enteredNameKey,
  agentIdMap,
  agentId,
  setSelectedAgentId,
}) {
  return (
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
          onChange={(event) => {
            setName(event.target.value);
            setSelectedAgentId("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              amountRef.current?.focus();
            }
          }}
          placeholder="e.g. Anil Kumar"
          autoComplete="name"
          enterKeyHint="next"
          maxLength={MAX_NAME}
          aria-describedby="name-hint"
        />
        <p id="name-hint" className={errors.name ? "hint is-error" : "hint"}>
          {errors.name ||
            (matchedAgentIds.length === 1
              ? `Matched agent ID ending ${matchedAgentIds[0].slice(-5)}`
              : enteredNameKey && Object.keys(agentIdMap).length
                ? "No agent ID match yet. Check the name with your team."
                : "The name your team knows you by.")}
        </p>
        {matchedAgentIds.length > 1 && (
          <label className="agent-id-choice">
            <span>Choose your ID</span>
            <select value={agentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
              <option value="">Select ID ending…</option>
              {matchedAgentIds.map((id) => (
                <option key={id} value={id}>
                  …{id.slice(-5)}
                </option>
              ))}
            </select>
            {errors.agentId && <span className="hint is-error">{errors.agentId}</span>}
          </label>
        )}
      </div>

      <AmountField
        digits={digits}
        onChange={setDigits}
        error={errors.amount}
        inputRef={amountRef}
      />
    </div>
  );
}
