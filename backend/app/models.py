"""Relational SQLAlchemy models for the ANUBHAV MVP."""

from datetime import date, datetime, timezone
from enum import Enum
from typing import List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def enum_column(enum_type: type[Enum], name: str, length: Optional[int] = None) -> SAEnum:
    values = [member.value for member in enum_type]
    return SAEnum(
        enum_type,
        name=name,
        native_enum=False,
        length=length or max(len(value) for value in values),
        values_callable=lambda members: [member.value for member in members],
    )


class WellRole(str, Enum):
    ACTIVE = "active"
    OFFSET = "offset"


class WellStatus(str, Enum):
    DRILLING = "drilling"
    COMPLETED = "completed"
    SUSPENDED = "suspended"
    ABANDONED = "abandoned"


class EventType(str, Enum):
    LOST_CIRCULATION = "lost_circulation"
    KICK_INFLUX = "kick_influx"
    STUCK_PIPE = "stuck_pipe"
    TORQUE_SPIKE = "torque_spike"
    DRAG_INCREASE = "drag_increase"
    OVERPRESSURE_SIGNAL = "overpressure_signal"
    WELLBORE_INSTABILITY = "wellbore_instability"
    CEMENTING_ISSUE = "cementing_issue"
    CASING_ISSUE = "casing_issue"
    MUD_WEIGHT_ADJUSTMENT = "mud_weight_adjustment"
    HOLE_CLEANING_ISSUE = "hole_cleaning_issue"
    FISHING_OPERATION = "fishing_operation"
    NPT_EVENT = "npt_event"
    EQUIPMENT_FAILURE = "equipment_failure"
    GAS_SHOW = "gas_show"
    OTHER = "other"


class SeverityLabel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


class DocumentType(str, Enum):
    DAILY_DRILLING_REPORT = "daily_drilling_report"
    FINAL_WELL_REPORT = "final_well_report"
    INCIDENT_REPORT = "incident_report"
    OTHER = "other"


class ProcessingStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"


class DocumentOrigin(str, Enum):
    SEEDED_DEMO = "seeded_demo"
    UPLOADED_DOCUMENT = "uploaded_document"


class ExtractionMethod(str, Enum):
    SYNTHETIC_DEMO = "synthetic_demo"
    MANUAL_REVIEW = "manual_review"
    RULE_BASED = "rule_based"
    IMPORTED = "imported"


class AlertType(str, Enum):
    OFFSET_EVENT = "offset_event"
    HISTORICAL_PRECEDENT = "historical_precedent"


