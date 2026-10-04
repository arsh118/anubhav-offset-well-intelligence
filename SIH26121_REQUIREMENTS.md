# SIH26121 Capability Coverage

This assessment reflects the ANUBHAV hackathon prototype in this repository. A working demo capability does not establish operational validation, field readiness, OIL endorsement, or connection to OIL systems.

## Release deployment status

The Vercel → Render → Supabase deployment is **not live or publicly verified**. On 2026-10-04, local PostgreSQL migrations, repeated deterministic seed, Alembic drift check, backend tests/lint/typecheck, frontend tests/lint/typecheck/build, and the local ANB-01 API workflow passed. Production performance and clean-browser checks remain pending because there are no connected public service URLs. Local test/build success is not public deployment verification. See [DEPLOYMENT.md](DEPLOYMENT.md) for required configuration and release checks; do not distribute public URLs until all checks pass.

## Hackathon MVP

The MVP uses **Representative Synthetic Demo Data** and local document examples. It demonstrates source-linked workflows using the existing structured well, event, document, evidence, and measurement records. It does not use confidential OIL data or connect to OIL's actual eRTMAC system.

### i. AI/NLP/OCR/data analytics for historical drilling reports and well documents

- **Status:** Partial.
- **Implemented feature:** PDF and UTF-8 text intake, page-aware text extraction, OCR fallback for image-only PDF pages when Tesseract is available, and deterministic event/depth/formation/date/consequence/mitigation extraction. Extracted event records retain their source document, page, and evidence excerpt. The predictive classifier is a separate experimental feature described under requirement v.
- **API:** `POST /api/documents/ingest`, `POST /api/documents/{document_id}/process`, `GET /api/documents/{document_id}/events`, and `GET /api/events/{event_id}/evidence`.
- **Frontend:** `/documents` for upload, processing, and source inspection; evidence links open the source record and stored page excerpt.
- **Demo workflow:** Upload a representative PDF or text fixture, process it, then inspect extracted events and page evidence. For the seeded ANB-01 journey, use the source-linked historical records already loaded in the database.
- **Current limitation:** Extraction is deterministic pattern/dictionary logic, not general NLP. OCR depends on local Tesseract. There is no human approve/correct workflow, no broad document-format support, and seeded source metadata does not include fabricated original PDF binaries.
- **Future production integration:** Operator-approved document ingestion, robust format and scan handling, multilingual/OCR evaluation, human verification and correction, source versioning, and governed data retention.

### ii. Interactive nearby-well map with configurable radius

- **Status:** Implemented for the hackathon dataset.
- **Implemented feature:** Interactive Leaflet map, active and offset well markers, selectable/synchronized offset list, event markers, distance display, and configurable 5, 10, 20, and 50 km radius presets.
- **API:** `GET /api/wells/{well_id}/nearby?radius_km=...`.
- **Frontend:** Dashboard map at `/`; expanded map, filters, and offset register at `/offsets`.
- **Demo workflow:** Select **Start demo** for ANB-01, then inspect ANB-02, ANB-03, ANB-04, and ANB-05 within the 20 km demo radius.
- **Current limitation:** Demo coordinates are synthetic. Production coordinate reference systems, trajectories, coordinate quality, and field geometry are not modeled.
- **Future production integration:** Authorized operator well locations, validated coordinate systems, trajectory-aware distances, map access controls, and operational map performance testing.

### iii. Searchable knowledge repository of events, lessons learned, challenges, and mitigation

- **Status:** Implemented as structured keyword search.
- **Implemented feature:** Search covers event type, well, formation and aliases, measured depth, event title and description, consequence, mitigation, source document name/source label, source page, and linked evidence excerpt. Results include event, well, depth, formation, challenge/summary, recorded mitigation, source document/page, evidence excerpt, and provenance. Search uses structured database records; it does not require an LLM.
- **API:** `GET /api/knowledge/search?q=...`; structured filters are also available through `GET /api/events`.
- **Frontend:** `/knowledge`, with well, formation, event type, depth, and date filters, and links to the associated evidence/source page.
- **Demo workflow:** Open the dashboard guide's matching-record link or enter `lost circulation`, `stuck pipe`, `X Formation`, `cementing`, or `mud losses`; open a result's source evidence.
- **Current limitation:** Search is keyword-based with simple term normalization. It does not index full document binaries or provide semantic/vector retrieval. A page is shown only when the source event/evidence has a stored page number.
- **Future production integration:** Governed indexing of operator-approved document text, scalable full-text retrieval, optional evaluated semantic retrieval, retention/version controls, and relevance evaluation with engineers.

### iv. Geological, drilling, and reservoir correlation based on depth and formation

- **Status:** Partial.
- **Implemented feature:** Correlation returns comparable wells and reasons, distance, depth alignment, formation match, geological and reservoir similarity, drilling parameter comparisons, and historical events. It reuses formation intervals, geology/reservoir descriptors, timestamped drilling measurements, and structured historical events.
- **API:** `GET /api/intelligence/{active_well_id}/correlation` and `GET /api/intelligence/{active_well_id}/offsets`.
- **Frontend:** Dashboard and `/active-well` show depth correlation; the **Well Correlation** panel compares active and offset formation, reservoir, and drilling data; `/offsets` shows the map and matched events.
- **Demo workflow:** In the ANB-01 scenario, compare the active well at 2,842 m in X Formation with nearby records, including ANB-02 lost circulation at 2,865 m (23 m ahead, 4.2 km away).
- **Current limitation:** Values and comparisons are synthetic, and the scoring/similarity heuristics are not expert-validated. Seed depths are treated as meters and comparable MD values. No depth datum, trajectory, or MD/TVD reconciliation is implemented for arbitrary records.
- **Future production integration:** Validated units/datums, trajectory and coordinate normalization, operator geology/reservoir data mapping, quality flags, expert-reviewed similarity rules, and field validation.

