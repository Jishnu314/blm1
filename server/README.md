# Local Express helper

Production uses the Supabase Edge Function in `../supabase/functions/api/`.
`server/` is the previous Express API, retained for local development and for the
one-time Google Sheet import script. It is not deployed as a hosted server.

## Run the older API locally

1. Copy `.env.example` to `.env` and set `DATABASE_URL`. This can point to local
   PostgreSQL or the Supabase Session Pooler.
2. In this folder, run `npm install`, then `npm run migrate`.
3. Start the local API with `npm run dev`. The frontend's Vite proxy sends local
   `/api` calls to port 8787.
4. In the repository root, run `npm install` and `npm run dev` in a second terminal.
   Open `http://localhost:5173/form/` or `/admin/`.

The local Express API still uses its legacy schema and same-origin cookie login. The
production Edge Function instead uses the schema in `../supabase/migrations/` and a
tab-scoped bearer session.

## Import old reports from the Google Sheet

Set `DATABASE_URL` and `SHEET_WEBHOOK_URL` in the private `.env`, then run
`npm run import-sheet`. It inserts report IDs that are not already in PostgreSQL and
can be run again safely. For production migration, use the Supabase Session Pooler
connection string so the report rows land in the same database used by the Edge
Function.

## Production

Follow [`../PUBLISH.md`](../PUBLISH.md) to deploy the Edge Function and GitHub Pages.
