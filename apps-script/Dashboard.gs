/**
 * The sheet an admin actually reads.
 *
 * Code.gs is the machinery: it answers the web app, keeps the Reports tab, and
 * stamps who edited what. This file is about the other half of the job — making
 * the same spreadsheet something you can open on a Sunday evening and understand
 * without asking anybody, and safely type into.
 *
 * It adds three things:
 *
 *   a menu       "Monthly report" next to Help, so nothing here needs the script
 *                editor twice. One command sets the whole sheet up.
 *   a Dashboard  one tab: an index of every month with its totals, then one block
 *                per month — every agent in it, and under each agent every RD and
 *                FD they sent with the scheme name they gave it. Newest month
 *                first, so a new month goes on top; no month is ever taken away.
 *                Written by this script rather than built from formulas, for the
 *                reason given at refreshDashboard_, and rebuilt whenever the
 *                spreadsheet is opened.
 *   plain words  the Settings tab gets a third column saying what each setting
 *                does, and yes/no settings get a dropdown so they cannot be
 *                mistyped. Code.gs only ever reads columns 1 and 2, so a third
 *                column is yours.
 *
 * Nothing here writes to the Reports tab's own figures. If this file were deleted
 * tomorrow the register would carry on exactly as before — which is the test of
 * whether a convenience has been added or a dependency.
 *
 * Paste it into the same Apps Script project as Code.gs, as a second file, then
 * reload the spreadsheet: the menu appears. Nothing needs deploying again — a menu
 * is not part of the web app.
 */

const DASHBOARD_TAB = "Dashboard";

/** Indian grouping: 10,000 · 1,00,000 · 1,00,00,000. */
const RUPEES = "[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0";

/**
 * The app's three money colours, so a figure means the same thing in both places,
 * and a dimmer pair of them for the RD/FD lines under an agent — those are the
 * detail of the row above, not a figure to read on its own.
 */
const INK = {
  renewal: "#0f7a5a", rd: "#b06a12", fd: "#2a4d8f", quiet: "#8a8f98",
  rdSoft: "#cfa671", fdSoft: "#7f94bc",
};

const HEAD_FILL = "#f2f4f6";
const HEAD_INK = "#3d434c";
const TOTAL_FILL = "#eceef1";

/**
 * The tint behind a deposit line. Deliberately lighter than HEAD_FILL: it has to
 * say "this belongs to the line above" without being mistaken for a heading.
 */
const DETAIL_FILL = "#f8f9fb";

/** An empty money cell says × rather than nothing, the same as the app does. */
const NOTHING = "×";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Monthly report")
    .addItem("Set up / tidy the sheet", "setUpSheet")
    .addItem("Refresh the dashboard", "refreshDashboard")
    .addToUi();

  // Reloading the spreadsheet is the refresh. Because this runs on open, what you
  // are looking at was worked out seconds ago, and an agent pressing Send no longer
  // waits for this tab to be rebuilt on the other side of the country. If it fails
  // — a fresh spreadsheet with no Reports tab yet — the menu is still there and
  // "Refresh the dashboard" still works.
  try {
    afterReportChange_();
  } catch (nothingToShowYet) {}
}

/**
 * Everything, once, from the menu. Safe to run again whenever — it formats and
 * rewrites, it never deletes a report.
 */
function setUpSheet() {
  reportsTab_(); // makes the tab and its headings if this is a fresh spreadsheet
  tab_(SETTINGS_TAB, ["Setting", "Value"]);
  tidyReports_();
  tidySettings_();
  refreshDashboard_();
  dropEmptyFirstTab_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    "Dashboard rebuilt, Reports and Settings tidied.",
    "Ready",
    6
  );
}

/** The menu's own entry point, so the toast only appears when a person asked. */
function refreshDashboard() {
  refreshDashboard_();
  SpreadsheetApp.getActiveSpreadsheet().toast("Dashboard rebuilt.", "Done", 4);
}

