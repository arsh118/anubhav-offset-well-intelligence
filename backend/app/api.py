"""Read-only API routes for wells, events, alerts, documents, and search."""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Select, String, and_, cast, func, or_, select
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.database import get_db
from app.geo import coordinate_bounds_within_radius, haversine_distance_km
from app.models import (
    Alert,
    Document,
    EventEvidence,
    EventType,
    Formation,
    ProcessingStatus,
    Well,
    WellEvent,
    WellFormationInterval,
    WellRole,
    WellStatus,
)
from app.schemas import (
    AlertDetailRead,
    AlertRead,
    DocumentRead,
    EventCountRead,
    FormationRead,
    NearbyWellItem,
    NearbyWellsRead,
    WellEventRead,
    WellRead,
)

router = APIRouter(prefix="/api")
WELL_LOADS = (
    selectinload(Well.current_formation),
    selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation),
)
EVENT_LOADS = (
    selectinload(WellEvent.well),
    selectinload(WellEvent.formation),
    selectinload(WellEvent.source_document),
    selectinload(WellEvent.evidence).selectinload(EventEvidence.document),
)


def _event_query() -> Select:
    return select(WellEvent).options(*EVENT_LOADS)


def _knowledge_text_clause(pattern: str) -> ColumnElement[bool]:
    """Match a term against the structured fields shown by the knowledge repository."""
    return or_(
        WellEvent.event_title.ilike(pattern),
        WellEvent.description.ilike(pattern),
        WellEvent.consequence.ilike(pattern),
        WellEvent.mitigation.ilike(pattern),
        cast(WellEvent.event_type, String).ilike(pattern),
        cast(WellEvent.measured_depth, String).ilike(pattern),
        cast(WellEvent.source_page, String).ilike(pattern),
        WellEvent.well.has(Well.well_name.ilike(pattern)),
        WellEvent.formation.has(
            or_(
                Formation.name.ilike(pattern),
                Formation.normalized_name.ilike(pattern),
                cast(Formation.aliases, String).ilike(pattern),
            )
        ),
        WellEvent.source_document.has(
            or_(Document.filename.ilike(pattern), Document.source.ilike(pattern))
        ),
        WellEvent.evidence.any(
            or_(
                EventEvidence.excerpt.ilike(pattern),
                cast(EventEvidence.page_number, String).ilike(pattern),
                EventEvidence.document.has(
                    or_(Document.filename.ilike(pattern), Document.source.ilike(pattern))
                ),
            )
        ),
    )


def _knowledge_search_terms(query: str) -> List[str]:
    tokens = query.casefold().replace("_", " ").replace("-", " ").split()
    stop_words = {"a", "an", "and", "at", "during", "in", "near", "of", "the", "to"}
    return [token for token in tokens if token not in stop_words]


def _search_term_variants(token: str) -> List[str]:
    variants = {token}
    if len(token) > 4 and token.endswith("ies"):
        variants.add(token[:-3] + "y")
    elif len(token) > 4 and token.endswith("es"):
        variants.add(token[:-2])
    elif len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        variants.add(token[:-1])
    return sorted(variants)


def _formation_clause(formation: str):
    normalized = formation.strip().casefold()
    alias_fragment = "%" + formation.strip() + "%"
    return or_(
        Formation.normalized_name == normalized,
        Formation.name.ilike(formation.strip()),
        cast(Formation.aliases, String).ilike(alias_fragment),
    )


def _get_well(db: Session, well_id: UUID) -> Well:
    well = db.scalar(select(Well).where(Well.id == str(well_id)).options(*WELL_LOADS))
    if well is None:
        raise HTTPException(status_code=404, detail="Well not found")
    return well


@router.get("/health", tags=["system"])
def health(db: Session = Depends(get_db)) -> dict:
    """Return API and database readiness."""
    try:
        db.execute(select(1))
    except Exception as exc:  # database drivers raise different operational exception classes
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ok", "database": "connected"}


