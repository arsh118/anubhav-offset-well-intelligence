"""Persistence services for seeded-evidence normalization and real uploads."""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.document_pipeline import (
    MAX_UPLOAD_BYTES,
    DocumentExtractionError,
    EventCandidate,
    extract_date,
    extract_depths,
    extract_event_candidates,
    extract_event_types,
    extract_formation,
    extract_pages,
    extract_well_name,
    normalize_text,
    sha256_digest,
)
from app.models import (
    Document,
    DocumentOrigin,
    DocumentType,
    EventEvidence,
    EventType,
    ExtractionMethod,
    Formation,
    ProcessingStatus,
    SeverityLabel,
    Well,
    WellEvent,
)

logger = logging.getLogger(__name__)


class DocumentProcessingError(RuntimeError):
    """A processing run failed after the document record was saved."""


@dataclass(frozen=True)
class ProcessingResult:
    events: List[WellEvent]
    processing_mode: str
    page_count: int
    ocr_pages: int
    message: str


def _event_loads():
    return (
        selectinload(WellEvent.formation),
        selectinload(WellEvent.source_document),
        selectinload(WellEvent.evidence).selectinload(EventEvidence.document),
        selectinload(WellEvent.well),
    )


def create_uploaded_document(
    db: Session,
    well_id: str,
    filename: str,
    content_type: Optional[str],
    content: bytes,
    document_type: DocumentType,
) -> Document:
    if not content:
        raise DocumentExtractionError("The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise DocumentExtractionError("The uploaded file exceeds the 20 MiB limit.")
    well = db.get(Well, well_id)
    if well is None:
        raise LookupError("Well not found.")

    safe_name = Path((filename or "").replace("\\", "/")).name.strip()
    suffix = Path(safe_name).suffix.casefold()
    if suffix == ".pdf":
        if not content.startswith(b"%PDF"):
            raise DocumentExtractionError("The .pdf upload does not contain a PDF document.")
    elif suffix in (".txt", ".text"):
        media_type = (content_type or "").split(";", maxsplit=1)[0].strip().casefold()
        if media_type not in ("", "text/plain", "application/octet-stream"):
            raise DocumentExtractionError("Text uploads must use the text/plain content type.")
        try:
            content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DocumentExtractionError("Text uploads must use UTF-8 encoding.") from exc
    else:
        raise DocumentExtractionError("Only PDF and UTF-8 text uploads are supported.")

    document_id = str(uuid4())
    upload_root = Path(settings.upload_dir).expanduser().resolve()
    relative_path = Path("raw") / f"{document_id}{suffix}"
    stored_path = upload_root / relative_path
    stored_path.parent.mkdir(parents=True, exist_ok=True)
    stored_path.write_bytes(content)
    document = Document(
        id=document_id,
        well_id=well_id,
        filename=safe_name[:255] or f"document{suffix}",
        document_type=document_type,
        source="Uploaded Document",
        origin=DocumentOrigin.UPLOADED_DOCUMENT,
        processing_status=ProcessingStatus.UPLOADED,
        storage_path=relative_path.as_posix(),
        content_sha256=sha256_digest(content),
    )
    try:
        db.add(document)
        db.commit()
        db.refresh(document)
        return document
    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise


def process_document(db: Session, document: Document) -> ProcessingResult:
    if document.processing_status == ProcessingStatus.PROCESSING:
        raise DocumentProcessingError("This document is already being processed.")
    if document.origin == DocumentOrigin.SEEDED_DEMO:
        return _process_seeded_evidence(db, document)
    if document.origin != DocumentOrigin.UPLOADED_DOCUMENT:
        raise DocumentProcessingError("The document origin is not supported.")
    return _process_uploaded_document(db, document)


def _process_seeded_evidence(db: Session, document: Document) -> ProcessingResult:
    document.processing_status = ProcessingStatus.PROCESSING
    db.commit()
    try:
        events = list(
            db.scalars(
                select(WellEvent)
                .where(WellEvent.source_document_id == document.id)
                .options(*_event_loads())
                .order_by(WellEvent.source_page, WellEvent.measured_depth, WellEvent.id)
            ).all()
        )
        supported: List[WellEvent] = []
        for event in events:
            cited = [
                item
                for item in event.evidence
                if item.document_id == document.id and item.excerpt.strip() and item.page_number is not None
            ]
            if not cited:
                continue
            # Seeded records are already curated structured events. Fill only absent fields;
            # never replace their source type, depth, formation, mitigation, or evidence.
            source_text = " ".join([event.event_title, event.description, *(item.excerpt for item in cited)])
            if event.event_type == EventType.OTHER:
                detected_types = extract_event_types(source_text)
                if detected_types:
                    event.event_type = detected_types[0]
            if event.measured_depth is None and event.true_vertical_depth is None:
                depths = extract_depths(source_text)
                event.measured_depth = depths.measured_depth
                event.true_vertical_depth = depths.true_vertical_depth
            if event.formation is None:
                formations = list(db.scalars(select(Formation)).all())
                event.formation = extract_formation(source_text, formations)
            if event.event_date is None:
                event.event_date = extract_date(source_text)
            if event.consequence is None:
                event.consequence = _extract_seeded_label(source_text, "consequence")
            if event.mitigation is None:
                event.mitigation = _extract_seeded_label(source_text, "mitigation")
            supported.append(event)
        document.processing_status = ProcessingStatus.PROCESSED
        document.page_count = max(
            [document.page_count or 0, *(item.page_number or 0 for event in supported for item in event.evidence)]
        )
        db.commit()
        return ProcessingResult(
            events=supported,
            processing_mode="seeded_demo_evidence",
            page_count=document.page_count or 0,
            ocr_pages=0,
            message=(
                "Existing synthetic source excerpts were normalized in place; source document, page, excerpt, "
                "well, and structured event fields were preserved."
            ),
        )
    except Exception as exc:
        _mark_failed(db, document.id)
        logger.exception("Seeded evidence processing failed for document %s", document.id)
        raise DocumentProcessingError("Seeded evidence could not be normalized.") from exc


def _extract_seeded_label(text: str, label: str) -> Optional[str]:
    import re

    match = re.search(r"(?i)\b" + re.escape(label) + r"\s*:\s*([^.;]+)", text)
    return normalize_text(match.group(1)).strip() if match else None


def _process_uploaded_document(db: Session, document: Document) -> ProcessingResult:
    document.processing_status = ProcessingStatus.PROCESSING
    db.commit()
    try:
        root = Path(settings.upload_dir).expanduser().resolve()
        if not document.storage_path:
            raise DocumentExtractionError("The uploaded file is unavailable.")
        stored_path = (root / document.storage_path).resolve()
        if not stored_path.is_relative_to(root) or not stored_path.is_file():
            raise DocumentExtractionError("The uploaded file is unavailable in local storage.")
        content = stored_path.read_bytes()
        if len(content) > MAX_UPLOAD_BYTES:
            raise DocumentExtractionError("The uploaded file exceeds the 20 MiB limit.")
        pages = extract_pages(document.filename, content)
        all_text = "\n".join(page.text for page in pages)
        well = db.get(Well, document.well_id)
        if well is None:
            raise DocumentExtractionError("The linked well no longer exists.")
        known_wells = list(db.scalars(select(Well)).all())
        detected_well = extract_well_name(all_text, (item.well_name for item in known_wells))
        if detected_well and detected_well.casefold() != well.well_name.casefold():
            raise DocumentExtractionError(
                f"The report identifies {detected_well}, but this upload is linked to {well.well_name}."
            )

        formations = list(db.scalars(select(Formation).order_by(Formation.normalized_name)).all())
        candidates = extract_event_candidates(pages, formations, document_date=extract_date(all_text))
        candidates = [candidate for candidate in candidates if candidate.evidence_excerpt.strip()]
        extracted_relative = Path("extracted") / f"{document.id}.txt"
        extracted_path = root / extracted_relative
        extracted_path.parent.mkdir(parents=True, exist_ok=True)
        extracted_path.write_text("\n\f\n".join(page.text for page in pages), encoding="utf-8")

        for candidate in candidates:
            event_id = _stable_extracted_id(document.id, candidate)
            db.merge(
                WellEvent(
                    id=event_id,
                    well_id=well.id,
                    event_type=candidate.event_type,
                    event_title=candidate.title,
                    description=candidate.description,
                    measured_depth=candidate.measured_depth,
                    true_vertical_depth=candidate.true_vertical_depth,
                    formation_id=candidate.formation_id,
                    event_date=candidate.event_date,
                    consequence=candidate.consequence,
                    mitigation=candidate.mitigation,
                    severity_label=SeverityLabel.UNKNOWN,
                    source_document_id=document.id,
                    source_page=candidate.page_number,
                    confidence=candidate.confidence,
                )
            )
            evidence_id = str(uuid5(NAMESPACE_URL, f"anubhav-evidence:{event_id}:{candidate.page_number}"))
            db.merge(
                EventEvidence(
                    id=evidence_id,
                    event_id=event_id,
                    document_id=document.id,
                    page_number=candidate.page_number,
                    excerpt=candidate.evidence_excerpt,
                    extraction_method=ExtractionMethod.RULE_BASED,
                    confidence=candidate.confidence,
                )
            )

        document.page_count = len(pages)
        document.extracted_text_path = extracted_relative.as_posix()
        document.processing_status = ProcessingStatus.PROCESSED
        db.commit()
        event_rows = list(
            db.scalars(
                select(WellEvent)
                .where(WellEvent.source_document_id == document.id)
                .options(*_event_loads())
                .order_by(WellEvent.source_page, WellEvent.measured_depth, WellEvent.id)
            ).all()
        )
        return ProcessingResult(
            events=event_rows,
            processing_mode="uploaded_document",
            page_count=len(pages),
            ocr_pages=sum(1 for page in pages if page.used_ocr),
            message=f"Extracted {len(candidates)} evidence-backed event(s) from the uploaded source.",
        )
    except Exception as exc:
        _mark_failed(db, document.id)
        logger.exception("Uploaded document processing failed for document %s", document.id)
        if isinstance(exc, DocumentExtractionError):
            raise DocumentProcessingError(str(exc)) from exc
        raise DocumentProcessingError("Document processing failed; the source is marked FAILED.") from exc


def _stable_extracted_id(document_id: str, candidate: EventCandidate) -> str:
    key = (
        f"{document_id}:{candidate.page_number}:{candidate.event_type.value}:"
        f"{candidate.occurrence_index}:{candidate.evidence_excerpt}"
    )
    return str(uuid5(NAMESPACE_URL, f"anubhav-extracted-event:{key}"))


def _mark_failed(db: Session, document_id: str) -> None:
    db.rollback()
    document = db.get(Document, document_id)
    if document is not None:
        document.processing_status = ProcessingStatus.FAILED
        db.commit()
