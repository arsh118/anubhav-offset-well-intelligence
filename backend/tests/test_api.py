from collections.abc import Generator

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database import build_engine, get_db
from app.demo_fixtures import DATASET_LABEL
from app.geo import coordinate_bounds_within_radius, haversine_distance_km
from app.main import app
from app.models import (
    Alert,
    Base,
    Document,
    EventEvidence,
    EventType,
    Formation,
    Well,
    WellEvent,
    WellRole,
)
from app.seed import ALERT_IDS, EVENT_IDS, WELL_IDS, dataset_counts, seed_database


@pytest.fixture()
def client(tmp_path) -> Generator[TestClient, None, None]:
    engine = build_engine("sqlite:///{}".format(tmp_path / "api-test.sqlite3"))
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


def test_health_wells_and_formations(client: TestClient) -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "database": "connected"}

    response = client.get("/api/wells")
    assert response.status_code == 200
    assert len(response.json()) == 10
    active = next(well for well in response.json() if well["well_name"] == "ANB-01")
    assert active["source"] == DATASET_LABEL
    assert active["current_depth"] == 2842.0
    assert active["current_formation"]["name"] == "X Formation"
    assert len(active["formations"]) == 5

    detail = client.get("/api/wells/{}".format(WELL_IDS["ANB-01"]))
    assert detail.status_code == 200
    assert client.get("/api/wells/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/api/wells/not-a-uuid").status_code == 422

    formations = client.get("/api/formations")
    assert formations.status_code == 200
    assert len(formations.json()) == 5


def test_primary_nearby_depth_and_formation_pattern(client: TestClient) -> None:
    active_id = WELL_IDS["ANB-01"]
    nearby = client.get(f"/api/wells/{active_id}/nearby?radius_km=10")
    assert nearby.status_code == 200
    items = nearby.json()["items"]
    assert [item["well"]["well_name"] for item in items] == ["ANB-02", "ANB-03", "ANB-04"]
    assert [item["distance_km"] for item in items] == pytest.approx([4.2, 6.1, 7.4], abs=0.02)
    assert all(item["formation_match"] is True for item in items)

    wider = client.get(f"/api/wells/{active_id}/nearby?radius_km=12").json()["items"]
    assert [item["well"]["well_name"] for item in wider][3] == "ANB-05"
    assert wider[3]["distance_km"] == pytest.approx(11.2, abs=0.02)

    matched_events = client.get(
        "/api/events",
        params={"formation": "X Formation", "depth_min": 2800, "depth_max": 2900},
    )
    assert matched_events.status_code == 200
    matched_ids = {event["id"] for event in matched_events.json()}
    assert matched_ids == {
        EVENT_IDS["ANB-02-loss-2865"],
        EVENT_IDS["ANB-02-mud-adjust-2868"],
        EVENT_IDS["ANB-03-torque-2830"],
        EVENT_IDS["ANB-03-drag-2818"],
        EVENT_IDS["ANB-04-loss-2875"],
    }

    offsets = client.get(
        "/api/events",
        params={"event_type": "lost_circulation", "formation": "x-fm", "depth_min": 2800},
    )
    assert {event["id"] for event in offsets.json()} == {
        EVENT_IDS["ANB-02-loss-2865"],
        EVENT_IDS["ANB-04-loss-2875"],
    }
    assert client.get("/api/events?depth_min=2500&depth_max=1000").status_code == 422
    assert client.get(f"/api/wells/{active_id}/nearby?radius_km=-2").status_code == 422


