# Monthly report collection

A one-screen form for LIA agents: open the link, type your name, type your
renewal for the month, add any new RD or FD schemes, send. White cards on a soft
grey page, still minimal, built for a phone held in one hand — amount fields
open the phone's own number pad.

Each group of questions is its own card: the name and renewal together, then New
RD, then New FD. The month heading and the send button sit outside the cards.

Name and renewal are required. New RD and New FD are optional and start as a
single "+ Add" button; each row is the amount first, then the scheme name.

Each kind of money has its own colour and keeps it everywhere: renewal is the
app's green, new RD amber, new FD blue. The same three swatches label the receipt
breakdown, the columns of the admin tables and the bars in the admin chart, so a
figure is the same colour on the form, on the receipt and in the chart.

Green is a colour for *money*, never for selection. Nothing on either page draws
a coloured box around the thing you are touching: a field says it is focused by
darkening its own underline, and a chosen chip, switch or agent card just takes a
darker border. Keyboard users still get a ring — a thin near-black one, the same
colour as the text — on buttons and links.

The receipt shows the **month's total** big — renewal plus every deposit — with
renewal, RD and FD listed small underneath. It comes up about **half a second**
after the tap, and it does not wait for the register. Its last line is the one
thing that has to wait: *"Going into the register now."* becomes *"It is in the
register."* when the server answers, or *"Held on this phone…"* if it could not be
reached — in which case the phone sends it by itself later. The figures above that
line are the agent's own typing, so they are right the instant they are shown;
nothing on the receipt claims more than is known.

There is a fourth ending, rare and worth knowing about. If the server understands
the report and **refuses** it, the receipt says so in the server's own words
instead of promising to send it later — because that promise would never come
true, and the report would sit in the outbox blocking everything behind it. The
form guards its own boxes so this should not happen; "should not" and "cannot"
want different code.

## Three pieces

```
the pages     Vite + React — /form/ for the agents, /admin/ for you
the server    Express + Postgres in server/ — the register, and the password
the sheet     the same Google Sheet as before, now a copy the server keeps up
```

**Postgres is the register.** Every report, every deposit line, the settings the
admin page changes and the popup pictures all live in it. A phone holds nothing but
what it has not managed to send yet.

**The Google Sheet is a copy.** Every write here is pushed to the same Apps Script
`/exec` URL this app used to talk to directly, in the same form-encoded language
`apps-script/Code.gs` already answers — so the Dashboard tab you read on a Sunday
evening keeps working and neither `.gs` file needs a single change. Nothing is lost
if Google is asleep: the push waits in a queue table and is retried. Leave
`SHEET_WEBHOOK_URL` unset and there is no copy at all and nothing is owed; the app
is complete without one.

Two documents belong to the server half and are worth knowing before you change
anything: [`server/API.md`](./server/API.md) is the contract — every route, every
shape, who may call what — and every call in `src/lib/` keeps it. If the code and
that file ever disagree, the code is wrong. [`server/README.md`](./server/README.md)
is the long version of running and deploying it.

## Which month is it collecting for?

The report for August is filled in between about 31 August and 5 September, so the
form cannot simply use today's month. Day to day you set the month **from the admin
page**, and what you set there reaches every agent's phone.

`src/config.js` still holds a value for each of those settings, but it is not the
admin screen it used to be. It is what a browser shows on the very first frame,
before it has heard from the server — which is why the form appears at once and
works with no signal. A moment later `GET /api/settings` answers and whatever the
admin page last saved is what wins.

```
REPORT_MONTH = null       // automatic
REPORT_MONTH = "2026-08"  // pin it to August 2026, whatever today's date is
GRACE_DAYS   = 7          // the 1st–7th of a month still report the month before
```

The rest of the file is the same kind of value: `COLLECTION_OPEN`, `FORM_MESSAGE`,
`SHOW_RD`, `SHOW_FD`, `AUTO_WINDOW`, `OPENS_ON_DAY`, `CLOSES_AFTER_DAY`, `CREDIT`,
the seven `POPUP_*` and the three `BOARD_*`. There is no `ADMIN_PIN` any more. The
password is not a value the build is allowed to see.

## Two addresses

```
/form     the form agents fill in       →  http://localhost:5173/form/
/admin    the admin page                →  http://localhost:5173/admin/
/         redirects to /form/
```

Published, that reads as `https://your-site/form` and `https://your-site/admin`,
with `/api/*` alongside them on the same origin. Agents only ever get the `/form`
link.

