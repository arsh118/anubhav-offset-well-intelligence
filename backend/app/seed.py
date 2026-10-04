"""Create the reproducible representative synthetic demo database."""

import argparse
from datetime import date, datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.demo_fixtures import (
    ALERT_FIXTURES,
    DATASET_LABEL,
    DEMO_SCENARIOS,
    DOCUMENT_FIXTURES,
    DRILLING_MEASUREMENT_FIXTURES,
    EVENT_FIXTURES,
    FORMATIONS,
    build_well_fixtures,
)
from app.geo import haversine_distance_km
from app.models import (
    Alert,
    AlertStatus,
    AlertType,
    Document,
    DocumentOrigin,
    DocumentType,
    DrillingMeasurement,
    EventEvidence,
    EventType,
    ExtractionMethod,
    Formation,
    ProcessingStatus,
    SeverityLabel,
    Well,
    WellEvent,
    WellFormationInterval,
    WellRole,
    WellStatus,
)

SEED_TIMESTAMP = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
LEGACY_WELL_NAMES = ("ANB-DEMO-A01", "ANB-DEMO-O01", "ANB-DEMO-O02", "ANB-DEMO-O03")
LEGACY_FORMATION_KEYS = ("demo-upper-sandstone", "demo-middle-shale", "demo-lower-sandstone")


def stable_id(kind: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"anubhav-demo:{kind}:{key}"))


FORMATION_IDS = {row["key"]: stable_id("formation", row["key"]) for row in FORMATIONS}
WELL_ROWS = build_well_fixtures()
WELL_IDS = {row["key"]: stable_id("well", row["well_name"]) for row in WELL_ROWS}
DOCUMENT_IDS = {key: stable_id("document", key) for key in DOCUMENT_FIXTURES}
EVENT_IDS = {row["key"]: stable_id("event", row["key"]) for row in EVENT_FIXTURES}
EVIDENCE_IDS = {row["key"]: stable_id("evidence", row["key"]) for row in EVENT_FIXTURES}
ALERT_IDS = {row["event"]: stable_id("alert", f"{row['active']}:{row['event']}") for row in ALERT_FIXTURES}
WELLS_BY_KEY = {row["key"]: row for row in WELL_ROWS}
FORMATIONS_BY_KEY = {row["key"]: row for row in FORMATIONS}
EVENTS_BY_KEY = {row["key"]: row for row in EVENT_FIXTURES}


def _timestamp_fields() -> dict:
    return {"created_at": SEED_TIMESTAMP, "updated_at": SEED_TIMESTAMP}


def _event_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _remove_previous_demo_fixture(db: Session) -> None:
    """Remove only the four fixed-ID records from the earlier Part 2 starter seed."""
    legacy_well_ids = [stable_id("well", name) for name in LEGACY_WELL_NAMES]
    legacy_formation_ids = [stable_id("formation", key) for key in LEGACY_FORMATION_KEYS]
    legacy_document_ids = [stable_id("document", f"{name}-daily-report") for name in LEGACY_WELL_NAMES[1:]]
    legacy_event_ids = [
        stable_id("event", "ANB-DEMO-O01-loss-circulation"),
        stable_id("event", "ANB-DEMO-O02-stuck-pipe"),
        stable_id("event", "ANB-DEMO-O03-wellbore-instability"),
    ]
    db.execute(
        delete(Alert).where(
            or_(Alert.active_well_id.in_(legacy_well_ids), Alert.historical_event_id.in_(legacy_event_ids))
        )
    )
    db.execute(
        delete(EventEvidence).where(
            or_(EventEvidence.event_id.in_(legacy_event_ids), EventEvidence.document_id.in_(legacy_document_ids))
        )
    )
    db.execute(delete(WellEvent).where(or_(WellEvent.id.in_(legacy_event_ids), WellEvent.well_id.in_(legacy_well_ids))))
    db.execute(delete(Document).where(or_(Document.id.in_(legacy_document_ids), Document.well_id.in_(legacy_well_ids))))
    db.execute(delete(Well).where(Well.id.in_(legacy_well_ids)))
    db.execute(delete(Formation).where(Formation.id.in_(legacy_formation_ids)))
    db.flush()