def test_simulated_live_feed_is_ordered_labeled_and_includes_interval_pressure_context(client: TestClient) -> None:
    response = client.get("/api/live/{}".format(WELL_IDS["ANB-01"]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["feed_type"] == "deterministic_simulated_replay"
    assert body["status"] == "Simulated eRTMAC / Representative Synthetic Data"
    assert "not connected to OIL's actual eRTMAC system" in body["data_notice"]
    assert [state["measurement"]["measured_depth_m"] for state in body["states"]] == [
        2842.0, 2850.0, 2858.0, 2865.0, 2875.0
    ]
    assert [state["measurement"]["sampled_at"] for state in body["states"]] == sorted(
        state["measurement"]["sampled_at"] for state in body["states"]
    )
    assert all(state["formation"] == "X Formation" for state in body["states"])
    assert all(state["pressure_indicator"] == "review_indicator" for state in body["states"])
    assert all(state["measurement"]["source"] == DATASET_LABEL for state in body["states"])
    assert client.get("/api/live/{}".format(WELL_IDS["ANB-01"])).json() == body


def test_haversine_candidate_bounds_include_antimeridian_neighbors() -> None:
    minimum_latitude, maximum_latitude, longitude_ranges = coordinate_bounds_within_radius(0, 179.99, 5)
    distance = haversine_distance_km(0, 179.99, 0, -179.99)
    assert distance < 5
    assert minimum_latitude <= 0 <= maximum_latitude
    assert len(longitude_ranges) == 2
    assert any(minimum <= -179.99 <= maximum for minimum, maximum in longitude_ranges)


def test_cors_allows_only_configured_frontend_origins(client: TestClient) -> None:
    allowed = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    rejected = client.options(
        "/api/health",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in rejected.headers


def test_default_database_configuration_contains_no_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("database_url", raising=False)
    assert Settings(_env_file=None).database_url == "sqlite:///./anubhav.db"


def test_event_summary_is_bounded_and_alert_listing_is_paginated(client: TestClient) -> None:
    summary = client.get("/api/events/summary")
    assert summary.status_code == 200
    assert summary.json() == {"total": 20}
    assert client.get("/api/events/summary?unused=1").json() == {"total": 20}

    first_page = client.get("/api/alerts", params={"limit": 2, "offset": 0})
    second_page = client.get("/api/alerts", params={"limit": 2, "offset": 2})
    assert len(first_page.json()) == len(second_page.json()) == 2
    assert {row["id"] for row in first_page.json()}.isdisjoint({row["id"] for row in second_page.json()})


def test_stuck_pipe_cementing_and_no_match_scenarios(client: TestClient) -> None:
    stuck_alerts = client.get("/api/alerts", params={"active_well_id": WELL_IDS["ANB-06"]}).json()
    assert len(stuck_alerts) == 1
    assert stuck_alerts[0]["historical_event_id"] == EVENT_IDS["ANB-07-stuck-1932"]

    cement_alerts = client.get("/api/alerts", params={"active_well_id": WELL_IDS["ANB-08"]}).json()
    assert len(cement_alerts) == 1
    assert cement_alerts[0]["historical_event_id"] == EVENT_IDS["ANB-09-cement-1560"]

    no_match_id = WELL_IDS["ANB-10"]
    nearby = client.get(f"/api/wells/{no_match_id}/nearby?radius_km=10").json()["items"]
    assert [item["well"]["well_name"] for item in nearby] == ["ANB-09"]
    assert client.get("/api/alerts", params={"active_well_id": no_match_id}).json() == []
    historical_events = client.get(
        "/api/events",
        params={"well_id": WELL_IDS["ANB-09"], "formation": "Basal Sandstone", "depth_min": 2400},
    )
    assert historical_events.json() == []


def test_documents_evidence_and_knowledge_search(client: TestClient) -> None:
    documents = client.get("/api/documents")
    assert documents.status_code == 200
    filenames = {document["filename"] for document in documents.json()}
    assert {"DDR-ANB-02-2024-07.pdf", "WCR-ANB-03.pdf", "EOWR-ANB-04.pdf"} <= filenames

    well_events = client.get("/api/wells/{}/events".format(WELL_IDS["ANB-02"]))
    assert well_events.status_code == 200
    loss_event = next(event for event in well_events.json() if event["id"] == EVENT_IDS["ANB-02-loss-2865"])
    assert loss_event["source_page"] == 3
    assert loss_event["source_document"]["filename"] == "DDR-ANB-02-2024-07.pdf"
    assert loss_event["evidence"][0]["page_number"] == 3
    assert loss_event["evidence"][0]["document"]["source"] == DATASET_LABEL

    evidence = client.get("/api/events/{}/evidence".format(EVENT_IDS["ANB-02-loss-2865"]))
    assert evidence.status_code == 200
    assert len(evidence.json()) == 1
    assert evidence.json()[0]["page_number"] == loss_event["source_page"]
    assert evidence.json()[0]["excerpt"] == loss_event["evidence"][0]["excerpt"]
    assert evidence.json()[0]["document"]["source_label"] == "Seeded Demo Evidence"

    search = client.get("/api/knowledge/search", params={"q": "partial"})
    assert search.status_code == 200
    assert EVENT_IDS["ANB-02-loss-2865"] in {event["id"] for event in search.json()}
    assert client.get("/api/knowledge/search?q=x").status_code == 422
    assert client.get("/api/knowledge/search", params={"q": "  "}).status_code == 422


def test_knowledge_search_covers_structured_fields_and_returns_traceable_results(client: TestClient) -> None:
    examples = {
        "lost circulation": EVENT_IDS["ANB-02-loss-2865"],
        "stuck pipe": EVENT_IDS["ANB-07-stuck-1932"],
        "X Formation": EVENT_IDS["ANB-02-loss-2865"],
        "cementing": EVENT_IDS["ANB-09-cement-1560"],
        "mud losses": EVENT_IDS["ANB-04-loss-2875"],
        "ANB-02": EVENT_IDS["ANB-02-loss-2865"],
        "2865": EVENT_IDS["ANB-02-loss-2865"],
        "DDR-ANB-02-2024-07.pdf": EVENT_IDS["ANB-02-loss-2865"],
        "partial circulation losses": EVENT_IDS["ANB-02-loss-2865"],
        "loss-control material treatment": EVENT_IDS["ANB-02-loss-2865"],
        "short circulation pause": EVENT_IDS["ANB-02-loss-2865"],
    }
    responses = {}
    for query, expected_id in examples.items():
        response = client.get("/api/knowledge/search", params={"q": query})
        assert response.status_code == 200, f"query {query!r}: {response.text}"
        results = response.json()
        assert expected_id in {row["id"] for row in results}, f"missing expected result for {query!r}"
        responses[query] = next(row for row in results if row["id"] == expected_id)

    result = responses["lost circulation"]
    assert result["event_type"] == "lost_circulation"
    assert result["well_name"] == "ANB-02"
    assert result["measured_depth"] == 2865.0
    assert result["formation"]["name"] == "X Formation"
    assert result["description"]
    assert result["mitigation"]
    assert result["source_document"]["filename"] == "DDR-ANB-02-2024-07.pdf"
    assert result["source_page"] == 3
    assert result["evidence"]
    assert result["evidence"][0]["excerpt"]


def test_all_demo_api_routes_are_unique_by_method_and_path() -> None:
    registered = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods - {"HEAD", "OPTIONS"}:
            key = (method, route.path)
            assert key not in registered, f"duplicate API route {method} {route.path}"
            registered[key] = route.name


def test_complete_anb01_historical_intelligence_review_journey(client: TestClient) -> None:
    wells = client.get("/api/wells").json()
    active = next(well for well in wells if well["well_name"] == "ANB-01")
    active_id = active["id"]
    assert active["current_depth"] == 2842.0
    assert active["current_formation"]["name"] == "X Formation"

    nearby = client.get(f"/api/wells/{active_id}/nearby", params={"radius_km": 20}).json()["items"]
    assert {row["well"]["well_name"] for row in nearby} >= {"ANB-02", "ANB-03", "ANB-04", "ANB-05"}

    correlation_response = client.get(
        f"/api/intelligence/{active_id}/correlation",
        params={"radius_km": 20, "depth_window_m": 100},
    )
    assert correlation_response.status_code == 200, correlation_response.text
    correlation = correlation_response.json()
    assert correlation["comparable_wells"]
    loss_match = next(
        row for row in correlation["historical_events"] if row["event_id"] == EVENT_IDS["ANB-02-loss-2865"]
    )
    assert loss_match["depth_difference_m"] == 23.0
    assert loss_match["formation"]["name"] == "X Formation"
    assert loss_match["source_document"]["filename"] == "DDR-ANB-02-2024-07.pdf"
    assert loss_match["source_page"] == 3
    assert loss_match["evidence_excerpt"]

    historical_events = client.get(
        "/api/events",
        params={"formation": "X Formation", "depth_min": 2800, "depth_max": 2900},
    ).json()
    assert EVENT_IDS["ANB-02-loss-2865"] in {row["id"] for row in historical_events}

    prediction_response = client.post(
        f"/api/predictive-risk/{active_id}",
        json={"radius_km": 20, "depth_window_m": 100, "active_depth_m": 2842, "active_formation": "X Formation"},
    )
    assert prediction_response.status_code == 200, prediction_response.text
    prediction = prediction_response.json()
    assert prediction["status"] == "available"
    assert prediction["notice"] == "Prototype model — evaluation limited by representative synthetic data."
    assert prediction["signals"]
    assert all(signal["supporting_historical_events"] for signal in prediction["signals"])
    assert all(
        event["source_document"]["filename"] and event["source_page"] and event["evidence_excerpt"]
        for signal in prediction["signals"]
        for event in signal["supporting_historical_events"]
    )

    feed_response = client.get(f"/api/live/{active_id}")
    assert feed_response.status_code == 200, feed_response.text
    feed = feed_response.json()
    assert feed["states"][0]["measurement"]["measured_depth_m"] == 2842.0
    assert feed["states"][0]["formation"] == "X Formation"
    assert "Simulated eRTMAC / Representative Synthetic Data" in feed["data_notice"]
    assert "not connected to OIL's actual eRTMAC system" in feed["data_notice"]

    alerts_response = client.get(
        f"/api/alerts/active/{active_id}",
        params={"radius_km": 20, "depth_window_m": 100, "active_depth_m": 2842, "active_formation": "X Formation"},
    )
    assert alerts_response.status_code == 200, alerts_response.text
    alerts = alerts_response.json()
    loss_alert = next(
        row for row in alerts["alerts"] if row["historical_event_id"] == EVENT_IDS["ANB-02-loss-2865"]
    )
    recommendation = alerts["recommendation"]
    assert recommendation["source_event_id"] == EVENT_IDS["ANB-02-loss-2865"]
    assert recommendation["source_event_title"] == loss_match["event_title"]
    assert recommendation["source_well_name"] == "ANB-02"
    assert recommendation["source_document"] == "DDR-ANB-02-2024-07.pdf"
    assert recommendation["source_page"] == 3
    assert recommendation["reason"] and recommendation["recorded_mitigation"]

    evidence_response = client.get(f"/api/events/{EVENT_IDS['ANB-02-loss-2865']}/evidence")
    assert evidence_response.status_code == 200, evidence_response.text
    assert evidence_response.json()[0]["excerpt"] == loss_match["evidence_excerpt"]

    acknowledged = client.post(f"/api/alerts/{loss_alert['id']}/acknowledge")
    assert acknowledged.status_code == 200, acknowledged.text
    assert acknowledged.json()["status"] == "acknowledged"
    reviewed = client.patch(f"/api/alerts/{loss_alert['id']}", json={"status": "reviewed"})
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "reviewed"

    alternative_cases = {
        "ANB-06": ("stuck_pipe", "high_historical_relevance"),
        "ANB-08": ("cementing_issue", "high_historical_relevance"),
        "ANB-10": (None, "no_significant_precedent"),
    }
    for well_name, (event_type, category) in alternative_cases.items():
        well_id = next(row["id"] for row in wells if row["well_name"] == well_name)
        response = client.get(f"/api/alerts/active/{well_id}")
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["category"] == category
        if event_type:
            assert any(row["historical_event"]["event_type"] == event_type for row in result["alerts"])


def test_alert_detail_and_openapi(client: TestClient) -> None:
    alerts = client.get("/api/alerts")
    assert alerts.status_code == 200
    assert len(alerts.json()) == 5

    detail = client.get("/api/alerts/{}".format(ALERT_IDS["ANB-02-loss-2865"]))
    assert detail.status_code == 200
    assert detail.json()["historical_event"]["evidence"]
    assert detail.json()["distance_km"] == pytest.approx(4.2, abs=0.02)
    assert client.get("/api/alerts/00000000-0000-0000-0000-000000000000").status_code == 404
    assert client.get("/openapi.json").status_code == 200


def test_seed_relationships_taxonomy_and_idempotency(tmp_path) -> None:
    engine = build_engine("sqlite:///{}".format(tmp_path / "seed-test.sqlite3"))
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with testing_session() as db:
        seed_database(db)
        seed_database(db)
        counts = dataset_counts(db)
        assert counts == {
            "wells": 10,
            "formations": 5,
            "well_formation_intervals": 45,
            "documents": 10,
            "well_events": 20,
            "event_evidence": 20,
            "alerts": 5,
        }

        expected_taxonomy = {
            EventType.LOST_CIRCULATION,
            EventType.KICK_INFLUX,
            EventType.STUCK_PIPE,
            EventType.TORQUE_SPIKE,
            EventType.DRAG_INCREASE,
            EventType.OVERPRESSURE_SIGNAL,
            EventType.WELLBORE_INSTABILITY,
            EventType.CEMENTING_ISSUE,
            EventType.CASING_ISSUE,
            EventType.MUD_WEIGHT_ADJUSTMENT,
            EventType.HOLE_CLEANING_ISSUE,
            EventType.FISHING_OPERATION,
            EventType.NPT_EVENT,
        }
        actual_taxonomy = set(db.scalars(select(WellEvent.event_type)).all())
        assert expected_taxonomy <= actual_taxonomy

        wells = db.scalars(select(Well)).all()
        assert len({well.field for well in wells}) == 3
        assert {event.well_id for event in db.scalars(select(WellEvent)).all()} == {well.id for well in wells}
        assert {well.role for well in wells} == {WellRole.ACTIVE, WellRole.OFFSET}
        for well in wells:
            assert well.source == DATASET_LABEL
            assert well.latitude is not None and well.longitude is not None
            assert well.current_depth is not None
            assert well.formation_intervals
            assert any(
                interval.formation_id == well.current_formation_id
                and interval.top_depth <= well.current_depth <= interval.base_depth
                for interval in well.formation_intervals
            )

        events = db.scalars(select(WellEvent)).all()
        for event in events:
            assert event.source_document.well_id == event.well_id
            assert event.source_page is not None
            assert event.source_document.page_count is not None
            assert 1 <= event.source_page <= event.source_document.page_count
            assert event.evidence
            assert all(
                evidence.document_id == event.source_document_id and evidence.page_number == event.source_page
                for evidence in event.evidence
            )
            if event.measured_depth is not None:
                assert any(
                    interval.formation_id == event.formation_id
                    and interval.top_depth <= event.measured_depth <= interval.base_depth
                    for interval in event.well.formation_intervals
                )

        assert db.scalar(select(func.count()).select_from(Formation)) == 5
        assert db.scalar(select(func.count()).select_from(Document)) == 10
        assert db.scalar(select(func.count()).select_from(EventEvidence)) == 20
        assert db.scalar(select(func.count()).select_from(Alert)) == 5
    engine.dispose()
