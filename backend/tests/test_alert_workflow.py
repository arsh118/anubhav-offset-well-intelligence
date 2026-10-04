from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.database import build_engine, get_db
from app.main import app
from app.models import Alert, AlertNote, AlertStatus, Base
from app.seed import EVENT_IDS, WELL_IDS, seed_database


@pytest.fixture()
def client(tmp_path) -> Generator[TestClient, None, None]:
    engine = build_engine("sqlite:///{}".format(tmp_path / "alert-workflow.sqlite3"))
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with testing_session() as db:
        seed_database(db)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


def test_active_alerts_generate_future_formation_precedents_idempotently(client: TestClient) -> None:
    path = "/api/alerts/active/{}".format(WELL_IDS["ANB-01"])
    first = client.get(path, params={"radius_km": 10, "depth_window_m": 100})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["category"] == "high_historical_relevance"
    assert body["title"] == "HIGH HISTORICAL RELEVANCE"
    assert body["matching_event_count"] == 3
    assert body["summary"] == (
        "3 relevant historical events were recorded 23–33 m ahead of the current depth in the same formation."
    )
    assert {row["historical_event"]["id"] for row in body["alerts"]} == {
        EVENT_IDS["ANB-02-loss-2865"],
        EVENT_IDS["ANB-02-mud-adjust-2868"],
        EVENT_IDS["ANB-04-loss-2875"],
    }
    loss = next(row for row in body["alerts"] if row["historical_event"]["id"] == EVENT_IDS["ANB-02-loss-2865"])
    assert loss["alert_type"] == "historical_precedent"
    assert loss["historical_event"]["event_type"] == "lost_circulation"
    assert loss["historical_event"]["well_name"] == "ANB-02"
    assert loss["distance_km"] == pytest.approx(4.2, abs=0.02)
    assert loss["depth_difference_m"] == 23.0
    assert loss["historical_event"]["source_document"]["filename"] == "DDR-ANB-02-2024-07.pdf"
    assert loss["historical_event"]["source_page"] == 3
    assert loss["historical_event"]["evidence"]
    assert "loss-control material" in loss["historical_event"]["mitigation"]
    assert "Historical Precedent Alert" in loss["alert_title"]

    recommendation = body["recommendation"]
    assert recommendation["label"] == "Decision support — engineer review required."
    assert recommendation["message"] == (
        "Comparable historical wells contain documented mitigation. Review the recorded mitigation "
        "and current drilling conditions before proceeding."
    )
    assert recommendation["source_event_id"] == EVENT_IDS["ANB-02-loss-2865"]
    assert recommendation["source_event_title"] == "Partial lost circulation in X Formation"
    assert recommendation["source_well_name"] == "ANB-02"
    assert recommendation["source_document"] == "DDR-ANB-02-2024-07.pdf"
    assert recommendation["source_page"] == 3
    assert recommendation["evidence_excerpt"]
    assert recommendation["recorded_mitigation"] == loss["historical_event"]["mitigation"]

    second = client.get(path, params={"radius_km": 10, "depth_window_m": 100})
    assert second.status_code == 200
    assert second.json()["matching_event_count"] == 3
    assert len(client.get("/api/alerts", params={"active_well_id": WELL_IDS["ANB-01"]}).json()) == 4

    edge_radius = client.get(path, params={"radius_km": 8, "depth_window_m": 100}).json()
    medium = next(
        row for row in edge_radius["alerts"] if row["historical_event"]["id"] == EVENT_IDS["ANB-04-loss-2875"]
    )
    assert medium["alert_title"].startswith("Historical Precedent Alert — MEDIUM HISTORICAL RELEVANCE")
    assert 50 <= medium["relevance_score"] < 75


def test_historical_precedent_appears_at_configured_depth_window_boundary(client: TestClient) -> None:
    path = "/api/alerts/active/{}".format(WELL_IDS["ANB-01"])
    context = {"radius_km": 10, "active_depth_m": 2842, "active_formation": "X Formation"}
    before_threshold = client.get(path, params={**context, "depth_window_m": 22}).json()
    assert before_threshold["matching_event_count"] == 0
    assert before_threshold["recommendation"] is None

    at_threshold = client.get(path, params={**context, "depth_window_m": 23}).json()
    assert at_threshold["matching_event_count"] == 1
    alert = at_threshold["alerts"][0]
    assert alert["historical_event"]["id"] == EVENT_IDS["ANB-02-loss-2865"]
    assert alert["depth_difference_m"] == 23.0
    assert alert["historical_event"]["evidence"]
    assert at_threshold["recommendation"]["source_event_id"] == EVENT_IDS["ANB-02-loss-2865"]


