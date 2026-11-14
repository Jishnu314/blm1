# Local demo API (Express + SQLite)

This folder is the **on-this-PC** API. It uses a SQLite file, not Postgres and not
the live Supabase project.

Production is documented later in [`../PUBLISH.md`](../PUBLISH.md). Do not point
this helper at that database.

## Run

From the repository root:

```
npm install
npm --prefix server install
npm run demo
```

Or two terminals:

```
npm run dev          # in server/
npm run dev          # in the repository root
```

- API: http://localhost:8787/api/health — should say `"engine":"sqlite"`, `"mode":"demo"`
- Form: http://localhost:5173/form/
- Admin: http://localhost:5173/admin/ — password `demo-admin-10`

The file is `server/data/demo.sqlite` (gitignored). Reset it with
`npm run demo:reset` from the repository root, or `npm run reset` in this folder.

## Optional `.env`

Copy `.env.example` only if you need to change the port, SQLite path, or demo
password. `DATABASE_URL` is ignored on purpose so a leftover Postgres URL cannot
open live data.

## Optional Google Sheet copy

Leave `SHEET_WEBHOOK_URL` empty for demo. Import from a sheet (`npm run import-sheet`)
is only for moving old rows into this local file, never into production.