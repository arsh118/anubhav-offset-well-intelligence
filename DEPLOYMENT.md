# Deployment status and release runbook

## Current status

**Not live (checked 2026-10-04).** No public Vercel frontend, Render API, or Supabase database URL has been verified. Local quality checks and the local PostgreSQL-backed demo workflow passed, but the production and clean-browser checks below remain pending. A project-scoped Git repository now exists locally on `main`; release commit `9c5831e` is present. It has no remote because the GitHub CLI token is invalid. The Vercel CLI is authenticated and the exact project `anubhav-nwis` has been created and linked from `frontend/`, but it has no deployment and is not connected to Git. No production Supabase URL or Render service configuration is available, and Render/Supabase CLIs are not installed. Do not share a URL as the SIH evaluation deployment until the checks below pass against the deployed services.

The intended topology is:

```text
Browser → Vercel static frontend → Render API → Supabase PostgreSQL
```

Render Blueprint deployment requires this project to be pushed to the chosen Git provider. Keep the repository private unless public source publication is intentionally approved. GitHub CLI authentication must be restored with `gh auth login -h github.com` before creating the private remote and pushing `main`.

## Frontend: Vercel

The Vercel project `anubhav-nwis` already exists and is linked in `frontend/`. Before deployment, connect the private Git repository and set its Root Directory to `frontend`, Node.js to 20 or newer, Install Command to `npm ci`, Build Command to `npm run build`, and Output Directory to `dist`. `frontend/vercel.json` keeps React Router URLs working on direct visits.

Set this **Production** build environment variable in Vercel:

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<render-service-host>/api` |

This value is public by design and must contain no credentials. Redeploy after changing it; Vite embeds it at build time. Production frontend requests use this base URL, not the Vite development proxy.

Do not leave this variable unset for a split Vercel/Render deployment: the source fallback `/api` is same-origin and would point at Vercel. Check the generated `frontend/dist` bundle for `localhost` and `127.0.0.1` before release.

## Backend: Render

Use the root `render.yaml` Blueprint after connecting the project repository. It builds `backend/Dockerfile`, checks `/api/health`, and requests the database URL and exact allowed frontend origin as dashboard secrets/settings.

Set:

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL SQLAlchemy URL with TLS enabled, for example `postgresql+psycopg://...?...sslmode=require` |
| `CORS_ALLOWED_ORIGINS` | Exact deployed Vercel origin, for example `https://<vercel-domain>`; no path and no wildcard |
| `UPLOAD_DIR` | Blueprint sets `/tmp/anubhav-uploads`; this is temporary instance storage |

Render supplies `PORT` at runtime. The Dockerfile binds Uvicorn to `${PORT:-8000}`. Set `CORS_ALLOWED_ORIGINS` to the exact HTTPS Vercel origin, with no trailing path, wildcard, or comma-separated development origins in production.

Set these values in Render's service environment, never in Git or in Vercel. The container applies Alembic migrations and runs the idempotent representative seed before starting the API. The command binds to Render's assigned `PORT` and runs as a non-root user.

The included `plan: free` is for an evaluation prototype. Free services may sleep when idle, so the first request can be delayed. Do not use that plan if the evaluation requires continuously warm service; select a paid plan only with explicit budget approval.

## Database: Supabase PostgreSQL

Create a dedicated project for the public demo. In Supabase's **Connect** dialog, select a PostgreSQL connection suitable for the Render network. Use the shared **Session pooler** when the Render environment needs IPv4 access; use TLS (`sslmode=require`). Keep the database password inside Render's `DATABASE_URL` setting. Never put it in frontend variables or commit it.

The Render startup applies migrations through the single Alembic head and runs the idempotent `Representative Synthetic Demo Data` seed. Confirm the Render health response reports `database: connected` before setting the Vercel API URL.

To run the same database steps manually from `backend/`, with `DATABASE_URL` set in the shell to the Supabase PostgreSQL URL:

```bash
alembic upgrade head
python -m app.seed
```

The production container runs these commands on startup. The seed inserts only the representative synthetic fixture records; it does not contain confidential or fabricated OIL production data.

## First deployment and redeployment

1. Reauthenticate GitHub with `gh auth login -h github.com`, create a **private, project-scoped Git repository** for this workspace, add it as the remote, and push `main` (currently at `9c5831e`). Do not publish source code publicly as part of the SIH deployment.
2. Create a dedicated Supabase PostgreSQL project. Copy its TLS-enabled Session Pooler URL for Render's `DATABASE_URL` setting.
3. Connect the existing Vercel project `anubhav-nwis` to the private repository, set root directory `frontend`, and note its production origin after the first deployment.
4. Connect the repository to Render using the root `render.yaml` Blueprint. Set the Supabase URL and exact Vercel origin in Render, then deploy and wait for `/api/health` to report a connected database.
5. Set Vercel's `VITE_API_BASE_URL` to `https://<render-service-host>/api`, deploy the frontend, and confirm the production domain. If it differs from the origin in Render, update `CORS_ALLOWED_ORIGINS` and redeploy Render. Recheck health and browser network requests.

For later code releases, push the reviewed commit to the connected Git branch and wait for Render and Vercel deployments to finish. A manual release can be started from each provider dashboard; Vercel CLI deployment requires `vercel login` and `vercel link` first. Changing `VITE_API_BASE_URL` requires a new frontend build and deployment. Changing the database schema requires an Alembic migration, and the Render startup command applies the current head before serving requests.

## Public release verification

After deployment, record the actual service URLs here:

| Endpoint | Verified URL |
|---|---|
| Vercel frontend | Pending deployment |
| Render backend | Pending deployment |
| Render health | Pending deployment (`/api/health`) |

The production performance check and clean-browser walkthrough are **not run** until these public endpoints exist. Do not mark the release live based only on the local verification below.

Run the verification from a clean browser profile (no local storage or cached API responses):

1. Open the Vercel URL and confirm HTTP 200, the ANUBHAV title, the “Explore active well” action, and the representative-data label.
2. Open the Render health URL and confirm HTTP 200 plus a connected database.
3. In browser developer tools, verify all API requests use the Render HTTPS origin; no `localhost` or `127.0.0.1` request should appear.
4. Select **Explore active well** and follow [DEMO_GUIDE.md](DEMO_GUIDE.md). Verify ANB-01 (2,842 m, X Formation), map markers, nearby wells, correlation, historical and depth matches, predictive signal and its evidence, deterministic live replay, precedent alert, source evidence, mitigation, recommendation, acknowledge/review, and keyword knowledge search.
5. Directly reload `/active-well`, `/offsets`, and `/knowledge` to verify SPA rewrites.

Do not mark the release LIVE until all checks pass against the actual public URLs. Record the date, clean-browser result, and exact URLs in the table above.

## Public-demo security and storage notes

- `.env` files and secrets are excluded by `.gitignore`; use provider environment settings for credentials.
- The demo API is unauthenticated and contains only synthetic records. Do not ingest confidential or operational records into this public prototype.
- Uploads use temporary instance storage and can disappear on restart/redeploy. The ANB-01 judging path uses seeded records and does not require an upload or persistent disk.
- Production use requires identity/access controls, audit and retention policies, persistent approved document storage, operator integration, and security review.
