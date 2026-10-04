from collections.abc import Generator
from pathlib import Path
from typing import Dict

import fitz  # type: ignore[import-untyped]
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.database import build_engine, get_db
from app.document_pipeline import (
    EVENT_ALIASES,
    MAX_UPLOAD_BYTES,
    PageText,
    extract_depths,
    extract_event_candidates,
    extract_event_types,
    extract_formation,
    extract_pages,
)
from app.main import app
from app.models import (
    Base,
    DocumentOrigin,
    EventType,
    Formation,
)
from app.seed import EVENT_IDS, WELL_IDS, seed_database

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def document_client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    engine = build_engine(f"sqlite:///{tmp_path / 'documents.sqlite3'}")
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with testing_session() as db:
        seed_database(db)

    from app.config import settings

    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


def test_depth_patterns_cover_md_tvd_units_and_commas() -> None:
    expected: Dict[str, tuple] = {
        "2842 m": (2842.0, None),
        "2842m": (2842.0, None),
        "MD 2842 m": (2842.0, None),
        "at 2,842 m": (2842.0, None),
        "depth 2842": (2842.0, None),
        "TVD 2842 m": (None, 2842.0),
        "MD/TVD 2,842/2,615 m": (2842.0, 2615.0),
        "MD: 2842 m; TVD: 2615 m": (2842.0, 2615.0),
    }
    for text, values in expected.items():
        depths = extract_depths(text)
        assert (depths.measured_depth, depths.true_vertical_depth) == values


def test_event_dictionary_aliases_map_to_explicit_categories() -> None:
    for event_type, aliases in EVENT_ALIASES.items():
        for alias in aliases:
            assert event_type in extract_event_types(alias), alias
    assert EventType.KICK_INFLUX in extract_event_types("kick / influx")
    assert EventType.GAS_SHOW in extract_event_types("gas show")


def test_formation_name_and_alias_normalize() -> None:
    formation = Formation(
        id="formation-x",
        name="X Formation",
        normalized_name="x formation",
        aliases=["x-fm", "x formation"],
    )
    assert extract_formation("partial losses in X Formation", [formation]) is formation
    assert extract_formation("partial losses in x-fm", [formation]) is formation
    assert extract_formation("partial losses in a different interval", [formation]) is None


def test_pdf_image_page_uses_ocr_fallback(monkeypatch) -> None:
    document = fitz.open()
    page = document.new_page()
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 320, 120), False)
    pixmap.clear_with(255)
    page.insert_image(page.rect, stream=pixmap.tobytes("png"))
    pdf_bytes = document.tobytes()
    document.close()
    monkeypatch.setattr(
        "app.document_pipeline._ocr_page",
        lambda _page: "Well: ANB-02\nAt MD 2,865 m in X Formation, losses were recorded.",
    )
    pages = extract_pages("scanned-test.pdf", pdf_bytes)
    assert len(pages) == 1
    assert pages[0].used_ocr is True
    assert "2,865 m" in pages[0].text


def test_candidate_has_page_evidence_depth_formation_date_and_actions() -> None:
    text = (
        "Well: ANB-02\nDate: 2024-07-14\n\n"
        "At MD 2,865 m in X Formation, partial losses were recorded while drilling.\n"
        "Consequence: Reduced returns required a short circulation pause.\n"
        "Mitigation: The crew pumped a loss-control pill and monitored returns before continuing."
    )
    x_formation = Formation(
        id="formation-x",
        name="X Formation",
        normalized_name="x formation",
        aliases=["x-fm"],
    )
    candidate = extract_event_candidates([PageText(4, text)], [x_formation])[0]
    assert candidate.event_type == EventType.LOST_CIRCULATION
    assert candidate.measured_depth == 2865
    assert candidate.formation_id == "formation-x"
    assert candidate.event_date is not None
    assert candidate.event_date.isoformat().startswith("2024-07-14")
    assert candidate.page_number == 4
    assert "partial losses" in candidate.evidence_excerpt.casefold()
    assert candidate.consequence is not None and "Reduced returns" in candidate.consequence
    assert candidate.mitigation is not None and "loss-control pill" in candidate.mitigation
    assert candidate.confidence >= 0.9


