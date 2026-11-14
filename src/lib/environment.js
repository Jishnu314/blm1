// Which database is this page talking to?
//
// There are two, and they never mix:
//
//   TEST  a SQLite file on this PC (server/data/demo.sqlite), reached through the
//         Vite proxy to the Express server on port 8787. Throwaway sample data.
//   LIVE  the Supabase Postgres project, reached through the Edge Function. The
//         real register.
//
// vite.config.js blanks every VITE_ variable for local dev and local builds, so
// API_BASE is empty exactly when the page is on the test database, and set only
// in the GitHub Pages build for the live one. That makes this answer reliable
// rather than a guess: a page cannot be "live" without the Supabase address.

import { API_BASE } from "./api.js";

const live = API_BASE !== "";

export const ENV = {
  live,
  adminTitle: live ? "Admin" : "Admin · test database",
  topbarNote: live ? "Live register · Supabase" : "Test database · SQLite on this PC",
};
