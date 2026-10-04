"""Small, explainable event-category classifier over the fixed synthetic fixture."""

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.demo_fixtures import DATASET_LABEL
from app.geo import haversine_distance_km
from app.intelligence_service import (
    EngineResult,
    _interval_at_depth,
    _nearest_measurement,
    _norm,
    _reservoir_similarity,
    correlate_offsets,
)
from app.models import (
    Document,
    DocumentOrigin,
    DrillingMeasurement,
    EventType,
    Formation,
    Well,
    WellEvent,
    WellFormationInterval,
)
from app.schemas import (
    OffsetEventMatch,
    PredictiveFeatureContribution,
    PredictiveRiskRead,
    PredictiveRiskSignal,
)

RISK_LABELS: Dict[EventType, str] = {
    EventType.LOST_CIRCULATION: "Mud Loss",
    EventType.STUCK_PIPE: "Stuck Pipe",
    EventType.TORQUE_SPIKE: "Torque Spike",
    EventType.OVERPRESSURE_SIGNAL: "Overpressure Signal",
    EventType.CEMENTING_ISSUE: "Cementing Issue",
}
OTHER_LABEL = "Other documented event"
MODEL_METADATA = json.loads(Path(__file__).with_name("predictive_model_metadata.json").read_text())
FEATURES: Tuple[str, ...] = tuple(MODEL_METADATA["feature_set"])
FEATURE_TEXT = {
    "formation_similarity": "Formation match between the active interval and historical event",
    "reservoir_similarity": "Reservoir-zone property similarity",
    "depth_proximity": "Historical event depth proximity",
    "spatial_proximity": "Offset distance within the configured 50 km comparison scale",
    "historical_event_frequency": "Prior frequency of this mapped event category in available history",
    "mud_weight_sg": "Active mud weight (SG)",
    "ecd_sg": "Active equivalent circulating density (SG)",
    "rop_m_per_hr": "Active rate of penetration (m/hr)",
    "wob_kn": "Active weight on bit (kN)",
    "torque_knm": "Active torque (kN·m)",
    "pressure_indicator": "Synthetic qualitative pressure indicator",
}
PRESSURE_VALUES = {"typical": 0.25, "review_indicator": 0.75, "elevated": 1.0}


class PredictiveInputError(ValueError):
    """Raised for invalid prediction parameters."""


def _formation_similarity(
    active_interval: Optional[WellFormationInterval], event_formation: Optional[Formation]
) -> float:
    if active_interval is None or event_formation is None:
        return 0.0
    formation = active_interval.formation
    if formation.id == event_formation.id:
        return 1.0
    active_names = {_norm(formation.name), _norm(formation.normalized_name)}
    active_names.update(_norm(alias) for alias in formation.aliases)
    event_names = {_norm(event_formation.name), _norm(event_formation.normalized_name)}
    event_names.update(_norm(alias) for alias in event_formation.aliases)
    return 0.85 if active_names.intersection(event_names) else 0.0


def _measurement_value(measurement: Optional[DrillingMeasurement], field: str) -> float:
    if measurement is None:
        return 0.0
    value = getattr(measurement, field)
    return float(value) if value is not None else 0.0


def _features_for_pair(
    active_well: Well,
    active_depth: float,
    offset_well: Well,
    event_depth: float,
    event_formation: Optional[Formation],
    distance_km: float,
    event_frequency: int,
) -> Dict[str, float]:
    active_interval = _interval_at_depth(active_well, active_depth)
    offset_interval = _interval_at_depth(offset_well, event_depth)
    if event_formation is not None:
        offset_interval = next(
            (row for row in offset_well.formation_intervals if row.formation_id == event_formation.id),
            offset_interval,
        )
    active_measurement = _nearest_measurement(active_well, active_depth)
    reservoir_score = _reservoir_similarity(active_interval, offset_interval) or 0.0
    pressure = PRESSURE_VALUES.get(active_interval.pressure_indicator or "" if active_interval else "", 0.0)
    return {
        "formation_similarity": _formation_similarity(active_interval, event_formation),
        "reservoir_similarity": reservoir_score,
        "depth_proximity": max(0.0, 1.0 - abs(event_depth - active_depth) / 1000.0),
        "spatial_proximity": max(0.0, 1.0 - distance_km / 50.0),
        "historical_event_frequency": min(1.0, np.log1p(event_frequency) / np.log1p(5.0)),
        "mud_weight_sg": _measurement_value(active_measurement, "mud_weight_sg"),
        "ecd_sg": _measurement_value(active_measurement, "ecd_sg"),
        "rop_m_per_hr": _measurement_value(active_measurement, "rop_m_per_hr"),
        "wob_kn": _measurement_value(active_measurement, "wob_kn"),
        "torque_knm": _measurement_value(active_measurement, "torque_knm"),
        "pressure_indicator": pressure,
    }