def test_two_events_on_one_page_keep_their_own_depth_and_evidence() -> None:
    text = (
        "At MD 2,830 m in X Formation, a torque spike was observed. "
        "At MD 2,818 m in X Formation, drag increased during pickup."
    )
    x_formation = Formation(
        id="formation-x",
        name="X Formation",
        normalized_name="x formation",
        aliases=["x-fm"],
    )
    candidates = extract_event_candidates([PageText(8, text)], [x_formation])
    assert [(event.event_type, event.measured_depth) for event in candidates] == [
        (EventType.TORQUE_SPIKE, 2830.0),
        (EventType.DRAG_INCREASE, 2818.0),
    ]
    assert "torque spike" in candidates[0].evidence_excerpt.casefold()
    assert "drag increased" not in candidates[0].evidence_excerpt.casefold()


def test_text_upload_process_and_event_evidence_endpoints(document_client: TestClient) -> None:
    fixture = FIXTURES / "DDR-UPLOAD-ANB-07.txt"
    upload = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-07"], "document_type": "daily_drilling_report"},
        files={"file": (fixture.name, fixture.read_bytes(), "text/plain")},
    )
    assert upload.status_code == 201
    uploaded_document = upload.json()
    assert uploaded_document["processing_status"] == "uploaded"
    assert uploaded_document["origin"] == DocumentOrigin.UPLOADED_DOCUMENT.value
    assert uploaded_document["source_label"] == "Uploaded Document"

    processed = document_client.post("/api/documents/{}/process".format(uploaded_document["id"]))
    assert processed.status_code == 200
    payload = processed.json()
    assert payload["document"]["processing_status"] == "processed"
    assert payload["processing_mode"] == "uploaded_document"
    assert len(payload["events"]) == 1
    event = payload["events"][0]
    assert event["well_name"] == "ANB-07"
    assert event["event_type"] == EventType.STUCK_PIPE.value
    assert event["measured_depth"] == 1932
    assert event["true_vertical_depth"] == 1755
    assert event["formation"]["name"] == "Y Shale"
    assert event["event_date"].startswith("2023-02-04")
    assert event["source_page"] == 1
    assert "controlled movement" in event["mitigation"]
    assert event["source_document"]["source_label"] == "Uploaded Document"
    assert event["evidence"][0]["page_number"] == 1
    assert event["evidence"][0]["extraction_method"] == "rule_based"
    assert "differential sticking" in event["evidence"][0]["excerpt"].casefold()

    event_evidence = document_client.get("/api/events/{}/evidence".format(event["id"]))
    assert event_evidence.status_code == 200
    assert event_evidence.json()[0]["document"]["source_label"] == "Uploaded Document"
    document_events = document_client.get("/api/documents/{}/events".format(uploaded_document["id"]))
    assert document_events.status_code == 200
    assert [row["id"] for row in document_events.json()] == [event["id"]]
    assert document_client.get("/api/documents/{}".format(uploaded_document["id"])).json()["content_sha256"]


def test_pdf_upload_preserves_actual_source_page(document_client: TestClient) -> None:
    fixture = FIXTURES / "DDR-UPLOAD-ANB-02.pdf"
    upload = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-02"], "document_type": "daily_drilling_report"},
        files={"file": (fixture.name, fixture.read_bytes(), "application/pdf")},
    )
    assert upload.status_code == 201, upload.text
    payload = document_client.post("/api/documents/{}/process".format(upload.json()["id"])).json()
    assert payload["extracted_pages"] == 2
    assert payload["ocr_pages"] == 0
    assert len(payload["events"]) == 1
    event = payload["events"][0]
    assert event["well_name"] == "ANB-02"
    assert event["event_type"] == EventType.LOST_CIRCULATION.value
    assert event["measured_depth"] == 2865
    assert event["formation"]["name"] == "X Formation"
    assert event["event_date"].startswith("2024-07-14")
    assert event["source_page"] == 2
    assert event["evidence"][0]["page_number"] == 2
    assert "partial losses" in event["evidence"][0]["excerpt"].casefold()


