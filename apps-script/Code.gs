/**
 * The Google side of the monthly report form.
 *
 * THE SHEET IS THE REGISTER. Not this browser, not that phone — the sheet. Every
 * report lives in one row of "Reports", and both sides may write to it: the web
 * app through the calls below, and you, by typing in the tab like any other
 * spreadsheet. Whichever side you change, the other catches up.
 *
 * One script answers seven things:
 *   POST  action=saveReport      one report  ->  its row in "Reports" (new or corrected)
 *   POST  action=deleteReport    &id=…       ->  that row, gone
 *   POST  (no action)            an older copy of the app posting a new report
 *   POST  action=saveSettings    what the admin changed  ->  the "Settings" tab
 *   POST  action=saveImage       a shrunk popup picture  ->  a Drive folder
 *   GET   ?action=reports        every row, so any phone can show the register
 *   GET   ?action=settings       the settings, so every agent's phone agrees
 *   GET   ?action=images         what is already in the Drive folder
 *
 * ---------------------------------------------------------------------------
 * WHO CHANGED THIS ROW  —  the two marks
 *
 * Every row carries "Edited at" and "Edited in". A correction made on the web
 * writes "web" there; typing in this tab writes "sheet", stamped by onEdit
 * below. The register then shows a pencil against the first and a small grid
 * against the second, so you can always see where a figure was last touched.
 *
 * The mark is part of the row, not a setting, so nothing in the app can clear
 * it. Nor can you clear it by hand: blanking either of those two cells is
 * itself an edit, and onEdit writes the stamp straight back.
 *
 * ---------------------------------------------------------------------------
 * PUTTING IT UP  (about five minutes, once)
 *
 *  1. Make a new Google Sheet. Name it anything.
 *  2. Extensions -> Apps Script. Delete what is there, paste this file in, Save.
 *  3. Deploy -> New deployment -> Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone      <- must be "Anyone", not "Anyone with
 *                                         a Google account": agents are not
 *                                         signing in.
 *  4. Copy the /exec URL it gives you.
 *  5. In the project, next to package.json, make a file called `.env`:
 *
 *       VITE_SHEET_WEBHOOK_URL=https://script.google.com/macros/s/AKfy…/exec
 *
 *  6. Restart `npm run dev`.
 *
 * The tabs and the Drive folder make themselves the first time each is needed,
 * and a tab made by an older version of this file gains its new columns the
 * next time the script runs — nothing you have already collected is lost.
 *
 * onEdit needs no setting up: Apps Script runs a function of that name whenever
 * a person edits the sheet. It does NOT run when this script writes, which is
 * exactly what we want — a correction from the web must not be stamped "sheet".
 *
 * ---------------------------------------------------------------------------
 * WHO CAN REACH THIS — read this once
 *
 * "Anyone" means exactly that: whoever has the /exec URL can post a report,
 * change the settings and add a picture. There is no sign-in. That is the price
 * of agents opening a link and typing, and it is the same hole as the admin PIN:
 * the URL is inside the app every agent downloads, so it is not a secret. Now
 * that the sheet is the register rather than a copy of it, that URL can also
 * delete rows — so it matters more than it did.
 *
 * What that does and does not mean in practice: nobody can read your Drive or
 * your other sheets — the script only touches what is written below. Somebody
 * who went looking could add junk rows, change your settings, or remove a
 * report. Google keeps the sheet's own version history, so a deletion is
 * recoverable by hand (File -> Version history).
 *
 * If that day comes, the fix is a real one — sign-in on the form, or a small
 * server of your own holding the key — not a longer URL. Ask me and I will
 * build it.
 */

const REPORTS_TAB = "Reports";
const SETTINGS_TAB = "Settings";
const PICTURE_FOLDER = "Monthly report popups";

/** Every settings key the app knows, in the order they appear in the tab. */
const SETTING_KEYS = [
  "reportMonth",
  "graceDays",
  "credit",
  "open",
  "message",
  "showRd",
  "showFd",
  "autoWindow",
  "opensOnDay",
  "closesAfterDay",
  "popupOn",
  "popupMode",
  "popupFrom",
  "popupTo",
  "popupTitle",
  "popupText",
  "popupImage",
  // The game board's hand-typed list. boardPlayers is JSON — about a kilobyte for
  // a whole team, so unlike a picture it sits inside a cell comfortably.
  "boardOn",
  "boardTitle",
  "boardPlayers",
];

