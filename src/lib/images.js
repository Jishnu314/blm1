// The popup's picture: from the admin's PC, to something a phone loads quickly, to
// the server so nothing is ever lost.
//
// The chain is deliberately short, and it is now one chain rather than three:
//
//   1. shrink()  — the file is re-drawn at most 1200px wide as a JPEG. A 4MB
//                  photo out of a phone becomes 150-300KB, which is the
//                  difference between an agent seeing the popup and an agent
//                  closing the form while it loads.
//   2. upload()  — the shrunk copy goes to POST /api/images as exactly the data:
//                  URL shrink() already produced, which is why there is no
//                  multipart parser and no upload library anywhere in this app.
//                  The server keeps the bytes in Postgres and hands back
//                  "/api/images/12" — a few dozen characters for the settings to
//                  hold, so the picture travels to every agent without the
//                  picture itself travelling in a settings value.
//
// What went away was the third link: "no sheet? then keep it inline on this
// device". It existed because there might genuinely be nowhere to put a picture.
// There is somewhere now, so a failed upload is a plain failure with a readable
// note rather than a half-saved poster that reaches nobody but the admin's own
// browser and looks, on that browser, exactly like success.
//
// Nothing is overwritten. Every upload stays on the shelf under its own name and
// list() reads them back, so an old poster can be put up again with one click
// instead of being hunted for. remove() is the only way one leaves.

import { apiGet, apiSend } from "./api.js";

const MAX_WIDTH = 1200;
const QUALITY = 0.82;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file is not a picture I can open."));
    image.src = dataUrl;
  });
}

/**
 * Re-draw the picture at a sensible width for a phone. Returns a JPEG data URL.
 * A picture already small enough is still re-encoded — that is what strips the
 * camera's own bulk out of it.
 */
export async function shrink(file, max = MAX_WIDTH, quality = QUALITY) {
  const source = await loadImage(await readAsDataUrl(file));
  const scale = Math.min(1, max / (source.naturalWidth || max));
  const width = Math.max(1, Math.round((source.naturalWidth || max) * scale));
  const height = Math.max(1, Math.round((source.naturalHeight || max) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext("2d");
  // A JPEG has no transparency, so anything transparent would come out black.
  pen.fillStyle = "#ffffff";
  pen.fillRect(0, 0, width, height);
  pen.drawImage(source, 0, 0, width, height);

  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

/** Roughly what a data URL weighs once base64 is discounted. */
export function weigh(dataUrl) {
  const body = String(dataUrl || "").split(",")[1] || "";
  return Math.round((body.length * 3) / 4);
}

export function readable(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Take a file the admin chose and give back the value to store in the settings.
 *
 * Returns { ok, value, where, note, bytes }. `where` is only ever "server" now,
 * and it stays in the shape because a caller reads it — there used to be a
 * "device" to tell it apart from, and the whole point of the change is that there
 * is not one any more. A picture is either where the agents can see it or it is
 * nowhere, and this says which without needing to be read carefully.
 */
export async function upload(file) {
  if (!file) return { ok: false, note: "No file was chosen." };
  if (!/^image\//.test(file.type || "")) {
    return { ok: false, note: "Choose a picture — a JPG or a PNG." };
  }

  let shrunk;
  try {
    shrunk = await shrink(file);
  } catch (problem) {
    return { ok: false, note: problem.message };
  }
  const bytes = weigh(shrunk.dataUrl);

  try {
    const data = await apiSend("POST", "/api/images", {
      name: file.name || "poster.jpg",
      data: shrunk.dataUrl,
    });
    const url = String(data?.image?.url || "");
    if (url === "") throw new Error("the server sent no address back.");
    return {
      ok: true,
      value: url,
      where: "server",
      bytes,
      note: `Saved at ${shrunk.width}px wide, ${readable(bytes)}. Every agent will see it.`,
    };
  } catch (problem) {
    // No fallback, on purpose. Say what went wrong and let the admin try again
    // with the file still sitting in the box.
    return { ok: false, bytes, note: `That picture was not saved: ${problem.message}` };
  }
}

/**
 * Everything on the shelf, newest first, so a poster can be put back up without
 * going to look for the file again.
 *
 * null means it could not be asked — no signal, or no admin session — which is not
 * the same fact as asking and finding none, and the caller says which rather than
 * showing an empty shelf as though nothing had ever been uploaded.
 *
 * The sort happens here. The route promises newest first and keeps that promise,
 * but the version of this function that read the Drive folder made the same
 * promise in its own comment and did nothing whatsoever to keep it. A claim like
 * that is true until the day it is not, and this one costs a line.
 */
export async function list() {
  try {
    const data = await apiGet("/api/images");
    if (!Array.isArray(data?.images)) return null;
    return data.images
      .map((one = {}) => ({
        // An id is a number on the server and a string here, because it is only
        // ever put into an address or a React key.
        id: String(one.id ?? ""),
        name: String(one.name || "picture"),
        // What popupImage should be set to. Built by the server, not glued
        // together here, so the address only exists in one place.
        url: String(one.url || ""),
        bytes: Number(one.bytes) || 0,
        when: String(one.when || ""),
      }))
      .filter((one) => one.id !== "")
      .sort((one, two) => two.when.localeCompare(one.when) || Number(two.id) - Number(one.id));
  } catch {
    return null;
  }
}

/**
 * Take one off the shelf. Returns { ok, note }.
 *
 * The settings are deliberately not touched: deleting the picture the popup is
 * currently pointing at would leave it pointing at nothing, and what to do about
 * that is the admin page's decision to make out loud, not this file's to make
 * quietly.
 */
export async function remove(id) {
  try {
    await apiSend("DELETE", `/api/images/${encodeURIComponent(String(id))}`);
    return { ok: true, note: "Taken off the shelf." };
  } catch (problem) {
    return { ok: false, note: `That was not deleted: ${problem.message}` };
  }
}
