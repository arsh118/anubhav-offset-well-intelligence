"""Document upload, extraction, evidence, and processing routes."""

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.document_pipeline import MAX_UPLOAD_BYTES, DocumentExtractionError
from app.document_service import DocumentProcessingError, create_uploaded_document, process_document
from app.models import (
    Document,
    DocumentType,
    EventEvidence,
    ProcessingStatus,
    WellEvent,
)
from app.schemas import (
    DocumentProcessRead,
    DocumentRead,
    EvidenceRead,
    WellEventRead,
)

router = APIRouter(prefix="/api")


@router.post("/documents/ingest", response_model=DocumentRead, status_code=status.HTTP_201_CREATED, tags=["documents"])
async def ingest_document(
    well_id: UUID = Form(...),
    document_type: DocumentType = Form(default=DocumentType.OTHER),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Document:
    filename = file.filename or ""
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The uploaded file exceeds the 20 MiB limit.")
    try:
        return create_uploaded_document(
            db,
            str(well_id),
            filename,
            file.content_type,
            content,
            document_type,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DocumentExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/documents/{document_id}/process", response_model=DocumentProcessRead, tags=["documents"])
def process_document_route(document_id: UUID, db: Session = Depends(get_db)) -> DocumentProcessRead:
    document = db.get(Document, str(document_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.processing_status == ProcessingStatus.PROCESSING:
        raise HTTPException(status_code=409, detail="This document is already being processed.")
    try:
        result = process_document(db, document)
    except DocumentProcessingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.refresh(document)
    return DocumentProcessRead(
        document=DocumentRead.model_validate(document),
        events=[WellEventRead.model_validate(event) for event in result.events],
        processing_mode=result.processing_mode,
        extracted_pages=result.page_count,
        ocr_pages=result.ocr_pages,
        message=result.message,
    )


@router.get("/documents/{document_id}", response_model=DocumentRead, tags=["documents"])
def get_document(document_id: UUID, db: Session = Depends(get_db)) -> Document:
    document = db.get(Document, str(document_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.get("/documents/{document_id}/events", response_model=List[WellEventRead], tags=["documents"])
def list_document_events(
    document_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> List[WellEvent]:
    if db.get(Document, str(document_id)) is None:
        raise HTTPException(status_code=404, detail="Document not found")
    statement = (
        select(WellEvent)
        .where(WellEvent.source_document_id == str(document_id))
        .options(
            selectinload(WellEvent.well),
            selectinload(WellEvent.formation),
            selectinload(WellEvent.source_document),
            selectinload(WellEvent.evidence).selectinload(EventEvidence.document),
        )
        .order_by(WellEvent.source_page, WellEvent.measured_depth, WellEvent.id)
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(statement).all())


@router.get("/events/{event_id}/evidence", response_model=List[EvidenceRead], tags=["events"])
def list_event_evidence(event_id: UUID, db: Session = Depends(get_db)) -> List[EventEvidence]:
    if db.get(WellEvent, str(event_id)) is None:
        raise HTTPException(status_code=404, detail="Event not found")
    statement = (
        select(EventEvidence)
        .where(EventEvidence.event_id == str(event_id))
        .options(selectinload(EventEvidence.document))
        .order_by(EventEvidence.page_number, EventEvidence.id)
    )
    return list(db.scalars(statement).all())