/**
 * The empty "Sheet1" a new spreadsheet arrives with, removed once there is
 * something else to look at. Only if it is genuinely untouched.
 */
function dropEmptyFirstTab_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = book.getSheets();
  if (sheets.length < 2) return;
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i];
    const name = sheet.getName();
    const known = name === REPORTS_TAB || name === SETTINGS_TAB || name === DASHBOARD_TAB;
    if (known) continue;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) book.deleteSheet(sheet);
  }
}

/* --- the arithmetic, kept separate so it can be tested ------------------- */

/** One deposit list's total, coerced — a sheet cell hands back "5000", not 5000. */
function sumRows_(rows) {
  if (!rows || !rows.length) return 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const amount = Number(rows[i] && rows[i].amount);
    if (isFinite(amount)) total += amount;
  }
  return total;
}

/** Each deposit as its own line, in the order it was sent. */
function depositLines_(rows, kind) {
  const lines = [];
  if (!rows || !rows.length) return lines;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    const amount = Number(row.amount);
    lines.push({
      kind: kind,
      scheme: String(row.scheme == null ? "" : row.scheme).trim(),
      amount: isFinite(amount) ? amount : 0,
    });
  }
  return lines;
}

/**
 * Every report, added up by month, and inside each month by agent — and under each
 * agent, every RD and FD kept as its own line with the scheme name it was sent
 * with. Nothing is merged away: two RDs in one month are two lines, because that
 * is what the agent typed and what the admin has to check against.
 *
 * This is deliberately a plain function of a plain list — no sheet, no
 * SpreadsheetApp — because it is the only part of this file that can be tested
 * without a spreadsheet, and it is the part that would be wrong quietly. A
 * misformatted heading is obvious; a total that is short by one report is not.
 *
 * Agents are grouped without regard to capitals, the same way the web app groups
 * them, so "jishnu" and "Jishnu" are one person in both places. The spelling kept
 * is the first one seen.
 */
function dashboardRows_(reports) {
  const list = reports && reports.length ? reports : [];
  const months = {};

  for (let i = 0; i < list.length; i += 1) {
    const report = list[i] || {};
    const name = String(report.name || "").trim();
    if (name === "") continue; // a row somebody started and left is not a report

    const key = String(report.month || "");
    const renewal = Number(report.renewal) || 0;
    const rd = sumRows_(report.rd);
    const fd = sumRows_(report.fd);

    if (!months[key]) {
      months[key] = {
        key: key,
        label: monthWords_(key) || "No month given",
        renewal: 0, rd: 0, fd: 0, total: 0, count: 0,
        agents: {}, order: [],
      };
    }
    const month = months[key];
    month.renewal += renewal;
    month.rd += rd;
    month.fd += fd;
    month.total += renewal + rd + fd;
    month.count += 1;

    const who = name.toLowerCase();
    if (!month.agents[who]) {
      month.agents[who] = {
        name: name, renewal: 0, rd: 0, fd: 0, total: 0, count: 0, deposits: [],
      };
      month.order.push(who);
    }
    const agent = month.agents[who];
    agent.renewal += renewal;
    agent.rd += rd;
    agent.fd += fd;
    agent.total += renewal + rd + fd;
    agent.count += 1;
    agent.deposits = agent.deposits
      .concat(depositLines_(report.rd, "rd"))
      .concat(depositLines_(report.fd, "fd"));
  }

  // Newest month first. A report with no month at all is put at the end rather
  // than the front, where sorting alone would leave it: "" is smaller than any
  // real key, and a row nobody dated is not the oldest news, it is a loose end.
  const keys = Object.keys(months).filter(function (key) { return key !== ""; });
  keys.sort();
  keys.reverse();
  if (months[""]) keys.push("");

  return {
    months: keys.map(function (key) {
      const month = months[key];
      const agents = month.order
        .map(function (who) { return month.agents[who]; })
        .sort(function (a, b) {
          if (b.total !== a.total) return b.total - a.total;
          return a.name.localeCompare(b.name); // a tie reads alphabetically
        });
      return {
        key: month.key, label: month.label, renewal: month.renewal,
        rd: month.rd, fd: month.fd, total: month.total, count: month.count,
        agents: agents,
      };
    }),
    reports: keys.reduce(function (sum, key) { return sum + months[key].count; }, 0),
    renewal: keys.reduce(function (sum, key) { return sum + months[key].renewal; }, 0),
    rd: keys.reduce(function (sum, key) { return sum + months[key].rd; }, 0),
    fd: keys.reduce(function (sum, key) { return sum + months[key].fd; }, 0),
    total: keys.reduce(function (sum, key) { return sum + months[key].total; }, 0),
  };
}

