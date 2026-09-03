// The popup's pictures, kept in Postgres.
//
// In the database rather than on disk on purpose: Render's filesystem is wiped on
// every deploy, so a poster written to a folder would vanish the next time you push.
// A few hundred kilobytes of bytea is nothing to Postgres and it is backed up with
// everything else.
//
// What arrives is the data URL the browser's shrink() already produces, which is why
// there is no multipart parser and no upload dependency anywhere in this server. What
// is stored in the settings is only ever the ADDRESS of a picture — "/api/images/12"
// — never the picture, because settings travel to every phone on every load.

import { query, tx } from "../db.js";
import { enqueue, kick } from "./mirror.js";

/** The row as every route describes a picture. */
function toImage(row) {
  return {
    // bigserial comes back from pg as a string; the contract says a number.
    id: Number(row.id),
    url: `/api/images/${row.id}`,
    name: row.name,
    bytes: Number(row.bytes),
    when: row.created_at.toISOString(),
  };
}

export async function saveImage(input) {
  const image = await tx(async (client) => {
    const { rows } = await client.query(
      `insert into images (name, mime, bytes, width, height, data)
            values ($1, $2, $3, $4, $5, $6)
         returning id, name, bytes, created_at`,
      [input.name, input.mime, input.bytes, input.width, input.height, input.data]
    );
    // Drive gets a copy too, so the old "Monthly report popups" folder keeps filling
    // up exactly as it did. The queue row goes in here so the picture cannot be
    // saved without the copy being owed.
    await enqueue(client, "image", rows[0].id);
    return toImage(rows[0]);
  });

  kick();
  return image;
}

/**
 * The shelf, newest first — what replaces "Ones already in Drive". It is a database
 * query now rather than a walk through a Drive folder, which is why the admin page can
 * re-read the whole shelf every time it is opened, and again after a picture is
 * deleted, instead of holding on to a list it hopes is still true. The bytes are left
 * out: this is a list.
 */
export async function listImages() {
  const { rows } = await query(
    `select id, name, bytes, created_at from images order by id desc`
  );
  return rows.map(toImage);
}

/** The bytes, for GET /api/images/:id. Null when there is no such picture. */
export async function readImage(id) {
  const { rows } = await query(`select mime, data from images where id = $1::bigint`, [String(id)]);
  if (rows.length === 0) return null;
  return { mime: rows[0].mime, data: rows[0].data };
}

/**
 * Forget one.
 *
 * Only here — Code.gs has no action for removing a Drive file, and the folder was
 * always meant to keep everything. A settings value still pointing at this id simply
 * stops resolving, which the popup already treats as "no picture".
 *
 * That is a poster missing from every agent's phone, though, so it is not left to this
 * route to be relaxed about: the admin page refuses to delete the picture the
 * announcement points at and says to take it off the announcement first. This route
 * stays willing, because a client is not the only thing that may ever call it and a
 * refusal to delete something is a strange thing for a delete to hold.
 */
export async function removeImage(id) {
  const { rowCount } = await query(`delete from images where id = $1::bigint`, [String(id)]);
  return rowCount > 0;
}
