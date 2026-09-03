import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset paths relative, so the built site works from any
// folder or sub-path.
//
// Three pages, three folders — the addresses jishn asked for:
//   /form/    the form every agent opens
//   /admin/   the admin screen: separate page, unlinked, password-gated
//   /         a redirect to /form/, so the bare address is harmless
//
// "Password-gated" now means what it says. It used to mean a code compared in the
// browser, so hiding the page was the only protection there was and renaming this
// folder was the real lock. Now the routes behind it refuse to answer without a
// session the server issued, so a stranger finding /admin/ finds a password box and
// nothing else. Renaming the folder (say to `office-7k2`, changing the one line
// below to match) is still a reasonable thing to do — it is just no longer the part
// doing the work.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        // Relative to the project root; no __dirname needed in an ESM config.
        root: "index.html",
        form: "form/index.html",
        admin: "admin/index.html",
      },
    },
  },
  server: {
    port: 5173,
    // In development the API is a second process: this on 5173, and the Express
    // app in server/ on 8787. Proxying /api means the browser only ever sees one
    // origin, so there is no CORS to arrange and no API address baked into the
    // published JavaScript. In production the same server serves these built
    // pages, so /api is already a sibling of the page asking for it and there is
    // no proxy at all — which is why the paths in src/lib/api.js are plain and
    // relative to the origin.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
});
