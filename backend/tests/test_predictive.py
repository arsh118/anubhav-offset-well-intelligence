from collections import Counter
from collections.abc import Generator
from datetime import datetime, timezone

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app import predictive_service
from app.database import build_engine, get_db
from app.main import app
from app.models import (
    Base,
    Document,
    DocumentOrigin,
    DocumentType,
    EventType,
    Well,
    WellEvent,
)
from app.predictive_service import FEATURES, _features_for_pair, _measurement_value, _training_examples
from app.seed import DOCUMENT_IDS, EVENT_IDS, WELL_IDS, seed_database

NOTICE = "Prototype model — evaluation limited by representative synthetic data."


@pytest.fixture()
def predictive_client(tmp_path) -> Generator[tuple[TestClient, sessionmaker], None, None]:
    engine = build_engine("sqlite:///{}".format(tmp_path / "predictive.sqlite3"))
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with testing_session() as db:
        seed_database(db)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client, testing_session
    app.dependency_overrides.clear()
    engine.dispose()


def test_prediction_is_supported_by_source_backed_history(predictive_client) -> None:
    client, _ = predictive_client
    response = client.post(
        "/api/predictive-risk/{}".format(WELL_IDS["ANB-01"]),
        json={"radius_km": 10, "depth_window_m": 100},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "available"
    assert body["training_sample_count"] == 20
    assert body["model_version"] == "0.2.0-prototype"
    assert body["notice"] == NOTICE
    assert body["model_metadata"]["evaluation_status"] == "not_evaluated"
    assert body["model_metadata"]["training_label_counts"] == {
        "Mud Loss": 2,
        "Stuck Pipe": 1,
        "Torque Spike": 1,
        "Overpressure Signal": 1,
        "Cementing Issue": 1,
        "Other documented event": 14,
    }
    assert "accuracy" not in body["model_metadata"]
    assert body["signals"]
    for signal in body["signals"]:
        assert 0 <= signal["probability"] <= 1
        assert signal["risk_band"] == "Historical Risk Signal"
        assert signal["supporting_offset_wells"]
        assert signal["supporting_historical_events"]
        assert signal["top_contributing_features"]
        for event in signal["supporting_historical_events"]:
            assert event["source_document"]["origin"] == "seeded_demo"
            assert event["source_document"]["filename"]
            assert event["source_page"] is not None
            assert event["evidence_excerpt"]


def test_insufficient_training_data_returns_no_risk_signals(predictive_client, monkeypatch) -> None:
    client, _ = predictive_client
    monkeypatch.setattr(
        predictive_service,
        "_training_examples",
        lambda _db: (np.empty((0, len(FEATURES))), [], []),
    )

    response = client.post("/api/predictive-risk/{}".format(WELL_IDS["ANB-01"]), json={"radius_km": 10})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "insufficient_data"
    assert body["training_sample_count"] == 0
    assert body["signals"] == []
    assert body["notice"] == NOTICE


def test_prediction_output_is_deterministic(predictive_client) -> None:
    client, _ = predictive_client
    path = "/api/predictive-risk/{}".format(WELL_IDS["ANB-01"])
    payload = {"radius_km": 10, "depth_window_m": 100}

    first = client.post(path, json=payload)
    second = client.post(path, json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["signals"] == second.json()["signals"]


def test_feature_pipeline_has_fixed_features_and_zero_fills_missing_values(predictive_client) -> None:
    _, sessions = predictive_client
    with sessions() as db:
        active = db.get(Well, WELL_IDS["ANB-01"])
        offset = db.get(Well, WELL_IDS["ANB-02"])
        assert active is not None
        assert offset is not None
        event = next(row for row in _training_examples(db)[2] if row.well_id == offset.id)
        assert event.measured_depth is not None
        nearest_sample = min(
            active.drilling_measurements,
            key=lambda sample: abs(float(sample.measured_depth_m) - float(active.current_depth)),
        )
        nearest_sample.mud_weight_sg = None
        nearest_sample.ecd_sg = None
        values = _features_for_pair(
            active,
            float(active.current_depth),
            offset,
            float(event.measured_depth),
            event.formation,
            4.2,
            0,
        )

    assert tuple(values) == FEATURES
    assert all(np.isfinite(value) for value in values.values())
    assert values["formation_similarity"] == 1.0
    assert values["historical_event_frequency"] == 0.0
    assert values["mud_weight_sg"] == 0.0
    assert values["ecd_sg"] == 0.0
    assert _measurement_value(None, "mud_weight_sg") == 0.0


def test_training_uses_seeded_documents_only_and_excludes_uploaded_events(predictive_client) -> None:
    _, sessions = predictive_client
    with sessions() as db:
        db.add(
            Document(
                id="predictive-upload-document",
                well_id=WELL_IDS["ANB-02"],
                filename="uploaded-report.pdf",
                document_type=DocumentType.DAILY_DRILLING_REPORT,
                source="Uploaded test report",
                origin=DocumentOrigin.UPLOADED_DOCUMENT,
            )
        )
        db.add(
            WellEvent(
                id="predictive-upload-event",
                well_id=WELL_IDS["ANB-02"],
                event_type=EventType.LOST_CIRCULATION,
                event_title="Uploaded report loss event",
                description="Event used to check training provenance filter.",
                measured_depth=2866,
                event_date=datetime(2024, 7, 15, tzinfo=timezone.utc),
                source_document_id="predictive-upload-document",
                source_page=2,
                confidence=0.9,
            )
        )
        db.commit()

        _, labels, events = _training_examples(db)

    assert len(labels) == 20
    assert len(events) == 20
    assert Counter(labels) == {
        "Mud Loss": 2,
        "Stuck Pipe": 1,
        "Torque Spike": 1,
        "Overpressure Signal": 1,
        "Cementing Issue": 1,
        "Other documented event": 14,
    }
    assert all(event.source_document.origin == DocumentOrigin.SEEDED_DEMO for event in events)
    assert all(event.id != "predictive-upload-event" for event in events)


def test_training_event_frequency_uses_only_strictly_earlier_events(predictive_client) -> None:
    _, sessions = predictive_client
    with sessions() as db:
        db.add(
            WellEvent(
                id="predictive-future-loss-event",
                well_id=WELL_IDS["ANB-02"],
                event_type=EventType.LOST_CIRCULATION,
                event_title="Later seeded loss event",
                description="Test row for checking prior-only event frequency.",
                measured_depth=2870,
                event_date=datetime(2025, 7, 15, tzinfo=timezone.utc),
                source_document_id=DOCUMENT_IDS["ANB-02"],
                source_page=4,
                confidence=0.9,
            )
        )
        db.commit()

        matrix, _, events = _training_examples(db)
        original_index = next(index for index, event in enumerate(events) if event.id == EVENT_IDS["ANB-02-loss-2865"])
        later_index = next(index for index, event in enumerate(events) if event.id == "predictive-future-loss-event")

    frequency_index = FEATURES.index("historical_event_frequency")
    assert matrix[original_index, frequency_index] == 0.0
    assert matrix[later_index, frequency_index] == pytest.approx(np.log(2) / np.log(6))
