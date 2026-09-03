# The server

Express and Postgres behind the monthly renewal register. It does three things:

- **keeps the register** — reports, deposits, settings and popup pictures live in
  Postgres now, not in a Google Sheet and not in a phone's localStorage
- **guards it** — reading the register needs an admin session; an agent's phone can
  add its own report and read the settings, and that is all it can do
- **copies every write to the Google Sheet** — the same `/exec` URL, the same
  form-encoded calls `apps-script/Code.gs` already answers, so the Dashboard tab keeps
  working and neither `.gs` file needs a change

The contract is [`API.md`](./API.md) in this folder. If the code and that file ever
disagree, the code is wrong.

Two dependencies: `express` and `pg`. No bcrypt (a native build that fails on Windows —
passwords are scrypt from `node:crypto`), no multer (a picture arrives as a data URL,
not multipart), no dotenv (`node --env-file=.env`, which needs **Node 20 or newer**).

## Setting it up

1. **Have a Postgres to point at.** Locally: install Postgres and
   `createdb renewal_register`. Hosted: make a database on Render or Supabase and copy
   the connection string.

2. **Make `.env`.** Copy `.env.example` to `.env` and fill in `DATABASE_URL`. Every
   other variable has a working default; the comments in that file say what each does.

3. **Install.** In this folder:

   ```
   npm install
   ```

4. **Make the tables.**

   ```
   npm run migrate
   ```

   `schema.sql` is all `create ... if not exists`, so this is safe to run again, and the
   server runs it on every boot anyway. You will not need to think about migrations.

5. **Set the admin password.** At least 10 characters.

   ```
   npm run set-password -- "one you will remember"
   ```

   Or put it in `.env` as `ADMIN_PASSWORD` and let the first boot create the account.
   Either way it is stored as a scrypt hash and never as itself.

6. **Start it.**

   ```
   npm run dev
   ```

   `http://localhost:8787/api/health` should answer `{"ok":true,…}`.

**Then, once:** bring the reports that are already in the sheet across.

```
npm run import-sheet
```

It inserts by id and skips anything already here, so running it twice is harmless — run
it again after a few more rows arrive if you like.

### Serving the pages too

`npm run build` in the project root writes `../dist`, and this server serves it if it is
there: `/form/`, `/admin/` and `/api/*` on one origin, which is what removes CORS from
the project entirely. Without a `dist` it logs one line and serves the API alone.

In development the pages come from Vite on port 5173 instead, and Vite is told to pass
`/api` through to this process — that proxy is in `vite.config.js`:

```js
server: {
  port: 5173,
  proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
},
```

Both numbers have to agree. If you change `PORT` here, change it there.

## Putting it on Render

`render.yaml` in the project root already says all of this, so the short version is:
New → **Blueprint**, point it at this repository, and fill in the three values it asks
for (`DATABASE_URL`, `SHEET_WEBHOOK_URL`, `ADMIN_PASSWORD`). [`PUBLISH.md`](../PUBLISH.md)
in the project root is the click-by-click walk-through, database included.

By hand instead, it is one web service against a database made somewhere else:

1. New → **Web Service**, pointed at this repository.
   - **Root Directory:** `server`
   - **Build Command:** `npm install` — or, to have this process serve the pages as
     well, `cd .. && npm install --include=dev && npm run build && cd server && npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
2. Environment:

   | | |
   | --- | --- |
   | `DATABASE_URL` | the connection string, password in it |
   | `NODE_ENV` | `production` — this is what makes the session cookie `Secure` |
   | `TRUST_PROXY` | `1` — without it every request looks like it came from Render's proxy and the rate limits are shared by everybody |
   | `ADMIN_PASSWORD` | for the first deploy against an *empty* database. Already set the password locally against this same database? Leave it empty. |
   | `SHEET_WEBHOOK_URL` | the Apps Script `/exec` URL, if you still want the sheet copy |

3. Deploy. The tables are created on boot.

**`--include=dev` in that build command is not decoration.** `NODE_ENV` is
`production`, npm reads that and skips `devDependencies`, and `vite` is a
devDependency — so without the flag the build fails on `vite: not found` and the
service comes up serving the API with no pages in front of it.

**Do not use Render's free Postgres for this.** It expires 30 days after it is
created and the data is deleted 14 days after that. A register that quietly empties
itself six weeks in is worse than no register. Use a database that does not expire
and put its URL in `DATABASE_URL`.

`npm start` deliberately does **not** read `.env` — on Render the variables come from the
dashboard, and `node --env-file` fails when the file is not there.

The sheet queue lives in the database, so a deploy in the middle of an outage loses
nothing: whatever Google still owes is picked up by the next boot.

## What is worth knowing

**`deletedAt`.** A deleted report keeps its row and stops appearing.
`?includeDeleted=1` shows them, and those come back with a `deletedAt` so the admin page
can tell which is which. The sheet copy gets a real delete, so that tab looks the way it
always did.

**Money.** `bigint` in Postgres, a JS number in every reply. `pg` hands a bigint back as
a *string*, so every one of them goes through `Number()` in the service layer. That is
not tidiness: `total + "5000"` is `"05000"`, and this app has had that bug once already.

**The sheet is a copy.** Editing a figure in the tab changes nothing here any more. The
✎ and grid marks stay on old rows as history; corrections happen in the admin page from
now on. `GET /api/admin/status` says how far behind the copy is.

**`POST /api/reports` never overwrites.** The id is minted on the phone so a retry from
the outbox is safe. Because a stranger could post a known id, that route only ever
inserts: an id already stored gets the stored report back with `created:false`.
Corrections go through `PUT`, which needs the session.

**The rate limits are in this process's memory.** They reset on restart and a second
instance would keep its own count. Right for one small instance; if this ever runs on
two, they belong in Postgres.

**`DATABASE_SSL`.** `auto` turns TLS on for any host that is not this machine, without
checking the certificate — Render's and Supabase's are not signed by anything in Node's
trust store. That stops somebody reading the connection, not somebody who can already
stand in the middle of it. If your provider hands you a CA file, wiring it in here is a
real improvement.

## What has not been checked

Written without being run: nothing in this folder has been executed, no `npm install`, no
Node, no `psql`, no request. It was written by reading `API.md`, `Code.gs` and
`src/lib/entries.js` and by keeping to constructions that are hard to get wrong. Treat
the first run as the first test, and in this order:

1. `npm install`, then `npm run migrate` — proves `DATABASE_URL`, TLS and `schema.sql`
2. `npm run set-password -- "…"` — proves scrypt and the one admin row
3. `npm run dev`, then `GET /api/health` — proves the boot and the pool
4. `POST /api/admin/login`, then `GET /api/reports` — proves the cookie and the session
5. `POST /api/reports` twice with the same id — the second must answer `200` and
   `created:false`
6. `npm run import-sheet` twice — the second must bring in nothing
7. `GET /api/admin/status` — `queue` should fall back to 0 within a minute of a write

The SQL is the part most worth watching on that first run: every statement was written
by hand and none has been near a database.
