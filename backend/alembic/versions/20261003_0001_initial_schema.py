"""Create the ANUBHAV well, event, evidence, and alert schema."""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "20261003_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def timestamp_columns() -> list:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "formations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("normalized_name", sa.String(length=120), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        *timestamp_columns(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("normalized_name"),
    )

    op.create_table(
        "wells",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("well_name", sa.String(length=120), nullable=False),
        sa.Column("field", sa.String(length=120), nullable=True),
        sa.Column("latitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("longitude", sa.Numeric(9, 6), nullable=True),
        sa.Column("spud_date", sa.Date(), nullable=True),
        sa.Column("completion_date", sa.Date(), nullable=True),
        sa.Column("total_depth", sa.Numeric(10, 2), nullable=True),
        sa.Column("current_depth", sa.Numeric(10, 2), nullable=True),
        sa.Column("current_formation_id", sa.String(length=36), nullable=True),
        sa.Column(
            "role",
            sa.Enum("active", "offset", name="well_role", native_enum=False, length=6),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "drilling",
                "completed",
                "suspended",
                "abandoned",
                name="well_status",
                native_enum=False,
                length=9,
            ),
            nullable=False,
        ),
        sa.Column("source", sa.String(length=255), nullable=False),
        *timestamp_columns(),
        sa.CheckConstraint("latitude IS NULL OR (latitude >= -90 AND latitude <= 90)", name="ck_well_latitude"),
        sa.CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_well_longitude",
        ),
        sa.CheckConstraint("total_depth IS NULL OR total_depth >= 0", name="ck_well_total_depth_nonnegative"),
        sa.CheckConstraint("current_depth IS NULL OR current_depth >= 0", name="ck_well_current_depth_nonnegative"),
        sa.ForeignKeyConstraint(["current_formation_id"], ["formations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("well_name", name="uq_wells_well_name"),
    )
    op.create_index("ix_wells_coordinates", "wells", ["latitude", "longitude"])
    op.create_index("ix_wells_field", "wells", ["field"])
    op.create_index("ix_wells_current_formation_id", "wells", ["current_formation_id"])

    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("well_id", sa.String(length=36), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column(
            "document_type",
            sa.Enum(
                "daily_drilling_report",
                "final_well_report",
                "incident_report",
                "other",
                name="document_type",
                native_enum=False,
                length=21,
            ),
            nullable=False,
        ),
        sa.Column("source", sa.String(length=255), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "processing_status",
            sa.Enum(
                "pending",
                "processed",
                "failed",
                name="processing_status",
                native_enum=False,
                length=9,
            ),
            nullable=False,
        ),
        sa.Column("extracted_text_path", sa.String(length=500), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        *timestamp_columns(),
        sa.CheckConstraint("page_count IS NULL OR page_count >= 0", name="ck_documents_page_count_nonnegative"),
        sa.ForeignKeyConstraint(["well_id"], ["wells.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_documents_well_id", "documents", ["well_id"])
    op.create_index("ix_documents_processing_status", "documents", ["processing_status"])

    op.create_table(
        "well_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("well_id", sa.String(length=36), nullable=False),
        sa.Column(
            "event_type",
            sa.Enum(
                "stuck_pipe",
                "loss_circulation",
                "influx",
                "wellbore_instability",
                "equipment_failure",
                "other",
                name="event_type",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("event_title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("measured_depth", sa.Numeric(10, 2), nullable=True),
        sa.Column("true_vertical_depth", sa.Numeric(10, 2), nullable=True),
        sa.Column("formation_id", sa.String(length=36), nullable=True),
        sa.Column("event_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consequence", sa.Text(), nullable=True),
        sa.Column("mitigation", sa.Text(), nullable=True),
        sa.Column(
            "severity_label",
            sa.Enum(
                "low",
                "medium",
                "high",
                "critical",
                "unknown",
                name="severity_label",
                native_enum=False,
                length=8,
            ),
            nullable=False,
        ),
        sa.Column("source_document_id", sa.String(length=36), nullable=False),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("confidence", sa.Numeric(3, 2), nullable=False),
        *timestamp_columns(),
        sa.CheckConstraint(
            "measured_depth IS NULL OR measured_depth >= 0",
            name="ck_event_measured_depth_nonnegative",
        ),
        sa.CheckConstraint(
            "true_vertical_depth IS NULL OR true_vertical_depth >= 0",
            name="ck_event_tvd_nonnegative",
        ),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_event_confidence_range"),
        sa.ForeignKeyConstraint(["well_id"], ["wells.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["formation_id"], ["formations.id"]),
        sa.ForeignKeyConstraint(["source_document_id"], ["documents.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_well_events_well_id", "well_events", ["well_id"])
    op.create_index("ix_well_events_formation_id", "well_events", ["formation_id"])
    op.create_index("ix_well_events_measured_depth", "well_events", ["measured_depth"])
    op.create_index("ix_well_events_well_depth", "well_events", ["well_id", "measured_depth"])
    op.create_index("ix_well_events_event_date", "well_events", ["event_date"])

    op.create_table(
        "event_evidence",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.Column(
            "extraction_method",
            sa.Enum(
                "synthetic_demo",
                "manual_review",
                "rule_based",
                "imported",
                name="extraction_method",
                native_enum=False,
                length=14,
            ),
            nullable=False,
        ),
        sa.Column("confidence", sa.Numeric(3, 2), nullable=False),
        *timestamp_columns(),
        sa.CheckConstraint("page_number IS NULL OR page_number > 0", name="ck_evidence_page_positive"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_evidence_confidence_range"),
        sa.ForeignKeyConstraint(["event_id"], ["well_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_event_evidence_event_id", "event_evidence", ["event_id"])
    op.create_index("ix_event_evidence_document_id", "event_evidence", ["document_id"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("active_well_id", sa.String(length=36), nullable=False),
        sa.Column("historical_event_id", sa.String(length=36), nullable=False),
        sa.Column(
            "alert_type",
            sa.Enum(
                "offset_event",
                "historical_precedent",
                name="alert_type",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("alert_title", sa.String(length=200), nullable=False),
        sa.Column("relevance_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("distance_km", sa.Numeric(8, 2), nullable=True),
        sa.Column("depth_difference_m", sa.Numeric(10, 2), nullable=True),
        sa.Column("formation_match", sa.Boolean(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("open", "reviewed", "dismissed", name="alert_status", native_enum=False, length=9),
            nullable=False,
        ),
        *timestamp_columns(),
        sa.CheckConstraint("relevance_score >= 0 AND relevance_score <= 100", name="ck_alert_relevance_range"),
        sa.CheckConstraint("distance_km IS NULL OR distance_km >= 0", name="ck_alert_distance_nonnegative"),
        sa.CheckConstraint(
            "depth_difference_m IS NULL OR depth_difference_m >= 0",
            name="ck_alert_depth_difference_nonnegative",
        ),
        sa.ForeignKeyConstraint(["active_well_id"], ["wells.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["historical_event_id"], ["well_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_active_well_id", "alerts", ["active_well_id"])
    op.create_index("ix_alerts_historical_event_id", "alerts", ["historical_event_id"])
    op.create_index("ix_alerts_status_created", "alerts", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("event_evidence")
    op.drop_table("well_events")
    op.drop_table("documents")
    op.drop_table("wells")
    op.drop_table("formations")