## Run it on your PC

Two processes now, because there is a server. Two terminals, one in each folder.

**The server first.** You need a Postgres to point at — locally
`createdb renewal_register`, or a hosted one on Render or Supabase — and a
password. In `server/`:

```
npm install
copy .env.example .env        # then put your DATABASE_URL in it
npm run migrate
npm run set-password -- "one you will remember"
npm run dev
```

`http://localhost:8787/api/health` should answer `{"ok":true,…}`. **Node 20 or
newer**, because `node --env-file` is what reads `.env` — there is no dotenv here,
and only two dependencies in total. `npm run migrate` is safe to run again: the
schema is all `create … if not exists`, and the server runs it on every boot anyway.

**Then the pages**, in the other terminal, in this folder:

```
npm install
npm run dev
```

Open http://localhost:5173/form/ (the bare address sends you there anyway).

**8787 is not a number you can change in one place.** Vite is told to pass `/api`
through to it, which is what leaves the browser seeing a single origin: no CORS to
arrange anywhere, and no API address baked into the published JavaScript. If you
change `PORT` in `server/.env`, change the proxy in `vite.config.js` to match.

**Then, once:** bring the reports already in the sheet across, so the register
starts with the history instead of empty. In `server/`, with `SHEET_WEBHOOK_URL`
set:

```
npm run import-sheet
```

It inserts by id and skips anything already there, so the second run brings in
nothing — safe after a few more rows arrive, and safe when you cannot remember
whether you already did it. It reads the same `?action=reports` the app used to
read on every page load, it is defensive about what a hand-typed cell might hold,
and a row with no name is treated as a row somebody abandoned rather than a report.

## Try it on your phone (same wifi)

```
npm run phone
```

That prints a second address like `http://192.168.1.5:5173` — type that into your
phone's browser and add `/form/`. The server has to be running in its own terminal
as usual; `/api` is proxied through the address the phone is already using, so there
is nothing extra to set up on the phone. This is the real test: the amount field asks
the phone for its number pad, and type this large only looks right on a real screen.

## The admin page

It is a **separate page, not a route inside the form** — its own folder, its own
HTML file, its own bundle. Nothing in the form links to it, it carries `noindex`,
and it shows a password box before anything else.

**The password is checked on the server, and it is what stands in front of the
register.** Every route that shows or changes the whole register refuses to answer
without the session cookie that password buys. Two things follow. A stranger who
finds `/admin/` finds a box and nothing else — and, the part that is new, the
register itself is no longer readable by anyone who happens to know an address.

Set it in `server/`:

```
npm run set-password -- "at least ten characters"
```

or put `ADMIN_PASSWORD` in `server/.env` before the first boot and the account is
created from it. Either way it is stored as scrypt with its own salt and never as
itself. After that you change it from the admin page, which signs every other device
out. One caution about that command: a password typed on a command line is in your
shell history afterwards, so on a machine you share, set it once that way and then
change it from the page.

The cookie is `HttpOnly`, so no script on the page can read it — which is precisely
what the old PIN could not manage, sitting as it did in the built JavaScript for
anyone to read out of the bundle. It is `SameSite=Lax`, `Secure` in production, and
lasts 30 days, extended on use. Wrong passwords are limited to 10 tries per IP per
15 minutes and answer with the same sentence every time, whether the password was
close or nothing like it.

Renaming the `admin` folder — say to `office-7k2`, changing the matching line in
`vite.config.js` — is still a reasonable thing to do. It is simply no longer the
part doing the work.

From the page you can:

- **pick the month** — automatic with grace days, or pin one (a pinned month is
  always open, which is how you reopen a month for a late report)
- **open and close collection**, by hand or with a window: "opens on day 28,
  closes after day 7" and it looks after itself
- **hide New RD or New FD** if you only want renewal this month
- **write one line for the agents** to read above the questions — it appears as an
  ANNOUNCEMENT above the form, a solid green block with the text reversed out of
  it, so it is the one thing on a page of white cards that cannot be skimmed past