/* --- the Dashboard tab --------------------------------------------------- */

/**
 * Rebuild the whole tab from the reports.
 *
 * Written as values, not as formulas. A dashboard of live formulas is the obvious
 * choice and it was the first design, but a formula over a tab that a script
 * rewrites is fragile in a way that is hard to see: `saveReport_` writes a whole
 * row at its full width, so an ArrayFormula sitting in that width is overwritten,
 * and a correction reads the row with getValues() first, which flattens any
 * formula it finds to whatever number it had at that moment.
 *
 * Values cannot go stale here because this runs whenever the spreadsheet is
 * opened — see onOpen — and again after any hand edit. It deliberately no longer
 * runs when an agent presses Send: rebuilding this tab is work the agent's phone
 * was waiting on, and nobody is looking at the tab at that moment anyway.
 *
 * Everything is written in one setValues and dressed with one matrix per kind of
 * formatting, so the cost is the same for one month or twenty.
 */
function refreshDashboard_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(DASHBOARD_TAB);
  if (!sheet) sheet = book.insertSheet(DASHBOARD_TAB, 0);

  const stamp = Utilities.formatDate(new Date(), zone_(), "d MMMM yyyy 'at' HH:mm");
  const built = dashboardGrid_(dashboardRows_(readReports_()), stamp);

  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.getRange(1, 1, built.rows.length, 6).breakApart();
  sheet.getRange(1, 1, built.rows.length, 6).setValues(built.rows);
  dressDashboard_(sheet, built);
}

/**
 * The whole tab as a grid of values, plus what each row is — "top", "note",
 * "eyebrow", "head", "month", "title", "agent", "deposit", "total", "blank".
 *
 * Pure: no sheet, no clock. The stamp is handed in. dressDashboard_ reads the
 * kinds rather than being told row numbers, which is what makes a tab that grows
 * by a block a month no harder to format than a fixed one.
 *
 * Both tables are ordered the same way, newest month first. The month being
 * collected is the one you have opened the tab to read, so it sits at the top in
 * the index and again as the first block below it; a new month pushes the older
 * blocks down rather than being added at the far end of a year of scrolling.
 */
