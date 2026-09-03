# The API

One contract, written down once, so the server and the React pages cannot drift
apart. If a route here disagrees with the code, the code is wrong.

Everything lives under `/api`. Same origin as the pages in production (this server
serves `dist/` as well), and in development Vite proxies `/api` to it — so there is
no CORS anywhere and no address baked into the published JavaScript.

## Shapes

**Money is always a whole number of rupees, as a JSON number.** Never a string,
never paise. A sheet cell hands back `"5000"`; this API does not.

**A month is always `"YYYY-MM"`.** The words ("August 2026") are never stored and
never sent — both sides derive them from the key, because a spreadsheet turns
"August 2026" into a date behind your back and that is how the register once came
to print `Sat Aug 01 2026 00:00:00 GMT+0530`.

A **report**, exactly as every route returns it:

```json
{
  "id": "web-1756900000000-ab12cd",
  "name": "Ramesh",
  "month": "2026-08",
  "renewal": 30000,
  "rd": [{ "amount": 5000, "scheme": "Bhima Deposit" }],
  "fd": [],
  "submittedAt": "2026-08-31T10:22:00.000Z",
  "editedAt": "",
  "editedIn": ""
}
```

`editedIn` is `""`, `"web"` or `"sheet"`. `"sheet"` only ever appears on rows
imported from the old Google Sheet — the sheet is a copy now, not a place you can
change anything, so nothing new can be edited there. The server sets `"web"` on
every correction it makes; a client may not send `editedIn` and it is ignored if it
does. A mark the app could set is a mark the app could clear.

One field is **absent** from the block above rather than empty in it:

```json
  "deletedAt": "2026-09-02T06:11:00.000Z"
```

It appears only on a report that has been deleted, and only `GET /api/reports?includeDeleted=1`
ever returns one — every row from every other route is a live row, so a client that
never asks for the deleted ones never has to look at this field. Absent rather than
`""` because "this report is in the register" and "this report was deleted at 6:11"
are different kinds of answer, and the admin page tells them apart to offer the undo.

**Every failure** answers with the same envelope and never with HTML:

```json
{ "error": { "code": "invalid_input", "message": "Say who this is for.", "field": "name" } }
```

| code | status | when |
| --- | --- | --- |
| `invalid_input` | 400 | something typed is not usable; `field` names it |
| `unauthorised` | 401 | admin route without a valid session |
| `not_found` | 404 | no such report, image, or route |
| `too_many` | 429 | rate limit; `Retry-After` in seconds |
| `server_error` | 500 | a bug here |
| `unavailable` | 503 | the database could not be reached |

## Who may call what

Agents do not sign in — they open a link and type. So the two things the form needs
are public, and everything that shows or changes the whole register needs the admin
session:

| | route | who |
| --- | --- | --- |
| GET | `/api/health` | anyone |
| GET | `/api/settings` | anyone — the form needs the month, the notice, the board |
| POST | `/api/reports` | anyone, rate limited — this is the form's send |
| GET | `/api/images/:id` | anyone — an agent has to see the poster |
| GET | `/api/reports` | admin |
| PUT | `/api/reports/:id` | admin |
| DELETE | `/api/reports/:id` | admin |
| POST | `/api/reports/:id/restore` | admin |
| PUT | `/api/settings` | admin |
| POST | `/api/images` | admin |
| GET | `/api/images` | admin |
| DELETE | `/api/images/:id` | admin |
| POST | `/api/admin/login` | anyone, rate limited |
| GET | `/api/admin/me` | anyone — answers `{ "signedIn": false }` rather than 401 |
| POST | `/api/admin/logout` | admin |
| POST | `/api/admin/password` | admin |
| GET | `/api/admin/status` | admin |

**Reading the register is admin-only, which it never was before.** With the sheet as
the register, the `/exec` URL sat in the published JavaScript and anyone holding it
could read every agent's figures. Now an agent's phone can write its own report and
read the settings, and that is all it can do.

## Reports

### `POST /api/reports` — the form's send

```json
{ "report": { "id": "web-…", "name": "Ramesh", "month": "2026-08",
              "renewal": 30000, "rd": [{ "amount": 5000, "scheme": "Bhima" }], "fd": [],
              "submittedAt": "2026-08-31T10:22:00.000Z" } }
```