- **pop up an announcement** when an agent opens the form — a picture, a heading,
  a few words, or any one of the three. It is a separate thing from the green bar:
  the bar is the standing line, this is the thing that must not be missed. It ends
  one of two ways, your choice: **until you turn it off**, or **between two dates**,
  where it starts itself on the first day and closes itself after the last (both
  days count). A sentence under the switch says what it is doing right now —
  showing, waiting, finished, or nothing in it — and the very card an agent will
  get is previewed on the page as you type it. Each agent sees it once a day;
  change the words or the picture and it comes up again straight away. Getting
  past it is one tap: the Close button, the × in the corner, the dimmed area
  around it, or Escape — an agent came to type a figure and must never feel held
  up. Closing it is not losing it: while an announcement is live the form carries
  a **See the announcement** link under the month, so an agent who tapped past it,
  or who read it yesterday, can put it back up. The link only exists while there
  is something to see. With all three boxes empty nothing pops up, whatever the
  switch says.
- **take the announcement down for good** with **Delete the announcement**, which
  sits above the switch and stays there when the switch is off — because off only
  stops it popping up, and the heading, the words, the picture and the dates are
  all still written down behind it. It asks once, in the box, and the red one is
  set apart from **Keep it** so a thumb does not find it by accident. Saying yes
  empties all four and puts the switch off; like every other box on the page,
  nothing reaches an agent until you Save. The picture on its own can go the same
  way: whatever it came from — this device or a pasted link — it is named in words
  with a **Remove** beside it, rather than a box you have to empty by hand.
- **choose the popup's picture** three ways. **Choose a picture** takes one off
  your PC, shrinks it in the browser to 1200px wide as a JPEG — a 4 MB phone photo
  becomes 150–300 KB, which is the difference between an agent seeing the popup and
  an agent closing the form while it loads — then uploads that shrunk copy and
  points the popup at it. **Ones uploaded before** lists every picture you have ever
  put up, newest first, as thumbnails you click to re-use. Or type a name from
  `public/ads/`, or paste a web address. The settings only ever carry the *address*
  of a picture — `/api/images/12` — never the picture, so a poster reaches every
  phone without travelling in a settings value. The bytes go into Postgres rather
  than onto disk on purpose: a hosted filesystem is wiped on every deploy, so a
  poster written to a folder would vanish the next time you push. Old `drive:1AbC…`
  values from the Drive era still resolve.
- **take a picture off the shelf** with the × on its thumbnail, which asks once in
  words underneath before it goes. It refuses outright while that picture is the one
  the announcement points at, and says to take it off the announcement first —
  because deleting it there and then would be a poster missing from every agent's
  phone. Nothing else is ever replaced or deleted: an old poster is always one click
  away.
- **put up a game board** — a scoreboard on the form, and on the admin page under
  the settings that made it. You type the names and the points yourself: the app
  does not work them out from the reports, so the board can say whatever you want
  it to say. The top three stand on a podium — the winner in the middle and
  highest, on gold, with silver and bronze either side — and everybody else is
  folded away behind a **See all 9** line. Two people level are both first, and
  their place reads **Draw** rather than a made-up order. A little confetti falls
  behind the podium, and stops entirely for anyone whose phone is set to reduce
  motion. Switch it off, or empty the list, and nothing is drawn at all — an empty
  podium is not the same as no board. The medals are the one place colour is
  allowed to mean something other than money, because a gold medal cannot be
  misread as rupees.
- **copy the `/form` link** to send on WhatsApp
- **see who has brought in what this month** — one card per agent, showing that
  agent's total **for the month being collected** (a grey dash if they have not
  reported yet), with everything up to that month on the small line under it. The
  cards are ordered by this month's figure, so the standing is the order.
- **see each agent month by month** — pick an agent and read six months at a
  time, ending at the month being collected. Each month is one bar: renewal, new
  RD and new FD stacked in their three colours, with a scale down the left side
  and faint lines across. Each band carries its own figure: written on the band
  when the band is tall enough to hold it, and printed just outside the bar when
  it is a sliver, nudged apart so two slivers never overprint. Resting on a month
  brings up a card with all three figures to the rupee and the month's total under
  a rule. Every agent is drawn to the same scale, so two agents compare honestly,
  and a month nobody reported is a hairline rather than a gap. Under the chart the
  same months are listed as a table of exact figures with a total row.
- **everything per-agent stops at the month being collected.** Pin the collection
  back to July and the chart, the table under it, that table's total and the cards
  all read as July's standing — a report that counts for August is not quietly
  added in. Nothing is hidden: August is still one pick away in the register's
  month switcher.
