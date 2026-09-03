# Publishing this

Everything below is done once. Budget an hour, most of it waiting on installs.

## Where it stands today

Three of the four hard parts are already built. The fourth is missing entirely.

| | |
| --- | --- |
| **A real password** | Done. Typed into `/admin/`, checked on the server, stored as a scrypt hash, and the session comes back as a cookie no script on the page can read. `server/src/auth.js`, `server/src/routes/admin.js`. Ten wrong tries per quarter hour and it stops answering. |
| **The Google Sheet copy** | Done, and the `/exec` URL is already deployed — it is sitting in `server/.env`. Every write still reaches the Dashboard tab. |
| **The pages** | Done. `/form/` for agents, `/admin/` for you, one build, one origin. |
| **Somewhere to run** | Missing. No database, no admin password set, no Git repo, no host. That is this whole file. |

One thing said plainly, because it changes how you should spend the next hour:
**nothing in `server/` has ever been executed.** Its two dependencies are on disk, so
`npm install` has been run at some point — but not one query and not one request. It was
written by reading the contract and then frozen. So step 2 is not a formality. It is the
first test this code has ever had, and a failure on your own machine costs a minute
where the same failure inside a deploy log costs twenty.

## 1. A database that will not expire — Neon (5 minutes)

Not Render's free Postgres: it expires 30 days after you make it and deletes the data
14 days later. A register that quietly empties itself six weeks in is worse than no
register. Not Supabase either, for this one — a free project pauses after 7 days of
no traffic and you have to go and restore it by hand, and this app is idle for three
weeks out of every four. Neon suspends instead of pausing: it goes to sleep after
five minutes and wakes on the next query in well under a second, with nothing for you
to do.

1. Go to **neon.com** and sign up. Signing in with GitHub is the easy road, since you
   need a GitHub account for step 4 anyway. No card is asked for.
2. **New Project.** It asks for three things: a name (anything), a Postgres version
   (take the default) and a **region**. A project's region cannot be changed
   afterwards, so choose the one you will also choose for Render in step 5 —
   Singapore, from India. What matters is that the database sits near the *server*,
   not near the agents: every query goes Render → Neon, and a phone never talks to the
   database at all.
3. On the Project Dashboard, click **Connect**, top right. The panel that opens builds
   the whole string for you, password included — copy it. That button is always there,
   so nothing is shown only once. If it offers a pooled connection, take it.
4. Open `server/.env` in Notepad and put the string on the `DATABASE_URL=` line, all
   one line, no quotes:

   ```
   DATABASE_URL=postgresql://neondb_owner:…@ep-….aws.neon.tech/neondb?sslmode=require
   ```

   If a connection later gets refused, delete `&channel_binding=require` from the end
   of it. Everything else in that file is already correct and can be left alone.

The free plan is $0 with no time limit: 0.5 GB of storage and 100 compute-hours a
month. Reports and settings will never come near that; popup pictures might eventually,
because they are kept in the database as bytes rather than on a disk that a deploy would
wipe. A shrunk poster is a couple of hundred kilobytes, so it is thousands of them
before this matters — but that is the number to watch, and old posters can be taken off
the shelf from the admin page.

`server/.env` is never committed — `server/.gitignore` covers it. Nothing in this
step ever reaches GitHub or the published JavaScript.

## 2. The first run, on your own machine (20 minutes)

You need **Node 20 or newer**. `node -v` in a terminal says which you have.

Open a terminal in `D:\Desktop\New folder` and go in order. Each command proves one
thing, and the point of doing them separately is that when one fails you know exactly
what failed.

```
cd server
npm install
```

*Proves: express and pg are there, and nothing here needs a compiler.* There is no
bcrypt and no multer in this server precisely so this step cannot fail on Windows. If it
finishes instantly saying `up to date`, it has been run before and that is fine.

```
npm run migrate
```

*Proves: `DATABASE_URL` is right, TLS to Neon works, and `schema.sql` is valid.* It
should print `Tables are in place.` This is the statement most likely to fail —
every line of that SQL was written by hand and none of it has been near a database.
If it complains, the message names the table and the column; send it to me as it is.