def _seed_formations(db: Session) -> None:
    for fixture in FORMATIONS:
        name = fixture["name"]
        db.merge(
            Formation(
                id=FORMATION_IDS[fixture["key"]],
                name=name,
                normalized_name=name.casefold(),
                aliases=list(fixture["aliases"]),
                **_timestamp_fields(),
            )
        )
    db.flush()


def _seed_wells_and_intervals(db: Session) -> None:
    for fixture in WELL_ROWS:
        latitude, longitude = fixture["coordinates"]
        db.merge(
            Well(
                id=WELL_IDS[fixture["key"]],
                well_name=fixture["well_name"],
                field=fixture["field"],
                latitude=latitude,
                longitude=longitude,
                spud_date=date.fromisoformat(fixture["spud_date"]),
                completion_date=(
                    date.fromisoformat(fixture["completion_date"]) if fixture["completion_date"] else None
                ),
                total_depth=fixture["total_depth"],
                current_depth=fixture["current_depth"],
                current_formation_id=FORMATION_IDS[fixture["current_formation"]],
                role=WellRole(fixture["role"]),
                status=WellStatus(fixture["status"]),
                source=DATASET_LABEL,
                **_timestamp_fields(),
            )
        )
    db.flush()

    for fixture in WELL_ROWS:
        for formation_key, top_depth, base_depth in fixture["formations"]:
            interval_id = stable_id(
                "well-formation",
                f"{fixture['key']}:{formation_key}:{top_depth}",
            )
            db.merge(
                WellFormationInterval(
                    id=interval_id,
                    well_id=WELL_IDS[fixture["key"]],
                formation_id=FORMATION_IDS[formation_key],
                top_depth=top_depth,
                base_depth=base_depth,
                depth_unit="m",
                lithology=FORMATIONS_BY_KEY[formation_key]["lithology"],
                geological_zone=FORMATIONS_BY_KEY[formation_key]["geological_zone"],
                reservoir_zone=FORMATIONS_BY_KEY[formation_key]["reservoir_zone"],
                pressure_indicator=FORMATIONS_BY_KEY[formation_key]["pressure_indicator"],
                porosity_percent=FORMATIONS_BY_KEY[formation_key]["porosity_percent"],
                permeability_md=FORMATIONS_BY_KEY[formation_key]["permeability_md"],
                **_timestamp_fields(),
            )
        )
    db.flush()


def _seed_drilling_measurements(db: Session) -> None:
    for fixture in DRILLING_MEASUREMENT_FIXTURES:
        well_id = WELL_IDS[fixture["well"]]
        sampled_at = _event_datetime(fixture["at"])
        db.merge(
            DrillingMeasurement(
                id=stable_id("measurement", f"{fixture['well']}:{fixture['at']}"),
                well_id=well_id,
                sampled_at=sampled_at,
                measured_depth_m=fixture["md"],
                true_vertical_depth_m=fixture["tvd"],
                mud_weight_sg=fixture["mw"],
                ecd_sg=fixture["ecd"],
                rop_m_per_hr=fixture["rop"],
                wob_kn=fixture["wob"],
                rpm=fixture["rpm"],
                torque_knm=fixture["torque"],
                standpipe_pressure_mpa=fixture["spp"],
                inclination_deg=fixture["inc"],
                azimuth_deg=fixture["azi"],
                casing_depth_m=fixture.get("casing"),
                cementing_metadata=fixture.get("cementing"),
                source=DATASET_LABEL,
                **_timestamp_fields(),
            )
        )
    db.flush()


def _seed_documents(db: Session) -> None:
    for well_key, fixture in DOCUMENT_FIXTURES.items():
        db.merge(
            Document(
                id=DOCUMENT_IDS[well_key],
                well_id=WELL_IDS[well_key],
                filename=fixture["filename"],
                document_type=DocumentType(fixture["type"]),
                source=DATASET_LABEL,
                origin=DocumentOrigin.SEEDED_DEMO,
                uploaded_at=SEED_TIMESTAMP,
                processing_status=ProcessingStatus.PROCESSED,
                extracted_text_path=None,
                page_count=fixture["pages"],
                **_timestamp_fields(),
            )
        )
    db.flush()


