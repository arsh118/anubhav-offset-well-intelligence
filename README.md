# ANUBHAV — AI-Powered Offset Well Intelligence

ANUBHAV is a Smart India Hackathon 2026 prototype for SIH26121, eRTMAC-NWIS. It addresses the loss of usable institutional memory in drilling reports by connecting an active well's location, measured depth, and formation with evidence-backed events from nearby historical wells.

See [SIH26121_REQUIREMENTS.md](SIH26121_REQUIREMENTS.md) for a capability-by-capability status assessment, [DEMO_GUIDE.md](DEMO_GUIDE.md) for the judging path, and [DEPLOYMENT.md](DEPLOYMENT.md) for the public release runbook and live-verification checklist.

The demo uses **Representative Synthetic Demo Data** and does not access confidential OIL data or connect to a live OIL system. ANUBHAV surfaces historical precedents for engineer review; it is decision support, not a drilling control system or incident prediction.

**Release status: NOT LIVE.** Local checks pass. The `anubhav-nwis` Vercel project is created but not deployed; GitHub authentication is invalid, and no Render API or Supabase database is configured. No public URL is ready for SIH evaluation. See [DEPLOYMENT.md](DEPLOYMENT.md) for the exact remaining setup and release gate.

Deployment configuration verified for SIH 2026.

## Requirements

- Docker Compose (recommended for PostgreSQL and API), or Python 3.9+ with PostgreSQL 14+ for a local run.
- Node.js 20+ and npm for the React frontend.
- Python dependencies are declared in `backend/pyproject.toml`. The API image includes Tesseract OCR for image-only PDF pages.

## Run with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Compose waits for PostgreSQL, applies Alembic migrations, loads the idempotent synthetic seed, then starts the API at <http://localhost:8000>.

- Health: <http://localhost:8000/api/health>
- OpenAPI UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>

The sample database credentials are for local development only. Change them before any shared deployment.

Start the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies API requests to `http://localhost:8000`. The API CORS middleware accepts only the explicit origins configured by `CORS_ALLOWED_ORIGINS`.

## Run the API locally with an existing PostgreSQL server