/**
 * The columns of the Reports tab.
 *
 * "Id" comes first because it is how a row is found again — every other column is
 * something a person might reasonably want to move, so nothing below depends on
 * position. Columns are looked up by heading, and a tab written by an older
 * version of this file simply gains the ones it is missing.
 *
 * The two "Edited" columns are what the register's marks are made of. Leave them
 * alone; they look after themselves.
 */
const REPORT_HEADINGS = [
  "Id",
  "Submitted at",
  "Month",
  "Month label",
  "Name",
  "Renewal",
  "New RDs",
  "RD total",
  "RD detail",
  "New FDs",
  "FD total",
  "FD detail",
  // Renewal + both deposit totals. Written as a formula by Dashboard.gs, and
  // rewritten by it every time a report changes, because saveReport_ writes a row
  // at this tab's full width and would otherwise flatten it to a stale number.
  "Total",
  "RD json",
  "FD json",
  "Edited at",
  "Edited in",
];

/* ========================================================================= */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  try {
    if (action === "settings") return json_(readSettings_());
    if (action === "images") return json_({ images: listPictures_() });
    if (action === "reports") return json_({ reports: readReports_() });
    return json_({ ok: true, note: "Alive. Ask for ?action=reports or ?action=settings." });
  } catch (problem) {
    return json_({ error: String(problem) });
  }
}

function doPost(e) {
  const form = (e && e.parameter) || {};
  const action = form.action || "";
  try {
    if (action === "saveSettings") {
      writeSettings_(form);
      return json_({ ok: true });
    }
    if (action === "saveImage") {
      return json_(savePicture_(form.name, form.data));
    }
    if (action === "deleteReport") {
      return json_(deleteReport_(form.id));
    }
    // saveReport, and a bare post from an older copy of the app, are the same
    // thing: put this report in the sheet, in its own row, wherever that row is.
    return json_(saveReport_(form));
  } catch (problem) {
    return json_({ error: String(problem) });
  }
}

/* --- the reports tab ----------------------------------------------------- */

/**
 * The tab, its headings, and where each heading currently is.
 *
 * Two things are being handled at once here, both about a tab a person shares
 * with a script. A tab from an older version of this file is missing the newest
 * columns, so they are appended rather than the tab being rebuilt — nothing
 * already collected moves. And the columns are then indexed by their heading, so
 * dragging a column somewhere more convenient does not silently start writing
 * renewals into the month.
 */
function reportsTab_() {
  const sheet = tab_(REPORTS_TAB, REPORT_HEADINGS);
  const width = Math.max(sheet.getLastColumn(), 1);
  let headings = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (cell) {
    return String(cell || "").trim();
  });

  const missing = REPORT_HEADINGS.filter(function (name) {
    return headings.indexOf(name) < 0;
  });
  if (missing.length > 0) {
    sheet.getRange(1, headings.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, 1, 1, headings.length + missing.length).setFontWeight("bold");
    headings = headings.concat(missing);
  }

  const at = {};
  headings.forEach(function (name, index) {
    if (name !== "" && at[name] === undefined) at[name] = index + 1;
  });
  return { sheet: sheet, at: at, width: headings.length };
}

/** Every report in the tab, as the app's own shape. */
function readReports_() {
  const tab = reportsTab_();
  const sheet = tab.sheet;
  if (sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, tab.width).getValues();
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const cell = function (name) {
      const column = tab.at[name];
      return column ? row[column - 1] : "";
    };
    const name = String(cell("Name") || "").trim();
    const id = String(cell("Id") || "").trim();
    // A row somebody started and abandoned is not a report. A row with a name but
    // no id is one they typed in themselves — it is given an id on the next read.
    if (name === "") continue;
    // The month is worked out, and the words are then built from it, so a cell the
    // sheet turned into a date cannot show up on screen as one.
    const month = monthKey_(cell("Month")) || monthKey_(cell("Month label"));
    out.push({
      id: id || fillId_(sheet, tab, i + 2),
      submittedAt: stamp_(cell("Submitted at")),
      month: month,
      monthLabel: monthWords_(month) || String(cell("Month label") || ""),
      name: name,
      renewal: Number(cell("Renewal") || 0),
      rd: rows_(cell("RD json"), cell("RD detail")),
      fd: rows_(cell("FD json"), cell("FD detail")),
      editedAt: stamp_(cell("Edited at")),
      editedIn: String(cell("Edited in") || "").trim().toLowerCase(),
    });
  }
  return out;
}