function dashboardGrid_(data, stamp) {
  const rows = [];
  const kinds = [];
  const put = function (kind, line) { rows.push(line); kinds.push(kind); };
  const money = function (amount) { return amount > 0 ? amount : NOTHING; };
  // The apostrophe is not decoration. "August 2026" written into a cell is stored
  // as the date 1 August 2026 and then shown as 01/08/2026 — the same coercion
  // that once printed an instant in the register. A leading ' keeps it words, and
  // a scheme somebody named "2026-08" stays a name.
  const words = function (text) { return "'" + text; };
  const bare = ["", "", "", "", "", ""];
  const tally = function (label, one, count) {
    return [words(label), money(one.renewal), money(one.rd), money(one.fd),
      money(one.total), count];
  };
  const columns = [words("Agent"), "Renewal", "New RD", "New FD", "Total", "Reports"];

  put("top", [words("Monthly report"), "", "", "", "", ""]);
  put("note", [words((data.reports === 1 ? "1 report" : data.reports + " reports") +
    "  ·  worked out " + stamp), "", "", "", "", ""]);

  if (data.months.length === 0) {
    put("blank", bare);
    put("note", [words("Nothing has come in from the form yet."), "", "", "", "", ""]);
    return { rows: rows, kinds: kinds };
  }

  put("blank", bare);
  put("eyebrow", [words("EVERY MONTH  ·  figures in ₹"), "", "", "", "", ""]);
  put("head", [words("Month")].concat(columns.slice(1)));
  data.months.forEach(function (month) {
    put("month", tally(month.label, month, month.count));
  });
  put("total", tally("Total", data, data.reports));

  // Newest month first here too, so the block you want is the first one you meet
  // on the way down and last month sits directly under it. The undated group stays
  // last of all: it is a loose end to tidy, not news.
  const dated = data.months.filter(function (month) { return month.key !== ""; });
  const undated = data.months.filter(function (month) { return month.key === ""; });

  dated.concat(undated).forEach(function (month) {
    put("blank", bare);
    put("blank", bare);
    put("title", [words(month.label.toUpperCase() + "  ·  EACH AGENT"), "", "", "", "", ""]);
    put("head", columns);
    month.agents.forEach(function (agent) {
      put("agent", tally(agent.name, agent, agent.count));
      // Every deposit on its own line, under the agent who sent it. The amount sits
      // in the column for its kind, so an RD is still amber and an FD still blue.
      // The other cells are left empty rather than marked ×: × means no money came
      // in, and this line is simply not about renewals or a report count.
      agent.deposits.forEach(function (one) {
        const named = one.kind.toUpperCase() +
          (one.scheme ? "  ·  " + one.scheme : " (no scheme name)");
        put("deposit", [words("    " + named), "",
          one.kind === "rd" ? money(one.amount) : "",
          one.kind === "fd" ? money(one.amount) : "", "", ""]);
      });
    });
    put("total", tally("Total", month, month.count));
  });
  return { rows: rows, kinds: kinds };
}

/**
 * The look: sizes, the three money colours, ₹ formats, borders.
 *
 * One matrix per kind of formatting, each applied in a single call, so a tab with
 * twenty month blocks costs the same to dress as one with a single month. The
 * version before this read the figures back out of the sheet to work out their
 * colours; it never needed to — the values are right here in built.rows.
 *
 * Colour is doing one job and it is the same job it does in the app: a green number
 * is a renewal, an amber one is an RD, a blue one is an FD. Nothing is coloured to
 * show that it is selected or important. The one tint on the tab is behind the
 * RD/FD lines under an agent, and it is saying "these belong to the line above" —
 * which is structure, not status.
 */
