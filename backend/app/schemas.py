"""API response schemas."""

from datetime import date, datetime
from enum import Enum
from typing import Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    AlertStatus,
    AlertType,
    DocumentOrigin,
    DocumentType,
    EventType,
    ExtractionMethod,
    ProcessingStatus,
    SeverityLabel,
    WellRole,
    WellStatus,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class FormationRead(ORMModel):
    id: UUID
    name: str
    normalized_name: str
    aliases: List[str]


class WellFormationIntervalRead(ORMModel):
    id: UUID
    formation_id: UUID
    formation: FormationRead
    top_depth: float
    base_depth: float
    depth_unit: str
    lithology: Optional[str] = None
    geological_zone: Optional[str] = None
    reservoir_zone: Optional[str] = None
    pressure_indicator: Optional[str] = None
    porosity_percent: Optional[float] = None
    permeability_md: Optional[float] = None


class DrillingMeasurementRead(ORMModel):
    id: UUID
    well_id: UUID
    sampled_at: datetime
    measured_depth_m: float
    true_vertical_depth_m: Optional[float]
    mud_weight_sg: Optional[float]
    ecd_sg: Optional[float]
    rop_m_per_hr: Optional[float]
    wob_kn: Optional[float]
    rpm: Optional[float]
    torque_knm: Optional[float]
    standpipe_pressure_mpa: Optional[float]
    inclination_deg: Optional[float]
    azimuth_deg: Optional[float]
    casing_depth_m: Optional[float]
    cementing_metadata: Optional[str]
    source: str
    created_at: datetime
    updated_at: datetime


class LiveDrillingState(BaseModel):
    measurement: DrillingMeasurementRead
    formation: Optional[str]
    pressure_indicator: Optional[str] = None


class LiveFeedRead(BaseModel):
    well_id: UUID
    well_name: str
    feed_type: str = "deterministic_simulated_replay"
    status: str = "Simulated eRTMAC / Representative Synthetic Data"
    states: List[LiveDrillingState]
    message: Optional[str] = None
    data_notice: str = (
        "Simulated eRTMAC / Representative Synthetic Data. This deterministic replay is not connected "
        "to OIL's actual eRTMAC system."
    )


class WellRead(ORMModel):
    id: UUID
    well_name: str
    field: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    spud_date: Optional[date]
    completion_date: Optional[date]
    total_depth: Optional[float]
    current_depth: Optional[float]
    current_formation: Optional[FormationRead]
    formations: List[WellFormationIntervalRead] = Field(default_factory=list)
    role: WellRole
    status: WellStatus
    source: str
    created_at: datetime
    updated_at: datetime


class DocumentRead(ORMModel):
    id: UUID
    well_id: UUID
    filename: str
    document_type: DocumentType
    source: str
    origin: DocumentOrigin
    source_label: str
    uploaded_at: datetime
    processing_status: ProcessingStatus
    extracted_text_path: Optional[str]
    content_sha256: Optional[str]
    page_count: Optional[int]
    created_at: datetime
    updated_at: datetime


class EvidenceRead(ORMModel):
    id: UUID
    event_id: UUID
    document_id: UUID
    page_number: Optional[int]
    excerpt: str
    extraction_method: ExtractionMethod
    confidence: float
    document: DocumentRead


class WellEventRead(ORMModel):
    id: UUID
    well_id: UUID
    well_name: str
    event_type: EventType
    event_title: str
    description: str
    measured_depth: Optional[float]
    true_vertical_depth: Optional[float]
    formation: Optional[FormationRead]
    event_date: Optional[datetime]
    consequence: Optional[str]
    mitigation: Optional[str]
    severity_label: SeverityLabel
    source_document_id: UUID
    source_page: Optional[int]
    confidence: float
    source_document: DocumentRead
    evidence: List[EvidenceRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class DocumentProcessRead(BaseModel):
    document: DocumentRead
    events: List[WellEventRead]
    processing_mode: str
    extracted_pages: int
    ocr_pages: int
    message: str


class NearbyWellItem(BaseModel):
    well: WellRead
    distance_km: float
    formation_match: Optional[bool]


class NearbyWellsRead(BaseModel):
    active_well_id: UUID
    radius_km: float
    message: Optional[str] = None
    items: List[NearbyWellItem]


class EventCountRead(BaseModel):
    total: int = Field(ge=0)


class OffsetActiveWell(BaseModel):
    id: UUID
    well_name: str
    field: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    active_depth_m: Optional[float]
    active_formation: Optional[str]


class OffsetWellBrief(BaseModel):
    id: UUID
    well_name: str
    field: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]