def _active_near_event(event_well: Well, active_wells: Sequence[Well]) -> Optional[Tuple[Well, float]]:
    candidates = [well for well in active_wells if well.id != event_well.id]
    if not candidates:
        candidates = list(active_wells)
    if event_well.field:
        same_field = [well for well in candidates if well.field == event_well.field]
        if same_field:
            candidates = same_field
    if event_well.latitude is None or event_well.longitude is None:
        return None
    event_latitude = float(event_well.latitude)
    event_longitude = float(event_well.longitude)
    located: List[Tuple[Well, float, float]] = [
        (well, float(well.latitude), float(well.longitude))
        for well in candidates
        if well.latitude is not None and well.longitude is not None
    ]
    if not located:
        return None
    closest, closest_latitude, closest_longitude = min(
        located,
        key=lambda row: haversine_distance_km(
            event_latitude,
            event_longitude,
            row[1],
            row[2],
        ),
    )
    distance = haversine_distance_km(closest_latitude, closest_longitude, event_latitude, event_longitude)
    return closest, distance


def _training_examples(db: Session) -> Tuple[np.ndarray, List[str], List[WellEvent]]:
    """Build seeded-event rows only; this prototype has no train/holdout evaluation."""
    events = list(
        db.scalars(
            select(WellEvent)
            .join(WellEvent.source_document)
            .where(WellEvent.measured_depth.is_not(None))
            .where(Document.origin == DocumentOrigin.SEEDED_DEMO)
            .where(Document.source == DATASET_LABEL)
            .options(
                selectinload(WellEvent.formation),
                selectinload(WellEvent.source_document),
                selectinload(WellEvent.well).options(
                    selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation),
                    selectinload(Well.drilling_measurements),
                ),
            )
            .order_by(WellEvent.event_date, WellEvent.id)
        ).all()
    )
    active_wells = list(
        db.scalars(
            select(Well)
            .where(Well.role == "active")
            .order_by(Well.id)
            .options(
                selectinload(Well.formation_intervals).selectinload(WellFormationInterval.formation),
                selectinload(Well.drilling_measurements),
            )
        ).all()
    )
    earlier_events: Dict[Tuple[str, str], List[WellEvent]] = defaultdict(list)
    for event in events:
        earlier_events[(event.well_id, RISK_LABELS.get(event.event_type, OTHER_LABEL))].append(event)
    rows: List[List[float]] = []
    labels: List[str] = []
    training_events: List[WellEvent] = []
    for event in events:
        nearest = _active_near_event(event.well, active_wells)
        if nearest is None or event.measured_depth is None:
            continue
        active_well, distance = nearest
        active_depth = active_well.current_depth
        if active_depth is None:
            continue
        label = RISK_LABELS.get(event.event_type, OTHER_LABEL)
        prior_event_count = sum(
            prior.event_date is not None
            and event.event_date is not None
            and prior.event_date < event.event_date
            for prior in earlier_events[(event.well_id, label)]
        )
        values = _features_for_pair(
            active_well,
            float(active_depth),
            event.well,
            float(event.measured_depth),
            event.formation,
            distance,
            prior_event_count,
        )
        rows.append([values[name] for name in FEATURES])
        labels.append(label)
        training_events.append(event)
    return np.asarray(rows, dtype=float), labels, training_events


def _prediction_feature_rows(result: EngineResult) -> Dict[str, List[Tuple[Dict[str, float], OffsetEventMatch]]]:
    active = result.active_record
    active_depth = result.active_well.active_depth_m
    if active is None or active_depth is None:
        return {}
    offset_by_id = {well.id: (well, distance) for well, distance in result.candidate_offsets}
    matching_counts = Counter(RISK_LABELS.get(row.event_type, OTHER_LABEL) for row in result.matches)
    groups: Dict[str, List[Tuple[Dict[str, float], OffsetEventMatch]]] = defaultdict(list)
    for match in result.matches:
        risk_type = RISK_LABELS.get(match.event_type)
        if risk_type is None:
            continue
        offset_pair = offset_by_id.get(str(match.offset_well.id))
        if offset_pair is None:
            continue
        offset_well, distance = offset_pair
        formation = next(
            (row.formation for row in offset_well.formation_intervals if row.formation_id == str(match.formation.id)),
            None,
        ) if match.formation else None
        values = _features_for_pair(
            active,
            active_depth,
            offset_well,
            match.historical_depth_m,
            formation,
            distance,
            matching_counts[risk_type],
        )
        groups[risk_type].append((values, match))
    return groups