/**
 * A row typed straight into the tab has no id, and without one the web app
 * cannot correct or remove it. So it is given one, written back, and from then
 * on it is an ordinary report — you can add a row by hand and it behaves.
 */
function fillId_(sheet, tab, rowNumber) {
  const made = "sheet-" + Date.now() + "-" + rowNumber;
  if (tab.at["Id"]) sheet.getRange(rowNumber, tab.at["Id"]).setValue(made);
  return made;
}

/** A date cell or an ISO string, always handed back as an ISO string. */
function stamp_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || "").trim();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The timezone this sheet's own dates are displayed in. */
function zone_() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || "UTC";
  } catch (noBook) {
    return "UTC";
  }
}

/**
 * A month cell, however the sheet decided to keep it, as "2026-08".
 *
 * A sheet does not store what you typed. Type `August 2026` or `2026-08` into a
 * cell and what it keeps is 1 August 2026 as a **date**, so reading that cell as
 * text gives "Sat Aug 01 2026 00:00:00 GMT+0530 (India Standard Time)". That
 * string was reaching the register and being printed as the month.
 *
 * A real date is formatted in the sheet's own timezone, not UTC, because a date
 * cell is a wall-clock day rather than an instant: midnight on 1 August in India
 * is still 31 July in UTC, and that reads back as the wrong month. Text is read
 * by its words for the same reason.
 */
function monthKey_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, zone_(), "yyyy-MM");

  const text = String(value == null ? "" : value).trim().replace(/^'/, "");
  const plain = /^(\d{4})-(\d{1,2})/.exec(text);
  if (plain) {
    const month = Number(plain[2]);
    if (!(month >= 1 && month <= 12)) return "";
    return plain[1] + "-" + (month < 10 ? "0" + month : String(month));
  }

  const word = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(text);
  const year = /\b(\d{4})\b/.exec(text);
  if (!word || !year) return "";
  let index = -1;
  for (let i = 0; i < MONTH_NAMES.length; i += 1) {
    if (MONTH_NAMES[i].slice(0, 3).toLowerCase() === word[1].toLowerCase()) index = i;
  }
  if (index < 0) return "";
  return year[1] + "-" + (index < 9 ? "0" + (index + 1) : String(index + 1));
}

/** "2026-08" → "August 2026", and "" for anything that is not a month. */
function monthWords_(key) {
  const bits = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (!bits) return "";
  const index = Number(bits[2]) - 1;
  if (!(index >= 0 && index < 12)) return "";
  return MONTH_NAMES[index] + " " + bits[1];
}

/**
 * The deposit rows. The json column is the exact truth and is used when it is
 * there; "LIC Anand 5000 | Bhima 12000" is what a person types, and is read when
 * it is not — so a deposit added by hand in the tab still reaches the app.
 */
function rows_(jsonCell, detailCell) {
  const json = String(jsonCell || "").trim();
  if (json !== "") {
    try {
      const parsed = JSON.parse(json);
      if (Object.prototype.toString.call(parsed) === "[object Array]") return parsed;
    } catch (badJson) {
      // Fall through to the readable column.
    }
  }
  const detail = String(detailCell || "").trim();
  if (detail === "") return [];
  return detail
    .split("|")
    .map(function (part) {
      const text = part.trim();
      if (text === "") return null;
      const split = /^(.*?)(\d[\d,]*)\s*$/.exec(text);
      if (!split) return { scheme: text, amount: 0 };
      return {
        scheme: split[1].trim(),
        amount: Number(String(split[2]).replace(/,/g, "")) || 0,
      };
    })
    .filter(function (row) {
      return row !== null;
    });
}

/**
 * Put one report in the sheet: a new row if its id is new, the same row rewritten
 * if it is not.
 *
 * A correction is stamped "web"; a first submission is not stamped at all, because
 * it has not been edited — it has been made. That distinction is the whole point
 * of the mark, so it is decided here, at the one place both cases pass through.
 */
