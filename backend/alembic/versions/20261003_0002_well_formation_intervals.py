"""Add depth intervals and room for the expanded event taxonomy."""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "20261003_0002"
down_revision: Union[str, None] = "20261003_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("well_events") as batch_op:
        batch_op.alter_column(
            "event_type",
            existing_type=sa.String(length=20),
            type_=sa.String(length=32),
            existing_nullable=False,
        )

    op.create_table(
        "well_formation_intervals",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("well_id", sa.String(length=36), nullable=False),
        sa.Column("formation_id", sa.String(length=36), nullable=False),
        sa.Column("top_depth", sa.Numeric(10, 2), nullable=False),
        sa.Column("base_depth", sa.Numeric(10, 2), nullable=False),
        sa.Column("depth_unit", sa.String(length=10), server_default="m", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("top_depth >= 0", name="ck_well_formation_top_nonnegative"),
        sa.CheckConstraint("base_depth >= top_depth", name="ck_well_formation_depth_order"),
        sa.ForeignKeyConstraint(["well_id"], ["wells.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["formation_id"], ["formations.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("well_id", "formation_id", "top_depth", name="uq_well_formation_top"),
    )
    op.create_index(
        "ix_well_formation_intervals_well_depth",
        "well_formation_intervals",
        ["well_id", "top_depth", "base_depth"],
    )
    op.create_index(
        "ix_well_formation_intervals_formation_id",
        "well_formation_intervals",
        ["formation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_well_formation_intervals_formation_id", table_name="well_formation_intervals")
    op.drop_index("ix_well_formation_intervals_well_depth", table_name="well_formation_intervals")
    op.drop_table("well_formation_intervals")
    op.execute(
        "UPDATE well_events SET event_type = 'other' "
        "WHERE event_type NOT IN ('stuck_pipe', 'loss_circulation', 'influx', "
        "'wellbore_instability', 'equipment_failure', 'other')"
    )
    with op.batch_alter_table("well_events") as batch_op:
        batch_op.alter_column(
            "event_type",
            existing_type=sa.String(length=32),
            type_=sa.String(length=20),
            existing_nullable=False,
        )
