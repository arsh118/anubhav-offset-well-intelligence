"""Explainable, request-time correlation of active wells and sourced historical events."""

import re
from dataclasses import dataclass, field
from math import log10
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.geo import coordinate_bounds_within_radius, haversine_distance_km
from app.models import (
    DrillingMeasurement,
    EventEvidence,
    EventType,
    Formation,
    Well,
    WellEvent,
    WellFormationInterval,
    WellRole,
)
from app.schemas import (
    CorrelationRead,
    DashboardSignalsRead,
    DocumentRead,
    DrillingMeasurementRead,
    FormationRead,
    IntelligenceSummary,
    NumericParameterComparison,
    OffsetActiveWell,
    OffsetEventMatch,
    OffsetWellBrief,
    OffsetWellsRead,
    OffsetWellSummary,
    PersistedAlertReference,
    RelevanceComponent,
    RelevanceComponents,
    WellCorrelationComparison,
    WellFormationIntervalRead,
    WellRead,
)

# Heuristic families are an analysis-time grouping of the existing event taxonomy;
# they do not add or duplicate stored event categories.
EVENT_FAMILIES: Dict[str, set] = {
    "losses": {EventType.LOST_CIRCULATION, EventType.MUD_WEIGHT_ADJUSTMENT},
    "well_control": {EventType.KICK_INFLUX, EventType.OVERPRESSURE_SIGNAL, EventType.GAS_SHOW},
    "mechanical": {EventType.STUCK_PIPE, EventType.TORQUE_SPIKE, EventType.DRAG_INCREASE, EventType.FISHING_OPERATION},
    "wellbore": {EventType.WELLBORE_INSTABILITY, EventType.HOLE_CLEANING_ISSUE, EventType.STUCK_PIPE},
    "cementing": {EventType.CEMENTING_ISSUE},
    "casing": {EventType.CASING_ISSUE},
    "operations": {EventType.NPT_EVENT, EventType.EQUIPMENT_FAILURE, EventType.OTHER},
}
RELATED_FAMILIES: Dict[str, set] = {
    "losses": {"well_control"},
    "well_control": {"losses"},
    "mechanical": {"wellbore"},
    "wellbore": {"mechanical"},
    "cementing": {"casing"},
    "casing": {"cementing"},
    "operations": {"mechanical", "wellbore"},
}

WEIGHT_KEYS = {
    "formation": "offset_formation_weight",
    "depth_proximity": "offset_depth_weight",
    "spatial_proximity": "offset_spatial_weight",
    "event_similarity": "offset_event_weight",
    "source_confidence": "offset_source_confidence_weight",
}


class IntelligenceInputError(ValueError):
    """Raised when a requested formation or event family is invalid."""


@dataclass
class EngineResult:
    active_well: OffsetActiveWell
    radius_km: float
    depth_window_m: float
    event_family: Optional[str]
    heuristic_weights: Dict[str, float]
    matches: List[OffsetEventMatch]
    message: Optional[str]
    active_record: Optional[Well] = None
    candidate_offsets: List[Tuple[Well, float]] = field(default_factory=list)


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def _configured_weights() -> Dict[str, float]:
    raw = {key: float(getattr(settings, setting_name)) for key, setting_name in WEIGHT_KEYS.items()}
    total = sum(raw.values())
    if total <= 0:
        raise IntelligenceInputError("At least one offset relevance weight must be greater than zero.")
    return {key: value / total for key, value in raw.items()}


def _formation_context(
    db: Session, active_well: Well, requested: Optional[str]
) -> Tuple[Optional[Formation], Optional[str], bool]:
    """Return canonical formation, display label, and whether input used an alias."""
    if requested is None:
        formation = active_well.current_formation
        return formation, formation.name if formation else None, False

    target = _norm(requested.strip())
    if not target:
        raise IntelligenceInputError("active_formation must contain a non-space character.")
    formations = db.scalars(select(Formation).order_by(Formation.normalized_name)).all()
    for formation in formations:
        if target in {_norm(formation.normalized_name), _norm(formation.name)}:
            return formation, requested.strip(), False
        if target in {_norm(alias) for alias in (formation.aliases or [])}:
            return formation, requested.strip(), True
    # Keep an unknown user-supplied name so its component correctly scores zero.
    return None, requested.strip(), False