function dressDashboard_(sheet, built) {
  const rows = built.rows;
  const kinds = built.kinds;
  const end = rows.length;
  const sizes = [];
  const weights = [];
  const fills = [];
  const inks = [];
  const sides = [];

  for (let i = 0; i < end; i += 1) {
    const kind = kinds[i];
    const detail = kind === "deposit";
    const size = kind === "top" ? 16 : kind === "title" ? 13 : 10;
    const weight = (kind === "top" || kind === "title" || kind === "eyebrow" ||
      kind === "head" || kind === "total") ? "bold" : "normal";
    const fill = kind === "head" ? HEAD_FILL : kind === "total" ? TOTAL_FILL
      : detail ? DETAIL_FILL : null;
    const label = (kind === "note" || kind === "eyebrow" || detail)
      ? INK.quiet : HEAD_INK;

    sizes.push([size, size, size, size, size, size]);
    weights.push([weight, weight, weight, weight, weight, weight]);
    fills.push([fill, fill, fill, fill, fill, fill]);
    sides.push(["left", "right", "right", "right", "right", "right"]);

    if (kind === "head") {
      inks.push([HEAD_INK, INK.renewal, INK.rd, INK.fd, HEAD_INK, HEAD_INK]);
    } else {
      // A deposit line is read as part of the agent above it, so its figure is the
      // same colour a shade quieter — still plainly an RD or an FD, but it does not
      // compete with the agent's own total.
      const strong = [INK.renewal, INK.rd, INK.fd, HEAD_INK];
      const soft = [INK.quiet, INK.rdSoft, INK.fdSoft, INK.quiet];
      const line = [label];
      for (let column = 1; column <= 4; column += 1) {
        const value = rows[i][column];
        const nothing = value === NOTHING || value === "" || value === 0;
        line.push(nothing ? INK.quiet : (detail ? soft : strong)[column - 1]);
      }
      line.push(INK.quiet); // the report count, quiet because it is not money
      inks.push(line);
    }
  }
  const body = sheet.getRange(1, 1, end, 6);
  body.setFontFamily("Arial").setVerticalAlignment("middle");
  body.setFontSizes(sizes);
  body.setFontWeights(weights);
  body.setFontColors(inks);
  body.setHorizontalAlignments(sides);
  body.setBackgrounds(fills);
  // The label column stays text: a month, or a scheme somebody named 2026-08, is
  // words. The four money columns get Indian grouping; the count column is plain.
  sheet.getRange(1, 1, end, 1).setNumberFormat("@");
  sheet.getRange(1, 2, end, 4).setNumberFormat(RUPEES);

  // A banner row is one wide cell, so a long title is not clipped by an empty
  // neighbour. Merged after the values and formats, never before.
  for (let i = 0; i < end; i += 1) {
    const kind = kinds[i];
    if (kind === "top" || kind === "note" || kind === "eyebrow" || kind === "title") {
      sheet.getRange(i + 1, 1, 1, 6).merge();
    }
  }

  // Gridlines only where there is a table: from each heading row down to the last
  // row before the next gap. The blank rows between blocks stay blank.
  let from = 0;
  for (let i = 0; i < end; i += 1) {
    if (kinds[i] === "head") from = i + 1;
    const closes = i === end - 1 || kinds[i + 1] === "blank" || kinds[i + 1] === "head";
    if (from && closes) {
      sheet.getRange(from, 1, i + 2 - from, 6).setBorder(
        true, true, true, true, true, true, "#dfe2e6", SpreadsheetApp.BorderStyle.SOLID
      );
      from = 0;
    }
  }

  sheet.setColumnWidth(1, 300); // wide enough for a scheme name
  sheet.setColumnWidths(2, 3, 110);
  sheet.setColumnWidth(5, 130);
  sheet.setColumnWidth(6, 90);
  sheet.setFrozenRows(2);
  sheet.setHiddenGridlines(true);
}

/* --- the Settings tab, in words ------------------------------------------ */

/**
 * What each setting does, for the third column of the Settings tab.
 *
 * A key with no note here simply gets no note — a setting the app gains later
 * still works, it is only undescribed. The wording is aimed at somebody who has
 * opened this spreadsheet without the app in front of them.
 */
const SETTING_NOTES = {
  reportMonth: "Which month the form collects for, written as 2026-08. Leave it empty and the form works it out from today's date.",
  graceDays: "How many days into the new month last month's figures are still accepted.",
  credit: "The small line of text at the very bottom of the form.",
  open: "yes = agents can send figures. no = they see the closed screen instead.",
  message: "The announcement printed inside the form, above the questions. Empty means none.",
  showRd: "yes = the form asks for new RDs. no = that whole section disappears.",
  showFd: "yes = the form asks for new FDs. no = that whole section disappears.",
  autoWindow: "yes = the form opens and shuts itself on the two days below. no = 'open' above decides.",
  opensOnDay: "Day of the month collection opens by itself. Only used when autoWindow is yes.",
  closesAfterDay: "Last day of the month collection accepts. Only used when autoWindow is yes.",
  popupOn: "yes = agents get the greeting box when they open the form.",
  popupMode: "always, or window — window means only between the two dates below.",
  popupFrom: "First day the greeting shows, as 2026-08-01. Only used when popupMode is window.",
  popupTo: "Last day the greeting shows, as 2026-08-31. Only used when popupMode is window.",
  popupTitle: "The heading inside the greeting box.",
  popupText: "The words inside the greeting box.",
  popupImage: "A picture for the greeting: a Drive file as drive:ID, or a web address. Set from the admin page.",
  boardOn: "yes = the standing board shows on the form. An empty list below shows nothing either way.",
  boardTitle: "The heading above the standing board.",
  boardPlayers: "The board itself: a JSON list of names and points, typed on the admin page.",
};

