# Move the register to a NEW Supabase project

Use this when the old Supabase project cannot be reached (lost login) or you want a
clean one. Your data comes with you from the backup file. The old project is never
touched, so you can always go back.

Nothing below can lose data: the backup file in `backups/` is only ever read.

## 0. Before you start

- Make sure `backups/register-live-….json` exists, and copy it somewhere safe (USB
  or private cloud). It contains customer names. Never put it on GitHub.
- Know the admin password you want to use on the new project. Using the same one
  as before is easiest.

## 1. Create the new project

1. Sign in at https://supabase.com/dashboard with an account whose email and password
   you will not lose. Write both down somewhere safe this time.
2. **New project**. Name it, for example, `renewal-register`. Pick the region
   **Mumbai (ap-south-1)** if offered, so it is close to your agents.
3. Choose and save the **database password** privately. Wait for the project to
   finish setting up.
4. Copy the **project reference**. It is the code in the dashboard address
   (`.../project/THIS-PART`), or **Project Settings → General → Reference ID**.

## 2. Create the tables (migrations)

Open **SQL Editor → New query**. For each file below, in this order, open a new
query, paste the whole file, click **Run**, and look for "Success":

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_agent_ids.sql`
3. `supabase/migrations/003_revoke_public_rls_auto_enable.sql`

Run them one at a time, each in its own query, never together.

## 3. Set the admin password

**Edge Functions → Secrets → Add new secret**: name `ADMIN_PASSWORD`, value your
chosen password (10 characters or more). The password is saved the first time you
sign in to the admin page.

## 4. Load your data

1. On your PC, in `D:\Desktop\New folder`, run:

   ```
   npm run restore-sql
   ```

   This makes `backups\restore-live-….sql` from the newest backup. It only writes a
   file. It does not contact any server.
2. In the new project's SQL Editor, open a new query, paste the whole contents of
   that `.sql` file, and click **Run**.
3. The last line shows three numbers. They must read **46 reports, 31 deposit
   lines, 25 customers** (or whatever the file header says). If they differ, stop
   and send me the red text or the numbers.

Running it a second time is safe: nothing is doubled.

## 5. Point GitHub at the new project

In GitHub, open the repository **Settings → Secrets and variables → Actions**.

Variables (the **Variables** tab):

| Name | New value |
| --- | --- |
| `VITE_API_URL` | `https://NEW-REF.supabase.co/functions/v1/api` |
| `VITE_SUPABASE_ANON_KEY` | the new project's `anon` key (**Project Settings → API Keys**) |

Secrets (the **Secrets** tab):

| Name | New value |
| --- | --- |
| `SUPABASE_PROJECT_ID` | the new project reference |
| `SUPABASE_ACCESS_TOKEN` | a new token from the new account (**Account → Access Tokens → Generate new token**) |

Also update the same two `VITE_` lines in the `.env` file in this folder, so
`npm run backup` reads the new project.

## 6. Deploy

1. Push the latest code to `main` (see the push steps in chat). The fixed workflow
   now deploys the function with `--yes`.
2. In **Actions**, check **Deploy Supabase API** is green. If you changed the
   variables after the last push, also run **Publish frontend to GitHub Pages** with
   **Run workflow**, because the site address is baked in when it is built.
3. Open `https://NEW-REF.supabase.co/functions/v1/api/api/health`. It should show
   `"database":true` and `"engine":"supabase"`.

## 7. Check it

1. Open the live `/admin/` and sign in. The top bar says "Live register · Supabase".
2. You should see your 46 reports, your 25 customers, and your game board.
3. Run `npm run backup` again. It should say 46 reports and 25 customers. That is the
   proof the new project holds everything.
4. Submit one test report on the form, check it appears in admin, then delete it.

## 8. Things the backup does not carry

- **Popup poster image.** The settings still point to the picture in the OLD project's
  storage. While the old project exists it still shows. If you ever lose or delete it,
  upload the poster again from **Admin → Settings → Popup**.
- **Google Sheet link.** It is kept private on the server and is not in a backup.
  Reconnect it from **Admin → Settings → Google Sheet connection** if you use it.
  Use **Import existing reports** only if the sheet has reports that are not in the
  register (already-present ids are skipped).
- **Admin sign-ins.** You will sign in again once.

## 9. The switch-over moment

Agents keep sending reports to whichever project the published site points at. To
lose nothing at the moment you switch:

1. Right before step 5, run `npm run backup` again (still pointing at the old
   project, if you can sign in), then `npm run restore-sql`, then run the new SQL in
   the new project again. Anything sent since the first backup comes across.
2. Then change the GitHub variables and publish.

Keep the old project untouched for at least a few weeks. Do not delete it until you
have made at least one backup from the new project and checked it.