def _event_similarity(event_type: EventType, family: Optional[str]) -> float:
    if family is None:
        return 1.0
    target_family = family.casefold().strip()
    exact_type = next((member for member in EventType if member.value == target_family), None)
    if exact_type is not None:
        if event_type == exact_type:
            return 1.0
        families = {name for name, types in EVENT_FAMILIES.items() if exact_type in types}
        if any(event_type in EVENT_FAMILIES[name] for name in families):
            return settings.offset_related_event_score
        return 0.0

    if target_family not in EVENT_FAMILIES:
        accepted = ", ".join(sorted(list(EVENT_FAMILIES) + [item.value for item in EventType]))
        raise IntelligenceInputError("event_family must be one of: " + accepted)
    if event_type in EVENT_FAMILIES[target_family]:
        return 1.0
    event_families = {name for name, types in EVENT_FAMILIES.items() if event_type in types}
    if RELATED_FAMILIES[target_family].intersection(event_families):
        return settings.offset_related_event_score
    return 0.0


def _formation_score(
    event_formation: Optional[Formation],
    active_formation: Optional[Formation],
    active_formation_label: Optional[str],
    active_input_is_alias: bool,
) -> Tuple[float, str]:
    if event_formation is None or (active_formation is None and active_formation_label is None):
        return 0.0, "unknown"
    if active_formation is not None and event_formation.id == active_formation.id:
        if active_input_is_alias:
            return settings.offset_formation_alias_score, "alias"
        return 1.0, "exact"
    active_value = _norm(active_formation_label or "")
    event_terms = {_norm(event_formation.name), _norm(event_formation.normalized_name)}
    event_terms.update(_norm(alias) for alias in (event_formation.aliases or []))
    if active_value and active_value in event_terms:
        return settings.offset_formation_alias_score, "alias"
    return 0.0, "mismatch"


def _depth_score(depth_difference: float, depth_window: float) -> Tuple[float, str]:
    absolute_difference = abs(depth_difference)
    if absolute_difference <= settings.offset_depth_high_max_m:
        return 1.0, "high"
    if absolute_difference <= settings.offset_depth_medium_max_m:
        return 0.75, "medium"
    if absolute_difference <= settings.offset_depth_low_max_m:
        return 0.5, "low"
    if depth_window <= settings.offset_depth_low_max_m:
        return 0.0, "low"
    remaining_window = depth_window - settings.offset_depth_low_max_m
    score = 0.5 * max(0.0, (depth_window - absolute_difference) / remaining_window)
    return score, "low"


def _relevance_band(score: float) -> str:
    if score >= settings.offset_high_relevance_min_score:
        return "high"
    if score >= settings.offset_medium_relevance_min_score:
        return "medium"
    return "low"


def _explanation(
    band: str,
    difference: float,
    formation_match: str,
    distance: float,
    event_family: Optional[str],
    source_label: str,
    filename: str,
    page: Optional[int],
) -> str:
    depth_delta = round(abs(difference))
    if difference > 0:
        depth_phrase = f"{depth_delta} m ahead of the active depth"
    elif difference < 0:
        depth_phrase = f"{depth_delta} m behind the active depth"
    else:
        depth_phrase = "at the active depth"
    formation_phrase = {
        "exact": "in the same formation",
        "alias": "in a formation matched through an alias",
        "mismatch": "with a different formation",
        "unknown": "with the event formation unknown",
    }[formation_match]
    detail = (
        f"{band.capitalize()} historical relevance because the event occurred {depth_phrase}, {formation_phrase}, "
        f"and was recorded in a nearby well {distance:.1f} km away."
    )
    if event_family is not None:
        detail += f" The event similarity component compares it with the selected {event_family} family."
    source_detail = f" Source: {source_label} ({filename})"
    if page is not None:
        source_detail += f", page {page}"
    return detail + source_detail + "."


def _active_context(
    well: Well, active_depth: Optional[float], formation_label: Optional[str]
) -> OffsetActiveWell:
    return OffsetActiveWell(
        id=UUID(well.id),
        well_name=well.well_name,
        field=well.field,
        latitude=float(well.latitude) if well.latitude is not None else None,
        longitude=float(well.longitude) if well.longitude is not None else None,
        active_depth_m=active_depth,
        active_formation=formation_label,
    )


