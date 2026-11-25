"""device usage: top apps per hour (pre-fills "what did you do this hour?")

Revision ID: 0039_usage_hour_apps
Revises: 0038_feed_events
Create Date: 2026-11-25 09:00:00.000000

Expand-only: one nullable JSON column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0039_usage_hour_apps'
down_revision: Union[str, None] = '0038_feed_events'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column('device_usage', sa.Column('hourly_apps', JSON, nullable=True))


def downgrade() -> None:
    op.drop_column('device_usage', 'hourly_apps')
