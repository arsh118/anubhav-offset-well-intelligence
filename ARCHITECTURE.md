# ANUBHAV Architecture

## Purpose

ANUBHAV is a hackathon decision-support prototype for the SIH 2026 problem statement SIH26121, eRTMAC-NWIS. It connects an active well's location, current depth, and formation to nearby historical wells and evidence from their drilling events.

The system presents **historical risk signals and explainable recommendations** for an engineer to review. It does not independently predict accidents, guarantee safety, or control drilling operations.

## Current implementation

ANUBHAV is an implemented hackathon prototype backed by representative synthetic data. It does not connect to OIL systems, eRTMAC, or live operational data. Project files are currently under a directory whose Git root is the parent home directory; use project-scoped Git commands.

## Architecture

```text
React + TypeScript + Vite
  ├─ Dashboard / well / event / knowledge views
  ├─ Leaflet map and depth-correlation visualizations
  └─ Typed HTTP client
          │ JSON over HTTP
          ▼
FastAPI
  ├─ Read APIs and request validation
  ├─ PDF/text document intake and processing lifecycle
  ├─ Page extraction with OCR fallback and deterministic drilling rules
  ├─ Offset relevance and depth/formation correlation rules
  ├─ Historical signal generation with evidence references
  └─ SQLAlchemy repositories
          │
          ▼
PostgreSQL (Compose) / SQLite (tests and local fallback)
  ├─ Wells, formations, intervals, measurements, events, and evidence
  ├─ Document metadata, alerts, and engineer notes
  └─ Synthetic seed records and uploaded-file metadata
```

### Components and responsibilities

- **Frontend:** React, TypeScript, Vite, and Tailwind CSS. Leaflet displays the active well and nearby wells. Pages use a restrained dark operations palette, compact tables, clear map legends, and readable evidence panels.
- **Backend:** Python and FastAPI. It validates requests, serves the UI's data, computes deterministic relevance and correlation results, and accepts PDF/text uploads. PyMuPDF extracts page text; Tesseract runs only for image pages with little embedded text; regex and domain dictionaries create events only when source evidence is present.
- **Persistence:** SQLAlchemy models and five Alembic revisions define the relational schema. PostgreSQL 16 is used by Compose; tests use temporary SQLite databases. The API container applies migrations and loads the demo seed at startup.
- **Analytics:** Offset relevance is a deterministic, configurable heuristic based on formation, depth, distance, event family, and source confidence. Geological/reservoir properties and nearby drilling measurements are exposed in well comparisons. A separate scikit-learn logistic-regression prototype is fitted at request time from stored measured-depth event records. Seed records are synthetic; processed uploads may also enter the fit because the query does not filter by document origin. Its probabilities are uncalibrated.
- **Packaging:** Docker Compose starts PostgreSQL and the API. The React frontend runs separately with Vite; there is no frontend container or production deployment configuration.
- **Demo data:** Clearly labeled public, representative, or synthetic records. Every event shown as evidence must point to a source document or an explicitly labeled synthetic source excerpt. Do not imply access to confidential Oil India Limited records.

### Request flow

1. The UI loads an active-well overview, including measured depth and current formation.
2. The API finds candidate offsets and calculates distance and formation/depth comparisons from available fields.
3. The UI shows candidates on the map and in a ranked list, including why each well is relevant and any missing comparison data.
4. For selected offsets, the API returns evidence-backed events within the configured MD window and reports formation matching. Formation intervals are also compared separately.
5. Deterministic rules surface historical risk signals when comparable events fall within the active well's configured look-ahead interval. Each signal includes the matching event, offset, distance, depth delta, formation match, evidence reference, and rule explanation.
6. Search returns event records and evidence excerpts, not an unsupported free-form answer.
7. The optional live panel replays fixed synthetic measurements and reevaluates correlation, alerts, and the prototype classifier. It is not a live data feed.

## API plan

The implemented API uses `/api` and JSON responses. Document ingestion uses multipart form data; event and evidence results retain source document, page, excerpt, and an origin label.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | API/database health. |
| `GET /api/wells`, `GET /api/wells/{id}` | List wells and return well/formation detail. |
| `GET /api/wells/{id}/nearby` | Nearby wells, distance, and formation overlap. |
| `GET /api/wells/{id}/events`, `GET /api/events` | Events by well or by formation, type, and depth range. |
| `GET /api/alerts`, `GET /api/alerts/{id}` | Evidence-backed historical signals and linked event/source detail. |
| `GET /api/alerts/active/{well_id}` | Generate/update alerts for future-depth events with a close formation match. |
| `PATCH /api/alerts/{id}`, `POST /api/alerts/{id}/acknowledge` | Update alert workflow state. |
| `POST /api/alerts/{id}/notes` | Add an engineer note to an alert. |
| `GET /api/formations` | Normalized formation names and aliases. |
| `GET /api/documents` | Filterable document metadata. |
| `POST /api/documents/ingest` | Save a PDF/text upload and create a document in `uploaded` state. |
| `POST /api/documents/{id}/process` | Run page extraction/OCR/rules for uploads, or normalize existing `Seeded Demo Evidence` records in place. |
| `GET /api/documents/{id}` | Return document metadata, `origin`, `source_label`, and processing status. |
| `GET /api/documents/{id}/events` | List events attributed to a source document. |
| `GET /api/events/{id}/evidence` | Return excerpt, page, extraction method, and source label. |
| `GET /api/knowledge/search?q=...` | Deterministic keyword search over event type, well, formation/aliases, depth, event text, consequence, mitigation, source document/page, and linked evidence. |
| `GET /api/live/{well_id}` | Return the finite seeded measurement sequence for deterministic replay. |
| `POST /api/predictive-risk/{active_well_id}` | Fit the uncalibrated demo classifier from seeded events and return source-backed event-category estimates. |