def _well_summary(
    well: Well, distance: float, matches: Sequence[OffsetEventMatch]
) -> OffsetWellSummary:
    return OffsetWellSummary(
        id=UUID(well.id),
        well_name=well.well_name,
        field=well.field,
        latitude=float(well.latitude) if well.latitude is not None else None,
        longitude=float(well.longitude) if well.longitude is not None else None,
        distance_km=round(distance, 2),
        matching_event_count=len(matches),
        best_relevance_score=max((row.relevance_score for row in matches), default=0.0),
        event_ids=[row.event_id for row in matches],
    )


def correlate_offsets(
    db: Session,
    active_well_id: str,
    *,
    radius_km: Optional[float] = None,
    depth_window_m: Optional[float] = None,
    active_depth_m: Optional[float] = None,
    active_formation: Optional[str] = None,
    event_family: Optional[str] = None,
    limit: int = 100,
) -> EngineResult:
    radius = radius_km if radius_km is not None else settings.offset_default_radius_km
    window = depth_window_m if depth_window_m is not None else settings.offset_default_depth_window_m
    if radius <= 0 or radius > 50:
        raise IntelligenceInputError("radius_km must be greater than 0 and at most 50.")
    if window <= 0 or window > 1000:
        raise IntelligenceInputError("depth_window_m must be greater than 0 and at most 1000.")
    if limit < 1 or limit > 500:
        raise IntelligenceInputError("limit must be between 1 and 500.")
    if event_family is not None and not event_family.strip():
        raise IntelligenceInputError("event_family must contain a non-space character.")
    if event_family is not None:
        event_family = event_family.strip()
    if event_family is not None:
        _event_similarity(EventType.OTHER, event_family)

    active = db.scalar(
        select(Well)
        .where(Well.id == active_well_id)
        .options(
            selectinload(Well.current_formation),
            selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation),
            selectinload(Well.drilling_measurements),
        )
    )
    if active is None:
        raise LookupError("Active well not found")

    resolved_formation, formation_label, input_is_alias = _formation_context(db, active, active_formation)
    depth = active_depth_m if active_depth_m is not None else (
        float(active.current_depth) if active.current_depth is not None else None
    )
    context = _active_context(active, depth, formation_label)
    weights = _configured_weights()
    if active.latitude is None or active.longitude is None:
        return EngineResult(
            active_well=context,
            radius_km=radius,
            depth_window_m=window,
            event_family=event_family,
            heuristic_weights=weights,
            matches=[],
            message="Active well coordinates are unavailable; offset correlation was not computed.",
            active_record=active,
        )
    if depth is None:
        return EngineResult(
            active_well=context,
            radius_km=radius,
            depth_window_m=window,
            event_family=event_family,
            heuristic_weights=weights,
            matches=[],
            message="Active well depth is unavailable; depth-aware correlation was not computed.",
            active_record=active,
        )

    active_latitude, active_longitude = float(active.latitude), float(active.longitude)
    min_latitude, max_latitude, longitude_ranges = coordinate_bounds_within_radius(
        active_latitude, active_longitude, radius
    )
    offset_query = select(Well).where(
        Well.role == WellRole.OFFSET,
        Well.id != active.id,
        Well.latitude >= min_latitude,
        Well.latitude <= max_latitude,
    )
    if longitude_ranges != [(-180.0, 180.0)]:
        offset_query = offset_query.where(
            or_(
                *[
                    Well.longitude.between(min_longitude, max_longitude)
                    for min_longitude, max_longitude in longitude_ranges
                ]
            )
        )
    offset_wells = db.scalars(
        offset_query.options(
            selectinload(Well.current_formation),
            selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation),
            selectinload(Well.drilling_measurements),
        )
    ).all()
    distances: Dict[str, float] = {}
    candidate_ids: List[str] = []
    candidate_offsets: List[Tuple[Well, float]] = []
    for offset in offset_wells:
        if offset.latitude is None or offset.longitude is None:
            continue
        distance = haversine_distance_km(
            active_latitude, active_longitude, float(offset.latitude), float(offset.longitude)
        )
        if distance <= radius:
            distances[offset.id] = distance
            candidate_ids.append(offset.id)
            candidate_offsets.append((offset, distance))
    if not candidate_ids:
        return EngineResult(
            active_well=context,
            radius_km=radius,
            depth_window_m=window,
            event_family=event_family,
            heuristic_weights=weights,
            matches=[],
            message="No offset wells were found within the requested radius.",
            active_record=active,
        )

    event_rows = db.scalars(
        select(WellEvent)
        .where(
            WellEvent.well_id.in_(candidate_ids),
            WellEvent.measured_depth.is_not(None),
            WellEvent.measured_depth >= max(0.0, depth - window),
            WellEvent.measured_depth <= depth + window,
        )
        .options(
            selectinload(WellEvent.well),
            selectinload(WellEvent.formation),
            selectinload(WellEvent.source_document),
            selectinload(WellEvent.alerts),
            selectinload(WellEvent.evidence).selectinload(EventEvidence.document),
        )
    ).all()

    matches: List[OffsetEventMatch] = []
    for event in event_rows:
        # Only evidence-backed structured events can contribute a signal.
        evidence_rows = [
            row
            for row in event.evidence
            if row.excerpt.strip()
            and row.document is not None
            and row.document_id == event.source_document_id
        ]
        if not evidence_rows:
            continue
        evidence = max(evidence_rows, key=lambda row: (float(row.confidence), bool(row.page_number)))
        distance = distances[event.well_id]
        if event.measured_depth is None:
            continue
        historical_depth = float(event.measured_depth)
        difference = historical_depth - depth
        absolute_difference = abs(difference)
        if absolute_difference > window:
            continue

        formation_score, formation_match = _formation_score(
            event.formation, resolved_formation, formation_label, input_is_alias
        )
        depth_score, depth_band = _depth_score(difference, window)
        spatial_score = max(0.0, min(1.0, 1.0 - distance / radius))
        event_score = _event_similarity(event.event_type, event_family)
        evidence_confidence = float(evidence.confidence)
        event_confidence = max(0.0, min(1.0, float(event.confidence)))
        source_confidence = (event_confidence + evidence_confidence) / 2.0
        existing_alert = next((row for row in event.alerts if row.active_well_id == active.id), None)
        components = {
            "formation": formation_score,
            "depth_proximity": depth_score,
            "spatial_proximity": spatial_score,
            "event_similarity": event_score,
            "source_confidence": source_confidence,
        }
        normalized_score = sum(components[key] * weights[key] for key in components)
        relevance_band = _relevance_band(normalized_score)
        page = event.source_page if event.source_page is not None else evidence.page_number
        document = event.source_document
        if document is None:
            continue
        provisional = OffsetEventMatch(
            event_id=UUID(event.id),
            offset_well=OffsetWellBrief(
                id=UUID(event.well.id),
                well_name=event.well.well_name,
                field=event.well.field,
                latitude=float(event.well.latitude) if event.well.latitude is not None else None,
                longitude=float(event.well.longitude) if event.well.longitude is not None else None,
            ),
            distance_km=round(distance, 2),
            historical_depth_m=historical_depth,
            active_depth_m=depth,
            depth_difference_m=round(difference, 2),
            absolute_depth_difference_m=round(absolute_difference, 2),
            depth_band=depth_band,
            formation=FormationRead.model_validate(event.formation) if event.formation else None,
            formation_match=formation_match,
            event_type=event.event_type,
            event_title=event.event_title,
            description=event.description,
            consequence=event.consequence,
            mitigation=event.mitigation,
            relevance_score=round(normalized_score * 100, 2),
            relevance_score_normalized=round(normalized_score, 4),
            relevance_band=relevance_band,
            components=RelevanceComponents(
                formation=RelevanceComponent(score=formation_score, weight=weights["formation"]),
                depth_proximity=RelevanceComponent(score=depth_score, weight=weights["depth_proximity"]),
                spatial_proximity=RelevanceComponent(score=spatial_score, weight=weights["spatial_proximity"]),
                event_similarity=RelevanceComponent(score=event_score, weight=weights["event_similarity"]),
                source_confidence=RelevanceComponent(score=source_confidence, weight=weights["source_confidence"]),
            ),
            source_document=DocumentRead.model_validate(document),
            source_page=page,
            evidence_excerpt=evidence.excerpt,
            source_confidence=round(source_confidence, 4),
            existing_alert=(
                PersistedAlertReference(id=UUID(existing_alert.id), status=existing_alert.status)
                if existing_alert is not None
                else None
            ),
            explanation="",
        )
        provisional.explanation = _explanation(
            relevance_band,
            difference,
            formation_match,
            distance,
            event_family,
            document.source_label,
            document.filename,
            page,
        )
        matches.append(provisional)

    matches.sort(
        key=lambda row: (-row.relevance_score, row.absolute_depth_difference_m, row.distance_km, row.event_id)
    )
    matches = matches[:limit]
    message = (
        None
        if matches
        else "No evidence-backed historical events matched within the requested radius and depth window."
    )
    return EngineResult(
        active_well=context,
        radius_km=radius,
        depth_window_m=window,
        event_family=event_family,
        heuristic_weights=weights,
        matches=matches,
        message=message,
        active_record=active,
        candidate_offsets=candidate_offsets,
    )