/** The settings that are yes or no. These are the ones that get a dropdown. */
const YES_NO_SETTINGS = ["open", "showRd", "showFd", "autoWindow", "popupOn", "boardOn"];

/** Settings holding a date or a month, which a sheet would otherwise eat. */
const DATE_SETTINGS = { reportMonth: "yyyy-MM", popupFrom: "yyyy-MM-dd", popupTo: "yyyy-MM-dd" };

/**
 * What a yes/no cell is really saying, or null for "leave this alone".
 *
 * The app writes the words now, older sheets hold 1 and 0, and a person might
 * write anything. 1 and 0 are rewritten as yes and no because they mean exactly
 * the same thing to the app — see flag() in src/lib/settings.js — so nothing
 * changes except that the cell can now be read. A blank is left blank and a typo
 * is left showing: both are off, and inventing a value would hide a mistake.
 */
function onOrOff_(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  const said = String(value == null ? "" : value).trim().toLowerCase();
  if (said === "") return null;
  if (said === "yes" || said === "y" || said === "1" || said === "on" || said === "true") return "yes";
  if (said === "no" || said === "n" || said === "0" || said === "off" || said === "false") return "no";
  return null;
}

/**
 * The Settings tab, made readable and hard to mistype.
 *
 * Column 3 is a plain-words description; Code.gs only ever reads columns 1 and 2,
 * so column 3 is free. No row is added and no key is invented: a key missing from
 * this tab leaves the app on its baked-in default, whereas a row with a blank
 * value reads as a deliberate no — which would quietly hide the RD section. That
 * is the whole reason this function only ever describes what it finds.
 */