- **read and maintain every report** — the register is a spreadsheet: one row per
  report, a column each for renewal, new RD, new FD and that report's total, and a
  grey total row at the bottom that adds up *every* report even when the list is
  showing only the newest eight. Each RD or FD is listed **separately with the
  scheme name the agent typed**, and when there is more than one the cell adds them
  up under a hairline ("2 RDs 1,05,000") — that subtotal is what the row's Total
  and the column's Total are made of. A column with nothing in it is **shaded
  grey and carries an ×** rather than being left blank, so "nothing came in"
  cannot be mistaken for "not filled in yet" and the gaps in a wide table can be
  counted without reading a single figure. ₹ is said once above the table instead
  of on every figure.
- **look back at a month already collected** — the register opens on the month
  being collected and a switcher offers every month that has reports (newest
  first). The heading, the total row and the CSV all follow the month you pick.
- **edit or delete a report** — Edit opens the row in place (name, month, renewal,
  every deposit line, add or drop lines), Delete asks once in the row before it
  goes. Both change the row **in the register**, the chart above updates with it,
  and the sheet copy is brought into line by the server.
- **put a deleted report back.** A delete is not for good any more: the row is kept
  and only stops appearing, and under the register a shut **Deleted reports** line
  opens the bin — every report that has been taken out, most recent first, with what
  it was worth and when it went, and a **Put it back** beside each. The same report
  comes back, not a retyped copy: same id, same figures, same submitted time, in its
  own place in the list. The bin is read as it opens and again after anything moves
  in or out, never on the half-minute poll, so it cannot offer you a report that is
  already back. While the sheet was the register, Google's version history was the
  only way back.
- **see where each row was last touched.** A report nobody has corrected carries no
  mark at all, which is the ordinary case. A row corrected here wears a **pencil ✎**;
  a row somebody typed straight into the tab wears a small **grid**; a row this
  device has not managed to send yet wears a **✱**. The three meanings are written
  beside the table. The grid is history now rather than news — the sheet is a copy,
  so a figure typed into the tab changes nothing here — and it is left on the old
  rows it belongs to rather than quietly cleared, because it is true about how that
  row came to say what it says.
- **download a CSV** of the whole register, or of just the month on screen
- **ask how the machinery behind it is doing.** A **Behind the page** section says
  how many reports the register holds and how far back they go, and whether the
  Google Sheet copy is keeping up — a queue that is falling needs nothing from you,
  and if Google has said something unhelpful the sheet's own sentence is printed
  there rather than left in a log nobody opens. Nothing in it can be changed, which
  is why it sits outside Save and its only button asks again.
- **change the password for this page**, which is the one control on the page that
  commits itself the moment you press it rather than waiting for Save — a password
  that was "nearly changed" is the worst of both. It needs the current one, the new
  one has to be at least ten characters, and doing it signs every other device out.

The admin page is laid out for a big screen: settings in a narrow left column,
the agent chart and the register in a wide right one. It still stacks into one
column on a phone, but it is meant for a PC.

**The register on screen says how old it is.** Under the table one line reads either
*Read just now* or, more quietly, *As it was 8 minutes ago* — never a figure
presented as current when it is not — and *Signed out — reload and sign in* is named
separately, because that is the one failure waiting will not fix. Beside it is a
Refresh button, and the page re-reads the register by itself every thirty seconds.
That poll **stops while you are editing a row or answering a delete question**: a
read landing under an open editor would swap the row you are correcting for the
server's version of it, and you would be typing into last minute's figures. While it
is paused the page says so.

Everything on the page is a draft until you press **Save**, and only what you
actually changed is sent — so two people at two screens do not overwrite each
other's settings by both having the page open. Three things step outside that and
commit themselves the moment you press them, and each says so on screen: the
password, uploading a picture, and taking one off the shelf. An upload is a real
upload — the picture is on the shelf whether or not you Save — but *which* picture
the popup points at is a setting like any other and waits for Save with the rest.

## Where the reports live

**Postgres is the register.** Not a copy of it — the register itself. This app has
had two previous answers to that question and both were wrong in the same way. First
every report lived in the browser's own storage and the sheet got a copy, which meant
two phones never agreed with each other. Then the sheet was the register, which fixed
that and left something worse: the `/exec` URL that could read, rewrite and delete
every agent's figures was baked into the published JavaScript, so anyone who opened
the page held it.

Now the register is behind a password, an agent's phone can write its own report and
read the settings and that is all it can do, and the sheet gets the copy.

This device keeps only two scraps of paper, and both are disposable:

- **the outbox** — anything typed here that could not be sent. Retried every time
  the form or the admin page is opened, and after every successful call. Marked ✱
  in the register until it lands.