def matched_wells(result: EngineResult) -> List[OffsetWellSummary]:
    grouped: Dict[str, List[OffsetEventMatch]] = {}
    for match in result.matches:
        grouped.setdefault(str(match.offset_well.id), []).append(match)
    summaries = []
    for rows in grouped.values():
        first = rows[0]
        summaries.append(
            OffsetWellSummary(
                id=first.offset_well.id,
                well_name=first.offset_well.well_name,
                field=first.offset_well.field,
                latitude=first.offset_well.latitude,
                longitude=first.offset_well.longitude,
                distance_km=first.distance_km,
                matching_event_count=len(rows),
                best_relevance_score=max(row.relevance_score for row in rows),
                event_ids=[row.event_id for row in rows],
            )
        )
    return sorted(summaries, key=lambda item: (-item.best_relevance_score, item.distance_km, item.well_name))


def offsets_response(result: EngineResult) -> OffsetWellsRead:
    return OffsetWellsRead(
        active_well=result.active_well,
        radius_km=result.radius_km,
        depth_window_m=result.depth_window_m,
        event_family=result.event_family,
        heuristic_weights=result.heuristic_weights,
        offsets=matched_wells(result),
        total_matching_events=len(result.matches),
        message=result.message,
    )


def correlation_response(result: EngineResult) -> CorrelationRead:
    active = result.active_record
    active_depth = result.active_well.active_depth_m
    active_interval = _interval_at_depth(active, active_depth) if active is not None else None
    active_measurement = _nearest_measurement(active, active_depth) if active is not None else None
    comparisons: List[WellCorrelationComparison] = []
    for offset, distance in result.candidate_offsets:
        offset_events = [row for row in result.matches if str(row.offset_well.id) == offset.id]
        representative_event = min(
            offset_events,
            key=lambda row: (row.absolute_depth_difference_m, -row.relevance_score),
            default=None,
        )
        offset_depth = (
            representative_event.historical_depth_m
            if representative_event is not None
            else (active_depth if active_depth is not None else None)
        )
        offset_interval = _interval_at_depth(offset, offset_depth)
        if representative_event is not None and representative_event.formation is not None:
            event_interval = next(
                (
                    row
                    for row in offset.formation_intervals
                    if row.formation_id == str(representative_event.formation.id)
                ),
                None,
            )
            if event_interval is not None:
                offset_interval = event_interval
        offset_measurement = _nearest_measurement(offset, offset_depth)
        formation_match = _interval_formation_match(active_interval, offset_interval)
        comparisons.append(
            WellCorrelationComparison(
                offset_well=WellRead.model_validate(offset),
                distance_km=round(distance, 2),
                depth_alignment_m=(
                    round(offset_depth - active_depth, 2)
                    if offset_depth is not None and active_depth is not None
                    else None
                ),
                formation_match=formation_match,
                active_formation_interval=(
                    WellFormationIntervalRead.model_validate(active_interval) if active_interval else None
                ),
                offset_formation_interval=(
                    WellFormationIntervalRead.model_validate(offset_interval) if offset_interval else None
                ),
                geological_similarity=_geological_similarity(active_interval, offset_interval),
                reservoir_similarity=_reservoir_similarity(active_interval, offset_interval),
                active_drilling_parameters=(
                    DrillingMeasurementRead.model_validate(active_measurement) if active_measurement else None
                ),
                offset_drilling_parameters=(
                    DrillingMeasurementRead.model_validate(offset_measurement) if offset_measurement else None
                ),
                drilling_parameter_comparison=_parameter_differences(active_measurement, offset_measurement),
                historical_events=offset_events,
                comparison_reasons=_comparison_reasons(
                    distance,
                    formation_match,
                    active_interval,
                    offset_interval,
                    representative_event,
                    active_measurement,
                    offset_measurement,
                ),
                source_label=offset.source,
            )
        )
    comparisons.sort(key=lambda row: (row.distance_km, row.offset_well.well_name))
    return CorrelationRead(
        active_well=result.active_well,
        radius_km=result.radius_km,
        depth_window_m=result.depth_window_m,
        event_family=result.event_family,
        heuristic_weights=result.heuristic_weights,
        matched_wells=matched_wells(result),
        historical_events=result.matches,
        total_matching_events=len(result.matches),
        active_formation_interval=(
            WellFormationIntervalRead.model_validate(active_interval) if active_interval else None
        ),
        active_drilling_parameters=(
            DrillingMeasurementRead.model_validate(active_measurement) if active_measurement else None
        ),
        comparable_wells=comparisons,
        message=result.message,
    )