def _contributions(model: Pipeline, values: Dict[str, float], risk_type: str) -> List[PredictiveFeatureContribution]:
    scaler = model.named_steps["scale"]
    classifier = model.named_steps["classifier"]
    class_index = list(classifier.classes_).index(risk_type)
    standardized = (np.asarray([values[name] for name in FEATURES]) - scaler.mean_) / scaler.scale_
    contributions = classifier.coef_[class_index] * standardized
    ranked = sorted(enumerate(contributions), key=lambda item: (-abs(float(item[1])), FEATURES[item[0]]))[:4]
    result = []
    for index, amount in ranked:
        name = FEATURES[index]
        direction = "supports" if amount >= 0 else "reduces"
        result.append(
            PredictiveFeatureContribution(
                feature=name,
                value=round(values[name], 4),
                contribution=round(float(amount), 4),
                explanation=f"The fitted model {direction} this category through {FEATURE_TEXT[name].lower()}.",
            )
        )
    return result


def predict_historical_categories(
    db: Session,
    active_well_id: str,
    *,
    radius_km: Optional[float] = None,
    depth_window_m: Optional[float] = None,
    active_depth_m: Optional[float] = None,
    active_formation: Optional[str] = None,
) -> PredictiveRiskRead:
    result = correlate_offsets(
        db,
        active_well_id,
        radius_km=radius_km,
        depth_window_m=depth_window_m,
        active_depth_m=active_depth_m,
        active_formation=active_formation,
        limit=500,
    )
    if result.active_record is None:
        raise LookupError("Active well not found")
    if result.active_record.current_depth is None and active_depth_m is None:
        raise PredictiveInputError("An active measured depth is required for a prototype estimate.")
    matrix, labels, _ = _training_examples(db)
    groups = _prediction_feature_rows(result)
    base = {
        "active_well_id": result.active_well.id,
        "active_well_name": result.active_well.well_name,
        "model_name": MODEL_METADATA["model_name"],
        "model_version": MODEL_METADATA["model_version"],
        "model_metadata": MODEL_METADATA,
        "training_sample_count": len(labels),
    }
    if len(labels) < 5 or len(set(labels)) < 2:
        return PredictiveRiskRead(
            **base,
            status="insufficient_data",
            signals=[],
            message="Insufficient seeded event history to fit the prototype classifier.",
        )
    if not groups:
        return PredictiveRiskRead(
            **base,
            status="insufficient_data",
            signals=[],
            message="No source-backed target-category event matched this well, depth, formation, and radius context.",
        )

    model = Pipeline(
        steps=[
            ("scale", StandardScaler()),
            ("classifier", LogisticRegression(solver="lbfgs", max_iter=1000, random_state=42, C=1.0)),
        ]
    )
    model.fit(matrix, labels)
    classifier = model.named_steps["classifier"]
    signals: List[PredictiveRiskSignal] = []
    for risk_type, rows in groups.items():
        if risk_type not in classifier.classes_:
            continue
        feature_values = {
            name: float(np.mean([row[0][name] for row in rows]))
            for name in FEATURES
        }
        probabilities = model.predict_proba(np.asarray([[feature_values[name] for name in FEATURES]]))[0]
        probability = float(probabilities[list(classifier.classes_).index(risk_type)])
        signals.append(
            PredictiveRiskSignal(
                risk_type=risk_type,
                probability=round(probability, 4),
                top_contributing_features=_contributions(model, feature_values, risk_type),
                supporting_offset_wells=sorted({row.offset_well.well_name for _, row in rows}),
                supporting_historical_events=[row for _, row in rows],
            )
        )
    signals.sort(key=lambda row: (-row.probability, row.risk_type))
    return PredictiveRiskRead(
        **base,
        status="available" if signals else "insufficient_data",
        signals=signals,
        message=(
            None
            if signals
            else "The fitted model returned no event category supported by matched historical events."
        ),
    )
