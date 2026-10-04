from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.database import build_engine, get_db
from app.main import app
from app.models import Base
from app.seed import EVENT_IDS, WELL_IDS, seed_database


@pytest.fixture()
def client(tmp_path) -> Generator[TestClient, None, None]:
    engine = build_engine("sqlite:///{}".format(tmp_path / "intelligence.sqlite3"))
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


def test_anb01_correlation_has_exact_formation_depth_score_and_evidence(client: TestClient) -> None:
    response = client.get(
        "/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]),
        params={"radius_km": 10, "depth_window_m": 100, "event_family": "losses"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["active_well"]["active_depth_m"] == 2842.0
    assert body["active_well"]["active_formation"] == "X Formation"
    assert body["total_matching_events"] >= 5

    loss = next(row for row in body["historical_events"] if row["event_id"] == EVENT_IDS["ANB-02-loss-2865"])
    assert loss["offset_well"]["well_name"] == "ANB-02"
    assert loss["distance_km"] == pytest.approx(4.2, abs=0.02)
    assert loss["historical_depth_m"] == 2865.0
    assert loss["active_depth_m"] == 2842.0
    assert loss["depth_difference_m"] == 23.0
    assert loss["depth_band"] == "high"
    assert loss["formation"]["name"] == "X Formation"
    assert loss["formation_match"] == "exact"
    assert loss["components"]["formation"]["score"] == 1.0
    assert loss["components"]["depth_proximity"]["score"] == 1.0
    assert loss["components"]["event_similarity"]["score"] == 1.0
    weighted_score = sum(
        component["score"] * component["weight"] for component in loss["components"].values()
    )
    assert loss["relevance_score_normalized"] == pytest.approx(weighted_score, abs=0.0001)
    assert 0 <= loss["relevance_score_normalized"] <= 1
    assert loss["relevance_score"] == pytest.approx(loss["relevance_score_normalized"] * 100, abs=0.01)
    assert loss["source_document"]["source_label"] == "Seeded Demo Evidence"
    assert loss["source_page"] == 3
    assert loss["existing_alert"]["status"] == "open"
    assert "partial circulation losses" in loss["evidence_excerpt"].casefold()
    assert "loss-control material" in loss["mitigation"]
    assert "23 m ahead of the active depth" in loss["explanation"]
    assert "4.2 km away" in loss["explanation"]
    assert body["heuristic_weights"] == {
        "formation": 0.3,
        "depth_proximity": 0.25,
        "spatial_proximity": 0.2,
        "event_similarity": 0.15,
        "source_confidence": 0.1,
    }


def test_well_correlation_explains_geology_reservoir_drilling_and_history(client: TestClient) -> None:
    response = client.get("/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]), params={"radius_km": 10})

    assert response.status_code == 200, response.text
    body = response.json()
    offset = next(row for row in body["comparable_wells"] if row["offset_well"]["well_name"] == "ANB-02")
    assert body["data_notice"] == "Representative Synthetic Demo Data"
    assert offset["source_label"] == "Representative Synthetic Demo Data"
    assert offset["distance_km"] == pytest.approx(4.2, abs=0.02)
    assert offset["depth_alignment_m"] == 23.0
    assert offset["formation_match"] == "exact"
    assert offset["active_formation_interval"]["formation"]["normalized_name"] == "x formation"
    assert offset["active_formation_interval"]["formation"]["aliases"] == ["x formation", "x-fm"]
    assert offset["active_formation_interval"]["lithology"] == "interbedded sandstone and shale"
    assert offset["active_formation_interval"]["geological_zone"] == "X Formation interval"
    assert offset["active_formation_interval"]["reservoir_zone"] == "X sandstone unit"
    assert offset["active_formation_interval"]["pressure_indicator"] == "review_indicator"
    assert offset["active_formation_interval"]["porosity_percent"] == 16.0
    assert offset["active_formation_interval"]["permeability_md"] == 60.0
    assert offset["geological_similarity"] == 1.0
    assert offset["reservoir_similarity"] == 1.0

    active_parameters = offset["active_drilling_parameters"]
    offset_parameters = offset["offset_drilling_parameters"]
    comparisons = offset["drilling_parameter_comparison"]
    assert active_parameters["measured_depth_m"] == 2842.0
    assert active_parameters["true_vertical_depth_m"] == 2602.0
    assert offset_parameters["measured_depth_m"] == 2865.0
    assert offset_parameters["true_vertical_depth_m"] == 2616.0
    assert comparisons["measured_depth_m"]["difference"] == 23.0
    assert comparisons["true_vertical_depth_m"]["difference"] == 14.0
    assert comparisons["mud_weight_sg"]["difference"] == 0.01
    assert comparisons["ecd_sg"]["difference"] == 0.01
    assert comparisons["rop_m_per_hr"]["difference"] == -2.0
    assert comparisons["wob_kn"]["difference"] == 3.0
    assert comparisons["torque_knm"]["difference"] == 0.3
    assert offset["historical_events"]
    assert any("Same formation: X Formation" in reason for reason in offset["comparison_reasons"])
    assert any("4.2 km from active well" in reason for reason in offset["comparison_reasons"])
    assert any("23 m ahead of active depth" in reason for reason in offset["comparison_reasons"])
    assert any("10 shared parameter values" in reason for reason in offset["comparison_reasons"])


def test_near_depth_torque_and_multiple_matching_events(client: TestClient) -> None:
    body = client.get(
        "/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]),
        params={"radius_km": 10},
    ).json()
    event_ids = {row["event_id"] for row in body["historical_events"]}
    assert EVENT_IDS["ANB-02-loss-2865"] in event_ids
    assert EVENT_IDS["ANB-03-torque-2830"] in event_ids
    assert len(event_ids) >= 5

    torque = next(row for row in body["historical_events"] if row["event_id"] == EVENT_IDS["ANB-03-torque-2830"])
    assert torque["depth_difference_m"] == -12.0
    assert torque["absolute_depth_difference_m"] == 12.0
    assert torque["depth_band"] == "high"
    assert torque["formation_match"] == "exact"
    assert torque["source_page"] == 22
    assert "12 m behind the active depth" in torque["explanation"]


def test_radius_excludes_distant_offsets(client: TestClient) -> None:
    response = client.get(
        "/api/intelligence/{}/offsets".format(WELL_IDS["ANB-01"]),
        params={"radius_km": 5},
    )
    assert response.status_code == 200
    body = response.json()
    assert [row["well_name"] for row in body["offsets"]] == ["ANB-02"]
    assert body["offsets"][0]["distance_km"] == pytest.approx(4.2, abs=0.02)


def test_formation_alias_scores_below_exact_and_wrong_formation_scores_zero(client: TestClient) -> None:
    alias = client.get(
        "/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]),
        params={"active_formation": "x-fm"},
    ).json()
    loss_alias = next(row for row in alias["historical_events"] if row["event_id"] == EVENT_IDS["ANB-02-loss-2865"])
    assert loss_alias["formation_match"] == "alias"
    assert loss_alias["components"]["formation"]["score"] == pytest.approx(0.85)

    wrong = client.get(
        "/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]),
        params={"active_formation": "Basal Sandstone"},
    ).json()
    loss_wrong = next(row for row in wrong["historical_events"] if row["event_id"] == EVENT_IDS["ANB-02-loss-2865"])
    assert loss_wrong["formation_match"] == "mismatch"
    assert loss_wrong["components"]["formation"]["score"] == 0.0
    assert loss_wrong["relevance_score"] < loss_alias["relevance_score"]


def test_no_match_dashboard_is_explicit(client: TestClient) -> None:
    response = client.get("/api/intelligence/{}/signals".format(WELL_IDS["ANB-10"]))
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["matched_historical_events"] == 0
    assert body["summary"]["matched_offset_wells"] == 0
    assert body["summary"]["has_significant_match"] is False
    assert body["signals"] == []
    assert "No significant historical match" in body["message"]
    assert "not an accident prediction" in body["data_notice"]


def test_dashboard_aggregates_signals_and_validation_errors(client: TestClient) -> None:
    response = client.get(
        "/api/intelligence/{}/signals".format(WELL_IDS["ANB-01"]),
        params={"event_family": "losses", "radius_km": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["has_significant_match"] is True
    assert body["summary"]["high_relevance_signals"] >= 1
    assert all(row["relevance_band"] in {"high", "medium"} for row in body["signals"])

    assert client.get("/api/intelligence/not-a-uuid/signals").status_code == 422
    assert client.get("/api/intelligence/00000000-0000-0000-0000-000000000000/signals").status_code == 404
    assert client.get(
        "/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]), params={"event_family": "unknown-family"}
    ).status_code == 422
    assert client.get(
        "/api/intelligence/{}/correlation".format(WELL_IDS["ANB-01"]), params={"radius_km": 51}
    ).status_code == 422
