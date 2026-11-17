"""privacy: may the journal and the day tracker go to AI, and how long to keep tracking data

Revision ID: 0023_privacy
Revises: 0022_gym_time
Create Date: 2026-11-18 09:00:00.000000

Expand-only: three columns with server defaults. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0023_privacy'
down_revision: Union[str, None] = '0022_gym_time'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ai_settings', sa.Column('share_journal', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('ai_settings', sa.Column('share_activity', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('ai_settings', sa.Column('keep_activity_days', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('ai_settings', 'keep_activity_days')
    op.drop_column('ai_settings', 'share_activity')
    op.drop_column('ai_settings', 'share_journal')
