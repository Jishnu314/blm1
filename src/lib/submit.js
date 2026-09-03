// Sending a report, and correcting, removing or restoring one.
//
// The register lives on the server — see entries.js for why, and for the outbox
// these calls fall back on. This file's only job is to turn what the form
// and the admin page hold into one attempt at the API, and to make sure a failed
// attempt is queued rather than lost.
//
// Every one of them returns { ok, synced, refused, note, field, unauthorised }, and
// for the three that are queued there are exactly three outcomes:
//
//   ok:true  synced:true                 it is in the register. Done.
//   ok:true  synced:false                it is in this phone's outbox, marked ✱ in
//                                        the register, and will be sent on the next
//                                        load or the next successful call. Normal,
//                                        and recoverable without anybody doing
//                                        anything.
//   ok:false synced:false refused:true   the server understood it and said no. NOT
//                                        queued, because it would be refused again
//                                        on every load forever while blocking
//                                        everything behind it. `note` is the
//                                        server's own sentence and `field` names the
//                                        box, so the caller can say what to fix.
//
// restoreEntry is the exception and says why at its own doc comment: nothing about it
// is queued, so it has a fourth outcome — ok:false with refused:false, meaning the
// server was not reached and nothing is being kept on this device about it.
//
// This file used to claim there was no third outcome — that nothing an agent typed
// was ever refused. It was not true, it was only invisible: a 21st deposit row or an
// 81-character name came back 400, went into the outbox, and the receipt promised
// the agent it would send itself. It never would, and nothing queued behind it ever
// went either. A refusal is rare and the form now guards against most of the ways
// to cause one, but "rare" and "impossible" want different code.
//
// `unauthorised` is separate from all three, because "you are not signed in" is a
// different thing to do something about than "no signal" — and unlike a refusal it
// comes right the moment somebody signs in, so the action is kept.
//
// Nothing here writes a register of its own. That was the first design: this
// device's localStorage held every report and the sheet got a copy. It meant two
// phones never agreed and an edit made elsewhere was invisible to the app.

import { isUnauthorised, isRefusal } from "./api.js";
import {
  pushReport,
  pushCorrection,
  pushDelete,
  pushRestore,
  queue,
  flushOutbox,
} from "./entries.js";

export { flushOutbox };

/**
 * Try the server. Queue the same action if the call did not get through, and do
 * not queue it if the server refused it.
 *
 * There used to be a build-time flag here and a paragraph explaining why "no sheet
 * has been configured yet" was folded into the same story as "the sheet could not
 * be reached". The flag is gone — there is always a server now — and the reason is
 * simpler for it: the server may be asleep after a quiet spell, or the phone may
 * be in a lift. Neither is worth telling apart, because the answer to both is the
 * same and the phone keeps the report either way.
 *
 * A refusal is the one failure that must not be kept. See isRefusal in api.js.
 */
async function attempt(action, send) {
  try {
    await send();
    return { ok: true, synced: true, refused: false, note: "", field: "", unauthorised: false };
  } catch (problem) {
    if (isRefusal(problem)) {
      return {
        ok: false,
        synced: false,
        refused: true,
        // The server's own sentence. API.md promises it is something that can be
        // shown as it stands, and it is written to be read by whoever typed the box.
        note: String(problem.message || "The server would not accept that."),
        field: String(problem.field || ""),
        unauthorised: false,
      };
    }
    // The outbox is the answer to every other failure.
    queue(action);
    return {
      ok: true,
      synced: false,
      refused: false,
      note: "",
      field: "",
      unauthorised: isUnauthorised(problem),
    };
  }
}

/**
 * Record one agent's report: the mandatory renewal plus any new RD / FD rows,
 * each row being { amount, scheme }.
 *
 * The id is made here, on the phone, rather than by the server. That is what lets
 * a retry be safe: POST /api/reports inserts by that id and will not write it
 * twice, so the same report arriving twice is one row. It is also what lets the
 * outbox hold a correction to something it has not managed to send yet.
 *
 * `unauthorised` comes back with the rest of the outcome and is always false
 * here: posting a report is public, because an agent opens a link and types.
 */
export async function sendEntry({ name, renewal, rd = [], fd = [], month, monthLabel }) {
  const entry = {
    id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    renewal,
    rd,
    fd,
    month,
    monthLabel,
    submittedAt: new Date().toISOString(),
  };
  const outcome = await attempt({ kind: "save", entry }, () => pushReport(entry));
  return { ...outcome, entry };
}

/**
 * Correct one report — a misspelt name, a wrong figure, a month filed against the
 * wrong label. Returns { ok, synced, unauthorised }.
 *
 * The whole report is sent, not the patch, because the row is rewritten rather
 * than merged into. `editedIn` is not set here: the server decides that, and it
 * decides "web" precisely because this call is the one that reached it. A mark the
 * app could set is a mark the app could clear.
 *
 * It is queued as a correction, and queue() may keep it as a save instead — if
 * this phone has not managed to send the original yet, a PUT would 404. That
 * reasoning lives in queue(), where the outbox can see both actions at once.
 */
export async function saveCorrection(entry, patch) {
  const corrected = { ...entry, ...patch };
  return attempt({ kind: "correct", entry: corrected }, () => pushCorrection(corrected));
}

/**
 * Take one report out of the register. Returns { ok, synced, unauthorised }.
 *
 * The server keeps the row with a deletedAt rather than destroying it, so this is
 * undoable — and the admin page offers the undo: the deleted reports are listed under
 * the register and restoreEntry below puts one back.
 */
export async function removeEntry(id) {
  return attempt({ kind: "delete", id }, () => pushDelete(id));
}

/**
 * Put a deleted report back. Returns { ok, synced, refused, note, field, unauthorised }.
 *
 * The only call in this file that is NOT queued when it fails to get through, so it
 * is the only one that can come back ok:false with refused:false — read the outcome
 * here, do not assume the shape the other three have.
 *
 * That is deliberate. The outbox is for an agent standing in a lift who must not lose
 * what they typed; a restore is an admin at a page who pressed a button and is
 * watching for the row to come back. If it did not get through, pressing again is the
 * retry, and it is a better retry than a queue: the reports this would be replayed
 * against may have been deleted, corrected or restored from another device in the
 * meantime, and the bin is re-read every time it is opened. The settings Save is not
 * queued either, for the same reason.
 *
 * It also cannot be queued as things stand. flushOutbox knows three kinds — save,
 * correct, delete — and a fourth it did not recognise would fall through to its last
 * branch and post a report built out of nothing, which the register would refuse. A
 * queue that quietly does something else instead is worse than no queue.
 */
export async function restoreEntry(id) {
  try {
    await pushRestore(id);
    return { ok: true, synced: true, refused: false, note: "", field: "", unauthorised: false };
  } catch (problem) {
    if (isRefusal(problem)) {
      return {
        ok: false,
        synced: false,
        refused: true,
        // 404 is the one that will actually happen here: an id that is not in the
        // register at all, because somebody else emptied the bin between this page
        // reading it and this button being pressed.
        note: String(problem.message || "The server would not put that back."),
        field: "",
        unauthorised: false,
      };
    }
    return {
      ok: false,
      synced: false,
      refused: false,
      note: "",
      field: "",
      unauthorised: isUnauthorised(problem),
    };
  }
}