```bash
cp .env.example .env
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install '.[dev]'
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The local `.env.example` URL points at `localhost:5432`. When running in Compose, the API container uses the Compose `db` hostname instead.

Uploaded originals and extracted page text are stored under `UPLOAD_DIR` (default `backend/data/uploads` locally). Compose mounts a named volume at `/app/data/uploads`. The upload limit is 20 MiB per file.

## Database lifecycle

Run schema migrations from `backend/`:

```bash
alembic upgrade head
```

Load or refresh the fixed-ID demo records:

```bash
python -m app.seed
```

The seed command is idempotent: it merges stable UUID records and does not clear user data. Alembic revisions are under `backend/alembic/versions/`.

Compose runs the seed at API startup. The five seeded alert rows are merged with `open` status, so a container restart/reseed resets those demo alert statuses. The alert refresh API itself preserves an alert's workflow status.

The fixture generator is `backend/app/demo_fixtures.py`. It creates 10 wells across three synthetic fields, with deterministic coordinates, five formation names and measured-depth intervals, 10 document references, 20 sourced drilling events, 20 evidence snippets, and five evidence-backed historical alerts. Every demo well and document is labelled **Representative Synthetic Demo Data**.

Seeded demo scenarios:

- `ANB-01`: X Formation historical events in nearby `ANB-02`, `ANB-03`, and `ANB-04` around the active depth of 2,842 m.
- `ANB-06`: nearby stuck-pipe precedent in `ANB-07`.
- `ANB-08`: nearby cementing precedent in `ANB-09`.
- `ANB-10`: nearby offset `ANB-09`, but no alert because its cementing events are in a different formation and hundreds of meters above the active depth.

All coordinates and event/source text are illustrative synthetic values; document names resemble common report references only.

## Judging walkthrough

Start the frontend from `frontend/` with `npm install` and `npm run dev`, while the API and seeded database are running. Select **Explore active well** in the header to set the active context to `ANB-01`, a 20 km radius, and a 100 m depth window, then open the dashboard guide. The map and three highlighted precedents come from the API and the fixed seed: `ANB-02` mud loss at 2,865 m, `ANB-03` torque spike at 2,830 m, and `ANB-04` mud loss at 2,875 m.

The Dashboard guide and panels cover the active well, nearby map, depth and geological/reservoir/drilling correlation, historical evidence, the experimental predictive signal, and the deterministic live replay. The live replay is labeled “Simulated eRTMAC / Representative Synthetic Data” and is not connected to OIL's actual eRTMAC system. Follow its historical precedent to the stored event, source document/page, excerpt, recorded mitigation, and recommendation, then acknowledge and mark the alert reviewed. The guide also opens Knowledge with `lost circulation in X Formation`; search uses structured event, well, formation, depth, mitigation, document, and evidence data. Changing the well, radius, or depth window turns off the judging spotlight while the underlying API-backed views remain available.

The demo seed is reproducible. On a fresh Docker startup it is loaded automatically. To reset the seeded alert workflow before repeating the walkthrough, run `python -m app.seed` from `backend/` with the configured database available. Uploaded records are not used by the judging path.

The full spoken 3-minute walkthrough is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## Architecture

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, and Leaflet. Dashboard, active-well, offset-well, knowledge, alert, and document routes call the backend API.
- **Backend:** FastAPI with SQLAlchemy and Alembic. PostgreSQL is the preferred local demo database; tests also use temporary SQLite databases.
- **Storage and evidence:** Well events reference source documents and page-level evidence. Uploaded files are stored under `UPLOAD_DIR` using generated storage names. Seeded demo evidence is metadata and excerpt text; the seed does not fabricate source PDFs.
- **Intelligence:** Haversine distance filtering followed by formation, depth, event-family, and source-confidence components. Geology/reservoir descriptors and drilling measurements are also compared. Scoring is deterministic and heuristic; source evidence remains attached to each event.
- **Deployment:** Docker Compose supports local development. The intended public topology is Vercel → Render → Supabase PostgreSQL; the public deployment is not live until the exact URLs and workflows in [DEPLOYMENT.md](DEPLOYMENT.md) have been verified.
- **Live and predictive prototype:** the dashboard can replay a finite synthetic measurement sequence and request uncalibrated event-category estimates from a logistic-regression model fitted only to measured-depth events linked to seeded documents labeled `Representative Synthetic Demo Data`. Uploaded-document events are excluded. Neither feature consumes live operator data.

## Data provenance and limitations

All included well names, coordinates, dates, events, document metadata, excerpts, confidence values, and mitigations are illustrative synthetic examples. They are labeled **Representative Synthetic Data**. The uploaded PDF/text fixtures are also synthetic. No confidential Oil India Limited records, production OIL data, eRTMAC connection, live telemetry, or operational system access is included.

Seeded depths are treated as meters, and the demo compares comparable measured-depth (MD) values. The well/current-depth and event-depth schema does not include depth datum metadata, so this assumption must not be extended to arbitrary operator data. Correlation, geology/reservoir comparisons, alert thresholds, extraction confidence, and classifier estimates are not expert-validated; classifier probabilities are uncalibrated.

Extraction uses text extraction/OCR and deterministic rules. Its confidence value is a rule-completeness indicator, not a calibrated probability. Relevance weights and thresholds are prototype heuristics, not an OIL-approved formula. Historical precedent alerts do not guarantee safety, predict an incident, or replace engineering judgment. Seeded documents have no source PDF binaries; uploaded files can be stored and processed locally.

## Future production scope

These items require authorization, data governance, engineering validation, and security design before production use:

- Authorized OIL data integration and eRTMAC-NWIS integration.
- Governed real-time telemetry and event synchronization.
- Validated advanced ML for retrieval/ranking, with explainability and operational review.
- LAS/DLIS ingestion and richer geology/formation correlation.
- Enterprise deployment, identity and access controls, audit retention, monitoring, and disaster recovery.

## Document intelligence pipeline

The MVP accepts PDF and UTF-8 text uploads. It extracts text per page, invokes Tesseract only for image pages with little embedded text, then applies deterministic domain dictionaries and regex rules for event type, MD/TVD, formation, date, consequence, and mitigation. Each stored event must have a non-empty source excerpt and source page. The reported confidence is a rule-completeness heuristic, not a calibrated probability. This pipeline does not call a paid LLM API. Local scanned-PDF processing requires the Tesseract executable; the Docker API image includes it.

Part 3 documents have no PDF binaries. Processing one of these records uses its existing synthetic event/evidence rows directly and preserves their well, depth, formation, mitigation, document, page, and excerpt. Its API `source_label` is **Seeded Demo Evidence**. Uploaded documents use **Uploaded Document** and rule-based evidence. These are separate paths.

Upload a fixture or your own supported report after starting the API:

```bash
curl -X POST http://localhost:8000/api/documents/ingest \
  -F 'well_id=<well UUID>' \
  -F 'document_type=daily_drilling_report' \
  -F 'file=@backend/tests/fixtures/DDR-UPLOAD-ANB-02.pdf'
