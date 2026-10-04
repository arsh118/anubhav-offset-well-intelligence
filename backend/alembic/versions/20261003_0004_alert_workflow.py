"""Add alert acknowledgement workflow and engineer note history."""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "20261003_0004"
down_revision: Union[str, None] = "20261003_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("alerts") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=9),
            type_=sa.String(length=12),
            existing_nullable=False,
        )
        batch_op.create_unique_constraint(
            "uq_alert_active_well_event", ["active_well_id", "historical_event_id"]
        )

    op.create_table(
        "alert_notes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("alert_id", sa.String(length=36), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("author", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alert_notes_alert_id", "alert_notes", ["alert_id"])


def downgrade() -> None:
    op.drop_index("ix_alert_notes_alert_id", table_name="alert_notes")
    op.drop_table("alert_notes")
    op.execute("UPDATE alerts SET status = 'open' WHERE status = 'acknowledged'")
    with op.batch_alter_table("alerts") as batch_op:
        batch_op.drop_constraint("uq_alert_active_well_event", type_="unique")
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=12),
            type_=sa.String(length=9),
            existing_nullable=False,
        )