function tidySettings_() {
  const sheet = tab_(SETTINGS_TAB, ["Setting", "Value"]);
  sheet.getRange(1, 3).setValue("What it means");
  sheet.getRange(1, 1, 1, 3).setFontWeight("bold")
    .setBackground(HEAD_FILL).setFontColor(HEAD_INK);
  sheet.setFrozenRows(1);
  [[1, 150], [2, 300], [3, 430]].forEach(function (pair) {
    sheet.setColumnWidth(pair[0], pair[1]);
  });

  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return;

  const keys = sheet.getRange(2, 1, rows, 1).getValues();
  // Read column 3 first and write it back changed, so a note somebody added
  // themselves against a key the app has never heard of is not wiped.
  const said = sheet.getRange(2, 3, rows, 1);
  const notes = said.getValues();
  const yesNo = SpreadsheetApp.newDataValidation()
    .requireValueInList(["yes", "no"], true)
    .setAllowInvalid(true)
    .setHelpText("yes or no — anything else counts as no.")
    .build();

  for (let i = 0; i < rows; i += 1) {
    const key = String(keys[i][0] || "").trim();
    if (SETTING_NOTES[key] !== undefined) notes[i][0] = SETTING_NOTES[key];
    const cell = sheet.getRange(i + 2, 2);

    if (YES_NO_SETTINGS.indexOf(key) >= 0) {
      cell.setDataValidation(yesNo);
      const plain = onOrOff_(cell.getValue());
      if (plain !== null && plain !== cell.getValue()) cell.setValue(plain);
    } else if (DATE_SETTINGS[key]) {
      // A month typed by hand is stored as a date; put the words back, then keep
      // the cell as text so the next person to type in it is not eaten either.
      const value = cell.getValue();
      if (value instanceof Date) {
        cell.setValue("'" + Utilities.formatDate(value, zone_(), DATE_SETTINGS[key]));
      }
      cell.setNumberFormat("@");
    } else if (key === "popupImage" || key === "boardPlayers") {
      // Both can run to hundreds of characters; clipped, they stay one row tall.
      cell.setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  }

  said.setValues(notes).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
    .setFontColor(INK.quiet);
  sheet.getRange(1, 1, rows + 1, 3).setVerticalAlignment("top");
}

/* --- the Reports tab ------------------------------------------------------ */

/**
 * Put the months back into words, in the tab itself.
 *
 * A sheet does not keep what you type: `August 2026` is stored as the date 1
 * August 2026, and read back out it becomes "Sat Aug 01 2026 00:00:00 GMT+0530
 * (India Standard Time)". saveReport_ now writes both month columns with a leading
 * apostrophe so new rows cannot be eaten, but rows already in the tab — and any
 * row typed by hand before the format below was applied — are still dates. This
 * rewrites them from whichever of the two columns is still readable.
 *
 * A cell neither column can make sense of is left exactly as it is. Guessing at
 * it would turn somebody's note into a month.
 */
function repairMonths_(tab) {
  const sheet = tab.sheet;
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return;

  const keyColumn = tab.at["Month"];
  const wordColumn = tab.at["Month label"];
  if (!keyColumn && !wordColumn) return;

  const keys = keyColumn ? sheet.getRange(2, keyColumn, rows, 1).getValues() : null;
  const words = wordColumn ? sheet.getRange(2, wordColumn, rows, 1).getValues() : null;

  for (let i = 0; i < rows; i += 1) {
    const key = monthKey_(keys ? keys[i][0] : "") || monthKey_(words ? words[i][0] : "");
    if (!key) continue;
    if (keys) keys[i][0] = "'" + key;
    if (words) words[i][0] = "'" + (monthWords_(key) || "");
  }

  if (keys) sheet.getRange(2, keyColumn, rows, 1).setValues(keys);
  if (words) sheet.getRange(2, wordColumn, rows, 1).setValues(words);
}

/** A column number as a letter, for the one formula this file writes. */
function columnLetter_(index) {
  let letter = "";
  let left = Number(index) || 0;
  while (left > 0) {
    const rest = (left - 1) % 26;
    letter = String.fromCharCode(65 + rest) + letter;
    left = Math.floor((left - 1) / 26);
  }
  return letter;
}

/**
 * The Total column: renewal plus both deposit totals, one formula per row.
 *
 * This is the one formula in the whole spreadsheet, and it is rewritten every time
 * a report changes rather than trusted to stay put. It has to be: saveReport_
 * writes a row at the tab's full width, so a formula in that width is overwritten
 * by a new row, and a correction reads the row with getValues() first, which
 * flattens a formula to whatever number it held at that moment. Rewriting is
 * cheaper than defending, and it also fills in a row somebody typed by hand.
 *
 * A row with no name gets nothing — an abandoned row should not sprout a total.
 * An empty row gets ×, the same mark the app uses, and SUM ignores text, so your
 * own total further down the column still comes out right.
 */
/**
 * One row's Total formula, or "" for a row with no name in it.
 *
 * A formula rather than a number so that correcting a figure by hand in the tab
 * updates the total without the script being involved at all. It is rewritten
 * rather than trusted to stay put, because saveReport_ writes a whole row at the
 * tab's full width — see the comment there.
 */
function totalFormula_(tab, line) {
  const letters = ["Renewal", "RD total", "FD total"]
    .map(function (name) { return tab.at[name]; })
    .filter(function (found) { return Boolean(found); })
    .map(columnLetter_);
  if (letters.length === 0) return "";
  const sum = "SUM(" + letters.map(function (letter) { return letter + line; }).join(",") + ")";
  return '=IF(' + sum + '=0,"' + NOTHING + '",' + sum + ")";
}

function fixTotals_(tab) {
  const sheet = tab.sheet;
  const column = tab.at["Total"];
  const rows = sheet.getLastRow() - 1;
  if (!column || rows < 1) return;

  const names = sheet.getRange(2, tab.at["Name"] || 1, rows, 1).getValues();
  const formulas = [];
  for (let i = 0; i < rows; i += 1) {
    const named = String(names[i][0] || "").trim() !== "";
    formulas.push([named ? totalFormula_(tab, i + 2) : ""]);
  }
  sheet.getRange(2, column, rows, 1).setFormulas(formulas);
}

/**
 * The Reports tab, made readable without changing a single figure.
 *
 * The one thing here that does touch data is repairMonths_, and it puts words back
 * where a date had replaced them. Everything else is format: colour, width, and a
 * text format on the two month columns so the same thing cannot happen again to a
 * row typed by hand.
 */
function tidyReports_() {
  const tab = reportsTab_();
  const sheet = tab.sheet;
  const at = tab.at;
  repairMonths_(tab);

  // Formats are applied to the whole column, not only the rows that exist, so
  // that the next row typed by hand behaves like the rows already there.
  const deep = Math.max(sheet.getMaxRows() - 1, 1);

  sheet.getRange(1, 1, 1, tab.width)
    .setFontWeight("bold").setBackground(HEAD_FILL).setFontColor(HEAD_INK);
  sheet.setFrozenRows(1);

  // Green is a renewal, amber an RD, blue an FD — the same three colours as the
  // app and the dashboard. The Total is a mixture, so it is plain ink.
  [["Renewal", INK.renewal], ["RD total", INK.rd], ["FD total", INK.fd],
    ["Total", HEAD_INK]].forEach(function (pair) {
    const column = at[pair[0]];
    if (!column) return;
    sheet.getRange(1, column).setFontColor(pair[1]);
    sheet.getRange(2, column, deep, 1).setNumberFormat(RUPEES)
      .setHorizontalAlignment("right").setFontColor(pair[1]);
  });

  ["New RDs", "New FDs"].forEach(function (name) {
    if (at[name]) {
      sheet.getRange(2, at[name], deep, 1)
        .setHorizontalAlignment("right").setFontColor(INK.quiet);
    }
  });

  // Text, so that 2026-08 and August 2026 both stay what you typed.
  ["Month", "Month label"].forEach(function (name) {
    if (at[name]) sheet.getRange(2, at[name], deep, 1).setNumberFormat("@");
  });

  // The plumbing: still visible, because hiding the Id would make a report hard
  // to trace, but plainly not something to read.
  ["Id", "Submitted at", "RD json", "FD json", "Edited at", "Edited in"]
    .forEach(function (name) {
      if (at[name]) sheet.getRange(2, at[name], deep, 1).setFontColor(INK.quiet);
    });

  ["RD detail", "FD detail", "RD json", "FD json"].forEach(function (name) {
    if (at[name]) {
      sheet.getRange(1, at[name], deep + 1, 1)
        .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  });

  const WIDTHS = {
    Id: 115, "Submitted at": 150, Month: 80, "Month label": 110, Name: 150,
    Renewal: 105, "New RDs": 70, "RD total": 105, "RD detail": 210,
    "New FDs": 70, "FD total": 105, "FD detail": 210, Total: 115,
    "Edited at": 150, "Edited in": 80,
  };
  Object.keys(WIDTHS).forEach(function (name) {
    if (at[name]) sheet.setColumnWidth(at[name], WIDTHS[name]);
  });

  if (at["Edited in"]) {
    sheet.getRange(1, at["Edited in"]).setNote(
      "Written for you, not by you.\n\n'web' means the row was last changed on the " +
      "admin page. 'sheet' means somebody typed in it here.\n\nClearing this does " +
      "not un-edit a row — the next edit writes it again."
    );
  }

  fixTotals_(tab);
}

/**
 * Called from Code.gs after anything touches a report — always inside a try/catch
 * there, so that if this file is ever deleted the register carries on exactly as
 * it did before.
 */
function afterReportChange_() {
  fixTotals_(reportsTab_());
  refreshDashboard_();
}


