# Publish with GitHub Pages and Supabase

The production setup is **GitHub Pages** for the website and **Supabase** for the
database, image storage, and API. There is no Railway or Render server in this setup.
The API is a Supabase Edge Function, and the Supabase database is the main register.
The Google Sheet can remain a secondary copy.

This repository is `Jishnu314/blm1`. The site address will be
`https://jishnu314.github.io/blm1/`.

## 1. Create the Supabase project and tables

1. Create a project at [Supabase](https://supabase.com/) and save its database
   password privately.
2. In the project, open **SQL Editor → New query**. Paste and run the complete file
   `supabase/migrations/001_initial.sql`. It creates the register tables, access
   controls, image bucket, and database functions.
3. Open **Edge Functions → Secrets** and add `ADMIN_PASSWORD` with a private password
   of at least 10 characters. The function creates its admin password record on the
   first sign-in. Connect the Google Sheet later from **Admin → Settings**; the link
   is kept on the server and is not placed in the public website.

The `register-images` bucket is public-read so agents can load announcement posters;
it only accepts JPEG, PNG, and WebP files up to 2 MB. Database tables remain private.

The Edge Function uses Supabase's built-in service key on the server side. Do not
copy that secret key into GitHub or the website.

## 2. Connect GitHub to Supabase

In GitHub, open this repository's **Settings → Secrets and variables → Actions**.

Add these **repository variables**:

| Name | Value |
| --- | --- |
| `VITE_API_URL` | `https://YOUR-PROJECT-REF.supabase.co/functions/v1/api` |
| `VITE_SUPABASE_ANON_KEY` | The project's public `anon` key from Supabase **Project Settings → API Keys** |

Add these **repository secrets**:

| Name | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token |
| `SUPABASE_PROJECT_ID` | The project reference shown in the Supabase dashboard URL/settings |

The `anon` key is intended for the browser; database access is blocked by row-level
security and goes through the Edge Function. Never use the service-role/secret key
as a GitHub variable.

For local development, create `.env.local` in the repository root with the same two
public values (`VITE_API_URL` and `VITE_SUPABASE_ANON_KEY`). This file is ignored by
Git. Restart Vite after creating or changing it; when `VITE_API_URL` is set, browser
requests go straight to Supabase instead of the legacy local Express proxy.

Use this format, replacing both placeholders with values from **Supabase → Project
Settings → API**:

```dotenv
VITE_API_URL=https://YOUR-PROJECT-REF.supabase.co/functions/v1/api
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

## 3. Deploy the API

1. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source.
2. Push the project files to the repository's `main` branch.
3. The push starts **Deploy Supabase API** automatically. If needed, open the
   repository's **Actions** tab, select **Deploy Supabase API**, and choose **Run
   workflow** to redeploy the function.
4. Open `https://YOUR-PROJECT-REF.supabase.co/functions/v1/api/api/health` in a
   browser. A working API reports `"database":true`.

## 4. Publish the website

The same push to `main` starts **Publish frontend to GitHub Pages** automatically.
When it finishes, open:

- Agent form: `https://jishnu314.github.io/blm1/form/`
- Admin page: `https://jishnu314.github.io/blm1/admin/`

The admin password is the `ADMIN_PASSWORD` secret you set in Supabase. Admin sessions
are kept in this browser tab's session storage, so the admin remains signed in while
that tab is open.

## 5. Bring over existing data

To connect the Sheet and bring its existing report history into the app:

1. Deploy Apps Script as a web app that executes as you and allows access to
   **Anyone**. Run its setup once and approve Google's access prompt.
2. Copy the deployed web app URL ending in `/exec`. The editor-only `/dev` URL and
   the regular spreadsheet URL will not work.
3. Sign in at `/admin/`, open **Settings → Google Sheet connection**, paste the
   `/exec` URL, and choose **Save and connect**.
4. Choose **Import existing reports**. Existing report IDs are skipped, so the
   import can be repeated safely.

After connection, new form reports, admin corrections and customer-ledger changes
are copied to the Sheet. The private **Customers** tab is not returned by the public
report-reading endpoint. Supabase remains the app's main database.

## GitHub Pages visibility and costs

GitHub Pages on GitHub Free requires a public repository, and the published site is
public. Make the repository public only if you are comfortable sharing its source;
never commit credentials or `.env` files. See [GitHub's Pages guide](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
Check [Supabase pricing and limits](https://supabase.com/pricing) before using it
long-term; free project limits and pause behavior may change.

After the new form and admin page work and the existing data has been imported, you
can delete the old Render service from its dashboard. Removing `render.yaml` from the
repository alone does not delete an already deployed service.