- **the last read** — the newest list the server gave us, kept only so a phone in a
  bad-signal spot shows this morning's register rather than an empty table, and it
  says how old it is.

Clear this browser's storage and you lose nothing except reports that had not been
sent yet.

**Nothing an agent types is lost.** If they tap Send where there is no signal, or
while the server is waking up, the report is held on the phone and goes into the
register by itself the moment it can, and the receipt says so in those words rather
than pretending it is done. The id is made on the phone and the server inserts by
id — never overwrites — so the same report arriving twice is one row and not two.
That is what makes retrying safe, and it is also why a correction cannot go through
that route: anyone could post an id, so `POST` only ever inserts, and `PUT` behind
the password is where a figure gets changed.

The one thing that is *not* held on the phone is a report the server has read and
refused — a 21st deposit row, an 81-character name. Keeping that would mean an
outbox that retries something certain to fail on every load, forever, with
everything typed after it stuck behind it. So a refusal is shown, in the server's
own sentence, naming the box to fix. The form guards against most ways to cause one
before Send is even offered.

## The Google Sheet, now that it is a copy

The sheet is still there, still worth opening on a Sunday evening, and the Dashboard
tab still draws itself. What changed is which way the arrow points: the server pushes
every write to it, and nothing in it is read back.

Three things follow, and they matter:

1. **The `/exec` URL is now known only to the server.** It moved out of the frontend
   `.env`, where `npm run build` copied it into published JavaScript, and into
   `server/.env` as `SHEET_WEBHOOK_URL`. Nothing in a browser can see it any more.
   Each folder has its own `.gitignore` and each keeps its own `.env` out of git.
2. **A failed push is never a failed request.** It waits in a `mirror_queue` table
   and is retried with a growing delay. Nothing an agent typed depends on Google
   being awake, and the admin page's **Behind the page** section says how deep the
   queue is.
3. **Editing a figure in the tab no longer changes anything.** It is a copy. That is
   the trade this design makes, and corrections happen in the admin page from now on.

A delete and a restore both survive the trip: the sheet gets a real delete, then a
real re-add of the same row, so the tab holds what the register holds either way.
Two small things to know about that round trip, both because the sheet is told
"delete this row" and later "here is this report" and it cannot know the two are
connected. The row comes back at the **bottom** of the Reports tab rather than in the
place it used to sit, and it comes back **without** whatever ✎ or grid mark it used to
carry — along with anything you had typed in your own extra column on that row.
Nothing in the register is affected; it is the copy that forgets.

A correction is different, and does what you would want: the row is found and
rewritten in place, and the sheet stamps it *Edited in: web*.

### How the two marks came to mean what they mean

Apps Script has a trigger called `onEdit` that fires when a **person** types in a
cell and does not fire when a **script** writes one. That single fact is the whole
mechanism. A row the web app saved is stamped *Edited in: web*; a row somebody typed
into the tab by hand fires `onEdit` and is stamped *Edited in: sheet*. Neither side
had to announce itself, and neither side could lie about the other.

It is history rather than machinery now, because nothing is read back from the sheet.
The marks are left alone rather than tidied away: a pencil or a grid on an old row is
a true thing about how that row came to say what it says. The web app has never
written that column itself and still does not — a mark this page could set is a mark
this page could quietly clear.

### Connect it

Skip this whole section if you do not want the sheet copy. Without
`SHEET_WEBHOOK_URL` nothing is queued, nothing is owed, and the app is complete.

1. Open the sheet → **Extensions → Apps Script**, and paste in
   `apps-script/Code.gs`.
2. Add a **second file** in the same project (the **+** beside *Files* →
   *Script*), name it `Dashboard`, and paste in `apps-script/Dashboard.gs`. Both
   files must be in the one project — they are two halves of the same script and
   each calls the other's functions.
3. **Deploy → New deployment → Web app**, with *Execute as: **Me*** and *Who has
   access: **Anyone***. Still "Anyone" rather than "Anyone with a Google account",
   because it is now the server calling it and the server has no Google account.
4. Copy the `/exec` URL into **`server/.env`** — not the `.env` next to
   `package.json`, which is where it used to go and which is exactly the mistake this
   rewire was for:

   ```
   SHEET_WEBHOOK_URL=https://script.google.com/macros/s/xxxxx/exec
   ```

5. Restart the server — stop `npm run dev` and start it again, because `--watch`
   reloads code and not the environment. Whatever is already queued goes out on the
   next sweep.
