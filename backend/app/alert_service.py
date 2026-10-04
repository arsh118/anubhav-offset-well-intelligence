"""Create and refresh persistent, evidence-backed historical precedent alerts."""

from typing import Optional
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.intelligence_service import correlate_offsets
from app.models import Alert, AlertStatus, AlertType, EventEvidence, Well, WellEvent, WellFormationInterval, WellRole
from app.schemas import ActiveAlertsRead, AlertCategory, AlertDetailRead, EvidenceBackedRecommendation


def _category(score: float) -> AlertCategory:
    if score >= settings.offset_high_relevance_min_score:
        return AlertCategory.HIGH_HISTORICAL_RELEVANCE
    return AlertCategory.MEDIUM_HISTORICAL_RELEVANCE


def _category_title(category: AlertCategory) -> str:
    return {
        AlertCategory.HIGH_HISTORICAL_RELEVANCE: "HIGH HISTORICAL RELEVANCE",
        AlertCategory.MEDIUM_HISTORICAL_RELEVANCE: "MEDIUM HISTORICAL RELEVANCE",
        AlertCategory.NO_SIGNIFICANT_PRECEDENT: "NO SIGNIFICANT PRECEDENT",
    }[category]


def _summary(matches) -> str:
    differences = sorted(round(match.depth_difference_m) for match in matches)
    if differences[0] == differences[-1]:
        depth_phrase = f"{differences[0]} m ahead"
    else:
        depth_phrase = f"{differences[0]}–{differences[-1]} m ahead"
    if all(match.formation_match == "exact" for match in matches):
        formation_phrase = "in the same formation"
    else:
        formation_phrase = "in the same or alias-matched formation"
    quantity = "{} relevant historical event{} {} recorded".format(
        len(matches), "s" if len(matches) != 1 else "", "were" if len(matches) != 1 else "was"
    )
    return f"{quantity} {depth_phrase} of the current depth {formation_phrase}."


def _no_match_summary(radius_km: float, depth_window_m: float, formation: Optional[str]) -> str:
    formation_phrase = f" in {formation}" if formation else ""
    return (
        "No significant historical precedent was found within "
        f"{radius_km:.1f} km and the next {depth_window_m:.0f} m{formation_phrase}; "
        "this reflects the available historical records only."
    )


def generate_active_alerts(
    db: Session,
    active_well_id: str,
    *,
    radius_km: Optional[float] = None,
    depth_window_m: Optional[float] = None,
    active_depth_m: Optional[float] = None,
    active_formation: Optional[str] = None,
) -> ActiveAlertsRead:
    """Refresh matching Alert rows from live correlations and return their evidence."""
    result = correlate_offsets(
        db,
        active_well_id,
        radius_km=radius_km,
        depth_window_m=depth_window_m,
        active_depth_m=active_depth_m,
        active_formation=active_formation,
        limit=500,
    )
    active_orm_well = db.get(Well, active_well_id)
    if active_orm_well is None:
        raise LookupError("Active well not found")
    if active_orm_well.role != WellRole.ACTIVE:
        raise ValueError("Historical precedent alerts require a well with active role.")

    threshold = settings.offset_medium_relevance_min_score
    future_matches = [
        match
        for match in result.matches
        if match.depth_difference_m > 0
        and match.formation_match in {"exact", "alias"}
        and match.relevance_score_normalized >= threshold
    ]
    future_matches.sort(key=lambda match: (-match.relevance_score, match.depth_difference_m, match.distance_km))

    existing_by_event = {}
    event_ids = [str(match.event_id) for match in future_matches]
    if event_ids:
        existing = db.scalars(
            select(Alert).where(
                Alert.active_well_id == active_well_id,
                Alert.historical_event_id.in_(event_ids),
            )
        ).all()
        existing_by_event = {alert.historical_event_id: alert for alert in existing}

    for match in future_matches:
        stored = existing_by_event.get(str(match.event_id))
        item_category = _category(match.relevance_score_normalized)
        title = f"Historical Precedent Alert — {_category_title(item_category)} — {match.event_title}"
        fields = {
            "alert_type": AlertType.HISTORICAL_PRECEDENT,
            "alert_title": title[:200],
            "relevance_score": match.relevance_score,
            "explanation": match.explanation,
            "distance_km": match.distance_km,
            "depth_difference_m": match.depth_difference_m,
            "formation_match": True,
        }
        if stored is None:
            stored = Alert(
                id=str(uuid5(NAMESPACE_URL, f"anubhav:alert:{active_well_id}:{match.event_id}")),
                active_well_id=active_well_id,
                historical_event_id=str(match.event_id),
                status=AlertStatus.OPEN,
                **fields
            )
            db.add(stored)
            existing_by_event[str(match.event_id)] = stored
        else:
            for name, value in fields.items():
                setattr(stored, name, value)

    if future_matches:
        db.commit()
        alert_rows = db.scalars(
            select(Alert)
            .where(
                Alert.active_well_id == active_well_id,
                Alert.historical_event_id.in_(event_ids),
            )
            .order_by(Alert.relevance_score.desc(), Alert.created_at, Alert.id)
            .options(
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
        ).all()
    else:
        alert_rows = []

    if future_matches:
        overall = (
            AlertCategory.HIGH_HISTORICAL_RELEVANCE
            if any(
                match.relevance_score_normalized >= settings.offset_high_relevance_min_score
                for match in future_matches
            )
            else AlertCategory.MEDIUM_HISTORICAL_RELEVANCE
        )
        title = _category_title(overall)
        summary = _summary(future_matches)
    else:
        overall = AlertCategory.NO_SIGNIFICANT_PRECEDENT
        title = _category_title(overall)
        summary = _no_match_summary(result.radius_km, result.depth_window_m, result.active_well.active_formation)

    recommendation_match = next(
        (match for match in future_matches if match.mitigation and match.evidence_excerpt.strip()),
        None,
    )
    recommendation = None
    if recommendation_match is not None:
        formation_name = (
            recommendation_match.formation.name
            if recommendation_match.formation
            else "the recorded interval"
        )
        recommendation = EvidenceBackedRecommendation(
            message=(
                "Comparable historical wells contain documented mitigation. Review the recorded mitigation "
                "and current drilling conditions before proceeding."
            ),
            reason=(
                f"A source-linked {recommendation_match.event_type.value.replace('_', ' ')} event "
                "was recorded "
                f"{recommendation_match.absolute_depth_difference_m:.0f} m ahead in {formation_name}, "
                f"{recommendation_match.distance_km:.1f} km away."
            ),
            source_event_id=recommendation_match.event_id,
            source_event_title=recommendation_match.event_title,
            source_well_name=recommendation_match.offset_well.well_name,
            source_document=recommendation_match.source_document.filename,
            source_page=recommendation_match.source_page,
            evidence_excerpt=recommendation_match.evidence_excerpt,
            recorded_mitigation=recommendation_match.mitigation or "",
        )

    return ActiveAlertsRead(
        active_well=result.active_well,
        category=overall,
        title=title,
        summary=summary,
        radius_km=result.radius_km,
        future_depth_window_m=result.depth_window_m,
        relevance_threshold=round(threshold * 100, 2),
        matching_event_count=len(future_matches),
        alerts=[AlertDetailRead.model_validate(row) for row in alert_rows],
        recommendation=recommendation,
    )