### v. Predictive analytics for drilling risks

- **Status:** Experimental.
- **Implemented feature:** A deterministic, request-time StandardScaler plus multinomial Logistic Regression prototype returns event-category signals with feature contributions and supporting historical events. Training rows are restricted to documents marked both `seeded_demo` and `Representative Synthetic Demo Data`. Model metadata records the feature pipeline and version. Each returned signal is linked to source-backed history.
- **API:** `POST /api/predictive-risk/{active_well_id}`.
- **Frontend:** Prototype signals appear as a secondary panel in Dashboard **Live Intelligence**, with the notice “Prototype model — evaluation limited by representative synthetic data.” and engineer-review language.
- **Demo workflow:** Select ANB-01 and inspect an available signal alongside the matched historical event, source document, page, and evidence. ANB-10 demonstrates graceful insufficient-data/no-match behavior.
- **Current limitation:** The small synthetic corpus has sparse classes. There is no credible independent well-level holdout, accuracy claim, probability calibration, incident probability, or OIL-approved risk model. The estimate is historical decision support and requires engineer review.
- **Future production integration:** Governed representative operator data, well-level/time-aware independent validation, calibration and monitoring, subject-matter-expert review, model governance, and explicit operational approval before any use beyond decision support.

### vi. Real-time alerts and recommendations

- **Status:** Partial; the live feed is simulated.
- **Implemented feature:** Evidence-backed historical precedent alerts are refreshed from existing correlations and retain stable alert IDs and workflow state. Recommendations quote documented mitigation and identify the source event, well, document, page, reason, and evidence. A deterministic finite drilling replay reevaluates the existing correlation, alert, and predictive APIs.
- **API:** `GET /api/alerts/active/{well_id}`, `GET /api/live/{well_id}`, `POST /api/alerts/{alert_id}/acknowledge`, `PATCH /api/alerts/{alert_id}`, and `POST /api/alerts/{alert_id}/notes`.
- **Frontend:** Dashboard **Live Intelligence**, `/active-well`, `/alerts`, and the shared evidence drawer support precedent review and the OPEN → ACKNOWLEDGED → REVIEWED / DISMISSED workflow.
- **Demo workflow:** Start the ANB-01 replay, inspect the historical precedent ahead and its documented source, review the evidence-backed recommendation, then acknowledge and mark the alert reviewed.
- **Current limitation:** The feed is explicitly labeled **“Simulated eRTMAC / Representative Synthetic Data”** and is not connected to OIL's actual eRTMAC system. Alerts are request/replay driven, not pushed from live telemetry. Recommendations summarize recorded mitigation and do not prescribe engineering actions.
- **Future production integration:** Operator-authorized eRTMAC/telemetry interfaces, authentication, transport/retry/latency controls, monitoring, audited notification delivery, operational review, and governed recommendation policies.

### vii. User-friendly field and office dashboard

- **Status:** Implemented for the hackathon workflow.
- **Implemented feature:** Responsive web views connect the active-well context to nearby wells, maps, correlations, events, knowledge search, evidence, alerts, documents, and review status. Dashboard and route-level loading, empty, and API error states are implemented.
- **API:** Uses the existing wells, nearby, intelligence, event, alert, live, predictive-risk, document, and evidence endpoints; there is no separate dashboard data model.
- **Frontend:** `/`, `/active-well`, `/offsets`, `/knowledge`, `/alerts`, and `/documents`.
- **Demo workflow:** Use **Start demo** to select ANB-01 and its demo radius/window, then follow the dashboard panels and links through map, correlation, evidence, replay, recommendation, and alert review.
- **Current limitation:** The interface has not been validated in field usability trials, offline conditions, production security/accessibility reviews, or deployment at operational scale.
- **Future production integration:** Field user research, rugged/offline workflows where required, accessibility testing, role-based views, authentication/authorization, auditability, operational observability, and deployment hardening.

## Data provenance and prototype assumptions

- The included wells, locations, intervals, measurements, documents, events, and excerpts are **Representative Synthetic Demo Data**. They are not real OIL confidential records.
- The live panel is a deterministic replay. There is **no connection to OIL's actual eRTMAC system**.
- The classifier is **not an OIL-approved risk model**. Its outputs are experimental, uncalibrated historical signals and must be reviewed by an engineer.
- Seed depths are interpreted in meters; demo cross-well comparisons use comparable measured-depth (MD) values. These assumptions do not establish comparability for arbitrary uploads or operator data.
- Historical intelligence returned by correlation, alerts, predictive signals, and knowledge search remains linked to a well/event and source document/page/evidence when that source evidence exists. Search results without a non-empty excerpt linked to their source document are excluded.
- Relevance, formation/reservoir similarity, extraction confidence, and alert thresholds are prototype heuristics, not expert-validated limits.

## Future Production — explicitly outside the Hackathon MVP

The following are not claimed as implemented: actual eRTMAC/OIL integration; access to confidential operator data; production-grade general NLP/OCR or human extraction approval; normalized operator depth datums and trajectories; semantically evaluated full-document retrieval; validated or calibrated incident prediction; prescriptive drilling recommendations; field-validated workflows; production identity, authorization, audit/compliance, availability, and deployment controls.