6. Back in the spreadsheet, **reload the page**. A **Monthly report** menu appears
   next to Help; run **Set up / tidy the sheet** once. That builds the three tabs,
   formats them, and draws the dashboard.
7. Once, if the sheet already holds reports: `npm run import-sheet` in `server/`.

**Whenever either `.gs` file changes, paste the new version in and reload the
spreadsheet.** Editing a file in the script editor is enough for the menu and for the
dashboard — those run inside your own spreadsheet. Only the part the server talks to
needs **Deploy → Manage deployments → edit → Deploy** again to pick up a change.

**That URL is still worth protecting**, but it is no longer the keys to the register.
Whoever holds it can read, write and delete rows *in the copy*, and the copy is not
what any figure on this app is drawn from — the register is behind a password and a
session cookie no page can read. Keep it in `server/.env` all the same and do not
hand it to the agents; they only ever get the `/form` link.

## The sheet you open on a Sunday evening

Three tabs, and now none of them is a place you change anything.

**Dashboard** — written by the script, never typed into. At the top, **EVERY
MONTH**: one line per month with its renewal, RD and FD totals and how many
reports came in, newest month first. Below that, one block per month, each under
two blank rows and a big title — `SEPTEMBER 2026 · EACH AGENT`, then
`AUGUST 2026 · EACH AGENT`. **Newest first here too, so the month you are
collecting is the first block you meet and a new month pushes the older ones down
— no month is ever taken away.** Inside a block, every agent on their own line
with their totals, and under each agent **every RD and FD as its own line with the
scheme name they typed** — `RD · Sumangal`, `FD · Bhagyalakshmi`. A deposit sent
with no scheme name says `RD (no scheme name)` rather than showing a gap. A grey
**Total** row ends each block. Reports that arrived with no month at all are
grouped last, under `NO MONTH GIVEN`, so they are visible rather than silently
dropped.

Money keeps the app's three colours throughout: green renewal, amber RD, blue FD.
An empty money cell says **×** on a dim background — a figure of nothing, not a
cell somebody forgot. The RD and FD lines under an agent sit on a fainter tint of
their own, with the figure a shade quieter than the agent's, so they read as the
detail of the line above rather than as reports in their own right.

**Reloading the spreadsheet is the refresh.** The dashboard is rebuilt every time
the file is opened, so what you are looking at was worked out seconds ago. There is
also **Monthly report → Refresh the dashboard** if you have had the tab open a
while, and a hand edit in the Reports tab rebuilds it too. It is deliberately *not*
rebuilt when a report arrives: the server would be waiting on Google for it, and the
report is already in the register by then anyway.

**Reports** — one row per report, pushed here by the server. You *can* still type in
it, and `onEdit` will still mark the row and redraw the dashboard, but understand
what that is now: a note to yourself on a copy. The figure the app shows, the CSV, the
chart and next month's totals all come from the register, and the next push touching
that row will write over your cell. Corrections belong in the admin page.

**Settings** — what the admin page changed, in words, and the same warning applies
twice over. Column 1 is the setting, column 2 the value, and column 3 a plain-English
note of what it does. The pinned month here decides nothing now — the form reads
`GET /api/settings` — so this tab is a record of what was set, useful for
"when did we close August?", not a control.

`Set up / tidy the sheet` is safe to run as often as you like. It formats, it
rewrites the dashboard, and it puts months that the spreadsheet had turned into
dates back into words — it never deletes a report.

## What's where

The pages:

```
index.html                  redirect to /form/
form/index.html             the form every agent opens
admin/index.html            the admin page — unlinked, password-gated
vite.config.js              three pages, and the /api proxy to port 8787
src/config.js               the first frame's defaults: month, grace days, the rest
src/App.jsx                 the screen: name, renewal, RD, FD, send, receipt
src/main.jsx                mounts the form
src/manage.jsx              mounts the admin page
src/admin/AdminApp.jsx      sign in, the settings, the chart, the register, the bin
src/admin/AgentChart.jsx    one agent's six months as stacked bars, each band
                            carrying its own figure, with a hover card — no
                            chart library
src/admin/EntryEditor.jsx   correcting one report in place
src/components/AmountField  the ₹ renewal field (device number pad)
src/components/DepositSection  one RD/FD section: repeatable amount + scheme rows
src/components/Receipt      the "report sent" screen
src/components/Popup        the announcement card an agent gets on opening
src/components/Board        the game board: podium, medals, Draw, See all
src/lib/api.js              the one place the server's address and its failures are
                            known: apiGet, apiSend, and telling a refusal apart
                            from no answer
src/lib/auth.js             signing in, signing out, changing the password
src/lib/entries.js          the register: reading it, the bin, the outbox, the
                            last-read cache, merging the three, and which marks a
                            row carries
src/lib/submit.js           one attempt at the API per action — send, correct,
                            remove, restore — falling back to the outbox for the
                            three that may be replayed
src/lib/settings.js         what the admin changed: this device first frame, the
                            server for everyone
src/lib/images.js           shrink a chosen picture, upload it, list the shelf
src/lib/report.js           entries grouped by agent, the chart's six-month
                            window, the scale every bar is drawn against, the
                            months that have reports, and the cut-off that keeps
                            every per-agent figure at the month being collected
src/lib/rows.js             ids for repeatable rows, and the limits those rows have
src/lib/month.js            the month the form is collecting for, and the window
src/lib/board.js            reads the typed list, ranks it, hands out the medals
                            and calls a tie a Draw
src/lib/popup.js            when the popup is live, when it has ended, and
                            whether this agent has already seen today's
src/lib/currency.js         ₹ digits in, "1,25,000" out
src/lib/haptics.js          a 10ms buzz per key press where the phone allows one
src/lib/sheet.js            nothing. A dead re-export left where the old module
                            was, because the tools used for the rewire could not
                            delete a file. Nothing imports it; delete it.
src/index.css               the whole look, in one file
src/admin.css               the few controls only the admin page needs
public/ads/                 popup pictures kept with the app instead of uploaded
```

The server — two dependencies, `express` and `pg`, and nothing else:

```
server/API.md               the contract. If the code disagrees, the code is wrong
server/README.md            running it, deploying it, and what is worth knowing
server/.env.example         every variable, with a comment saying what it is for
server/src/index.js         boot: migrate, make sure there is a password, listen,
                            start the sheet flusher, shut down without dropping a
                            request
server/src/app.js           what is mounted in what order — the API first, the
                            built pages second, and a catch-all under /api so a
                            missing route can never answer a phone with HTML
server/src/config.js        the environment, read once
server/src/db.js            the pool, query(), tx(), and migrate()
server/src/schema.sql       every table, all create-if-not-exists
server/src/auth.js          scrypt passwords, session rows keyed by sha256(token),
                            the HttpOnly cookie, and requireAdmin
server/src/lib/http.js      one failure envelope for every failure
server/src/lib/validate.js  every rule a client's figures have to pass
server/src/lib/rateLimit.js per-IP counts, in this process's memory
server/src/lib/month.js     "YYYY-MM", and never the words
server/src/routes/*.js      reports, settings, images, admin
server/src/services/*.js    the SQL behind those routes
server/src/services/mirror.js  the sheet copy: one queue table, retried with a
                            growing delay, so Google being asleep is never an
                            agent's problem
server/scripts/set-password.mjs   the password, from a terminal
server/scripts/import-sheet.mjs   the old sheet's rows into Postgres, once
apps-script/Code.gs         the Google side the server posts to — reports,
                            settings, pictures. Unchanged by this rewire
apps-script/Dashboard.gs    the sheet an admin reads: the menu, the Dashboard tab,
                            and the plain-words column on Settings — a second file
                            in the same Apps Script project
```

What the server posts to the sheet for one report is the shape `Code.gs` already
expected: name, renewal, then `rdCount`/`rdTotal`/`rdDetail`
(`"Jeevan Anand 5000 | Bhima Deposit 125000"`) and the same three for FD, plus
`rdJson`/`fdJson`, and `submittedAt`. `editedAt` and `editedIn` are the sheet's own
to write, as they always were.

## What has been checked, and what only you can check

**Be plain about this: none of the rewire has been run.** No `npm install`, no build,
no dev server, no `psql`, no request — not once. Every claim in this file and in
`server/API.md` was checked by reading the code on both sides of each call and making
them agree: the route shapes out of the server's own source, the cookie flags out of
`server/src/auth.js`, the queue's ordering out of `mirror.js`, and every new name
grepped for a collision before it was used. That is worth something and it is not the
same as a passing test. There is no test harness in this folder.

So treat the first run as the first test, and in this order. Each step proves
something the next one assumes:

1. `npm install` and `npm run migrate` in `server/` — proves `DATABASE_URL`, TLS and
   `schema.sql`. The SQL is the part most worth watching: every statement was written
   by hand and none has been near a database.