function saveReport_(form) {
  const tab = reportsTab_();
  const sheet = tab.sheet;
  const id = String(form.id || "").trim() || "web-" + Date.now();
  const found = rowOfId_(sheet, tab, id);

  const values = {
    Id: id,
    "Submitted at": form.submittedAt || new Date().toISOString(),
    // A leading ' keeps "2026-09" text, so the sheet cannot hand back a date.
    Month: form.month ? "'" + form.month : "",
    // And the same for the words: a bare `August 2026` becomes 1 August 2026.
    "Month label": form.monthLabel ? "'" + form.monthLabel : "",
    Name: form.name || "",
    Renewal: Number(form.renewal || 0),
    "New RDs": Number(form.rdCount || 0),
    "RD total": Number(form.rdTotal || 0),
    "RD detail": form.rdDetail || "",
    "New FDs": Number(form.fdCount || 0),
    "FD total": Number(form.fdTotal || 0),
    "FD detail": form.fdDetail || "",
    "RD json": form.rdJson || "",
    "FD json": form.fdJson || "",
  };

  if (found) {
    values["Edited at"] = new Date().toISOString();
    values["Edited in"] = "web";
  }

  const rowNumber = found || sheet.getLastRow() + 1;
  const line = new Array(tab.width).fill("");
  // A row being rewritten keeps whatever is in a column this script does not know
  // about — a note you added at the end of the row is yours, not ours to wipe.
  if (found) {
    const existing = sheet.getRange(rowNumber, 1, 1, tab.width).getValues()[0];
    for (let i = 0; i < tab.width; i += 1) line[i] = existing[i];
  }
  Object.keys(values).forEach(function (heading) {
    const column = tab.at[heading];
    if (column) line[column - 1] = values[heading];
  });

  sheet.getRange(rowNumber, 1, 1, tab.width).setValues([line]);
  // Only this row's own Total formula, and only if Dashboard.gs is in the project.
  // The Dashboard tab is deliberately NOT rebuilt here: the agent's phone is waiting
  // on this reply, nobody is looking at the spreadsheet at this moment, and opening
  // it rebuilds the tab anyway. A nicety must never slow down — or break — a save.
  try {
    const total = tab.at["Total"];
    if (total) sheet.getRange(rowNumber, total).setFormula(totalFormula_(tab, rowNumber));
  } catch (noDashboard) {}
  return { ok: true, id: id, corrected: Boolean(found) };
}

/** Gone from the sheet, not merely hidden — the sheet's own history is the undo. */
function deleteReport_(id) {
  const tab = reportsTab_();
  const found = rowOfId_(tab.sheet, tab, String(id || "").trim());
  if (!found) return { ok: true, removed: 0 };
  tab.sheet.deleteRow(found);
  // Nothing else to put right. The Total formulas below only ever point at their own
  // row, and a spreadsheet moves a relative reference itself when a row above it is
  // deleted. The Dashboard tab catches up when the spreadsheet is next opened.
  return { ok: true, removed: 1 };
}

function rowOfId_(sheet, tab, id) {
  if (id === "" || !tab.at["Id"] || sheet.getLastRow() < 2) return 0;
  const column = sheet.getRange(2, tab.at["Id"], sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < column.length; i += 1) {
    if (String(column[i][0] || "").trim() === id) return i + 2;
  }
  return 0;
}

/**
 * Somebody typed in the tab. Apps Script runs this by itself on a human edit and
 * never on a write from this script, which is what lets the two marks mean
 * different things without either side having to announce itself.
 *
 * Blanking "Edited at" or "Edited in" by hand is an edit too, so it lands here
 * and the stamp goes straight back on. That is what makes the mark unremovable
 * rather than merely discouraged.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== REPORTS_TAB) return;

    const first = e.range.getRow();
    const last = e.range.getLastRow();
    if (last < 2) return; // the heading row

    const tab = reportsTab_();
    const stampAt = tab.at["Edited at"];
    const stampIn = tab.at["Edited in"];
    if (!stampAt || !stampIn) return;

    const when = new Date().toISOString();
    for (let row = Math.max(first, 2); row <= last; row += 1) {
      // An entirely empty row is somebody clearing a mistake, not a correction.
      if (sheet.getRange(row, 1, 1, tab.width).isBlank()) continue;
      sheet.getRange(row, stampAt).setValue(when);
      sheet.getRange(row, stampIn).setValue("sheet");
      if (tab.at["Id"] && String(sheet.getRange(row, tab.at["Id"]).getValue() || "").trim() === "") {
        sheet.getRange(row, tab.at["Id"]).setValue("sheet-" + Date.now() + "-" + row);
      }
    }

    // A hand edit is exactly when the dashboard is most out of date. Script writes
    // do not fire onEdit, so the stamps above cannot bring us back in here.
    try {
      afterReportChange_();
    } catch (noDashboard) {}
  } catch (problem) {
    // A trigger that throws would show the editor an error on every keystroke.
    // The stamp is worth having, not worth interrupting anyone over.
  }
}

/* --- the settings tab ---------------------------------------------------- */

