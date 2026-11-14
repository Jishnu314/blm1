/** A row the agent tapped "add" on but never filled — dropped, not complained about. */
export const isBlank = (row) => row.digits === "" && row.scheme.trim() === "";

/** Rows worth sending: amount and scheme both present. */
export function cleanRows(rows, toNumber) {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => ({ amount: toNumber(row.digits), scheme: row.scheme.trim() }));
}

export function sumRows(rows, toNumber) {
  return rows.reduce((total, row) => total + (toNumber(row.digits) || 0), 0);
}

/** One message per half-filled row, keyed by row id. */
export function rowErrors(rows, short) {
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
 * Deposit rows are left to the sentence on the receipt: the server counts them by
 * position and this form keys them by row id.
 */
export function errorFor(field, note) {
  if (field === "name") return { name: note };
  if (field === "renewal") return { amount: note };
  if (field === "agentId") return { agentId: note };
  return {};
}

export function agentIdsForName(settings, name) {
  let agentIdMap = {};
  try {
    agentIdMap = JSON.parse(settings.agentIds || "{}");
  } catch {
    agentIdMap = {};
  }
  const enteredNameKey = name.trim().toLowerCase().replace(/\s+/g, " ");
  const raw = enteredNameKey ? agentIdMap[enteredNameKey] : [];
  const matchedAgentIds = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { agentIdMap, enteredNameKey, matchedAgentIds };
}

export function chosenAgentId(matchedAgentIds, selectedAgentId) {
  if (matchedAgentIds.length === 1) return matchedAgentIds[0];
  return matchedAgentIds.includes(selectedAgentId) ? selectedAgentId : "";
}