def _interval_at_depth(well: Optional[Well], depth: Optional[float]) -> Optional[WellFormationInterval]:
    if well is None:
        return None
    candidates = sorted(well.formation_intervals, key=lambda row: (row.base_depth - row.top_depth, row.top_depth))
    if depth is not None:
        for interval in candidates:
            if float(interval.top_depth) <= depth <= float(interval.base_depth):
                return interval
    return None


def _nearest_measurement(well: Well, depth: Optional[float]) -> Optional[DrillingMeasurement]:
    if not well.drilling_measurements:
        return None
    return min(
        well.drilling_measurements,
        key=lambda row: (
            abs(float(row.measured_depth_m) - depth) if depth is not None else 0.0,
            row.sampled_at,
        ),
    )


def _interval_formation_match(
    active: Optional[WellFormationInterval], offset: Optional[WellFormationInterval]
) -> str:
    if active is None or offset is None:
        return "unknown"
    if active.formation.normalized_name == offset.formation.normalized_name:
        return "exact"
    active_names = {_norm(active.formation.name), _norm(active.formation.normalized_name)}
    active_names.update(_norm(alias) for alias in active.formation.aliases)
    offset_names = {_norm(offset.formation.name), _norm(offset.formation.normalized_name)}
    offset_names.update(_norm(alias) for alias in offset.formation.aliases)
    return "alias" if active_names.intersection(offset_names) else "mismatch"


