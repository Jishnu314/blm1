// The picture routes.
//
// Everything is the admin's except fetching the bytes, which has to be public: an
// agent's phone is not signed in and still has to see the poster.
//
// The bytes go out with a year of immutable caching, which is safe because an id here
// never points at different bytes — an upload always makes a new row. A phone on a
// slow connection fetches a poster once for as long as it is up.

import express from "express";
import { ApiError, asyncRoute } from "../lib/http.js";
import { imageId, imageInput } from "../lib/validate.js";
import { requireAdmin } from "../auth.js";
import { listImages, readImage, removeImage, saveImage } from "../services/images.js";

export const images = express.Router();

const noSuchImage = () => new ApiError("not_found", 404, "There is no picture with that id.");

images.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const image = await saveImage(imageInput(req.body));
    res.status(201).json({ image });
  })
);

images.get(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ images: await listImages() });
  })
);

// Public, and before nothing else — the only route here an agent's phone will call.
images.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = imageId(req.params.id);
    if (id === 0) throw noSuchImage();

    const found = await readImage(id);
    if (!found) throw noSuchImage();

    res.set("Content-Type", found.mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(found.data);
  })
);

images.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = imageId(req.params.id);
    if (id === 0) throw noSuchImage();
    if (!(await removeImage(id))) throw noSuchImage();
    res.json({ ok: true });
  })
);