def test_seeded_evidence_processing_preserves_source_and_event_fields(document_client: TestClient) -> None:
    documents = document_client.get("/api/documents").json()
    document = next(row for row in documents if row["filename"] == "DDR-ANB-02-2024-07.pdf")
    before_counts = dataset_counts_from_api(document_client)
    before_event = document_client.get("/api/events").json()
    source_event = next(row for row in before_event if row["id"] == EVENT_IDS["ANB-02-loss-2865"])

    processed = document_client.post("/api/documents/{}/process".format(document["id"]))
    assert processed.status_code == 200
    payload = processed.json()
    assert payload["processing_mode"] == "seeded_demo_evidence"
    assert payload["document"]["source_label"] == "Seeded Demo Evidence"
    normalized = next(row for row in payload["events"] if row["id"] == source_event["id"])
    for field in (
        "well_id",
        "well_name",
        "event_type",
        "measured_depth",
        "formation",
        "mitigation",
        "source_page",
    ):
        assert normalized[field] == source_event[field]
    assert normalized["source_document"]["id"] == document["id"]
    assert normalized["evidence"][0]["excerpt"] == source_event["evidence"][0]["excerpt"]
    assert normalized["evidence"][0]["page_number"] == source_event["source_page"]
    assert dataset_counts_from_api(document_client) == before_counts


def test_failed_processing_is_visible_and_upload_validation_is_clear(document_client: TestClient) -> None:
    malformed_pdf = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-01"], "document_type": "other"},
        files={"file": ("broken.pdf", b"%PDF-1.4 not a complete pdf", "application/pdf")},
    )
    assert malformed_pdf.status_code == 201
    document_id = malformed_pdf.json()["id"]
    failed = document_client.post(f"/api/documents/{document_id}/process")
    assert failed.status_code == 422
    assert document_client.get(f"/api/documents/{document_id}").json()["processing_status"] == "failed"

    unsupported = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-01"]},
        files={
            "file": (
                "report.docx",
                b"not supported",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert unsupported.status_code == 422
    assert document_client.get("/api/documents/00000000-0000-0000-0000-000000000000").status_code == 404
    assert document_client.get("/api/events/00000000-0000-0000-0000-000000000000/evidence").status_code == 404


def test_upload_sanitizes_client_filename_and_enforces_size_limit(document_client: TestClient) -> None:
    sanitized = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-01"], "document_type": "other"},
        files={"file": ("../../outside.txt", b"Representative Synthetic Data", "text/plain")},
    )
    assert sanitized.status_code == 201, sanitized.text
    assert sanitized.json()["filename"] == "outside.txt"

    oversized = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-01"], "document_type": "other"},
        files={"file": ("large.txt", b"x" * (MAX_UPLOAD_BYTES + 1), "text/plain")},
    )
    assert oversized.status_code == 413
    assert oversized.json()["detail"] == "The uploaded file exceeds the 20 MiB limit."


def test_upload_without_event_evidence_creates_no_historical_event(document_client: TestClient) -> None:
    before = dataset_counts_from_api(document_client)
    response = document_client.post(
        "/api/documents/ingest",
        data={"well_id": WELL_IDS["ANB-01"], "document_type": "other"},
        files={
            "file": (
                "daily-notes.txt",
                b"Well: ANB-01\nDate: 2026-10-01\nRoutine connection checks completed without incident.\n",
                "text/plain",
            )
        },
    )
    assert response.status_code == 201
    processed = document_client.post("/api/documents/{}/process".format(response.json()["id"]))
    assert processed.status_code == 200
    assert processed.json()["events"] == []
    after = dataset_counts_from_api(document_client)
    assert after["events"] == before["events"]


def dataset_counts_from_api(client: TestClient) -> dict:
    response = client.get("/api/documents")
    assert response.status_code == 200
    events = client.get("/api/events").json()
    return {"documents": len(response.json()), "events": len(events)}
