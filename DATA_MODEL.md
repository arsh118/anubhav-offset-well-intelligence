# ANUBHAV Data Model

This document describes the schema implemented in `backend/app/models.py` and Alembic revisions `20261003_0001` through `20261003_0005`. It does not describe a production operator data model.

## Prototype assumptions

- All seeded wells, coordinates, formation properties, measurements, events, and excerpts are representative synthetic demo data.
- Depths in the seeded demo are treated as meters. The seeded cross-well comparisons use comparable measured-depth (MD) values.
- `Well.current_depth` and `WellEvent.measured_depth` do not carry a unit or datum column. The current comparisons assume meters and compatible MD; the schema does not validate that assumption for uploaded or external data.
- Formation intervals have a `depth_unit` value (default `m`) but no datum. Drilling measurements use explicitly named meter fields. Historical `true_vertical_depth` is stored but is not the depth used for offset event correlation.
- Offset scores, alert thresholds, and geology/reservoir comparisons are prototype heuristics and have not been validated by drilling experts.

## Implemented tables

| Table / model | Implemented data |
| --- | --- |
| `formations` / `Formation` | ID, display and normalized names, JSON aliases. |
| `wells` / `Well` | Name, field, latitude/longitude, spud/completion dates, total/current depth, current formation, active/offset role, status, and source label. |
| `well_formation_intervals` / `WellFormationInterval` | Well and formation IDs, top/base depth, depth unit, lithology, geological/reservoir zone, pressure indicator, porosity, and permeability. |
| `drilling_measurements` / `DrillingMeasurement` | Timestamped MD/TVD in meters, mud weight, ECD, ROP, WOB, RPM, torque, standpipe pressure, inclination, azimuth, casing depth, cementing metadata, and source label. |
| `documents` / `Document` | Well, filename/type, source and origin, upload time, processing status, storage paths, SHA-256 for uploaded bytes, and page count. |
| `well_events` / `WellEvent` | Well, event type/title/description, optional MD/TVD and formation/date, consequence, mitigation, severity, source document/page, and extraction confidence. |
| `event_evidence` / `EventEvidence` | Event/document IDs, page, excerpt, extraction method, and confidence. |
| `alerts` / `Alert` | Active well and historical event, alert type/title, relevance score/explanation, distance/depth difference, formation match, and review status. Unique per active-well/event pair. |
| `alert_notes` / `AlertNote` | Append-only note text, optional author, and timestamp. |

IDs are stored as 36-character strings; the demo seed uses stable UUIDs. Foreign keys, indexes, uniqueness rules, and check constraints are declared in the models and migrations. The schema has no user/account table, authorization metadata, well trajectory/survey table, coordinate reference system, depth datum, source revision history, or human extraction-review state.

## Relationships and evidence

```text
Well 1 ─── * WellFormationInterval * ─── 1 Formation
Well 1 ─── * DrillingMeasurement
Well 1 ─── * Document
Well 1 ─── * WellEvent * ─── 1 Document
WellEvent 1 ─── * EventEvidence * ─── 1 Document
Well 1 ─── * Alert * ─── 1 WellEvent
Alert 1 ─── * AlertNote
```

Correlation only uses historical events that have an MD value and a non-empty evidence excerpt linked to the event's source document. Seeded source rows are metadata/excerpts; the seed does not fabricate source PDF files. Uploaded PDF/TXT originals and extracted page text are written to `UPLOAD_DIR`; Compose mounts a named volume for this directory.

## Derived intelligence and workflow

- Nearby distance is calculated from latitude/longitude using Haversine distance and a configurable radius.
- Event correlation filters candidates by the configured symmetric MD window, then reports formation match and transparent relevance components for formation, depth proximity, spatial proximity, event family, and source confidence.
- Geology/reservoir similarity and drilling-parameter comparisons use the seeded formation interval properties and the nearest stored measurements. They are deterministic comparisons, not calibrated engineering models.
- Active alerts are generated for evidence-backed events ahead of active MD, with an exact or alias formation match and score above the configured medium threshold. The API upserts an alert per well/event and retains its review state during refresh. The startup seed merges its five demo alerts as `open`, so reseeding can reset those seeded statuses.
- Alert statuses are `open`, `acknowledged`, `reviewed`, and `dismissed`; dismissal is terminal. Notes are append-only.
- The classifier fits a scikit-learn logistic regression model at request time from measured-depth events whose source documents are both marked `seeded_demo` and labeled `Representative Synthetic Demo Data`. Uploaded-document events are excluded. Estimates are experimental and uncalibrated; the schema stores no model training snapshots or production predictions.

## Migrations and seed

Alembic revisions add the initial wells/formations/events/evidence/alerts schema, formation depth intervals, document upload lifecycle fields, alert notes/workflow states, and geology/drilling-measurement properties. `backend/app/seed.py` loads the fixed synthetic scenario set using stable IDs. Its printed table counts omit the `drilling_measurements` and `alert_notes` tables.

## Future data work

Before comparing operator data, add and validate explicit depth units/datums, coordinate reference systems, and trajectory-aware MD/TVD handling. Production use would also require governed source revisions, human review/approval records, user identity/access control, audit attribution, and versioned signal/model snapshots. These are not currently implemented, and this documentation update does not change the schema.