→ `201 { "report": {…}, "created": true }` for a new report,
`200 { "report": {…}, "created": false }` if that id is already stored.

**It inserts, and it will not overwrite.** The id is minted on the phone so that a
retry from the outbox is safe — the same report arriving twice must be one row. But a
client-minted id means anyone could post *your* id, so this route never rewrites an
existing row: it hands the stored one back with `created:false` and changes nothing.
Corrections go through `PUT`, which needs the admin session. That is the whole reason
the two are separate routes.

Rules: `name` 1–80 characters after trimming; `month` matches `YYYY-MM`; `renewal`
and every `amount` a whole number, 0 to 999,999,999 (0 is allowed, negative is not);
at most 20 `rd` and 20 `fd` rows; `scheme` up to 80 characters, may be empty;
`id` up to 64 characters of `A–Z a–z 0–9 - _`; `submittedAt` optional, and the server
uses its own clock if it is missing or unparseable. Rate limit: 30 posts per IP per
10 minutes. Anything over the limits is `invalid_input` with the offending `field`.

### `GET /api/reports` — the register

`?month=2026-08` narrows it; leave it off for every report. Deleted reports are left
out unless you pass `?includeDeleted=1`, and the ones that come back that way are the
only rows anywhere that carry `deletedAt` — which is how the admin page picks the bin
out of the answer. It asks for everything and keeps the deleted ones, because the live
rows it also gets are the ones it wanted anyway.

→ `{ "reports": [ … newest submittedAt first … ], "at": "2026-09-03T…Z" }`

`at` is the server's clock at the moment it answered, which is what the admin page
labels the register with.

### `PUT /api/reports/:id` — correct one

Body is `{ "report": { … } }` holding the whole report, not a patch: name, month,
renewal and every RD/FD row, exactly as `POST`. The row is rewritten, `editedAt` is
stamped and `editedIn` becomes `"web"`.

→ `200 { "report": {…} }`, or `404` if there is no such report.

### `DELETE /api/reports/:id`

→ `200 { "ok": true }`. The row is kept with a `deletedAt` and stops appearing;
`POST /api/reports/:id/restore` → `200 { "report": {…} }` brings it back, same id, same
figures, same `submittedAt`. That undo did not exist while the sheet was the register —
Google's version history was the only way back — and the admin page offers it under the
register as the bin. The sheet copy gets a real delete and a real re-add, so the tab
looks the same as before either way.

Restoring a report that was never deleted is not an error: nothing changes and the row
is handed back. `404` means there is no report with that id at all.

## Settings

`GET /api/settings` → `{ "settings": { … all of the keys below … } }`, always every
key, always the right type. `PUT /api/settings` takes `{ "settings": { …only what
changed… } }` and answers with the full set afterwards, so the admin page can hold
what came back and never has to guess what the merge did.

| key | type | notes |
| --- | --- | --- |
| `reportMonth` | `"YYYY-MM"` or `null` | `null` = work it out from today |
| `graceDays` | int 0–28 | the 1st–7th report the month before |
| `credit` | string ≤ 80 | the footer line |
| `open` | bool | closed → the form shows a notice instead |
| `message` | string ≤ 500 | the standing ANNOUNCEMENT line |
| `showRd` / `showFd` | bool | whether the optional sections appear |
| `autoWindow` | bool | open and close by date instead of by hand |
| `opensOnDay` | int 1–31 | |
| `closesAfterDay` | int 0–31 | |
| `popupOn` | bool | |
| `popupMode` | `"always"` or `"window"` | anything else is read as `"always"` |
| `popupFrom` / `popupTo` | `"YYYY-MM-DD"` or `""` | |
| `popupTitle` | string ≤ 120 | |
| `popupText` | string ≤ 2000 | |
| `popupImage` | string ≤ 300 | see below |
| `boardOn` | bool | |
| `boardTitle` | string ≤ 120 | |
| `boardPlayers` | string ≤ 20000 | a JSON array, kept as the string |

Booleans travel as real JSON booleans now, not the words `yes`/`no` a spreadsheet
cell needed. The client's `flag()` still reads the words, so a sheet set up before
this keeps working.

