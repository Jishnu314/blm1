// Reports, in and out of Postgres.
//
// Two decisions here are the reason this file exists rather than the routes talking
// to the database themselves:
//
//   A report is two tables. The row and its deposit rows are written and rewritten
//   together, in one transaction, so a corrected report is never half corrected.
//
//   Money comes back from pg as a STRING, because a bigint does not fit in a JS
//   number and pg refuses to guess. Every one of them goes through Number() here, at
//   the edge, so nothing above this line can ever add "5000" to a total and get
//   "05000" — which is a bug this app has already had once.

import { query, tx } from "../db.js";
import { enqueue, kick } from "./mirror.js";

/** The row and its deposits, as the shape every route returns. */
function toReport(row, deposits = []) {
  const of = (kind) =>
    deposits
      .filter((one) => one.kind === kind)
      .map((one) => ({ amount: Number(one.amount), scheme: one.scheme }));

  return {
    id: row.id,
    name: row.name,
    month: row.month,
    renewal: Number(row.renewal),
    rd: of("rd"),
    fd: of("fd"),
    submittedAt: row.submitted_at.toISOString(),
    // "" rather than null for both, so a client never has to check which kind of
    // nothing it got.
    editedAt: row.edited_at ? row.edited_at.toISOString() : "",
    editedIn: row.edited_in || "",
    // Only on a report that has been removed, and only ?includeDeleted=1 ever sees
    // one. Without it the admin page could not tell a deleted row from a live one.
    ...(row.deleted_at ? { deletedAt: row.deleted_at.toISOString() } : {}),
  };
}

/** One report, whether we are inside a transaction or not. `runner` is a client or the pool. */
async function readOne(runner, id) {
  const found = await runner.query(`select * from reports where id = $1`, [id]);
  if (found.rows.length === 0) return null;
  const held = await runner.query(
    `select kind, amount, scheme from deposits where report_id = $1 order by position, id`,
    [id]
  );
  return toReport(found.rows[0], held.rows);
}

/** The deposit rows, in the order they were typed. */
async function writeDeposits(client, id, rd, fd) {
  const all = [
    ...rd.map((row, index) => ["rd", row, index]),
    ...fd.map((row, index) => ["fd", row, index]),
  ];
  // One statement per row: at most 40 of them, inside a transaction that is open
  // anyway. A single crafted multi-row insert would be faster and harder to read.
  for (const [kind, row, position] of all) {
    await client.query(
      `insert into deposits (report_id, kind, amount, scheme, position) values ($1, $2, $3, $4, $5)`,
      [id, kind, row.amount, row.scheme, position]
    );
  }
}

/**
 * The register. Newest submitted first — not newest edited, so correcting an old
 * report does not jump it to the top of the list.
 */
export async function listReports({ month = "", includeDeleted = false } = {}) {
  const conditions = [];
  const params = [];
  if (month !== "") {
    params.push(month);
    conditions.push(`month = $${params.length}`);
  }
  if (!includeDeleted) conditions.push(`deleted_at is null`);
  const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const found = await query(
    `select * from reports ${where} order by submitted_at desc, id desc`,
    params
  );
  if (found.rows.length === 0) return { reports: [], at: new Date().toISOString() };

  const ids = found.rows.map((row) => row.id);
  const held = await query(
    `select report_id, kind, amount, scheme
       from deposits
      where report_id = any($1::text[])
      order by position, id`,
    [ids]
  );

  const byReport = new Map();
  for (const one of held.rows) {
    const list = byReport.get(one.report_id);
    if (list) list.push(one);
    else byReport.set(one.report_id, [one]);
  }

  return {
    reports: found.rows.map((row) => toReport(row, byReport.get(row.id) || [])),
    // The server's clock at the moment it answered, which is what the admin page
    // labels the register with.
    at: new Date().toISOString(),
  };
}

/**
 * The form's send. Inserts, and will not overwrite.
 *
 * The id is minted on the phone so a retry out of the outbox is safe — the same
 * report arriving twice must be one row. But a client-minted id means anybody could
 * post somebody else's id, so this never rewrites: an id that is already stored gets
 * the stored report handed back, unchanged, with created:false. Corrections go
 * through replaceReport, which needs the admin session. That is the whole reason the
 * two are separate.
 */
export async function insertReport(input) {
  const result = await tx(async (client) => {
    const inserted = await client.query(
      `insert into reports (id, name, name_key, month, renewal, submitted_at)
            values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do nothing
         returning id`,
      [input.id, input.name, input.nameKey, input.month, input.renewal, input.submittedAt]
    );
    const created = inserted.rowCount > 0;

    if (created) {
      await writeDeposits(client, input.id, input.rd, input.fd);
      await enqueue(client, "report", input.id);
    }

    // Read back rather than trusting what we just sent: this is the row as stored,
    // and on the created:false path it is somebody else's row entirely.
    return { report: await readOne(client, input.id), created };
  });

  if (result.created) kick();
  return result;
}

/**
 * A correction. The whole report, not a patch, rewritten in one transaction.
 *
 * submittedAt is deliberately left alone — a correction is not a new submission, and
 * moving it would shuffle the register every time a figure was fixed.
 */
export async function replaceReport(id, input) {
  const report = await tx(async (client) => {
    const found = await client.query(
      `select id from reports where id = $1 and deleted_at is null for update`,
      [id]
    );
    if (found.rows.length === 0) return null;

    await client.query(
      `update reports
          set name = $2, name_key = $3, month = $4, renewal = $5,
              edited_at = now(), edited_in = 'web'
        where id = $1`,
      [id, input.name, input.nameKey, input.month, input.renewal]
    );
    await client.query(`delete from deposits where report_id = $1`, [id]);
    await writeDeposits(client, id, input.rd, input.fd);
    await enqueue(client, "report", id);

    return readOne(client, id);
  });

  if (report) kick();
  return report;
}

/**
 * Remove one. The row stays, with a deletedAt, so it can come back — an undo that
 * did not exist while the sheet was the register and Google's version history was
 * the only way back.
 *
 * Returns "gone" for a report that was already removed: asking twice is not an
 * error, and the sheet has already had its real delete.
 */
export async function deleteReport(id) {
  return tx(async (client) => {
    const found = await client.query(`select deleted_at from reports where id = $1 for update`, [id]);
    if (found.rows.length === 0) return "missing";
    if (found.rows[0].deleted_at) return "gone";

    await client.query(`update reports set deleted_at = now() where id = $1`, [id]);
    // The sheet copy gets a real delete, so the tab looks the same as it always did.
    await enqueue(client, "delete", id);
    return "done";
  }).then((outcome) => {
    if (outcome === "done") kick();
    return outcome;
  });
}

/** Bring one back, and put it back in the sheet — the sheet's row was really gone. */
export async function restoreReport(id) {
  const report = await tx(async (client) => {
    const found = await client.query(`select deleted_at from reports where id = $1 for update`, [id]);
    if (found.rows.length === 0) return null;

    if (found.rows[0].deleted_at) {
      await client.query(`update reports set deleted_at = null where id = $1`, [id]);
      await enqueue(client, "report", id);
    }
    return readOne(client, id);
  });

  if (report) kick();
  return report;
}

/** For GET /api/admin/status: how many reports there are, and since when. */
export async function reportsSummary() {
  const { rows } = await query(
    `select count(*) as held, min(submitted_at) as since from reports where deleted_at is null`
  );
  return {
    reports: Number(rows[0].held),
    since: rows[0].since ? rows[0].since.toISOString() : "",
  };
}