Responses for offsets, correlations, and signals expose comparison values and explanations. The prototype assumes seeded depths are meters and comparable MD values; it has no event-depth datum field and does not validate arbitrary uploaded/operator depth bases.

## Frontend routes

| Route | Main content |
| --- | --- |
| `/` | Operations dashboard with active well snapshot, nearby well/event/signal counts, and links into the demo journey. |
| `/active-well` | Active well overview, depth/formation, correlated events, formation intervals, and historical alerts. |
| `/offsets` | Nearby-well map, synchronized offset list, filters, relevance, and event evidence. |
| `/knowledge` | Structured keyword search with well, formation, event type, depth, and date filters; results show summary, mitigation, source, page, and evidence. |
| `/alerts` | Alert register, evidence review, status transitions, and engineer notes. |
| `/documents` | Upload PDF/TXT sources, process them, and inspect extracted events/evidence. |
| Event/source detail | Opened in evidence drawers and source links; there are no standalone event or well-ID routes. |

The dashboard and `/active-well` view are the primary judging/demo screens. Evidence drawers and source links open details; there are no standalone well-ID or event-ID routes.

## MVP / Hackathon scope

- Multiple selectable seeded active wells and a manageable set of nearby/analogous demo wells.
- A map with labeled active and offset wells, selectable wells, and distance display.
- Structured historical events with measured depth, formation, event type, recorded consequence/mitigation, and evidence links.
- Depth-window and formation correlation over the comparable seeded MD values; the UI reports missing comparison values but does not reconcile depth datums.
- Explainable offset relevance results and historical risk signals from deterministic rules.
- Keyword search over event and evidence text, with well, formation, event type, depth, and date filters. Full-document semantic search is not implemented.
- A professional dashboard that links overview metrics to the underlying wells, events, and evidence.
- Seed data using public, representative, or synthetic information with visible provenance.
- PDF and UTF-8 text upload, page-preserving extraction, OCR fallback for image-only pages, and deterministic event/evidence extraction.
- A separate seeded-evidence normalization path that uses existing Part 3 document/evidence rows without creating substitute PDF binaries.
- A deterministic synthetic drilling replay and an experimental request-time classifier; neither is connected to live feeds or validated for operational use.

## Future production scope

These items are explicitly outside the hackathon MVP:

- Integration with OIL or other operator systems, confidential well records, real-time feeds, or authenticated operational data.
- Production identity management, role-based access, audit/compliance controls, retention policy, and security review.
- Operator-scale ingestion for WITSML, arbitrary report formats, scanned-document review, and operator-specific schemas.
- Robust coordinate reference system handling, trajectory-aware spatial comparisons, and measured-depth/true-vertical-depth reconciliation across datums.
- Human-reviewed event extraction, source versioning, and production data-quality workflows.
- Calibrated scoring validated by drilling subject matter experts, field trials, monitoring, and operational approval.
- Resiliency, observability, backups, scaling, formal threat modeling, and production deployment.
- Any automated control action or autonomous drilling recommendation.

## Design constraints

- Every alert is a **historical risk signal**, not a forecast or safety guarantee.
- Demo depths are interpreted as meters, and seeded cross-well comparisons use comparable measured-depth (MD) values. Units and datum are not normalized for arbitrary uploaded/operator data.
- Seed data is representative and synthetic. Correlation heuristics and classifier probabilities are not expert-validated.
- Show why an offset matched: distance, formation overlap, depth interval, available data, and source evidence.
- Keep event source and provenance accessible from the alert itself.
- Make missing or incomparable data visible instead of silently treating it as a match.
- Keep map, correlation, and search as connected views over the same well/event records; avoid a standalone generic chatbot.
- Authentication, authorization, user identity/audit attribution, and production operations controls are not implemented.

## Complexity to avoid in the MVP

- Microservices, message brokers, vector databases, and a separate analytics service.
- Mandatory generative AI, paid APIs, or natural-language claims without linked evidence.
- Fine-grained production tenancy, permissions, or multi-operator configuration before there is real operational data.
- Hosted LLM extraction, message queues, and generalized OCR/ETL orchestration. The MVP uses synchronous uploads and deterministic rules.
- Persisting every derived score when it can be calculated transparently from a small dataset.