def _seed_events_and_evidence(db: Session) -> None:
    for fixture in EVENT_FIXTURES:
        well_key = fixture["well"]
        document_id = DOCUMENT_IDS[well_key]
        db.merge(
            WellEvent(
                id=EVENT_IDS[fixture["key"]],
                well_id=WELL_IDS[well_key],
                event_type=EventType(fixture["type"]),
                event_title=fixture["title"],
                description=fixture["description"],
                measured_depth=fixture["md"],
                true_vertical_depth=fixture["tvd"],
                formation_id=FORMATION_IDS[fixture["formation"]],
                event_date=_event_datetime(fixture["date"]),
                consequence=fixture["consequence"],
                mitigation=fixture["mitigation"],
                severity_label=SeverityLabel(fixture["severity"]),
                source_document_id=document_id,
                source_page=fixture["page"],
                confidence=fixture["confidence"],
                **_timestamp_fields(),
            )
        )
    db.flush()

    for fixture in EVENT_FIXTURES:
        db.merge(
            EventEvidence(
                id=EVIDENCE_IDS[fixture["key"]],
                event_id=EVENT_IDS[fixture["key"]],
                document_id=DOCUMENT_IDS[fixture["well"]],
                page_number=fixture["page"],
                excerpt=fixture["evidence"],
                extraction_method=ExtractionMethod.SYNTHETIC_DEMO,
                confidence=fixture["confidence"],
                **_timestamp_fields(),
            )
        )
    db.flush()


def _seed_alerts(db: Session) -> None:
    for fixture in ALERT_FIXTURES:
        active = WELLS_BY_KEY[fixture["active"]]
        event = EVENTS_BY_KEY[fixture["event"]]
        offset = WELLS_BY_KEY[event["well"]]
        distance = haversine_distance_km(
            *active["coordinates"],
            *offset["coordinates"],
        )
        depth_difference = abs(active["current_depth"] - event["md"])
        formation_name = FORMATIONS_BY_KEY[event["formation"]]["name"]
        explanation = (
            f"{DATASET_LABEL}. {offset['well_name']} recorded {event['title']} at "
            f"{event['md']:,} m in {formation_name}, {distance:.1f} km from "
            f"{active['well_name']}. The event is {depth_difference:.0f} m from the "
            f"active well's current depth. Historical precedent for engineer review only. "
            f"Source: {DOCUMENT_FIXTURES[event['well']]['filename']}, page {event['page']}."
        )
        db.merge(
            Alert(
                id=ALERT_IDS[fixture["event"]],
                active_well_id=WELL_IDS[fixture["active"]],
                historical_event_id=EVENT_IDS[fixture["event"]],
                alert_type=AlertType.HISTORICAL_PRECEDENT,
                alert_title=f"Historical precedent: {event['title']}",
                relevance_score=fixture["score"],
                explanation=explanation,
                distance_km=round(distance, 2),
                depth_difference_m=depth_difference,
                formation_match=True,
                status=AlertStatus.OPEN,
                **_timestamp_fields(),
            )
        )
    db.commit()


def seed_database(db: Session) -> None:
    """Upsert the full fixture with stable IDs; rerunning it does not duplicate rows."""
    _remove_previous_demo_fixture(db)
    _seed_formations(db)
    _seed_wells_and_intervals(db)
    _seed_drilling_measurements(db)
    _seed_documents(db)
    _seed_events_and_evidence(db)
    _seed_alerts(db)


def dataset_counts(db: Session) -> dict:
    return {
        table: db.scalar(select(func.count()).select_from(model)) or 0
        for table, model in (
            ("wells", Well),
            ("formations", Formation),
            ("well_formation_intervals", WellFormationInterval),
            ("documents", Document),
            ("well_events", WellEvent),
            ("event_evidence", EventEvidence),
            ("alerts", Alert),
        )
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=f"Load {DATASET_LABEL} into PostgreSQL.")
    parser.parse_args()
    with SessionLocal() as db:
        seed_database(db)
        counts = dataset_counts(db)
    print(f"{DATASET_LABEL} loaded: {counts}")
    print(f"Scenarios: {DEMO_SCENARIOS}")


if __name__ == "__main__":
    main()