def _geological_similarity(
    active: Optional[WellFormationInterval], offset: Optional[WellFormationInterval]
) -> Optional[float]:
    if active is None or offset is None:
        return None
    formation_match = _interval_formation_match(active, offset)
    components = [1.0 if formation_match == "exact" else 0.85 if formation_match == "alias" else 0.0]
    for active_value, offset_value in (
        (active.lithology, offset.lithology),
        (active.geological_zone, offset.geological_zone),
    ):
        if active_value and offset_value:
            components.append(1.0 if _norm(active_value) == _norm(offset_value) else 0.0)
    return round(sum(components) / len(components), 3)


def _reservoir_similarity(
    active: Optional[WellFormationInterval], offset: Optional[WellFormationInterval]
) -> Optional[float]:
    if active is None or offset is None:
        return None
    components: List[float] = []
    if active.reservoir_zone and offset.reservoir_zone:
        components.append(1.0 if _norm(active.reservoir_zone) == _norm(offset.reservoir_zone) else 0.0)
    if active.pressure_indicator and offset.pressure_indicator:
        components.append(1.0 if active.pressure_indicator == offset.pressure_indicator else 0.0)
    if active.porosity_percent is not None and offset.porosity_percent is not None:
        components.append(max(0.0, 1.0 - abs(float(active.porosity_percent) - float(offset.porosity_percent)) / 10.0))
    if active.permeability_md is not None and offset.permeability_md is not None:
        ratio = (float(active.permeability_md) + 1.0) / (float(offset.permeability_md) + 1.0)
        components.append(max(0.0, 1.0 - abs(log10(ratio)) / 2.0))
    return round(sum(components) / len(components), 3) if components else None