class OffsetWellSummary(OffsetWellBrief):
    distance_km: float
    matching_event_count: int
    best_relevance_score: float
    event_ids: List[UUID] = Field(default_factory=list)


class RelevanceComponent(BaseModel):
    score: float = Field(ge=0, le=1)
    weight: float = Field(ge=0)


class RelevanceComponents(BaseModel):
    formation: RelevanceComponent
    depth_proximity: RelevanceComponent
    spatial_proximity: RelevanceComponent
    event_similarity: RelevanceComponent
    source_confidence: RelevanceComponent


class PersistedAlertReference(BaseModel):
    id: UUID
    status: AlertStatus


class OffsetEventMatch(BaseModel):
    event_id: UUID
    offset_well: OffsetWellBrief
    distance_km: float
    historical_depth_m: float
    active_depth_m: float
    depth_difference_m: float = Field(description="Signed historical depth minus active depth; positive means ahead.")
    absolute_depth_difference_m: float
    depth_band: str
    formation: Optional[FormationRead]
    formation_match: str
    event_type: EventType
    event_title: str
    description: str
    consequence: Optional[str]
    mitigation: Optional[str]
    relevance_score: float = Field(ge=0, le=100, description="Composite relevance score on a 0-100 scale.")
    relevance_score_normalized: float = Field(ge=0, le=1)
    relevance_band: str
    components: RelevanceComponents
    source_document: DocumentRead
    source_page: Optional[int]
    evidence_excerpt: str
    source_confidence: float = Field(ge=0, le=1)
    existing_alert: Optional[PersistedAlertReference] = None
    explanation: str


class OffsetWellsRead(BaseModel):
    active_well: OffsetActiveWell
    radius_km: float
    depth_window_m: float
    event_family: Optional[str]
    heuristic_weights: Dict[str, float]
    offsets: List[OffsetWellSummary]
    total_matching_events: int
    message: Optional[str] = None


class CorrelationRead(BaseModel):
    active_well: OffsetActiveWell
    radius_km: float
    depth_window_m: float
    event_family: Optional[str]
    heuristic_weights: Dict[str, float]
    matched_wells: List[OffsetWellSummary]
    historical_events: List[OffsetEventMatch]
    total_matching_events: int
    active_formation_interval: Optional[WellFormationIntervalRead] = None
    active_drilling_parameters: Optional[DrillingMeasurementRead] = None
    comparable_wells: List["WellCorrelationComparison"] = Field(default_factory=list)
    data_notice: str = "Representative Synthetic Demo Data"
    message: Optional[str] = None


class NumericParameterComparison(BaseModel):
    active_value: Optional[float]
    offset_value: Optional[float]
    difference: Optional[float]
    unit: str


class WellCorrelationComparison(BaseModel):
    offset_well: WellRead
    distance_km: float
    depth_alignment_m: Optional[float]
    formation_match: str
    active_formation_interval: Optional[WellFormationIntervalRead]
    offset_formation_interval: Optional[WellFormationIntervalRead]
    geological_similarity: Optional[float]
    reservoir_similarity: Optional[float]
    active_drilling_parameters: Optional[DrillingMeasurementRead]
    offset_drilling_parameters: Optional[DrillingMeasurementRead]
    drilling_parameter_comparison: Dict[str, NumericParameterComparison]
    historical_events: List[OffsetEventMatch] = Field(default_factory=list)
    comparison_reasons: List[str] = Field(default_factory=list)
    source_label: str = "Representative Synthetic Demo Data"


