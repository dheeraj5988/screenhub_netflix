# ScreenHub Digital Services: Netflix Portal

Customer portal + admin panel for ScreenHub Digital Services.

- **Customers** (`/`): enter their registered mobile number (remembered in a cookie), then either log in a TV with the Netflix TV code or get the latest "Update household" link. Any problem sends them to WhatsApp support **+91 75979 58755**.
- **Admin** (`/admin`): works on phone and desktop. Add/edit/block/delete customers, bulk import from a sheet or CSV, manage the Netflix cookie vault (add, test, keep alive), see activity logs, change the monthly TV login limit, back up and restore.
  - On your phone, open `https://<your-site>/admin`, sign in, then **Share > Add to Home Screen** (iPhone) or **⋮ > Install app** (Android). It opens like an app and stays signed in for 7 days.

## 1. Database (Supabase)

1. Create a **new** Supabase project (do not reuse the Tetra one).
2. Open **SQL Editor**, paste the whole of [`supabase/migrations/20261016_screenhub_v1.sql`](supabase/migrations/20261016_screenhub_v1.sql) and click **Run**.
3. The last result should list 4 tables with `rls_enabled = true` and `anon_access = false`.

## 2. Environment variables (Vercel)

| Name | Where to get it |
| --- | --- |
| `SUPABASE_URL` | Supabase > Project Settings > API > Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API keys > `service_role` / secret key |
| `ADMIN_PASSWORD` | Your choice: the password for `/admin` |
| `ADMIN_SESSION_SECRET` | Optional, any long random string |
| `CRON_SECRET` | Any long random string (`openssl rand -hex 32`) |
| `GMAIL_USER` | Gmail address that receives the Netflix household emails |
| `GMAIL_APP_PASSWORD` | 16-character Google App Password (https://myaccount.google.com/apppasswords) |

See [`.env.example`](.env.example).

## 3. Deploy

Import the GitHub repo in Vercel, add the variables above, deploy. Then check `https://<your-site>/api/health`.

Optional 6-hourly cookie keepalive via GitHub Actions: in the repo add secret `CRON_SECRET` (same value) and variable `KEEPALIVE_URL` = `https://<your-site>/api/cron/keepalive-cookies`.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```