/**
 * Two columns, key and value, so you can also just type in it. A key the app
 * has never heard of is ignored by the app; a key missing from the tab leaves
 * the app on its own default, which is why deleting a row is harmless.
 */
function readSettings_() {
  const sheet = tab_(SETTINGS_TAB, ["Setting", "Value"]);
  const rows = sheet.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < rows.length; i += 1) {
    const key = String(rows[i][0] || "").trim();
    if (key === "") continue;
    const value = rows[i][1];
    // A date typed by hand is midnight where you are, so it is read in the sheet's
    // own timezone; reading it as UTC would hand back the day before.
    out[key] = value instanceof Date ? Utilities.formatDate(value, zone_(), "yyyy-MM-dd") : value;
  }
  return out;
}

function writeSettings_(form) {
  const sheet = tab_(SETTINGS_TAB, ["Setting", "Value"]);
  const rows = sheet.getDataRange().getValues();
  const rowOf = {};
  for (let i = 1; i < rows.length; i += 1) {
    const key = String(rows[i][0] || "").trim();
    if (key !== "") rowOf[key] = i + 1;
  }
  SETTING_KEYS.forEach(function (key) {
    if (form[key] === undefined) return;
    // A date or a month typed as text must stay text: a leading ' stops the
    // sheet turning "2026-09" into a date and handing back something else.
    const value = /^\d{4}-\d{2}/.test(String(form[key])) ? "'" + form[key] : form[key];
    if (rowOf[key]) {
      sheet.getRange(rowOf[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
      rowOf[key] = sheet.getLastRow();
    }
  });
}

/* --- the popup's pictures ------------------------------------------------- */

/**
 * The folder every popup picture is kept in. Found once and remembered, so it is
 * never created twice — and nothing in it is ever replaced or deleted. Every
 * picture you have ever put up stays here, which is what makes the list in the
 * admin worth having.
 */
function pictureFolder_() {
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperty("pictureFolderId");
  if (known) {
    try {
      return DriveApp.getFolderById(known);
    } catch (gone) {
      // Deleted from Drive by hand — fall through and make a fresh one.
    }
  }
  const existing = DriveApp.getFoldersByName(PICTURE_FOLDER);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(PICTURE_FOLDER);
  props.setProperty("pictureFolderId", folder.getId());
  return folder;
}

/**
 * Save one already-shrunk picture and hand back its id. The app stores that id
 * as "drive:ID" — a few dozen characters — so the picture reaches every agent
 * without a spreadsheet cell ever having to hold it.
 *
 * The name gets the date in front of it, so the folder reads in order and two
 * files called poster.jpg do not look like the same file.
 */
function savePicture_(name, dataUrl) {
  const raw = String(dataUrl || "");
  const parts = /^data:([^;]+);base64,(.+)$/.exec(raw);
  if (!parts) throw new Error("That was not a picture the app had prepared.");

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HHmm");
  const clean = String(name || "poster.jpg").replace(/[^\w. -]+/g, "");
  const blob = Utilities.newBlob(
    Utilities.base64Decode(parts[2]),
    parts[1],
    stamp + " " + (clean || "poster.jpg")
  );

  const file = pictureFolder_().createFile(blob);
  // A picture in a popup is fetched by a phone that is not signed in to Drive,
  // so the file has to be readable by anyone holding the link. Nothing else in
  // the folder or the Drive is touched by this.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: file.getId(), name: file.getName() };
}

/** Newest first — the admin picks from the top. */
function listPictures_() {
  const files = pictureFolder_().getFiles();
  const out = [];
  while (files.hasNext()) {
    const file = files.next();
    if (String(file.getMimeType() || "").indexOf("image/") !== 0) continue;
    out.push({
      id: file.getId(),
      name: file.getName(),
      when: file.getDateCreated().toISOString(),
    });
  }
  out.sort(function (a, b) {
    return a.when < b.when ? 1 : a.when > b.when ? -1 : 0;
  });
  return out;
}

/* --- small things -------------------------------------------------------- */

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** The tab, made with its headings the first time it is asked for. */
function tab_(name, headings) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.appendRow(headings);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headings.length).setFontWeight("bold");
  }
  return sheet;
}