```

Use the returned document ID with `POST /api/documents/{id}/process`. The two synthetic upload test fixtures are in `backend/tests/fixtures/`; they are clearly labeled and independent of the seeded Part 3 source metadata.

## API endpoints

All endpoints return JSON under `/api`:

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | API/database readiness |
| `GET /api/wells` | List wells; optional role/status and pagination filters |
| `GET /api/wells/{id}` | Well detail including current formation |
| `GET /api/wells/{id}/nearby` | Offset wells within a radius, ordered by calculated distance |
| `GET /api/wells/{id}/events` | Events and evidence for a well |
| `GET /api/events` | Filter events by well, formation, type, and measured depth |
| `GET /api/events/summary` | Return event count without downloading event records |
| `GET /api/alerts` | Paginated list of historical signals |
| `GET /api/alerts/{id}` | Alert with linked historical event and evidence |
| `GET /api/alerts/active/{well_id}` | Re-evaluate future-depth precedents for an active well and return evidence-backed alert records |
| `PATCH /api/alerts/{id}` | Move an alert through the review workflow |
| `POST /api/alerts/{id}/acknowledge` | Acknowledge an open alert |
| `POST /api/alerts/{id}/notes` | Append an engineer note to the alert history |
| `GET /api/formations` | Formation names and aliases |
| `GET /api/documents` | Source document metadata |
| `POST /api/documents/ingest` | Upload a PDF or UTF-8 text file linked to a well |
| `POST /api/documents/{id}/process` | Extract or normalize events and evidence for an uploaded or seeded document |
| `GET /api/documents/{id}` | Document metadata, origin label, and processing status |
| `GET /api/documents/{id}/events` | Structured events attributed to the document |
| `GET /api/events/{id}/evidence` | Page excerpts and evidence provenance for one event |
| `GET /api/knowledge/search?q=...` | Deterministic keyword search across event type, well, formation, depth, challenge/summary, consequence, mitigation, source document, page, and linked evidence |
| `GET /api/intelligence/{active_well_id}/offsets` | Evidence-backed event matches grouped by offset well |
| `GET /api/intelligence/{active_well_id}/correlation` | Depth correlation, component scores, matched events, offsets, and source evidence |
| `GET /api/intelligence/{active_well_id}/signals` | Compact dashboard summary with high and medium relevance signals |
| `GET /api/live/{well_id}` | Finite seeded measurements for deterministic replay; not a live stream |
| `POST /api/predictive-risk/{active_well_id}` | Experimental, uncalibrated event-category estimate from the synthetic seed |

Intelligence requests accept `radius_km` (up to 50 km; common presets are 5, 10, 20, and 50), `depth_window_m` (up to 1,000 m), optional `active_depth_m`, optional `active_formation` (canonical name or alias), and optional `event_family`. Event-family values include `losses`, `well_control`, `mechanical`, `wellbore`, `cementing`, `casing`, and `operations`; existing event taxonomy values are also accepted. Omitted depth and formation values come from the active well record. Events without measured depth or linked source evidence are excluded from correlation.

The offset relevance score is a request-time heuristic with normalized component scores from 0 to 1. Defaults are formation 0.30, depth proximity 0.25, spatial proximity 0.20, event similarity 0.15, and source confidence 0.10. Source confidence is the mean of the event confidence and the strongest eligible evidence confidence. Depth bands default to high at 0–25 m, medium above 25–50 m, and low above 50–100 m; the depth window and thresholds are configurable. Alias formation matches score 0.85. Environment variables in `.env.example` override these settings. These values are prototype choices, not an OIL-approved formula, calibrated probability, or safety prediction. Correlation reads the existing structured events and linked evidence. The active-alert endpoint idempotently upserts one existing `Alert` row per active-well/event pair, retaining its acknowledgement/review status while refreshing the current relevance fields.

Proactive alerts only include evidence-backed events inside the configured radius and future-depth window, with an exact or alias-matched formation and relevance at or above the medium threshold. Events behind the active depth are available in correlation results but do not trigger a proactive alert. The active-alert response uses **HIGH HISTORICAL RELEVANCE**, **MEDIUM HISTORICAL RELEVANCE**, or **NO SIGNIFICANT PRECEDENT**. The no-precedent message only describes the available historical records; it does not indicate that an interval is safe. Alert workflow status values are `open`, `acknowledged`, `reviewed`, and `dismissed`. Existing alert detail includes source excerpts and page references; engineer notes are append-only and visible in alert detail.

The active-alert request accepts `radius_km`, `depth_window_m`, and optional active-depth/formation overrides, using the same configured defaults as the intelligence endpoints. It performs an idempotent upsert so each qualifying active-well/event pair has a stable alert ID for acknowledgement, review, dismissal, and notes. The status transitions are `open` → `acknowledged` → `reviewed`; alerts may also be dismissed from open, acknowledged, or reviewed. Dismissed alerts cannot be reopened through this MVP API.

Example request for the seeded ANB-01 scenario:

```text
GET /api/intelligence/<ANB-01 UUID>/correlation?radius_km=10&depth_window_m=100&event_family=losses
```

Validation errors use FastAPI's `422` responses; missing records return `404`; database constraint conflicts return `409`; database health failures return `503`. Query bounds and UUID formats appear in the generated OpenAPI schema.

## Tests and checks

Run from `backend/`:

```bash
pytest
ruff check app tests alembic
mypy app
```

Tests use a temporary SQLite database; they do not require the local PostgreSQL service. Migrations can also be exercised against SQLite:

```bash
DATABASE_URL=sqlite:////tmp/anubhav-migrations.sqlite3 alembic upgrade head
DATABASE_URL=sqlite:////tmp/anubhav-migrations.sqlite3 python -m app.seed
```

Run frontend checks from `frontend/`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