`popupImage` is one of: `""`, `/api/images/12` (uploaded here — this is what the
upload route returns), a full `http(s)://` address, or a leftover `drive:ID` from the
Google Drive era, which still resolves. It is never the picture itself. The 50,000
character spreadsheet-cell wall that forced `drive:ID` is gone, but the rule that a
settings value is a *pointer* stays.

## Pictures

`POST /api/images` → `{ "name": "poster.jpg", "data": "data:image/jpeg;base64,…" }`,
which is exactly what the browser's existing `shrink()` already produces, so there is
no multipart parser here and no upload dependency.

→ `201 { "image": { "id": 12, "url": "/api/images/12", "name": "poster.jpg",
"bytes": 148230, "when": "2026-09-03T…Z" } }`

The bytes go into Postgres, not onto disk, on purpose: Render's filesystem is wiped on
every deploy, so a poster written to disk would vanish the next time you push. Only
`image/jpeg`, `image/png` and `image/webp` are accepted, at most 2 MB after decoding.

`GET /api/images` → `{ "images": [ … newest first … ] }` — the shelf of everything
uploaded, which is what replaces "Ones already in Drive". It is fast now, so the admin
page may ask for it on open rather than on a button.

`GET /api/images/:id` returns the bytes with `Cache-Control: public, max-age=31536000,
immutable` — an id never points at different bytes, so an agent's phone fetches a
poster once. `DELETE /api/images/:id` → `{ "ok": true }`.

## The admin session

`POST /api/admin/login` with `{ "password": "…" }` → `200 { "ok": true }` and a
`Set-Cookie: mr_session=…`. Wrong password is `401 unauthorised` with the same
message every time and no hint about whether the password was close.

The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` whenever `NODE_ENV` is
`production`, and lasts 30 days, extended on use. `HttpOnly` is the point: no
JavaScript on the page can read it, so the token cannot be copied out the way the PIN
in `config.js` could simply be read out of the bundle.

What is stored server-side is `sha256(token)`, never the token. The password is stored
as `scrypt` with a per-password salt (`node:crypto`, so there is no native `bcrypt`
build to fail on Windows), compared with `timingSafeEqual`.

Rate limit: 10 attempts per IP per 15 minutes, then `429` with `Retry-After`. Every
attempt also waits a moment before answering, so the endpoint cannot be used to
measure anything.

`GET /api/admin/me` → `{ "signedIn": true|false }`, and deliberately **200 either
way** — the admin page asks it on open to decide whether to show the login form, and a
401 there would just be noise in the console.

`POST /api/admin/logout` → `{ "ok": true }`, clears the cookie and deletes that one
session row. Other devices stay signed in.

`POST /api/admin/password` with `{ "current": "…", "next": "…" }` → `{ "ok": true }`.
`next` must be at least 10 characters. Changing it **signs every other device out** by
deleting every session row but the one making the call.

`GET /api/admin/status` → `{ "sheet": { "configured": true, "queue": 0,
"lastError": "" }, "reports": 41, "since": "2026-08-31T…Z" }` — enough to answer "is
the Google Sheet copy keeping up?" without opening the sheet.

## The Google Sheet copy

The sheet is no longer the register. Postgres is. But every write here is also pushed
to the existing Apps Script `/exec` URL **from the server**, in the same form-encoded
language `apps-script/Code.gs` already speaks (`saveReport`, `deleteReport`,
`saveSettings`, `saveImage`), so neither `.gs` file needs a single change and the
Dashboard tab keeps working exactly as it does today.

Three things follow, and they matter:

1. **The `/exec` URL is now only ever known to the server.** It moves out of the
   frontend `.env` — where `npm run build` baked it into published JavaScript — and
   into `server/.env`. Nothing in the browser can see it any more.
2. **A failed push is never a failed request.** The push is queued in a
   `mirror_queue` table and retried with a growing delay. Nothing an agent typed
   depends on Google being awake. `GET /api/admin/status` reports the queue depth.
3. **Editing a figure in the sheet no longer changes anything.** It is a copy. That
   is the trade this design makes: the ✎ / grid marks stay on old rows as history, but
   from now on corrections happen in the admin page.

If `SHEET_WEBHOOK_URL` is not set, nothing is queued and nothing is owed — the app is
complete without it.