def _parameter_differences(
    active: Optional[DrillingMeasurement], offset: Optional[DrillingMeasurement]
) -> Dict[str, NumericParameterComparison]:
    parameters = {
        "measured_depth_m": ("measured_depth_m", "m"),
        "true_vertical_depth_m": ("true_vertical_depth_m", "m"),
        "mud_weight_sg": ("mud_weight_sg", "SG"),
        "ecd_sg": ("ecd_sg", "SG"),
        "rop_m_per_hr": ("rop_m_per_hr", "m/hr"),
        "wob_kn": ("wob_kn", "kN"),
        "rpm": ("rpm", "rpm"),
        "torque_knm": ("torque_knm", "kN·m"),
        "standpipe_pressure_mpa": ("standpipe_pressure_mpa", "MPa"),
        "inclination_deg": ("inclination_deg", "°"),
        "azimuth_deg": ("azimuth_deg", "°"),
        "casing_depth_m": ("casing_depth_m", "m"),
    }
    differences: Dict[str, NumericParameterComparison] = {}
    for key, (attribute, unit) in parameters.items():
        active_value = getattr(active, attribute) if active is not None else None
        offset_value = getattr(offset, attribute) if offset is not None else None
        active_number = float(active_value) if active_value is not None else None
        offset_number = float(offset_value) if offset_value is not None else None
        differences[key] = NumericParameterComparison(
            active_value=active_number,
            offset_value=offset_number,
            difference=(
                round(offset_number - active_number, 3)
                if active_number is not None and offset_number is not None
                else None
            ),
            unit=unit,
        )
    return differences


def _comparison_reasons(
    distance_km: float,
    formation_match: str,
    active_interval: Optional[WellFormationInterval],
    offset_interval: Optional[WellFormationInterval],
    representative_event: Optional[OffsetEventMatch],
    active_measurement: Optional[DrillingMeasurement],
    offset_measurement: Optional[DrillingMeasurement],
) -> List[str]:
    reasons = [f"{distance_km:.1f} km from active well"]
    if formation_match == "exact" and active_interval is not None:
        reasons.append(f"Same formation: {active_interval.formation.name}")
    elif formation_match == "alias" and active_interval is not None and offset_interval is not None:
        reasons.append(
            "Formation alias match: "
            f"{active_interval.formation.name} / {offset_interval.formation.name}"
        )
    elif formation_match == "mismatch" and active_interval is not None and offset_interval is not None:
        reasons.append(
            f"Different formations: {active_interval.formation.name} / {offset_interval.formation.name}"
        )
    else:
        reasons.append("Formation match unavailable at the compared depth")

    if representative_event is not None:
        delta = representative_event.depth_difference_m
        if delta > 0:
            position = f"{delta:g} m ahead of active depth"
        elif delta < 0:
            position = f"{abs(delta):g} m behind active depth"
        else:
            position = "at active depth"
        reasons.append(f"Historical event {position}: {representative_event.event_title}")

    if active_measurement is not None and offset_measurement is not None:
        active_depth = float(active_measurement.measured_depth_m)
        offset_depth = float(offset_measurement.measured_depth_m)
        shared_parameters = sum(
            getattr(active_measurement, attribute) is not None and getattr(offset_measurement, attribute) is not None
            for attribute in (
                "mud_weight_sg",
                "ecd_sg",
                "rop_m_per_hr",
                "wob_kn",
                "rpm",
                "torque_knm",
                "standpipe_pressure_mpa",
                "inclination_deg",
                "azimuth_deg",
                "casing_depth_m",
            )
        )
        reasons.append(
            f"Drilling samples at {active_depth:g} m MD and {offset_depth:g} m MD; "
            f"{shared_parameters} shared parameter values are compared below"
        )
    return reasons


def dashboard_response(result: EngineResult) -> DashboardSignalsRead:
    counts = {
        band: sum(1 for row in result.matches if row.relevance_band == band)
        for band in ("high", "medium", "low")
    }
    significant = counts["high"] + counts["medium"]
    message = None
    if significant == 0:
        message = (
            f"No significant historical match found within {result.radius_km:.1f} km and "
            f"±{result.depth_window_m:.0f} m. Historical records may still be searched separately."
        )
    return DashboardSignalsRead(
        active_well=result.active_well,
        radius_km=result.radius_km,
        depth_window_m=result.depth_window_m,
        event_family=result.event_family,
        summary=IntelligenceSummary(
            matched_offset_wells=len(matched_wells(result)),
            matched_historical_events=len(result.matches),
            high_relevance_signals=counts["high"],
            medium_relevance_signals=counts["medium"],
            low_relevance_matches=counts["low"],
            top_relevance_score=result.matches[0].relevance_score if result.matches else None,
            has_significant_match=significant > 0,
        ),
        signals=[row for row in result.matches if row.relevance_band in {"high", "medium"}],
        message=message or result.message,
    )