def test_no_significant_precedent_and_active_well_validation(client: TestClient) -> None:
    response = client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-10"]))
    assert response.status_code == 200
    body = response.json()
    assert body["category"] == "no_significant_precedent"
    assert body["title"] == "NO SIGNIFICANT PRECEDENT"
    assert body["matching_event_count"] == 0
    assert body["alerts"] == []
    assert "available historical records only" in body["summary"]

    assert client.get("/api/alerts/active/not-a-uuid").status_code == 422
    assert client.get("/api/alerts/active/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-02"])).status_code == 422
    assert client.get("/api/alerts/active/{}?radius_km=100".format(WELL_IDS["ANB-01"])).status_code == 422


def test_stuck_pipe_and_cementing_scenarios_trigger_at_future_depth(client: TestClient) -> None:
    stuck = client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-06"]))
    assert stuck.status_code == 200
    stuck_body = stuck.json()
    assert stuck_body["category"] == "high_historical_relevance"
    assert stuck_body["matching_event_count"] >= 1
    stuck_alert = next(
        row for row in stuck_body["alerts"] if row["historical_event"]["event_type"] == "stuck_pipe"
    )
    assert stuck_alert["historical_event"]["event_type"] == "stuck_pipe"
    assert stuck_alert["depth_difference_m"] == 22.0

    cement = client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-08"]))
    assert cement.status_code == 200
    cement_body = cement.json()
    assert cement_body["category"] == "high_historical_relevance"
    assert cement_body["matching_event_count"] >= 1
    cement_alert = next(
        row for row in cement_body["alerts"] if row["historical_event"]["event_type"] == "cementing_issue"
    )
    assert cement_alert["historical_event"]["event_type"] == "cementing_issue"
    assert cement_alert["depth_difference_m"] == 22.0


def test_acknowledge_review_dismiss_and_engineer_notes(client: TestClient) -> None:
    generated = client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-01"])).json()
    alert_id = next(
        row["id"] for row in generated["alerts"] if row["historical_event"]["id"] == EVENT_IDS["ANB-02-loss-2865"]
    )

    acknowledged = client.post(f"/api/alerts/{alert_id}/acknowledge")
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["status"] == AlertStatus.ACKNOWLEDGED.value
    # The active-alert refresh updates relevance but preserves the workflow state.
    refreshed = client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-01"])).json()
    persisted = next(row for row in refreshed["alerts"] if row["id"] == alert_id)
    assert persisted["status"] == AlertStatus.ACKNOWLEDGED.value

    note = client.post(
        f"/api/alerts/{alert_id}/notes",
        json={
            "note": "Compare returns trend with the adjacent interval before next connection.",
            "author": "Drilling engineer",
        },
    )
    assert note.status_code == 201, note.text
    assert note.json()["author"] == "Drilling engineer"
    assert note.json()["note"].startswith("Compare returns trend")
    detail = client.get(f"/api/alerts/{alert_id}")
    assert detail.status_code == 200
    assert len(detail.json()["notes"]) == 1
    assert detail.json()["historical_event"]["evidence"]

    reviewed = client.patch(f"/api/alerts/{alert_id}", json={"status": "reviewed"})
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == AlertStatus.REVIEWED.value
    dismissed = client.patch(f"/api/alerts/{alert_id}", json={"status": "dismissed"})
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == AlertStatus.DISMISSED.value
    assert client.post(f"/api/alerts/{alert_id}/acknowledge").status_code == 409
    assert client.patch(f"/api/alerts/{alert_id}", json={"status": "open"}).status_code == 409
    assert client.patch(f"/api/alerts/{alert_id}", json={}).status_code == 422
    assert client.post(f"/api/alerts/{alert_id}/notes", json={"note": "   "}).status_code == 422


def test_active_alerts_create_rows_once_and_note_fk_is_used(client: TestClient, tmp_path) -> None:
    client.get("/api/alerts/active/{}".format(WELL_IDS["ANB-01"]))
    # The 3 seeded ANB-01 alerts plus the newly correlated mud-weight event are unique pairs.
    assert client.get("/api/alerts", params={"active_well_id": WELL_IDS["ANB-01"]}).status_code == 200

    engine = build_engine("sqlite:///{}".format(tmp_path / "alert-workflow.sqlite3"))
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Alert).where(Alert.active_well_id == WELL_IDS["ANB-01"])) == 4
        assert db.scalar(select(func.count()).select_from(AlertNote)) == 0
    engine.dispose()
