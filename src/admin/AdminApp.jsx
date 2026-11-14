import { useEffect, useMemo, useRef, useState } from "react";
import { MONTHS, describeKey, reportMonth, isCollectionOpen } from "../lib/month.js";
import { loadSettings, saveSettings, fetchSettings } from "../lib/settings.js";
import { saveCorrection, removeEntry, restoreEntry } from "../lib/submit.js";
import {
  fetchReports,
  fetchDeleted,
  mergeRegister,
  readCache,
  readOutbox,
  flushOutbox,
} from "../lib/entries.js";
import { whoAmI, signOut, changePassword, serverStatus } from "../lib/auth.js";

import {
  byAgent,
  byMonth,
  tallest,
  monthWindow,
  monthsPresent,
  upTo,
  sumMonths,
} from "../lib/report.js";
import { popupState } from "../lib/popup.js";
import { serialisePlayers, rankPlayers } from "../lib/board.js";

import { upload as uploadPicture, list as listPictures, remove as removePicture } from "../lib/images.js";



import CustomerLedger from "../customers/CustomerLedger.jsx";
import ReportsDashboard from "./ReportsDashboard.jsx";
import { apiGet, apiSend } from "../lib/api.js";
import { idsObject, monthTotal, rowsSum, SPAN } from "./format.js";
import Lock from "./Lock.jsx";
import { AdminNavigation, AdminTopbar } from "./AdminChrome.jsx";

import { POLL_MS, playerRows, changedOnly } from "./adminHelpers.js";
import RegisterSection from "./parts/RegisterSection.jsx";
import AgentsSection from "./parts/AgentsSection.jsx";
import SettingsTab from "./parts/SettingsTab.jsx";
import WhichMonthSection from "./parts/WhichMonthSection.jsx";

