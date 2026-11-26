"""user profile: app preferences (notification centre, onboarding, Today card order, pinned screens)

Revision ID: 0041_app_prefs
Revises: 0040_water_mindset
Create Date: 2026-11-26 10:00:00.000000

Expand-only: one nullable JSON column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0041_app_prefs'
down_revision: Union[str, None] = '0040_water_mindset'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column('user_profiles', sa.Column('app_prefs', JSON, nullable=True))


def downgrade() -> None:
    op.drop_column('user_profiles', 'app_prefs')