```
npm run set-password -- "something you will remember"
```

*Proves: scrypt works and the one admin row is written.* At least 10 characters. This
is the password for `/admin/` from now on. It is stored as a hash, so nobody —
including me — can read it back out; if you forget it, run this again.

```
npm run dev
```

*Proves: the server boots and holds a pool.* Leave it running. Open
<http://localhost:8787/api/health> in a browser: it should say
`{"ok":true,...,"database":true}`. `"database":false` means it is listening but cannot
reach Neon.

Now a **second terminal**, in `D:\Desktop\New folder`:

```
npm install
npm run dev
```

Open <http://localhost:5173/admin/> and sign in with the password you just set. Then
<http://localhost:5173/form/> and send one test report. Back on the admin page it
should appear in the register, and within a minute it should also appear in the Google
Sheet — that last part is the `/exec` URL in `server/.env` doing its job.

**If the login says "could not reach the server", the first terminal is not running.**
Both have to be up in development: Vite on 5173 serves the pages and passes `/api`
through to 8787.

## 3. Prove one process can serve the lot (5 minutes)

On Render there is no Vite — the Express process serves the built pages itself. Worth
seeing that work before you rely on it. Stop the Vite terminal, then in the project
root:

```
npm run build
```

That writes `dist/`. Restart the server terminal (`npm run dev` in `server`) and watch
its first lines: it should now say **`Serving the built pages from …\dist`**. If it
says `No built pages at …` then `dist` is not where it expects and Render would serve
the API with nothing in front of it.

Now open <http://localhost:8787/form/> — no 5173 involved. Sign in at
<http://localhost:8787/admin/> too. What you are looking at is exactly what Render
will serve.

## 4. Put it on GitHub (10 minutes)

Render deploys from a repository, and this folder is not one yet — there is no `.git`
here at all. In the project root:

```
git init
git add .
git commit -m "Monthly report collection: form, admin, server"
```

Before that commit, run `git status` and read the list once. **`server/.env` and both
`node_modules` must not be in it.** They are covered by `.gitignore` and
`server/.gitignore`, but this is the one moment where being wrong about that publishes
your database password, so look rather than assume. `dist` is ignored too, which is
correct — Render builds it.

Then on **github.com** → **New repository**. Name it something you will recognise in a
year (`monthly-report-collection`), and make it **private** — nothing here needs to be
public, and private costs nothing. Do not let GitHub add a README or a `.gitignore`;
you already have both. It then shows you two lines to paste, roughly:

```
git remote add origin https://github.com/Jishnu314/monthly-report-collection.git
git branch -M main
git push -u origin main
```

From now on, `git add .` → `git commit -m "…"` → `git push` is how a change reaches
the live site. **Render only ever runs what has been pushed** — this bit the FORM app
once, where a feature that existed only on your machine 404'd in production.

## 5. Render (10 minutes, mostly waiting)

`render.yaml` in this folder already describes the service, so you are confirming
rather than filling in a form.

1. **render.com** → **New** → **Blueprint**.
2. Connect the repository you just pushed. It finds `render.yaml` and shows one web
   service called `renewal-register`.
3. It asks for the three values the file deliberately does not contain:

   | | |
   | --- | --- |
   | `DATABASE_URL` | the same Neon string from `server/.env` |
   | `SHEET_WEBHOOK_URL` | the `/exec` URL, also already in `server/.env` |
   | `ADMIN_PASSWORD` | **leave it empty.** It only creates an account against an empty database, and yours already has one — you set it in step 2, against this same Neon database. |

4. **Apply**. First build takes three to five minutes: it installs the frontend, runs
   `vite build`, installs the server, then boots and creates any missing tables.

Your address is `https://renewal-register.onrender.com` — and the two links that
matter are `…onrender.com/form/` for agents and `…onrender.com/admin/` for you. The
trailing slash matters. Nothing anywhere links to `/admin/`, so bookmark it.

