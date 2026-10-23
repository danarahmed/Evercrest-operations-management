# Running Evercrest on Supabase

Supabase provides three things to this ERP. The ERP's own rules, permissions and audit trail stay in the ERP.

| Supabase part | Used for | How the ERP uses it |
|---|---|---|
| **Postgres** | All data: jobs, trips, books, audit log | The server connects directly (`DATABASE_URL`) through Drizzle. Migrations add the guards: append-only audit and ledger, balance per currency, month locks. |
| **Auth** | Who is signed in | E-mail + password. People are added in **Users & roles**, which e-mails an invitation; the first sign-in links the Supabase identity to that ERP user (audited). Someone not added in the ERP has no access even with a Supabase account. |
| **Storage** | Scanned documents (PDF, photos) | Private bucket `documents`, files under the company's folder. Opened only through the ERP's permission-checked link (signed URL, valid two minutes). |

The browser never talks to the database. Supabase's public Data API is closed: every table has row level security with no policies, and the API roles (`anon`, `authenticated`) have no privileges (migration `0020_lockdown_data_api.sql`; the test `tests/lockdown.test.ts` fails if a new table is not locked).

## One-time setup

1. **Create the project** in Supabase (region close to Iraq, e.g. Frankfurt `eu-central-1`). Keep the database password.
2. **Authentication settings** (Authentication → Sign In / Providers, and URL Configuration):
   - E-mail provider on; **turn off "Allow new users to sign up"** — only invited people can get in.
   - Site URL = the ERP address (`SITE_URL`); add `SITE_URL/api/auth/confirm` to the redirect URLs.
   - Minimum password length 10.
   - E-mail templates (Authentication → Emails). The links must carry a token the server can read; replace the link in
     - **Invite user** with `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite`
     - **Reset password** with `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`

     (`RedirectTo` is the ERP's `/api/auth/confirm?next=/<language>/set-password`, so the person lands on "Choose your password" in their own language. The default `{{ .ConfirmationURL }}` does not work with server sign-in.)
   - For real e-mail volume, connect an SMTP sender (Authentication → Emails → SMTP); Supabase's built-in sender is rate-limited.
3. **Vercel**: import the GitHub repository as a new project and set the environment variables from `.env.example`:
   `AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `DATABASE_URL` (transaction pooler, port 6543), `MIGRATION_DATABASE_URL` (session pooler, port 5432),
   `DATABASE_CA_CERT`, `DATABASE_POOL_MAX=5`, `SITE_URL`, and a long random `SETUP_TOKEN`.
   Functions run in the same region as the database (`vercel.json`: `icn1` for a Seoul project; change it if the project moves).
4. **Deploy.** A production deployment applies the database migrations before building (`scripts/vercel-build.mjs`); preview deployments never touch the live database.
5. **First-run setup in the browser**: open `SITE_URL/en/welcome`, enter the `SETUP_TOKEN`, the company name, your name, e-mail and language.
   It creates the private `documents` bucket, the company, you as administrator (all permissions), the starter configuration
   (chart of accounts, posting accounts, the four job templates, the manifest rule, two cash boxes, suggested roles Operations / Finance / Accountant)
   and e-mails you the invitation. The page disappears for good once the company exists; then delete `SETUP_TOKEN` in Vercel.
   (Command-line alternative: `scripts/setup-production.ts`.)
6. **Open the invitation e-mail**, choose your password, sign in.
7. **Then** in Setup set the approval limits (Limits & rounding), the opening balances (Journal), bank accounts, partners, products and price rules; in Users & roles add the team (each gets an invitation) and give them roles.

## Every later release

Production deployments apply new migrations automatically before the build. Migrations are additive; the database guards are part of them.

## Backups

Supabase takes daily backups on paid plans; enable Point-in-Time Recovery for the live project. The books are append-only, so a restored backup plus the audit log shows exactly what happened.
