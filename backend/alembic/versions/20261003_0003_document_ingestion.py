"""Add uploaded document metadata and processing lifecycle."""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "20261003_0003"
down_revision: Union[str, None] = "20261003_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("documents") as batch_op:
        batch_op.alter_column(
            "processing_status",
            existing_type=sa.String(length=9),
            type_=sa.String(length=10),
            existing_nullable=False,
        )
        batch_op.add_column(
            sa.Column(
                "origin",
                sa.String(length=17),
                server_default="seeded_demo",
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("storage_path", sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column("content_sha256", sa.String(length=64), nullable=True))

    op.execute("UPDATE documents SET processing_status = 'uploaded' WHERE processing_status = 'pending'")


def downgrade() -> None:
    op.execute("UPDATE documents SET processing_status = 'failed' WHERE processing_status = 'processing'")
    op.execute("UPDATE documents SET processing_status = 'pending' WHERE processing_status = 'uploaded'")
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_column("content_sha256")
        batch_op.drop_column("storage_path")
        batch_op.drop_column("origin")
        batch_op.alter_column(
            "processing_status",
            existing_type=sa.String(length=10),
            type_=sa.String(length=9),
            existing_nullable=False,
        )