CorrelationRead.model_rebuild()


class EvidenceBackedRecommendation(BaseModel):
    label: str = "Decision support — engineer review required."
    message: str
    reason: str
    source_event_id: UUID
    source_event_title: str
    source_well_name: str
    source_document: str
    source_page: Optional[int]
    evidence_excerpt: str
    recorded_mitigation: str


class IntelligenceSummary(BaseModel):
    matched_offset_wells: int
    matched_historical_events: int
    high_relevance_signals: int
    medium_relevance_signals: int
    low_relevance_matches: int
    top_relevance_score: Optional[float]
    has_significant_match: bool


class DashboardSignalsRead(BaseModel):
    active_well: OffsetActiveWell
    radius_km: float
    depth_window_m: float
    event_family: Optional[str]
    summary: IntelligenceSummary
    signals: List[OffsetEventMatch]
    message: Optional[str] = None
    data_notice: str = "Historical decision support only; not an accident prediction or safety guarantee."


class AlertRead(ORMModel):
    id: UUID
    active_well_id: UUID
    historical_event_id: UUID
    alert_type: AlertType
    alert_title: str
    relevance_score: float
    explanation: str
    distance_km: Optional[float]
    depth_difference_m: Optional[float]
    formation_match: Optional[bool]
    status: AlertStatus
    created_at: datetime
    updated_at: datetime


class AlertNoteCreate(BaseModel):
    note: str = Field(min_length=1, max_length=4000)
    author: Optional[str] = Field(default=None, max_length=120)


class AlertNoteRead(ORMModel):
    id: UUID
    alert_id: UUID
    note: str
    author: Optional[str]
    created_at: datetime


class AlertDetailRead(AlertRead):
    active_well: WellRead
    historical_event: WellEventRead
    notes: List[AlertNoteRead] = Field(default_factory=list)


class AlertPatch(BaseModel):
    status: Optional[AlertStatus] = None


class AlertCategory(str, Enum):
    HIGH_HISTORICAL_RELEVANCE = "high_historical_relevance"
    MEDIUM_HISTORICAL_RELEVANCE = "medium_historical_relevance"
    NO_SIGNIFICANT_PRECEDENT = "no_significant_precedent"


class ActiveAlertsRead(BaseModel):
    active_well: OffsetActiveWell
    category: AlertCategory
    title: str
    summary: str
    radius_km: float
    future_depth_window_m: float
    relevance_threshold: float
    matching_event_count: int
    alerts: List[AlertDetailRead] = Field(default_factory=list)
    recommendation: Optional[EvidenceBackedRecommendation] = None


class PredictiveFeatureContribution(BaseModel):
    feature: str
    value: float
    contribution: float
    explanation: str


class PredictiveRiskRequest(BaseModel):
    radius_km: float = Field(default=20.0, gt=0, le=50)
    depth_window_m: float = Field(default=100.0, gt=0, le=1000)
    active_depth_m: Optional[float] = Field(default=None, ge=0)
    active_formation: Optional[str] = Field(default=None, min_length=1, max_length=120)


class PredictiveRiskSignal(BaseModel):
    risk_type: str
    probability: float = Field(ge=0, le=1)
    risk_band: str = "Historical Risk Signal"
    top_contributing_features: List[PredictiveFeatureContribution]
    supporting_offset_wells: List[str] = Field(min_length=1)
    supporting_historical_events: List[OffsetEventMatch] = Field(
        min_length=1,
        description="Source-backed historical matches required to include a predictive signal.",
    )


class PredictiveRiskRead(BaseModel):
    active_well_id: UUID
    active_well_name: str
    status: str
    model_name: str
    model_version: str
    model_metadata: Dict[str, object]
    training_sample_count: int
    signals: List[PredictiveRiskSignal]
    message: Optional[str] = None
    notice: str = "Prototype model — evaluation limited by representative synthetic data."
