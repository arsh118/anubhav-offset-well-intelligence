# ANUBHAV MVP Scope

## Hackathon objective

Demonstrate that an engineer can start from an active well's location, depth, and formation; identify relevant nearby historical wells; inspect events near comparable conditions; and open the evidence behind a historical risk signal.

The MVP is a prototype using public, representative, or synthetic data. It must not claim access to confidential Oil India Limited data or act as a production drilling control system.

## Implemented demo scope

The current workspace contains a working prototype of the demo journey below, backed by a representative synthetic seed. This scope describes what the code currently supports; it does not imply production readiness or validated operational performance.

### Required demo journey

1. Open the active well overview and see its location, current measured depth, formation, and data provenance.
2. View nearby/analogous wells on a Leaflet map and in a ranked list.
3. Select one or more offsets and see distance, formation overlap, depth comparability, and the reason for relevance.
4. Review structured historical events within the active well's configured measured-depth window and inspect the formation match; qualifying future-depth events can also appear as alerts.
5. Open an evidence-backed historical risk signal and inspect the event, source excerpt, source label, and correlation explanation.
6. Inspect the prototype risk signal beside its supporting historical evidence and replay the explicitly simulated drilling feed.
7. Search/filter the historical drilling knowledge repository and navigate from a result to its well and evidence.
8. Review the evidence-backed recommendation, acknowledge the alert, and mark it reviewed.
9. Use dashboard summaries to navigate to the wells, events, and alerts they represent.

### MVP capabilities

- **Active well overview:** several selectable demo active wells with location, measured depth, formation, and status.
- **Nearby well map:** active/offset markers, selection, list/map synchronization, and distance display. No fake operational precision when coordinates are synthetic.
- **Event repository:** curated structured events and source evidence with visible provenance.
- **Depth + formation correlation:** compare active and offset event MD values against the configured depth window and current formation, with formation intervals and source evidence. The data model does not store a datum for event depths.
- **Offset relevance:** transparent, deterministic score or ranked factors with a short explanation; missing data is shown as unavailable and does not masquerade as a mismatch.
- **Historical precedent alerts:** deterministic surfacing of evidence-backed nearby events ahead of the active depth, with high/medium/no-significant-precedent categories, acknowledgement/review/dismissal, source evidence, and engineer notes. Wording must remain historical and non-predictive.
- **Knowledge search:** keyword search across structured event type, well, formation/aliases, depth, event text, consequence, mitigation, source document/source label, page, and linked evidence, with filters for well, formation, depth range, event type, and date. Search does not index full document binaries and has no semantic retrieval.
- **Dashboard:** compact counts for nearby wells, historical events, correlated precedents, and open/acknowledged signals, linked to evidence and review views.
- **Document intelligence:** PDF and UTF-8 text upload, page text extraction, OCR fallback for image-only pages, deterministic event/depth/formation/date/outcome/action rules, and stored source excerpts. Existing seeded Part 3 evidence has a separate normalization path that preserves its original provenance without generating placeholder PDFs.
- **Prototype predictive analytics:** a deterministic request-time logistic-regression classifier fits only measured-depth events linked to documents marked `seeded_demo` and `Representative Synthetic Demo Data`. It returns uncalibrated event-category estimates only when matching source-backed categories are available. It is an experiment, not a validated risk model.
- **Deterministic live replay:** a finite, fixed-step synthetic measurement sequence reevaluates existing correlation, alerts, and predictive endpoints. It is not a live telemetry feed or eRTMAC integration.

### Data and safety language

- Label records as **synthetic**, **representative**, or **public** and display the label near the source/evidence.
- Do not invent confidential OIL operational records, imply live feeds, or use real operator branding in a way that suggests endorsement.
- Use “historical risk signal,” “offset relevance,” “evidence-backed alert,” “decision support,” “historical precedent,” and “explainable recommendation.”
- Do not say the system predicts accidents, guarantees safety, or determines what an engineer must do.

## Explicitly out of scope for the MVP

- Production use, field deployment, or connection to confidential OIL systems/data.
- Autonomous well control, control-room integration, prescriptive drilling parameters, or safety guarantees.
- A generic RAG chatbot as the main experience.
- Mandatory paid AI APIs or cloud NLP dependencies.
- Generalized extraction across arbitrary operator formats, low-quality scans, and non-English reports. The parser supports bounded PDF/text inputs and deterministic rules. Users can inspect extracted records, but there is no event approval/correction workflow.
- Multi-tenant authorization, production identity and audit systems, advanced admin tooling, and enterprise compliance.
- Claims of calibrated incident probability or operationally validated predictive performance.
- Trajectory simulation, 3D drilling animations, or complex GIS infrastructure.

## Future production scope

Production work would require operator-approved source integration, security and access controls, documented data governance, robust ingestion and human review, depth/datum and coordinate normalization, validated relevance/signal methods, SME review, auditability, monitoring, reliability engineering, and field evaluation. These are separate future workstreams and are not implied by the demo.

## MVP completion criteria

- The complete demo journey above works with seeded data.
- An engineer can explain why an offset and event are relevant by inspecting the displayed factors.
- Every displayed event-backed signal links to a source record/excerpt and provenance label.
- Depth basis, formation match, distance, and missing data are visible where they affect a comparison.
- The UI consistently frames results as historical decision support, without accident prediction or safety-guarantee claims.

## Risks and open assumptions

- The included dataset is synthetic and illustrative; it is not an operator dataset. It currently contains 10 wells, 5 formations, 45 formation intervals, 10 document references, 20 events, 20 evidence records, and 5 seeded alerts.
- Demo depths are treated as meters. Seeded cross-well comparisons use comparable MD values. Event/well depth datum and trajectory normalization are not modeled, so arbitrary operator data must not be compared without additional validation.
- Event labels and actions can be ambiguous; curated examples should distinguish observed event, consequence, response, and source wording.
- A small synthetic corpus can make relevance scores look more certain than they are. Display component factors and provenance rather than implying statistical confidence.
- Offset relevance weights, alert thresholds, and geological/reservoir comparison heuristics are prototype rules only and have not been validated by drilling experts.
- The predictive classifier is uncalibrated and not validated; its estimates are not incident probabilities. Its training query is restricted to the representative synthetic seed and does not have a meaningful independent holdout.
- Authentication, authorization, user-attributed audit records, real-time integration, production hosting, and operational reliability controls remain future work.
