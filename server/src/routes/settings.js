// The settings routes.
//
// Reading is public because the form cannot work without it: which month is being
// collected, whether collection is open, the notice, the popup, the board. Writing is
// the admin's. That asymmetry is the whole of the access model on this pair.

import express from "express";
import { asyncRoute } from "../lib/http.js";
import { settingsPatch } from "../lib/validate.js";
import { requireAdmin } from "../auth.js";
import { readSettings, writeSettings } from "../services/settings.js";

export const settings = express.Router();

settings.get(
  "/",
  asyncRoute(async (req, res) => {
    res.json({ settings: await readSettings() });
  })
);

settings.put(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    // Only what changed comes in; the whole set goes back, so the admin page can hold
    // the answer instead of working out what the merge did.
    const patch = settingsPatch(req.body?.settings);
    res.json({ settings: await writeSettings(patch) });
  })
);