@router.get("/wells", response_model=List[WellRead], tags=["wells"])
def list_wells(
    role: Optional[WellRole] = None,
    status: Optional[WellStatus] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> List[Well]:
    statement = select(Well).options(*WELL_LOADS)
    if role is not None:
        statement = statement.where(Well.role == role)
    if status is not None:
        statement = statement.where(Well.status == status)
    statement = statement.order_by(Well.well_name).limit(limit).offset(offset)
    return list(db.scalars(statement).all())


@router.get("/wells/{well_id}", response_model=WellRead, tags=["wells"])
def get_well(well_id: UUID, db: Session = Depends(get_db)) -> Well:
    return _get_well(db, well_id)


@router.get("/wells/{well_id}/nearby", response_model=NearbyWellsRead, tags=["wells"])
def nearby_wells(
    well_id: UUID,
    radius_km: float = Query(default=100.0, gt=0, le=1000),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> NearbyWellsRead:
    active = _get_well(db, well_id)
    if active.latitude is None or active.longitude is None:
        return NearbyWellsRead(
            active_well_id=well_id,
            radius_km=radius_km,
            message="Active well coordinates are unavailable; nearby comparison was not computed.",
            items=[],
        )

    active_lat, active_lon = float(active.latitude), float(active.longitude)
    min_latitude, max_latitude, longitude_ranges = coordinate_bounds_within_radius(
        active_lat, active_lon, radius_km
    )
    candidate_query = select(Well).where(
        Well.role == WellRole.OFFSET,
        Well.id != str(well_id),
        Well.latitude >= min_latitude,
        Well.latitude <= max_latitude,
    )
    if longitude_ranges != [(-180.0, 180.0)]:
        longitude_conditions = [
            Well.longitude.between(min_longitude, max_longitude)
            for min_longitude, max_longitude in longitude_ranges
        ]
        candidate_query = candidate_query.where(or_(*longitude_conditions))
    candidates = db.scalars(candidate_query.options(*WELL_LOADS)).all()
    active_formations = {row.formation.normalized_name for row in active.formation_intervals}
    items = []
    for candidate in candidates:
        if candidate.latitude is None or candidate.longitude is None:
            continue
        distance = haversine_distance_km(
            active_lat,
            active_lon,
            float(candidate.latitude),
            float(candidate.longitude),
        )
        if distance <= radius_km:
            candidate_formations = {row.formation.normalized_name for row in candidate.formation_intervals}
            formation_match = (
                bool(active_formations.intersection(candidate_formations))
                if active_formations and candidate_formations
                else None
            )
            items.append(
                NearbyWellItem(
                    well=WellRead.model_validate(candidate),
                    distance_km=round(distance, 2),
                    formation_match=formation_match,
                )
            )
    items.sort(key=lambda item: item.distance_km)
    return NearbyWellsRead(
        active_well_id=well_id,
        radius_km=radius_km,
        items=items[:limit],
    )


@router.get("/wells/{well_id}/events", response_model=List[WellEventRead], tags=["events"])
def list_well_events(
    well_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> List[WellEvent]:
    _get_well(db, well_id)
    statement = (
        _event_query()
        .where(WellEvent.well_id == str(well_id))
        .order_by(WellEvent.measured_depth, WellEvent.event_date.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(statement).all())


@router.get("/events", response_model=List[WellEventRead], tags=["events"])
def list_events(
    well_id: Optional[UUID] = None,
    formation: Optional[str] = Query(default=None, min_length=1, max_length=120),
    event_type: Optional[EventType] = None,
    depth_min: Optional[float] = Query(default=None, ge=0),
    depth_max: Optional[float] = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> List[WellEvent]:
    if depth_min is not None and depth_max is not None and depth_min > depth_max:
        raise HTTPException(status_code=422, detail="depth_min must be less than or equal to depth_max")
    statement = _event_query()
    if well_id is not None:
        statement = statement.where(WellEvent.well_id == str(well_id))
    if formation:
        statement = statement.join(WellEvent.formation).where(_formation_clause(formation))
    if event_type is not None:
        statement = statement.where(WellEvent.event_type == event_type)
    if depth_min is not None:
        statement = statement.where(WellEvent.measured_depth >= depth_min)
    if depth_max is not None:
        statement = statement.where(WellEvent.measured_depth <= depth_max)
    statement = statement.order_by(WellEvent.event_date.desc(), WellEvent.event_title).limit(limit).offset(offset)
    return list(db.scalars(statement).all())


@router.get("/events/summary", response_model=EventCountRead, tags=["events"])
def event_summary(db: Session = Depends(get_db)) -> EventCountRead:
    """Return event totals without transferring complete event/evidence records."""
    return EventCountRead(total=db.scalar(select(func.count()).select_from(WellEvent)) or 0)


@router.get("/alerts", response_model=List[AlertRead], tags=["alerts"])
def list_alerts(
    active_well_id: Optional[UUID] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> List[Alert]:
    statement = select(Alert).order_by(Alert.created_at.desc(), Alert.id)
    if active_well_id is not None:
        statement = statement.where(Alert.active_well_id == str(active_well_id))
    return list(db.scalars(statement.limit(limit).offset(offset)).all())


@router.get("/alerts/{alert_id}", response_model=AlertDetailRead, tags=["alerts"])
def get_alert(alert_id: UUID, db: Session = Depends(get_db)) -> Alert:
    statement = (
        select(Alert)
        .where(Alert.id == str(alert_id))
        .options(
            selectinload(Alert.active_well).options(*WELL_LOADS),
            selectinload(Alert.historical_event).options(*EVENT_LOADS),
            selectinload(Alert.notes),
        )
    )
    alert = db.scalar(statement)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/formations", response_model=List[FormationRead], tags=["formations"])
def list_formations(db: Session = Depends(get_db)) -> List[Formation]:
    return list(db.scalars(select(Formation).order_by(Formation.normalized_name)).all())


@router.get("/documents", response_model=List[DocumentRead], tags=["documents"])
def list_documents(
    well_id: Optional[UUID] = None,
    processing_status: Optional[ProcessingStatus] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> List[Document]:
    statement = select(Document).order_by(Document.uploaded_at.desc(), Document.filename)
    if well_id is not None:
        statement = statement.where(Document.well_id == str(well_id))
    if processing_status is not None:
        statement = statement.where(Document.processing_status == processing_status)
    return list(db.scalars(statement.limit(limit).offset(offset)).all())


@router.get("/knowledge/search", response_model=List[WellEventRead], tags=["knowledge"])
def search_knowledge(
    q: str = Query(min_length=2, max_length=200),
    formation: Optional[str] = Query(default=None, min_length=1, max_length=120),
    event_type: Optional[EventType] = None,
    depth_min: Optional[float] = Query(default=None, ge=0),
    depth_max: Optional[float] = Query(default=None, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> List[WellEvent]:
    if depth_min is not None and depth_max is not None and depth_min > depth_max:
        raise HTTPException(status_code=422, detail="depth_min must be less than or equal to depth_max")
    normalized_query = q.strip()
    if len(normalized_query) < 2:
        raise HTTPException(
            status_code=422,
            detail="q must contain at least two non-space characters",
        )
    phrase_pattern = "%" + normalized_query + "%"
    terms = _knowledge_search_terms(normalized_query)
    token_matches = [
        or_(*[_knowledge_text_clause("%" + variant + "%") for variant in _search_term_variants(token)])
        for token in terms
    ]
    token_clause = and_(*token_matches) if token_matches else _knowledge_text_clause(phrase_pattern)
    statement = _event_query().where(
        or_(
            _knowledge_text_clause(phrase_pattern),
            token_clause,
        ),
        WellEvent.evidence.any(
            and_(
                EventEvidence.document_id == WellEvent.source_document_id,
                func.trim(EventEvidence.excerpt) != "",
            )
        ),
    )
    if formation:
        statement = statement.join(WellEvent.formation).where(_formation_clause(formation))
    if event_type is not None:
        statement = statement.where(WellEvent.event_type == event_type)
    if depth_min is not None:
        statement = statement.where(WellEvent.measured_depth >= depth_min)
    if depth_max is not None:
        statement = statement.where(WellEvent.measured_depth <= depth_max)
    statement = statement.order_by(WellEvent.event_date.desc(), WellEvent.event_title).limit(limit)
    return list(db.scalars(statement).all())
