"""Offset relevance and historical correlation endpoints."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.intelligence_service import (
    IntelligenceInputError,
    correlate_offsets,
    correlation_response,
    dashboard_response,
    offsets_response,
)
from app.schemas import CorrelationRead, DashboardSignalsRead, OffsetWellsRead

router = APIRouter(prefix="/api/intelligence", tags=["offset intelligence"])


def _compute(
    active_well_id: UUID,
    radius_km: Optional[float],
    depth_window_m: Optional[float],
    active_depth_m: Optional[float],
    active_formation: Optional[str],
    event_family: Optional[str],
    limit: int,
    db: Session,
):
    try:
        return correlate_offsets(
            db,
            str(active_well_id),
            radius_km=radius_km,
            depth_window_m=depth_window_m,
            active_depth_m=active_depth_m,
            active_formation=active_formation,
            event_family=event_family,
            limit=limit,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IntelligenceInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _query(
    active_well_id: UUID,
    radius_km: Optional[float],
    depth_window_m: Optional[float],
    active_depth_m: Optional[float],
    active_formation: Optional[str],
    event_family: Optional[str],
    limit: int,
    db: Session,
):
    return _compute(
        active_well_id,
        radius_km,
        depth_window_m,
        active_depth_m,
        active_formation,
        event_family,
        limit,
        db,
    )


@router.get("/{active_well_id}/offsets", response_model=OffsetWellsRead)
def get_offset_intelligence(
    active_well_id: UUID,
    radius_km: Optional[float] = Query(default=None, gt=0, le=50),
    depth_window_m: Optional[float] = Query(default=None, gt=0, le=1000),
    active_depth_m: Optional[float] = Query(default=None, ge=0),
    active_formation: Optional[str] = Query(default=None, min_length=1, max_length=120),
    event_family: Optional[str] = Query(default=None, min_length=1, max_length=40),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> OffsetWellsRead:
    """Group evidence-backed historical matches by offset well."""
    result = _query(
        active_well_id, radius_km, depth_window_m, active_depth_m, active_formation, event_family, limit, db
    )
    return offsets_response(result)


@router.get("/{active_well_id}/correlation", response_model=CorrelationRead)
def get_depth_correlation(
    active_well_id: UUID,
    radius_km: Optional[float] = Query(default=None, gt=0, le=50),
    depth_window_m: Optional[float] = Query(default=None, gt=0, le=1000),
    active_depth_m: Optional[float] = Query(default=None, ge=0),
    active_formation: Optional[str] = Query(default=None, min_length=1, max_length=120),
    event_family: Optional[str] = Query(default=None, min_length=1, max_length=40),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> CorrelationRead:
    """Return depth-correlated events, offsets, provenance, and component scores."""
    result = _query(
        active_well_id, radius_km, depth_window_m, active_depth_m, active_formation, event_family, limit, db
    )
    return correlation_response(result)


@router.get("/{active_well_id}/signals", response_model=DashboardSignalsRead)
def get_dashboard_signals(
    active_well_id: UUID,
    radius_km: Optional[float] = Query(default=None, gt=0, le=50),
    depth_window_m: Optional[float] = Query(default=None, gt=0, le=1000),
    active_depth_m: Optional[float] = Query(default=None, ge=0),
    active_formation: Optional[str] = Query(default=None, min_length=1, max_length=120),
    event_family: Optional[str] = Query(default=None, min_length=1, max_length=40),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> DashboardSignalsRead:
    """Dashboard summary of medium/high historical relevance signals."""
    result = _query(
        active_well_id, radius_km, depth_window_m, active_depth_m, active_formation, event_family, limit, db
    )
    return dashboard_response(result)
