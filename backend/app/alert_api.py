"""Proactive historical alert generation and engineer review workflow."""

from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.alert_service import generate_active_alerts
from app.database import get_db
from app.intelligence_service import IntelligenceInputError
from app.models import (
    Alert,
    AlertNote,
    AlertStatus,
    EventEvidence,
    Well,
    WellEvent,
    WellFormationInterval,
)
from app.schemas import (
    ActiveAlertsRead,
    AlertDetailRead,
    AlertNoteCreate,
    AlertNoteRead,
    AlertPatch,
)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

ALERT_DETAIL_OPTIONS = (
    selectinload(Alert.active_well).options(
        selectinload(Well.current_formation),
        selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation),
    ),
    selectinload(Alert.historical_event).options(
        selectinload(WellEvent.well),
        selectinload(WellEvent.formation),
        selectinload(WellEvent.source_document),
        selectinload(WellEvent.evidence).selectinload(EventEvidence.document),
    ),
    selectinload(Alert.notes),
)

ALLOWED_TRANSITIONS = {
    AlertStatus.OPEN: {AlertStatus.ACKNOWLEDGED, AlertStatus.REVIEWED, AlertStatus.DISMISSED},
    AlertStatus.ACKNOWLEDGED: {AlertStatus.REVIEWED, AlertStatus.DISMISSED},
    AlertStatus.REVIEWED: {AlertStatus.DISMISSED},
    AlertStatus.DISMISSED: set(),
}


def _get_alert(db: Session, alert_id: UUID) -> Alert:
    alert = db.scalar(
        select(Alert).where(Alert.id == str(alert_id)).options(*ALERT_DETAIL_OPTIONS)
    )
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


def _set_status(db: Session, alert: Alert, target: AlertStatus) -> AlertDetailRead:
    if target != alert.status and target not in ALLOWED_TRANSITIONS[alert.status]:
        raise HTTPException(
            status_code=409,
            detail=f"Alert status cannot transition from {alert.status.value} to {target.value}.",
        )
    alert.status = target
    db.commit()
    return AlertDetailRead.model_validate(_get_alert(db, UUID(alert.id)))


@router.get("/active/{well_id}", response_model=ActiveAlertsRead)
def get_active_well_alerts(
    well_id: UUID,
    radius_km: Optional[float] = Query(default=None, gt=0, le=50),
    depth_window_m: Optional[float] = Query(default=None, gt=0, le=1000),
    active_depth_m: Optional[float] = Query(default=None, ge=0),
    active_formation: Optional[str] = Query(default=None, min_length=1, max_length=120),
    db: Session = Depends(get_db),
) -> ActiveAlertsRead:
    """Generate and return evidence-backed alerts for a current active well context."""
    try:
        return generate_active_alerts(
            db,
            str(well_id),
            radius_km=radius_km,
            depth_window_m=depth_window_m,
            active_depth_m=active_depth_m,
            active_formation=active_formation,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (IntelligenceInputError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/{alert_id}", response_model=AlertDetailRead)
def patch_alert(
    alert_id: UUID,
    payload: AlertPatch,
    db: Session = Depends(get_db),
) -> AlertDetailRead:
    """Move an alert through the allowed review states."""
    if payload.status is None:
        raise HTTPException(status_code=422, detail="status is required")
    alert = _get_alert(db, alert_id)
    return _set_status(db, alert, payload.status)


@router.post("/{alert_id}/acknowledge", response_model=AlertDetailRead)
def acknowledge_alert(alert_id: UUID, db: Session = Depends(get_db)) -> AlertDetailRead:
    """Acknowledge an open historical precedent alert."""
    alert = _get_alert(db, alert_id)
    return _set_status(db, alert, AlertStatus.ACKNOWLEDGED)


@router.post("/{alert_id}/notes", response_model=AlertNoteRead, status_code=201)
def add_alert_note(
    alert_id: UUID,
    payload: AlertNoteCreate,
    db: Session = Depends(get_db),
) -> AlertNoteRead:
    """Append an engineer note to an alert's review history."""
    _get_alert(db, alert_id)
    note_text = payload.note.strip()
    if not note_text:
        raise HTTPException(status_code=422, detail="note must contain a non-space character")
    author = payload.author.strip() if payload.author else None
    note = AlertNote(id=str(uuid4()), alert_id=str(alert_id), note=note_text, author=author or None)
    db.add(note)
    db.commit()
    db.refresh(note)
    return AlertNoteRead.model_validate(note)
