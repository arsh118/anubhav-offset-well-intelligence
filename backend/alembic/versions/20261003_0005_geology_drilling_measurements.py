"""Add formation geology/reservoir descriptors and measured drilling samples."""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "20261003_0005"
down_revision: Union[str, None] = "20261003_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for name, type_ in (
        ("lithology", sa.String(length=120)),
        ("geological_zone", sa.String(length=120)),
        ("reservoir_zone", sa.String(length=120)),
        ("pressure_indicator", sa.String(length=32)),
        ("porosity_percent", sa.Numeric(precision=5, scale=2)),
        ("permeability_md", sa.Numeric(precision=10, scale=2)),
    ):
        op.add_column("well_formation_intervals", sa.Column(name, type_, nullable=True))

    op.create_table(
        "drilling_measurements",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("well_id", sa.String(length=36), nullable=False),
        sa.Column("sampled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("measured_depth_m", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("true_vertical_depth_m", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("mud_weight_sg", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column("ecd_sg", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column("rop_m_per_hr", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("wob_kn", sa.Numeric(precision=7, scale=2), nullable=True),
        sa.Column("rpm", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("torque_knm", sa.Numeric(precision=7, scale=2), nullable=True),
        sa.Column("standpipe_pressure_mpa", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("inclination_deg", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("azimuth_deg", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("casing_depth_m", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("cementing_metadata", sa.Text(), nullable=True),
        sa.Column(
            "source",
            sa.String(length=255),
            server_default="Representative Synthetic Demo Data",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("measured_depth_m >= 0", name="ck_drilling_measurement_depth_nonnegative"),
        sa.CheckConstraint(
            "true_vertical_depth_m IS NULL OR true_vertical_depth_m >= 0",
            name="ck_drilling_tvd_nonnegative",
        ),
        sa.CheckConstraint("mud_weight_sg IS NULL OR mud_weight_sg > 0", name="ck_drilling_mud_weight_positive"),
        sa.CheckConstraint("ecd_sg IS NULL OR ecd_sg > 0", name="ck_drilling_ecd_positive"),
        sa.CheckConstraint("rop_m_per_hr IS NULL OR rop_m_per_hr >= 0", name="ck_drilling_rop_nonnegative"),
        sa.CheckConstraint("wob_kn IS NULL OR wob_kn >= 0", name="ck_drilling_wob_nonnegative"),
        sa.CheckConstraint("rpm IS NULL OR rpm >= 0", name="ck_drilling_rpm_nonnegative"),
        sa.CheckConstraint("torque_knm IS NULL OR torque_knm >= 0", name="ck_drilling_torque_nonnegative"),
        sa.CheckConstraint(
            "standpipe_pressure_mpa IS NULL OR standpipe_pressure_mpa >= 0",
            name="ck_drilling_spp_nonnegative",
        ),
        sa.CheckConstraint(
            "inclination_deg IS NULL OR (inclination_deg >= 0 AND inclination_deg <= 180)",
            name="ck_drilling_inclination_range",
        ),
        sa.CheckConstraint(
            "azimuth_deg IS NULL OR (azimuth_deg >= 0 AND azimuth_deg < 360)",
            name="ck_drilling_azimuth_range",
        ),
        sa.CheckConstraint(
            "casing_depth_m IS NULL OR casing_depth_m >= 0",
            name="ck_drilling_casing_depth_nonnegative",
        ),
        sa.ForeignKeyConstraint(["well_id"], ["wells.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("well_id", "sampled_at", name="uq_drilling_measurement_well_time"),
    )
    op.create_index(
        "ix_drilling_measurements_well_depth", "drilling_measurements", ["well_id", "measured_depth_m"]
    )
    op.create_index("ix_drilling_measurements_well_time", "drilling_measurements", ["well_id", "sampled_at"])


def downgrade() -> None:
    op.drop_index("ix_drilling_measurements_well_time", table_name="drilling_measurements")
    op.drop_index("ix_drilling_measurements_well_depth", table_name="drilling_measurements")
    op.drop_table("drilling_measurements")
    for name in (
        "permeability_md",
        "porosity_percent",
        "pressure_indicator",
        "reservoir_zone",
        "geological_zone",
        "lithology",
    ):
        op.drop_column("well_formation_intervals", name)
