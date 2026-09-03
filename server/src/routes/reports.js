// The report routes.
//
// The split that matters: POST is public and PUT is not. An agent's phone may add its
// own report and nothing else — it cannot read the register, cannot correct a figure,
// cannot remove a row. Reading the register is admin-only, which it never was while
// the /exec URL sat in the published JavaScript and anybody holding it could read
// every agent's figures.

import express from "express";
import { ApiError, asyncRoute } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { newReport, reportBody, reportId } from "../lib/validate.js";
import { requireAdmin } from "../auth.js";
import {
  deleteReport,
  insertReport,
  listReports,
  replaceReport,
  restoreReport,
} from "../services/reports.js";

export const reports = express.Router();

// 30 sends per phone per ten minutes. A month's reporting is one send, or a handful
// if the outbox retried; a script filling the register is hundreds.
const sending = rateLimit({
  name: "reports",
  limit: 30,
  windowMs: 10 * 60 * 1000,
  message: "That is a lot of sending. Wait a few minutes and try again.",
});

reports.get(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const month = String(req.query.month || "").trim();
    // Any value at all means yes, so ?includeDeleted=1 and ?includeDeleted=true both
    // work and nobody has to remember which.
    const includeDeleted = req.query.includeDeleted !== undefined && String(req.query.includeDeleted) !== "0";
    res.json(await listReports({ month, includeDeleted }));
  })
);

reports.post(
  "/",
  sending,
  asyncRoute(async (req, res) => {
    const input = newReport(req.body?.report);
    const { report, created } = await insertReport(input);
    // 201 when this call made the row, 200 when the id was already stored. The phone
    // uses it to know whether its retry was the one that landed.
    res.status(created ? 201 : 200).json({ report, created });
  })
);

reports.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const report = await replaceReport(id, reportBody(req.body?.report));
    if (!report) throw new ApiError("not_found", 404, "There is no report with that id.");
    res.json({ report });
  })
);

reports.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const outcome = await deleteReport(reportId(req.params.id));
    if (outcome === "missing") throw new ApiError("not_found", 404, "There is no report with that id.");
    // "gone" as well as "done": asking twice is not a mistake worth an error.
    res.json({ ok: true });
  })
);

reports.post(
  "/:id/restore",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const report = await restoreReport(reportId(req.params.id));
    if (!report) throw new ApiError("not_found", 404, "There is no report with that id.");
    res.json({ report });
  })
);