class AlertStatus(str, Enum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    REVIEWED = "reviewed"
    DISMISSED = "dismissed"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class Formation(TimestampMixin, Base):
    __tablename__ = "formations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    aliases: Mapped[List[str]] = mapped_column(JSON, nullable=False, default=list)

    wells: Mapped[List["Well"]] = relationship(back_populates="current_formation")
    events: Mapped[List["WellEvent"]] = relationship(back_populates="formation")
    well_intervals: Mapped[List["WellFormationInterval"]] = relationship(back_populates="formation")


class Well(TimestampMixin, Base):
    __tablename__ = "wells"
    __table_args__ = (
        CheckConstraint("latitude IS NULL OR (latitude >= -90 AND latitude <= 90)", name="ck_well_latitude"),
        CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_well_longitude",
        ),
        CheckConstraint("total_depth IS NULL OR total_depth >= 0", name="ck_well_total_depth_nonnegative"),
        CheckConstraint("current_depth IS NULL OR current_depth >= 0", name="ck_well_current_depth_nonnegative"),
        UniqueConstraint("well_name", name="uq_wells_well_name"),
        Index("ix_wells_coordinates", "latitude", "longitude"),
        Index("ix_wells_field", "field"),
        Index("ix_wells_current_formation_id", "current_formation_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    well_name: Mapped[str] = mapped_column(String(120), nullable=False)
    field: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    spud_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    completion_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    total_depth: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    current_depth: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    current_formation_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("formations.id", ondelete="SET NULL"), nullable=True
    )
    role: Mapped[WellRole] = mapped_column(enum_column(WellRole, "well_role"), nullable=False)
    status: Mapped[WellStatus] = mapped_column(enum_column(WellStatus, "well_status"), nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)

    current_formation: Mapped[Optional[Formation]] = relationship(back_populates="wells")
    formation_intervals: Mapped[List["WellFormationInterval"]] = relationship(
        back_populates="well", cascade="all, delete-orphan"
    )
    drilling_measurements: Mapped[List["DrillingMeasurement"]] = relationship(
        back_populates="well", cascade="all, delete-orphan", order_by="DrillingMeasurement.sampled_at"
    )
    events: Mapped[List["WellEvent"]] = relationship(back_populates="well")
    documents: Mapped[List["Document"]] = relationship(back_populates="well")

    @property
    def formations(self) -> List["WellFormationInterval"]:
        """Expose depth intervals using the API's concise ``formations`` field."""
        return self.formation_intervals


class WellFormationInterval(TimestampMixin, Base):
    __tablename__ = "well_formation_intervals"
    __table_args__ = (
        Index("ix_well_formation_intervals_well_depth", "well_id", "top_depth", "base_depth"),
        Index("ix_well_formation_intervals_formation_id", "formation_id"),
        UniqueConstraint("well_id", "formation_id", "top_depth", name="uq_well_formation_top"),
        CheckConstraint("top_depth >= 0", name="ck_well_formation_top_nonnegative"),
        CheckConstraint("base_depth >= top_depth", name="ck_well_formation_depth_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    well_id: Mapped[str] = mapped_column(ForeignKey("wells.id", ondelete="CASCADE"), nullable=False)
    formation_id: Mapped[str] = mapped_column(ForeignKey("formations.id", ondelete="RESTRICT"), nullable=False)
    top_depth: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    base_depth: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    depth_unit: Mapped[str] = mapped_column(String(10), nullable=False, default="m", server_default="m")
    lithology: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    geological_zone: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    reservoir_zone: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    pressure_indicator: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    porosity_percent: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    permeability_md: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)

    well: Mapped[Well] = relationship(back_populates="formation_intervals")
    formation: Mapped[Formation] = relationship(back_populates="well_intervals")


class DrillingMeasurement(TimestampMixin, Base):
    """Representative measured-depth drilling samples; live demo data is explicitly synthetic."""

    __tablename__ = "drilling_measurements"
    __table_args__ = (
        Index("ix_drilling_measurements_well_depth", "well_id", "measured_depth_m"),
        Index("ix_drilling_measurements_well_time", "well_id", "sampled_at"),
        UniqueConstraint("well_id", "sampled_at", name="uq_drilling_measurement_well_time"),
        CheckConstraint("measured_depth_m >= 0", name="ck_drilling_measurement_depth_nonnegative"),
        CheckConstraint(
            "true_vertical_depth_m IS NULL OR true_vertical_depth_m >= 0",
            name="ck_drilling_tvd_nonnegative",
        ),
        CheckConstraint("mud_weight_sg IS NULL OR mud_weight_sg > 0", name="ck_drilling_mud_weight_positive"),
        CheckConstraint("ecd_sg IS NULL OR ecd_sg > 0", name="ck_drilling_ecd_positive"),
        CheckConstraint("rop_m_per_hr IS NULL OR rop_m_per_hr >= 0", name="ck_drilling_rop_nonnegative"),
        CheckConstraint("wob_kn IS NULL OR wob_kn >= 0", name="ck_drilling_wob_nonnegative"),
        CheckConstraint("rpm IS NULL OR rpm >= 0", name="ck_drilling_rpm_nonnegative"),
        CheckConstraint("torque_knm IS NULL OR torque_knm >= 0", name="ck_drilling_torque_nonnegative"),
        CheckConstraint(
            "standpipe_pressure_mpa IS NULL OR standpipe_pressure_mpa >= 0",
            name="ck_drilling_spp_nonnegative",
        ),
        CheckConstraint(
            "inclination_deg IS NULL OR (inclination_deg >= 0 AND inclination_deg <= 180)",
            name="ck_drilling_inclination_range",
        ),
        CheckConstraint(
            "azimuth_deg IS NULL OR (azimuth_deg >= 0 AND azimuth_deg < 360)",
            name="ck_drilling_azimuth_range",
        ),
        CheckConstraint("casing_depth_m IS NULL OR casing_depth_m >= 0", name="ck_drilling_casing_depth_nonnegative"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    well_id: Mapped[str] = mapped_column(ForeignKey("wells.id", ondelete="CASCADE"), nullable=False)
    sampled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    measured_depth_m: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    true_vertical_depth_m: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    mud_weight_sg: Mapped[Optional[float]] = mapped_column(Numeric(4, 3), nullable=True)
    ecd_sg: Mapped[Optional[float]] = mapped_column(Numeric(4, 3), nullable=True)
    rop_m_per_hr: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    wob_kn: Mapped[Optional[float]] = mapped_column(Numeric(7, 2), nullable=True)
    rpm: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    torque_knm: Mapped[Optional[float]] = mapped_column(Numeric(7, 2), nullable=True)
    standpipe_pressure_mpa: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    inclination_deg: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    azimuth_deg: Mapped[Optional[float]] = mapped_column(Numeric(6, 2), nullable=True)
    casing_depth_m: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    cementing_metadata: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(
        String(255), nullable=False, default="Representative Synthetic Demo Data"
    )

    well: Mapped[Well] = relationship(back_populates="drilling_measurements")


class Document(TimestampMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_well_id", "well_id"),
        Index("ix_documents_processing_status", "processing_status"),
        CheckConstraint("page_count IS NULL OR page_count >= 0", name="ck_documents_page_count_nonnegative"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    well_id: Mapped[str] = mapped_column(ForeignKey("wells.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[DocumentType] = mapped_column(enum_column(DocumentType, "document_type"), nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    origin: Mapped[DocumentOrigin] = mapped_column(
        enum_column(DocumentOrigin, "document_origin"),
        nullable=False,
        default=DocumentOrigin.SEEDED_DEMO,
        server_default=DocumentOrigin.SEEDED_DEMO.value,
    )
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    processing_status: Mapped[ProcessingStatus] = mapped_column(
        enum_column(ProcessingStatus, "processing_status"),
        nullable=False,
        default=ProcessingStatus.PROCESSED,
    )
    extracted_text_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    content_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    well: Mapped[Well] = relationship(back_populates="documents")
    events: Mapped[List["WellEvent"]] = relationship(back_populates="source_document")
    evidence: Mapped[List["EventEvidence"]] = relationship(back_populates="document")

    @property
    def source_label(self) -> str:
        if self.origin == DocumentOrigin.SEEDED_DEMO:
            return "Seeded Demo Evidence"
        return "Uploaded Document"


class WellEvent(TimestampMixin, Base):
    __tablename__ = "well_events"
    __table_args__ = (
        Index("ix_well_events_well_id", "well_id"),
        Index("ix_well_events_formation_id", "formation_id"),
        Index("ix_well_events_measured_depth", "measured_depth"),
        Index("ix_well_events_well_depth", "well_id", "measured_depth"),
        Index("ix_well_events_event_date", "event_date"),
        CheckConstraint(
            "measured_depth IS NULL OR measured_depth >= 0",
            name="ck_event_measured_depth_nonnegative",
        ),
        CheckConstraint(
            "true_vertical_depth IS NULL OR true_vertical_depth >= 0",
            name="ck_event_tvd_nonnegative",
        ),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_event_confidence_range"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    well_id: Mapped[str] = mapped_column(ForeignKey("wells.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[EventType] = mapped_column(enum_column(EventType, "event_type", length=32), nullable=False)
    event_title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    measured_depth: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    true_vertical_depth: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    formation_id: Mapped[Optional[str]] = mapped_column(ForeignKey("formations.id"), nullable=True)
    event_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    consequence: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mitigation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    severity_label: Mapped[SeverityLabel] = mapped_column(
        enum_column(SeverityLabel, "severity_label"), nullable=False, default=SeverityLabel.UNKNOWN
    )
    source_document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    confidence: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=1.0)

    well: Mapped[Well] = relationship(back_populates="events")
    formation: Mapped[Optional[Formation]] = relationship(back_populates="events")
    source_document: Mapped[Document] = relationship(back_populates="events")
    evidence: Mapped[List["EventEvidence"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    alerts: Mapped[List["Alert"]] = relationship(back_populates="historical_event")

    @property
    def well_name(self) -> str:
        return self.well.well_name


class EventEvidence(TimestampMixin, Base):
    __tablename__ = "event_evidence"
    __table_args__ = (
        Index("ix_event_evidence_event_id", "event_id"),
        Index("ix_event_evidence_document_id", "document_id"),
        CheckConstraint("page_number IS NULL OR page_number > 0", name="ck_evidence_page_positive"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_evidence_confidence_range"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("well_events.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    excerpt: Mapped[str] = mapped_column(Text, nullable=False)
    extraction_method: Mapped[ExtractionMethod] = mapped_column(
        enum_column(ExtractionMethod, "extraction_method"), nullable=False
    )
    confidence: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=1.0)

    event: Mapped[WellEvent] = relationship(back_populates="evidence")
    document: Mapped[Document] = relationship(back_populates="evidence")


class Alert(TimestampMixin, Base):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("ix_alerts_active_well_id", "active_well_id"),
        Index("ix_alerts_historical_event_id", "historical_event_id"),
        Index("ix_alerts_status_created", "status", "created_at"),
        UniqueConstraint("active_well_id", "historical_event_id", name="uq_alert_active_well_event"),
        CheckConstraint("relevance_score >= 0 AND relevance_score <= 100", name="ck_alert_relevance_range"),
        CheckConstraint("distance_km IS NULL OR distance_km >= 0", name="ck_alert_distance_nonnegative"),
        CheckConstraint(
            "depth_difference_m IS NULL OR depth_difference_m >= 0",
            name="ck_alert_depth_difference_nonnegative",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    active_well_id: Mapped[str] = mapped_column(ForeignKey("wells.id", ondelete="CASCADE"), nullable=False)
    historical_event_id: Mapped[str] = mapped_column(ForeignKey("well_events.id", ondelete="CASCADE"), nullable=False)
    alert_type: Mapped[AlertType] = mapped_column(enum_column(AlertType, "alert_type"), nullable=False)
    alert_title: Mapped[str] = mapped_column(String(200), nullable=False)
    relevance_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    distance_km: Mapped[Optional[float]] = mapped_column(Numeric(8, 2), nullable=True)
    depth_difference_m: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    formation_match: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    status: Mapped[AlertStatus] = mapped_column(
        enum_column(AlertStatus, "alert_status"), nullable=False, default=AlertStatus.OPEN
    )

    active_well: Mapped[Well] = relationship(foreign_keys=[active_well_id])
    historical_event: Mapped[WellEvent] = relationship(back_populates="alerts")
    notes: Mapped[List["AlertNote"]] = relationship(
        back_populates="alert", cascade="all, delete-orphan", order_by="AlertNote.created_at"
    )


class AlertNote(Base):
    __tablename__ = "alert_notes"
    __table_args__ = (Index("ix_alert_notes_alert_id", "alert_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    alert: Mapped[Alert] = relationship(back_populates="notes")
