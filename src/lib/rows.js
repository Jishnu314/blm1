// Ids for the repeatable deposit rows, and the few limits those rows have.
//
// The ids are the bulk of it, and they are here because of one bug that was hard
// to see. Row ids used to come from a counter kept beside the component:
//
//   let seq = 0;
//   const blankRow = () => ({ id: `r${(seq += 1)}`, digits: "", scheme: "" });
//
// which is fine until something resets that counter while the rows themselves
// survive. Two ordinary things do exactly that. Vite's hot reload re-runs the
// module after a save but leaves React's state alone. And React deliberately
// re-runs a state updater to check it is pure, which a counter is not.
//
// Either way the next row is handed an id a row already has. Both rows then
// answer to the same id, so typing in one writes into both, and React's `key`
// list has a duplicate in it. On screen a row appears to fill itself in.
//
// The fix is to stop keeping a count. The next id is read off the rows, so it is
// a function of the state it belongs to: nothing to get out of step, and running
// it twice gives the same answer.

/**
 * The next id for a list of rows: one past the highest number already in it.
 *
 * Ids look like "r3" or "e12" — the prefix only says which list they came from,
 * so a row from an older shape of this data, or one with no number at all, is
 * simply ignored rather than throwing the count off.
 */
export function nextRowId(rows = [], prefix = "r") {
  let top = 0;
  for (const row of rows) {
    const found = /^\D*(\d+)$/.exec(String((row && row.id) || ""));
    if (!found) continue;
    const number = Number(found[1]);
    if (Number.isFinite(number) && number > top) top = number;
  }
  return `${prefix}${top + 1}`;
}

/** A fresh empty deposit row for a list, safe to append. */
export function blankRow(rows = [], prefix = "r") {
  return { id: nextRowId(rows, prefix), digits: "", scheme: "" };
}

/**
 * How many deposit rows one report may carry, per section.
 *
 * The same number as MAX_ROWS in server/src/lib/validate.js, and it is here rather
 * than only there because the two are used for opposite purposes: the server's
 * refuses a 21st row, this one stops a 21st row being offered. A limit an agent can
 * type past and only hear about afterwards is a limit that costs somebody their
 * evening — the whole report came back 400, and before this app could tell a
 * refusal from a lost signal it came back as "held on this phone", which was
 * neither true nor ever going to come right.
 *
 * If it ever changes, it changes in both files. Twenty is generous: the most any
 * agent has ever filed is four.
 */
export const MAX_DEPOSIT_ROWS = 20;

/** How long a scheme name may be, matching `line(..., 80)` on the server. */
export const MAX_SCHEME = 80;

/** How long an agent's name may be, matching `line(body.name, "name", …, 80)`. */
export const MAX_NAME = 80;