function Panel({ onSignOut }) {
  const [activeTab, setActiveTab] = useState(() =>
    ["customers", "reports", "settings"].includes(new URLSearchParams(window.location.search).get("page"))
      ? new URLSearchParams(window.location.search).get("page")
      : "register"
  );
  // The cache, read once per render and used only to seed the boxes below. It is
  // this device's last-known copy, not the register: the server's own set arrives a
  // moment later in the effect further down and replaces it.
  const saved = loadSettings();
  const now = new Date();
  const startFrom = describeKey(saved.reportMonth) || reportMonth(now, saved);

  const [mode, setMode] = useState(saved.reportMonth ? "pinned" : "auto");
  const [monthIndex, setMonthIndex] = useState(MONTHS.indexOf(startFrom.name));
  const [year, setYear] = useState(Number(startFrom.year));
  const [graceDays, setGraceDays] = useState(String(saved.graceDays));
  const [credit, setCredit] = useState(saved.credit);
  const [open, setOpen] = useState(saved.open);
  const [message, setMessage] = useState(saved.message || "");
  const [showRd, setShowRd] = useState(saved.showRd !== false);
  const [showFd, setShowFd] = useState(saved.showFd !== false);
  const [autoWindow, setAutoWindow] = useState(Boolean(saved.autoWindow));
  const [opensOn, setOpensOn] = useState(String(saved.opensOnDay));
  const [closesAfter, setClosesAfter] = useState(String(saved.closesAfterDay));
  const [note, setNote] = useState("");
  // Whether that note is good news. "Not saved" set in the same quiet grey as
  // "Saved" is a line that gets skimmed past, and the one time it matters is the
  // time it must not be.
  const [noteOk, setNoteOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Changing the password. Held apart from every other box on this page because it
  // commits on its own button, not on Save.
  const [pwNow, setPwNow] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwNote, setPwNote] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  // The popup announcement. Held apart from `message` on purpose: that is the
  // standing line in the green bar, this is the thing that must not be skimmed
  // past, and jishn wanted both, each with its own box.
  const [popupOn, setPopupOn] = useState(Boolean(saved.popupOn));
  const [popupMode, setPopupMode] = useState(
    saved.popupMode === "window" ? "window" : "always"
  );
  const [popupFrom, setPopupFrom] = useState(saved.popupFrom || "");
  const [popupTo, setPopupTo] = useState(saved.popupTo || "");
  const [popupTitle, setPopupTitle] = useState(saved.popupTitle || "");
  const [popupText, setPopupText] = useState(saved.popupText || "");
  const [popupImage, setPopupImage] = useState(saved.popupImage || "");
  const [picNote, setPicNote] = useState("");
  const [picBusy, setPicBusy] = useState(false);
  // The whole announcement waiting for a "yes, take it down". Asked in the box
  // itself, like the register's own delete, rather than in a browser dialog.
  const [askWipe, setAskWipe] = useState(false);
  // undefined = never asked, null = could not ask, [] = asked and there are none.
  const [shelf, setShelf] = useState(undefined);
  const [shelfBusy, setShelfBusy] = useState(false);
  // The one picture on the shelf waiting for a "yes, delete it" — an id, so only
  // ever one at a time, and the question is asked in words under the shelf where
  // there is room to name the file. This delete is the only one on the page that
  // cannot be undone by pressing Cancel: the bytes leave the server.
  const [dropping, setDropping] = useState("");
  const [picked, setPicked] = useState("");
  // The game board. Typed by hand and nothing to do with the reports below —
  // jishn decides what it says, which is why it is a list of boxes and not a
  // calculation. It rides to every phone in the settings, like the popup.
  const [boardOn, setBoardOn] = useState(Boolean(saved.boardOn));
  const [boardTitle, setBoardTitle] = useState(saved.boardTitle || "");
  const [players, setPlayers] = useState(() => playerRows(saved.boardPlayers));

  // What the server last told us it holds, and whether this admin has touched a
  // setting yet. Both exist for one reason: this page is not the only thing that
  // can change a setting.
  //
  // `known` is what Save measures against, so only the keys this admin actually
  // changed are sent. It starts as the cache — the best guess available on the
  // first frame — and becomes the server's own set the moment it answers, and
  // again after every accepted save.
  //
  // `touched` decides whether that answer is allowed into the boxes. On a server
  // that sleeps between visits the answer can be twenty seconds coming, and an
  // announcement half typed in that time must not be wiped by it. Refs rather than
  // state, both of them: nothing on the page draws itself differently for either,
  // and re-rendering on the first keystroke to record that a keystroke happened
  // would be a render for nobody.
  const known = useRef(saved);
  const touched = useRef(false);

  /**
   * "This admin has started changing something." Hung on the five settings
   * sections below rather than on each of the twenty-two controls inside them,
   * which is two attributes instead of twenty-two and cannot be forgotten when a
   * control is added.
   *
   * On the capture phase so it runs whatever a child's own handler does, and so a
   * click on a toggle counts: the toggles are buttons, and a button never fires
   * onChange. Deliberately not hung on the whole column — the link and password
   * sections live there too, and neither is part of what Save sends.
   */
  const mark = () => {
    touched.current = true;
  };

  // The register comes from the server. This page holds three things about that
  // read and none of them is the register itself: the rows the server last gave
  // us, this device's unsent outbox, and how the last read went. `entries` is the
  // two lists merged — which is why editing a report has to move the chart above
  // it as well, and does, without either of them being told.
  const [storedRows, setStoredRows] = useState(() => readCache().reports);
  const [outbox, setOutbox] = useState(readOutbox);
  // from: "" not asked yet · "server" it answered · "cache" it did not, so these
  // are the rows it gave us last time · "nowhere" not that either.
  // signedOut: the read came back 401, so the session has run out and the login
  // has to come back up — a stale table with no explanation would be worse.
  const [read, setRead] = useState(() => ({
    at: readCache().at,
    from: "",
    error: "",
    signedOut: false,
  }));
  const [reading, setReading] = useState(false);
  // What the server says about itself: how much the register holds, and whether the
  // Google Sheet copy is keeping up. undefined = not asked yet, null = asked and got
  // no answer. Read once on open and again on a button — not on the poll, because a
  // free server that sleeps between visits should be woken for the register, not for
  // a line about the register.
  const [health, setHealth] = useState(undefined);
  const [healthBusy, setHealthBusy] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetNote, setSheetNote] = useState("");
  const [sheetNoteOk, setSheetNoteOk] = useState(true);
  const [editing, setEditing] = useState(""); // id of the report being corrected
  const [confirming, setConfirming] = useState(""); // id waiting for "yes, delete"
  const [showAll, setShowAll] = useState(false);
  // The bin: reports that were deleted and can be put back. Kept apart from the
  // register above rather than mixed into it with a flag, because every total, every
  // agent's line and the whole chart are counted off `entries` — a deleted report in
  // there would make all of them quietly wrong. It is also read separately, only when
  // it is opened, so the ordinary use of this page does not pay for it.
  //
  // undefined = never opened · null = opened and the server did not answer · a list.
  const [binOpen, setBinOpen] = useState(false);
  const [bin, setBin] = useState(undefined);
  const [binBusy, setBinBusy] = useState(false);
  const [binNote, setBinNote] = useState("");
  const [binOk, setBinOk] = useState(true);
  const [putting, setPutting] = useState(""); // id being put back right now
  // null until the admin picks one, and "" once they choose every month.
  const [view, setView] = useState(null);

  function selectTab(tab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "register") url.searchParams.delete("page");
    else url.searchParams.set("page", tab);
    window.history.replaceState({}, "", url);
  }

  const entries = useMemo(() => mergeRegister(storedRows, outbox), [storedRows, outbox]);

  /**
   * Send whatever is waiting, then read the register back.
   *
   * In that order on purpose: a correction still in the outbox would otherwise be
   * shown as pending immediately after a read that already contained it.
   */
  async function refresh() {
    setReading(true);
    await flushOutbox();
    setOutbox(readOutbox());
    const got = await fetchReports();
    setStoredRows(got.reports);
    setRead({
      at: got.at,
      from: got.from,
      error: got.error,
      signedOut: Boolean(got.unauthorised),
    });
    setReading(false);
  }

  // The poll below re-reads through this rather than closing over `refresh`,
  // which is a different function on every render — an interval that captured
  // the first one would go on calling it with stale setters forever.
  const latest = useRef(refresh);
  latest.current = refresh;

  /**
   * Ask the server how it is: what the register holds, and whether the sheet copy
   * is keeping up. null on no answer, so the section below can say that rather than
   * show a zero it made up.
   */
  async function readHealth() {
    setHealthBusy(true);
    const got = await serverStatus();
    setHealthBusy(false);
    setHealth(got);
  }

  async function readSheetSettings() {
    try {
      const connected = await apiGet("/api/admin/sheet");
      setSheetUrl(connected.url || "");
    } catch {
      setSheetUrl("");
    }
  }

  async function connectSheet() {
    setSheetBusy(true);
    setSheetNote("");
    try {
      const connected = await apiSend("PUT", "/api/admin/sheet", { url: sheetUrl.trim() });
      setSheetUrl(connected.url || sheetUrl.trim());
      setSheetNote("Google Sheet connected. You can import existing reports now.");
      setSheetNoteOk(true);
      await readHealth();
    } catch (problem) {
      setSheetNote(problem.message || "Could not connect to this Google Sheet.");
      setSheetNoteOk(false);
    } finally {
      setSheetBusy(false);
    }
  }

  async function importSheet() {
    setSheetBusy(true);
    setSheetNote("");
    try {
      const result = await apiSend("POST", "/api/admin/sheet/import", {});
      setSheetNote(`Imported ${result.imported} report${result.imported === 1 ? "" : "s"}; skipped ${result.skipped} existing or invalid row${result.skipped === 1 ? "" : "s"}.`);
      setSheetNoteOk(true);
      await latest.current();
      await readHealth();
    } catch (problem) {
      setSheetNote(problem.message || "Could not import reports from this Sheet.");
      setSheetNoteOk(false);
    } finally {
      setSheetBusy(false);
    }
  }

  // Read once on open: the register itself, and how the server says it is doing.
  useEffect(() => {
    latest.current();
    readHealth();
    readSheetSettings();
  }, []);

  // Then keep reading, so a report an agent sends turns up here by itself — but
  // never while a row is open for editing or waiting to be deleted. A read landing
  // under an open editor would replace the row being corrected with the server's
  // version of it, and the admin would be typing into last minute's figures.
  // Closing the editor starts the clock again.
  const paused = editing !== "" || confirming !== "";
  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [paused]);

  /**
   * Write a settings set the server sent into all twenty-two boxes on this page.
   *
   * Every line here mirrors a useState initialiser near the top of this component,
   * and the two have to be kept in step by hand. That duplication is deliberate and
   * it is not free: the alternative was remounting this whole panel on a changing
   * `key` so the initialisers ran again — one line instead of twenty-two — but that
   * also throws away the register table's own state below, closes whatever month was
   * being inspected, and re-fetches the reports for nothing.
   */
  function seedFrom(fresh) {
    const from = describeKey(fresh.reportMonth) || reportMonth(new Date(), fresh);
    setMode(fresh.reportMonth ? "pinned" : "auto");
    setMonthIndex(Math.max(0, MONTHS.indexOf(from.name)));
    setYear(Number(from.year));
    setGraceDays(String(fresh.graceDays));
    setCredit(fresh.credit);
    setOpen(fresh.open);
    setMessage(fresh.message || "");
    setShowRd(fresh.showRd !== false);
    setShowFd(fresh.showFd !== false);
    setAutoWindow(Boolean(fresh.autoWindow));
    setOpensOn(String(fresh.opensOnDay));
    setClosesAfter(String(fresh.closesAfterDay));
    setPopupOn(Boolean(fresh.popupOn));
    setPopupMode(fresh.popupMode === "window" ? "window" : "always");
    setPopupFrom(fresh.popupFrom || "");
    setPopupTo(fresh.popupTo || "");
    setPopupTitle(fresh.popupTitle || "");
    setPopupText(fresh.popupText || "");
    setPopupImage(fresh.popupImage || "");
    setBoardOn(Boolean(fresh.boardOn));
    setBoardTitle(fresh.boardTitle || "");
    setPlayers(playerRows(fresh.boardPlayers));
    const ids = idsObject(fresh.agentIds);
    setAgentIds(ids);
    setAgentIdDrafts(ids);
  }

  // Ask the register what the settings actually are, once, on open.
  //
  // The boxes above opened on this device's cache, which is only the last thing
  // *this* browser saw or saved. Pin a month from the laptop and the phone's admin
  // page would go on showing automatic until something was saved from it — and that
  // save, before this effect existed, would have pushed the phone's twenty stale
  // keys back over the laptop's change.
  //
  // The answer is refused entry once anything has been typed. On a server that
  // sleeps between visits it can be twenty seconds coming, which is long enough to
  // have written half an announcement, and having it vanish mid-sentence would be
  // the page's own doing. `known` is still updated in that case: the diff base
  // should be the truth even when the boxes are deliberately not.
  useEffect(() => {
    let alive = true;
    fetchSettings().then((fresh) => {
      if (!alive || !fresh) return;
      known.current = fresh;
      if (!touched.current) seedFrom(fresh);
    });
    return () => {
      alive = false;
    };
  }, []);

  const agents = useMemo(() => byAgent(entries), [entries]);
  const [agentIds, setAgentIds] = useState(() => idsObject(saved.agentIds));
  const [agentIdDrafts, setAgentIdDrafts] = useState(() => idsObject(saved.agentIds));
  const [agentIdAddOpen, setAgentIdAddOpen] = useState({});
  const [agentIdSaving, setAgentIdSaving] = useState("");
  const [agentIdNote, setAgentIdNote] = useState("");

  async function applyAgentId(nameKey) {
    const id = String(agentIdDrafts[nameKey] || "").trim();
    if (!id || agentIdSaving) return;
    setAgentIdSaving(nameKey);
    setAgentIdNote("");
    const next = { ...agentIds, [nameKey]: [...(agentIds[nameKey] || []), id] };
    const outcome = await saveSettings({ agentIds: JSON.stringify(next) });
    setAgentIdSaving("");
    if (outcome.synced) {
      setAgentIds(next);
      setAgentIdDrafts(next);
      setAgentIdAddOpen((current) => ({ ...current, [nameKey]: false }));
      setAgentIdNote("");
    } else {
      setAgentIdNote(outcome.note || "Could not save this ID. Try again.");
    }
  }

  // The months that actually have reports, oldest first — what the switcher
  // offers. No empty months in the list: there is nothing to inspect in one.
  const monthKeys = useMemo(() => monthsPresent(entries), [entries]);

  const pinnedKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  // Whether that key is one the register would take. A year box on its way to 2026
  // holds 2, then 20, then 202, and "202-09" is not a month: the server refuses it
  // and — because a settings patch is accepted or refused as one thing — every
  // other setting on this page goes down with it. So Save waits for the fourth
  // digit, and the line under the year box says what it is waiting for.
  const pinnedOk = describeKey(pinnedKey) !== null;
  const canSave = mode !== "pinned" || pinnedOk;
  // Exactly what an agent's phone will do with the settings as they now stand.
  const draft = {
    reportMonth: mode === "pinned" ? pinnedKey : null,
    graceDays: Number(graceDays) || 0,
    open,
    autoWindow,
    opensOnDay: Number(opensOn) || 1,
    closesAfterDay: Number(closesAfter) || 0,
  };
  // describeKey returns null while the year box is half-typed, so fall back.
  const effective =
    (mode === "pinned" ? describeKey(pinnedKey) : reportMonth(now, draft)) ||
    reportMonth(now, { reportMonth: null, graceDays: draft.graceDays });
  const openNow = isCollectionOpen(now, draft);

  // The popup exactly as an agent's phone would read it, so the preview and the
  // status line below are the real thing rather than a description of it.
  const popupDraft = {
    popupOn,
    popupMode,
    popupFrom,
    popupTo,
    popupTitle,
    popupText,
    popupImage,
  };
  const popState = popupState(popupDraft, now);
  // A picture uploaded before there was a server is carried inline: hundreds of
  // thousands of characters, so it must never be poured into a text box. Nothing
  // can produce one of these any more — an upload now goes to the server and comes
  // back as a short /api/images/12 — but a browser that saved settings under the
  // old build may still be holding one, so it is still recognised rather than
  // printed as gibberish.
  const picIsInline = /^data:/i.test(popupImage);

  // What the picture is, in words, whatever it came from. An id is not worth
  // reading out; a link is, so it is shown as typed.
  const picWord = picIsInline
    ? "Held on this device from before the server"
    : /^\/api\/images\//i.test(popupImage)
      ? "Uploaded here"
      : /^drive:/i.test(popupImage)
        ? "One from the old Drive folder"
        : popupImage;

  /** Take the picture off — uploaded, a link, or an old one, all the same. */
  function dropPicture() {
    setPopupImage("");
    setPicNote("");
  }

  // The shelf picture whose × has been pressed — looked up in the list rather than
  // held, so a shelf re-read while the question was on screen cannot leave the
  // question attached to a picture that is no longer in it.
  const armed = Array.isArray(shelf) ? shelf.find((one) => one.id === dropping) : null;

  // GET /api/admin/status, in words.
  //
  // `mirror` is null until the server has answered, which is not the same fact as a
  // sheet that is not set up, so the section says which. The oldest report is shown
  // as a month and not as the timestamp it arrives as: the exact second a figure was
  // submitted is not something anybody needs off a status line, and the month is what
  // the rest of this page is counted in.
  const mirror = health ? health.sheet || {} : null;
  const held = Number(health?.reports) || 0;
  const oldest = describeKey(String(health?.since || "").slice(0, 7))?.full || "";
  const sheetWord = !mirror
    ? ""
    : !mirror.configured
      ? "no copy"
      : mirror.queue > 0
        ? `${mirror.queue} waiting`
        : "up to date";

  // Is there an announcement at all? The switch is not part of this: something
  // switched off is still written down, which is exactly the trap — turning it off
  // hides the boxes and leaves the words sitting there.
  const popHasSomething = Boolean(
    popupTitle.trim() || popupText.trim() || popupImage || popupFrom || popupTo
  );

  /**
   * Take the whole announcement down: heading, words, picture, both dates, and the
   * switch with them. Nothing leaves an agent's phone until Save, like every other
   * box on this page — this only empties the draft.
   */
  function wipePopup() {
    setPopupTitle("");
    setPopupText("");
    setPopupImage("");
    setPicNote("");
    setPopupFrom("");
    setPopupTo("");
    setPopupMode("always");
    setPopupOn(false);
    setShelf(undefined);
    setAskWipe(false);
  }

  // The board as a phone would read it. parsePlayers takes the rows as they are,
  // so the preview below is the real component on the real list — a name typed
  // half a second ago is already on the podium.
  const boardDraft = { boardOn, boardTitle, boardPlayers: players };
  const standing = rankPlayers(players);

  /** Change, add and drop a board row. */
  function editPlayer(id, patch) {
    setPlayers((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  // The cards read as this month's standing: whoever has brought in the most for
  // the month being collected comes first, and what they have brought in up to
  // that month only breaks a tie. Someone who has not reported yet falls to the
  // end. Every figure here stops at the collected month, so pinning back to July
  // shows July's standing rather than mixing August into it.
  const ranked = useMemo(
    () =>
      agents
        .map((one) => {
          const listed = upTo(one.months, effective.key);
          return { ...one, listed, sofar: sumMonths(listed), mine: monthTotal(one, effective.key) };
        })
        .sort(
          (one, two) =>
            two.mine - one.mine ||
            two.sofar.total - one.sofar.total ||
            one.name.localeCompare(two.name)
        ),
    [agents, effective.key]
  );
  const agent = ranked.find((one) => one.id === picked) || ranked[0] || null;

  // The page opens on the month being collected. An explicit month choice stays
  // selected even if it has no reports, so clicking an empty chart month does not
  // unexpectedly switch the register back to every month.
  const wanted = view === null ? effective.key : view;
  const viewKey = describeKey(wanted) && (view !== null || monthKeys.includes(wanted)) ? wanted : "";
  const viewLabel = viewKey ? describeKey(viewKey)?.full || viewKey : "";
  const shown = viewKey ? entries.filter((entry) => entry.month === viewKey) : entries;

  function chooseReportMonth(key) {
    setView(key);
    setShowAll(false);
    setEditing("");
    setConfirming("");
  }

  // The three kinds of money, added up over the reports being shown.
  const sums = shown.reduce(
    (running, entry) => ({
      renewal: running.renewal + (entry.renewal || 0),
      rd: running.rd + rowsSum(entry.rd),
      fd: running.fd + rowsSum(entry.fd),
    }),
    { renewal: 0, rd: 0, fd: 0 }
  );
  const collected = sums.renewal + sums.rd + sums.fd;

  // Every agent is charted over the same six months, ending at the month being
  // collected, and the tallest single bar inside that window sets the scale for
  // all of them — so two agents can be compared without doing arithmetic.
  const windows = useMemo(
    () => agents.map((one) => monthWindow(one.months, effective.key, SPAN)),
    [agents, effective.key]
  );
  const months = agent ? monthWindow(agent.months, effective.key, SPAN) : [];
  const scale = tallest(windows);

  // The same six months with every agent added together — what the register is
  // showing, as a shape. It keeps its own scale rather than the agents' one: a
  // team month is several agents' worth of money, and one scale for both would
  // leave whichever chart is smaller drawn along the floor.
  const teamMonths = useMemo(
    () => monthWindow(byMonth(entries), effective.key, SPAN),
    [entries, effective.key]
  );
  const teamScale = tallest([teamMonths]);

  const formLink = useMemo(() => {
    try {
      return new URL("../form/", window.location.href).href;
    } catch {
      return "/form/";
    }
  }, []);

  async function save() {
    // The button above is already disabled for this, and this is what makes it
    // true. Worth the four lines: one half-typed year would take the twenty other
    // settings on this page with it, and the sentence would be the server's own
    // rather than one that says where to look.
    if (!canSave) {
      setNoteOk(false);
      setNote("Not saved — the pinned month needs all four digits of the year.");
      return;
    }
    setBusy(true);
    // Every setting as the boxes now hold it, in the shape the register holds it.
    // The whole set is built so the comparison below is a comparison rather than a
    // guess about which boxes were touched — but only the keys that differ are sent.
    const whole = {
      reportMonth: mode === "pinned" ? pinnedKey : null,
      graceDays: Number(graceDays) || 0,
      credit,
      open,
      message,
      showRd,
      showFd,
      autoWindow,
      opensOnDay: Number(opensOn) || 1,
      closesAfterDay: Number(closesAfter) || 0,
      ...popupDraft,
      boardOn,
      boardTitle,
      // Stored as a JSON string, so this page, the server and the sheet copy are
      // never three different shapes of the same list.
      boardPlayers: serialisePlayers(players),
    };
    const patch = changedOnly(whole, known.current);
    // A poster from before there was a server, carried inline as a data: URL of a
    // few hundred thousand characters. The register refuses those outright, so
    // leaving it in the patch would mean this admin could never save any setting
    // again — a picture nobody chose today taking down a month they did. It is
    // dropped instead. Nothing is lost that was not already lost: that poster only
    // ever existed on this one device, and the moment a real one is uploaded the key
    // becomes a short /api/images/12 and travels normally.
    if (/^data:/i.test(String(patch.popupImage || ""))) delete patch.popupImage;
    // Nothing differs, so there is nothing to send. Said rather than swallowed: an
    // admin who pressed Save is owed an answer, and "Saved" would be a small lie
    // about a round trip that never happened.
    if (Object.keys(patch).length === 0) {
      setBusy(false);
      setNoteOk(true);
      setNote("Nothing to save — no setting has changed.");
      return;
    }
    const outcome = await saveSettings(patch);
    setBusy(false);
    // Four outcomes, wanting four different things said, and the new one is the
    // refusal: nobody's connection is at fault, the server read these settings and
    // named one it will not take. settings.js has already put this browser's copy
    // back the way it was, so nothing has changed anywhere — but the boxes above
    // still hold what was typed, which is right, because that is what has to change
    // before Save can work.
    //
    // The sentence is the server's own. It says which setting and what the limit
    // was, and rewording it here could only make it vaguer.
    if (outcome.refused) {
      setNoteOk(false);
      setNote(`Not saved. ${outcome.note}`);
    } else if (outcome.unauthorised) {
      setNoteOk(false);
      setNote("Not saved — this browser has been signed out. Reload the page and sign in again.");
    } else if (outcome.synced) {
      // The server merged the patch and sent back the whole set. That answer — not
      // what this page sent, and not what it happens to be holding — becomes the base
      // the next Save is measured against, so a key another device changed while this
      // one sat open is now known here rather than overwritten by the next save.
      known.current = outcome.settings;
      touched.current = false;
      setNoteOk(true);
      setNote("Saved. Every agent sees this.");
    } else {
      setNoteOk(false);
      const reason = outcome.status
        ? `The server answered with ${outcome.status}${outcome.note ? `: ${outcome.note}` : "."}`
        : outcome.note || "The server could not be reached. Check the connection and try again.";
      setNote(`Not saved — ${reason} Nothing has changed for the agents; try again.`);
    }
  }

  /**
   * Shrink the chosen picture, upload it, and point the popup at it.
   *
   * The shrinking is the part agents feel: a 4 MB phone photo becomes a few hundred
   * KB before it ever has to load on the form. The upload keeps its own copy on the
   * server, so choosing the same poster again next month is a click, not a hunt
   * through the phone's gallery.
   */
  async function choosePicture(event) {
    const file = event.target.files?.[0];
    // The same file chosen twice in a row must still fire the change event.
    event.target.value = "";
    if (!file) return;
    setPicBusy(true);
    setPicNote("Shrinking the picture…");
    const outcome = await uploadPicture(file);
    setPicBusy(false);
    setPicNote(outcome.note);
    if (outcome.ok) {
      setPopupImage(outcome.value);
      // One more picture on the server means the shelf on screen is out of date.
      if (shelf !== undefined) setShelf(undefined);
    }
  }

  /** Read back every picture uploaded so far. */
  async function openShelf() {
    setShelfBusy(true);
    const found = await listPictures();
    setShelfBusy(false);
    setShelf(found);
    // A shelf just re-read is a different list; an × armed against the old one
    // would be armed against whatever now sits in that place.
    setDropping("");
  }

  /**
   * Arm the × on one picture — unless deleting it would break the announcement
   * agents are reading right now.
   *
   * The picture leaves the server for good, and the settings are not touched with
   * it: src/lib/images.js deliberately refuses to make that decision quietly, and
   * this is where it is made out loud. Two ways it would go wrong, each with its own
   * sentence, because "cannot delete that" without the reason is a dead end:
   *
   *   the box points at it   — Save would then point every phone at a picture that
   *                            is not there. Take it off the announcement first.
   *   the cache points at it — the box has already been changed but not saved, so
   *                            the agents are still being shown this one. Save
   *                            first; then it is nobody's poster and can go.
   */
  function askDrop(one) {
    if (one.url === popupImage) {
      setPicNote(
        "That is the picture on the announcement. Take it off there first — then it can be deleted."
      );
      return;
    }
    if (one.url === saved.popupImage) {
      setPicNote(
        "The agents are still being shown this one — the change here has not been saved yet. Press Save, then it can be deleted."
      );
      return;
    }
    setPicNote("");
    setDropping(one.id);
  }

  /** Yes, delete it. The bytes go from the server; nothing else on the page moves. */
  async function dropFromShelf(one) {
    setShelfBusy(true);
    const outcome = await removePicture(one.id);
    setShelfBusy(false);
    setDropping("");
    if (!outcome.ok) {
      setPicNote(outcome.note);
      return;
    }
    setPicNote(`${one.name} is off the shelf.`);
    // Taken out of the list here rather than by re-reading the shelf: one fewer
    // round trip, and the tile going as the answer arrives is the answer.
    setShelf((rows) => (Array.isArray(rows) ? rows.filter((row) => row.id !== one.id) : rows));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(formLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  /**
   * Change the password.
   *
   * Both boxes are cleared on success and only the new one on failure, so a wrong
   * current password does not mean typing the new one out again. The server does
   * the judging — length, whether the current one is right, and signing the other
   * devices out — and this only says what it answered.
   */
  async function changeIt() {
    if (pwBusy) return;
    setPwBusy(true);
    setPwNote("");
    const outcome = await changePassword(pwNow, pwNext);
    setPwBusy(false);
    setPwNote(outcome.note);
    setPwNext("");
    if (outcome.ok) setPwNow("");
  }

  /**
   * Apply a correction: close the editor, send the whole report, and read the
   * register back.
   *
   * The editor closes first, before the server has answered, because a correction
   * that cannot be sent is queued rather than lost. The one case that is not true of
   * is a refusal — the server reading the correction and naming something in it that
   * it will not take — and that one is said out loud, because otherwise the row
   * simply snaps back to the figure it held and reads as an edit undone by nothing.
   *
   * Read back rather than patched in place because the pencil is the server's to
   * write: this page has no business deciding that a row was edited on the web.
   */
  async function applyEdit(id, patch) {
    const entry = entries.find((one) => one.id === id);
    setEditing("");
    if (!entry) return;
    const outcome = await saveCorrection(entry, patch);
    if (outcome.synced) {
      await refresh();
      return;
    }
    if (outcome.refused) {
      setNoteOk(false);
      setNote(`That correction was not made. ${outcome.note}`);
    }
    setOutbox(readOutbox());
  }

  /**
   * Take one report out of the register.
   *
   * It is kept, not destroyed: the row is marked deleted and stops appearing here,
   * and it turns up in the bin under the table, where it can be put back. That undo
   * did not exist while the Google Sheet was the register — the sheet's own version
   * history was the only way back.
   *
   * A refusal here is almost always a 404, which means this report is already out of
   * the register: deleted from another device, or never sent from this phone at all.
   * The register is the answer either way, so it is read back rather than argued
   * with, and the row goes — which is what was asked for.
   */
  async function drop(id) {
    setConfirming("");
    if (editing === id) setEditing("");
    const outcome = await removeEntry(id);
    if (outcome.refused) {
      setNoteOk(false);
      setNote(`${outcome.note} The register has been read again.`);
    }
    if (outcome.synced || outcome.refused) {
      await refresh();
      // The report just deleted belongs in the bin now. If the bin is open, showing
      // it without that report would read as the delete having gone somewhere else.
      if (binOpen) await readBin();
      return;
    }
    setOutbox(readOutbox());
  }

  /**
   * Read the bin.
   *
   * Every time it is opened, and again after anything moves in or out of it — never
   * on the poll. Two admins can be deleting and restoring at once, and a stale bin is
   * the one thing that makes this section actively misleading: a report offered for
   * restoring that is already back, or one missing that is in there.
   *
   * No answer is `null` and not an empty list. "The bin is empty" and "the bin could
   * not be read" are opposite facts and the section says which.
   */
  async function readBin() {
    setBinBusy(true);
    const got = await fetchDeleted();
    setBinBusy(false);
    if (got.error !== "") {
      setBin(null);
      setBinOk(false);
      setBinNote(got.unauthorised ? "Signed out — reload the page and sign in again." : "");
      return;
    }
    setBin(got.reports);
    // A note saying it could not be read is not true any more. A note saying a report
    // was put back still is, so only the failures are cleared — which is what asking
    // binOk rather than clearing unconditionally distinguishes.
    if (!binOk) {
      setBinOk(true);
      setBinNote("");
    }
  }

  /**
   * Put one deleted report back in the register.
   *
   * The row was never destroyed, so this is the same report coming back — same id,
   * same figures, same submitted time, in its own place in the list rather than at the
   * top of it. The sheet copy is brought back by the server.
   *
   * Nothing about this is queued, so unlike a correction it can simply fail to happen:
   * the outcome is read for all three answers. A refusal is a 404 and means the bin on
   * screen is out of date, so it is read again — the report is either already back or
   * was never there.
   */
  async function putBack(entry) {
    setPutting(entry.id);
    const outcome = await restoreEntry(entry.id);
    setPutting("");

    if (outcome.synced) {
      // Taken out of the list here as well as read back, so the row goes the moment
      // the answer arrives rather than a round trip later.
      setBin((rows) => (Array.isArray(rows) ? rows.filter((row) => row.id !== entry.id) : rows));
      setBinOk(true);
      setBinNote(`${entry.name}'s ${entry.monthLabel} report is back in the register.`);
      await refresh();
      // The register holds one more report than it did a moment ago.
      readHealth();
      return;
    }
    setBinOk(false);
    if (outcome.refused) {
      setBinNote(`${outcome.note} The bin has been read again.`);
      await readBin();
      return;
    }
    setBinNote(
      outcome.unauthorised
        ? "Signed out — reload the page and sign in again. Nothing has moved."
        : "The server could not be reached, so nothing has moved. Press it again in a moment."
    );
  }

  /** Open the bin, reading it as it opens; closing it says nothing more. */
  function toggleBin() {
    if (binOpen) {
      setBinOpen(false);
      return;
    }
    setBinOpen(true);
    setBinNote("");
    setBinOk(true);
    readBin();
  }

  return (
    <div className="app admin">
      {["customers", "reports"].includes(activeTab) ? (
        <main className="card" style={{ maxWidth: "none" }}>
          <AdminTopbar onSignOut={onSignOut} onHome={() => selectTab("register")} />
          <AdminNavigation activeTab={activeTab} onSelect={selectTab} />
          {activeTab === "customers" ? <CustomerLedger /> : <ReportsDashboard />}
        </main>
      ) : (
      <main className="card">
        <AdminTopbar onSignOut={onSignOut} onHome={() => selectTab("register")} />
        <AdminNavigation activeTab={activeTab} onSelect={selectTab} />
        <header className="head">
          <div className="head-text">
            <p className="eyebrow">
              <span className="dot" aria-hidden="true" />
              Manage collection
            </p>
            <h1 className="month">
              {activeTab === "settings" ? "Settings" : <>{effective.name}<span className="month-year">{effective.year}</span></>}
            </h1>
            <p className="lede">
              {activeTab === "settings"
                ? "Control the form, connections and admin access."
                : openNow
                ? "This is the month agents are filling in right now."
                : "Collection is closed. Agents see a notice instead of the form."}
            </p>
          </div>

          {/* Save belongs up here, opposite the month: it is the one thing on the
              page that commits everything, and at the bottom of a long left
              column it was below the fold on most of the settings. */}
          <div className="head-act">
            <button type="button" className="send" onClick={save} disabled={busy || !canSave}>
              {busy ? "Saving…" : "Save"}
            </button>
            {note && (
              <p className={noteOk ? "hint save-note" : "hint save-note is-error"} role="status">
                {note}
              </p>
            )}

          </div>
        </header>

        <div className={activeTab === "settings" ? "grid settings-grid" : "grid"}>
          <div className="column">
            {activeTab === "register" && (
            <WhichMonthSection graceDays={graceDays} mark={mark} mode={mode} monthIndex={monthIndex} pinnedOk={pinnedOk} setGraceDays={setGraceDays} setMode={setMode} setMonthIndex={setMonthIndex} setYear={setYear} year={year} />
            )}

            {activeTab === "settings" && <SettingsTab armed={armed} askDrop={askDrop} askWipe={askWipe} autoWindow={autoWindow} boardDraft={boardDraft} boardOn={boardOn} boardTitle={boardTitle} changeIt={changeIt} choosePicture={choosePicture} closesAfter={closesAfter} connectSheet={connectSheet} copied={copied} copyLink={copyLink} credit={credit} dropFromShelf={dropFromShelf} dropPicture={dropPicture} dropping={dropping} editPlayer={editPlayer} formLink={formLink} health={health} healthBusy={healthBusy} held={held} importSheet={importSheet} mark={mark} message={message} mirror={mirror} oldest={oldest} open={open} openNow={openNow} openShelf={openShelf} opensOn={opensOn} picBusy={picBusy} picNote={picNote} picWord={picWord} players={players} popHasSomething={popHasSomething} popState={popState} popupDraft={popupDraft} popupFrom={popupFrom} popupImage={popupImage} popupMode={popupMode} popupOn={popupOn} popupText={popupText} popupTitle={popupTitle} popupTo={popupTo} pwBusy={pwBusy} pwNext={pwNext} pwNote={pwNote} pwNow={pwNow} readHealth={readHealth} setAskWipe={setAskWipe} setAutoWindow={setAutoWindow} setBoardOn={setBoardOn} setBoardTitle={setBoardTitle} setClosesAfter={setClosesAfter} setCredit={setCredit} setDropping={setDropping} setMessage={setMessage} setOpen={setOpen} setOpensOn={setOpensOn} setPicNote={setPicNote} setPlayers={setPlayers} setPopupFrom={setPopupFrom} setPopupImage={setPopupImage} setPopupMode={setPopupMode} setPopupOn={setPopupOn} setPopupText={setPopupText} setPopupTitle={setPopupTitle} setPopupTo={setPopupTo} setPwNext={setPwNext} setPwNote={setPwNote} setPwNow={setPwNow} setSheetUrl={setSheetUrl} setShowFd={setShowFd} setShowRd={setShowRd} sheetBusy={sheetBusy} sheetNote={sheetNote} sheetNoteOk={sheetNoteOk} sheetUrl={sheetUrl} sheetWord={sheetWord} shelf={shelf} shelfBusy={shelfBusy} showFd={showFd} showRd={showRd} standing={standing} wipePopup={wipePopup} />}
          </div>

          {activeTab === "register" && (
          <div className="column">
            <AgentsSection agent={agent} agentIdAddOpen={agentIdAddOpen} agentIdDrafts={agentIdDrafts} agentIdNote={agentIdNote} agentIdSaving={agentIdSaving} agentIds={agentIds} agents={agents} applyAgentId={applyAgentId} chooseReportMonth={chooseReportMonth} effective={effective} months={months} ranked={ranked} read={read} scale={scale} setAgentIdAddOpen={setAgentIdAddOpen} setAgentIdDrafts={setAgentIdDrafts} setPicked={setPicked} viewKey={viewKey} />

            <RegisterSection applyEdit={applyEdit} bin={bin} binBusy={binBusy} binNote={binNote} binOk={binOk} binOpen={binOpen} chooseReportMonth={chooseReportMonth} collected={collected} confirming={confirming} drop={drop} editing={editing} effective={effective} entries={entries} monthKeys={monthKeys} now={now} paused={paused} putBack={putBack} putting={putting} read={read} reading={reading} refresh={refresh} setConfirming={setConfirming} setEditing={setEditing} setShowAll={setShowAll} showAll={showAll} shown={shown} sums={sums} teamMonths={teamMonths} teamScale={teamScale} toggleBin={toggleBin} viewKey={viewKey} viewLabel={viewLabel} />
          </div>
          )}
        </div>
      </main>
      )}
      <p className="credit">Admin · /admin</p>
    </div>
  );
}

/**
 * The page, or the login, decided by the server rather than by this browser.
 *
 * Three states, and the third one is the reason this is not a boolean: until
 * /api/admin/me answers, neither the login nor the register is the right thing to
 * show. Flashing the login at somebody who is already signed in teaches them to
 * type the password into anything that asks.
 *
 * Nothing is remembered here. The old build kept "unlocked" in localStorage, which
 * meant the lock could be picked with two words in a console. Now the answer comes
 * from a cookie this page cannot read, and asking again on every load costs one
 * request.
 */
export default function AdminApp() {
  const [signedIn, setSignedIn] = useState(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const answer = await whoAmI();
      if (!alive) return;
      setSignedIn(answer.signedIn);
      setReachable(answer.reachable);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (signedIn === null) {
    return (
      <div className="app">
        <p className="credit">Asking the server…</p>
      </div>
    );
  }

  if (!signedIn) {
    return <Lock onUnlock={() => setSignedIn(true)} reachable={reachable} />;
  }

  // Signing out is the server's business too: it deletes that one session row, so
  // the cookie left in this browser stops meaning anything. Other devices stay in.
  return (
    <Panel
      onSignOut={async () => {
        await signOut();
        setSignedIn(false);
      }}
    />
  );
}