2. `npm run set-password -- "…"` — proves scrypt and the one admin row.
3. `npm run dev`, then `http://localhost:8787/api/health` — proves the boot, the pool
   and the shutdown.
4. `npm install` and `npm run dev` in this folder, then open `/form/` — proves the
   Vite proxy, which is the one piece of wiring with a number in two files.
5. Sign in at `/admin/`, then look at the register — proves the cookie and the
   session. Sign in with the wrong password first; it should say the same thing
   however wrong it was.
6. Send a report from the form. Then send one **with the wifi off**, turn it back on,
   and reload: the receipt should say it is being held, the ✱ should appear beside it
   in the register, and both should clear by themselves.
7. Correct that report from the admin page, then delete it, then put it back from the
   bin. The chart above the table should follow all three.
8. `npm run import-sheet`, twice — the second run must bring in nothing.
9. **Behind the page** — the queue should fall back to 0 within a minute of a write.

And these need your eyes rather than a terminal, because nothing here can see pixels
or a real Google:

- **The Apps Script side was never re-tested**, because it was never changed. Open the
  spreadsheet after a few reports have gone through and satisfy yourself the Dashboard
  tab still reads well.
- **Delete a report and put it back, then look at the Reports tab.** The row should be
  at the bottom, and that is expected — see the note above about what the copy forgets.
- **The popup picture.** Choose one, watch it appear on the shelf, save, and open the
  form on your phone. `shrink()` has never executed here: it needs a real file chooser.
- **Whether the register table still has a scrollbar along the bottom of its card.**

## Publish it

[`PUBLISH.md`](PUBLISH.md) is the click-by-click version of this section — database,
GitHub, then Render, in that order, with a note on what each step proves. This is the
shape of it.

`npm run build` in this folder writes `dist/`, and the server serves that folder if it
is there — `/form/`, `/admin/` and `/api/*` on one origin, which is what removes CORS
from the project entirely. Without a `dist` it logs one line and serves the API alone.

Three things are needed, in this order. **A database that will not expire** — not
Render's free Postgres, which is deleted six weeks after it is made, and not a free
Supabase project, which pauses after a week of no traffic and has to be woken by hand;
this app is idle for three weeks out of every four. **A GitHub repository**, because
Render deploys from one and only ever runs what has been pushed. **Then Render**: New →
**Blueprint**, pointed at that repository — `render.yaml` in this folder already
describes the service, so that step is confirming rather than filling in a form.

What that file says, for doing it by hand instead: **Root Directory** `server`, **Start
Command** `npm start`, **Health Check Path** `/api/health`, and a **Build Command** that
builds both halves:

```
cd .. && npm install --include=dev && npm run build && cd server && npm install
```

**`--include=dev` is not decoration.** `NODE_ENV` is `production` in the environment
below, npm reads that and skips `devDependencies`, and `vite` is a devDependency — so
without the flag the build dies on `vite: not found` and the service comes up serving
the API with no pages in front of it.

Then the environment: `DATABASE_URL`, `NODE_ENV` set to `production` so the session
cookie is `Secure`, `TRUST_PROXY` set to `1` so the rate limits are per phone rather
than shared by everybody behind Render's proxy, `DATABASE_SSL` set to `auto`,
`SHEET_WEBHOOK_URL` if you want the sheet copy, and `ADMIN_PASSWORD` only for a first
deploy against an **empty** database — if you set the password locally against the same
database, the account is already there and this one is ignored. The tables are created
on boot, so there is no migration step to remember.

**What publishing no longer means.** The old warning here was that `npm run build`
copied the values out of `.env` into the JavaScript it produced, because that is the
only way a page with no server behind it can know anything — so publishing the site
published the webhook URL and the admin PIN inside it, and a public site was a
spreadsheet anyone could write to and delete from. That is what this rewire was for.
Now the built pages contain no address and no secret: the API is a sibling path, the
`/exec` URL is the server's alone, and the password is a scrypt hash in a database.
The root `.env` is left in place holding nothing but a comment saying so.

Two honest limits remain, neither of them a reason to wait. The rate limits live in
this one process's memory, so they reset on restart and a second instance would keep
its own count — right for one small service, and they belong in Postgres if it ever
runs on two. And `DATABASE_SSL=auto` encrypts the connection to the database without
checking the certificate, because neither Render's nor Supabase's is signed by
anything in Node's trust store; if your provider hands you a CA file, wiring it in is
a real improvement.