Because production points at the same database you tested against, the test report you
sent in step 2 is already sitting in the live register. Delete it from the admin page.

### If the build fails

Read the last twenty lines of the Render log; two failures are much likelier than the
rest. **`vite: not found`** means the `--include=dev` in the build command got lost —
`NODE_ENV` is `production`, npm reads that and skips `devDependencies`, and `vite`
lives in `devDependencies`. **`DATABASE_URL is not set`** is exactly what it says, and
the service prints the whole explanation before it stops.

One rarer one worth recognising: a message about **`@rollup/rollup-linux-x64-gnu`**
being missing. That is not your mistake — the lock file was written on Windows and npm
occasionally fails to pick up the Linux equivalent. Delete `package-lock.json` in the
project root, commit that, and push; the build will resolve it fresh.

A service that starts but logs `No built pages at …` is a build that half-worked: the
API is up, `/form/` gives you nothing. Same cause as the first one.

## 6. Check it like an agent would

Five things, in this order. Only the last two need a phone.

1. `…onrender.com/api/health` → `{"ok":true,…,"database":true}`.
2. `…onrender.com/form/` loads and looks right.
3. `…onrender.com/admin/` → sign in. **This is the real test of the password**, because
   the session cookie is `Secure` in production and was not on localhost. If the page
   accepts the password and then acts as though you never signed in, the cookie is
   being dropped — tell me, that is a five-minute fix, not a rebuild.
4. On your phone, **off wifi, on mobile data**, open `/form/` and send a report. This
   is the only test that proves an agent in another town can reach it.
5. Admin page → the register shows that report, and the Google Sheet gets it within a
   minute.

## Two things about the free tiers, so they do not surprise you

**The site falls asleep.** A free Render service that goes 15 minutes without a visitor
spins down, and the next visitor waits 30 to 60 seconds while it wakes. For this app
that is nearly harmless — agents arrive in a burst at month end, so the first one waits
and everybody after them is fast. Live with it, or pay Render's $7 a month, or point a
free monitor (cron-job.org, UptimeRobot) at it every 10 minutes to keep it awake.

**If you do use a monitor, point it at `/form/` and not at `/api/health`.** The health
route runs `select 1` against Postgres to answer, so pinging it every ten minutes would
keep Neon awake around the clock — and awake around the clock does not fit in the free
plan's 100 compute-hours: a month is about 730 hours, and even Neon's smallest compute
would spend roughly 180. `/form/` is a static file off disk and touches no database, so
it wakes Render and lets Neon go on sleeping. And before you set a monitor up at all:
Render's free plan allows only so many instance hours a month across *all* your free
services, and the FORM backend is already spending some of them. Keeping two services
awake around the clock will not fit either. Check the current allowance on your Render
dashboard first.

**Neon sleeps too, but harmlessly.** It suspends after five minutes idle and wakes on
the next query in a fraction of a second. Nothing for you to do, no restoring, and it
does not expire. That is exactly why it is Neon here and not Render's own free Postgres
(deleted after 30 days) or a second Supabase project (paused after 7 days idle, and you
would be at the free limit of two).

## Changing the password later

From the admin page, not from a terminal — and doing it there signs out every other
device, which is the point of having it. `ADMIN_PASSWORD` on Render stays empty; it is
only ever read against an empty database.

## What I have not checked, and you should not assume

- **Nothing was run today.** The shell was unavailable in this session, so no `npm`, no
  Node, no `psql` and no request. There is no test harness in this folder either — this
  file and `render.yaml` were written by reading the code on both sides of every call.
- **The SQL has still never touched a database.** `npm run migrate` in step 2 is its
  first run. That is the single most likely place for this to go wrong.
- **`render.yaml` has never been applied.** The field names come from Render's
  blueprint spec; the first **Apply** is its first test.
- **`src/lib/images.js` has never executed** — it needs a real canvas and FileReader, so
  uploading a popup picture is untested code the first time you do it.
- **I cannot see pixels.** Every layout judgement in this project is still yours.
