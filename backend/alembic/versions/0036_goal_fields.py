"""goals: start date, priority and manual progress %

Revision ID: 0036_goal_fields
Revises: 0035_discipline
Create Date: 2026-11-23 20:00:00.000000

Expand-only: three new columns (priority has a server default, so existing rows get 'medium').
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0036_goal_fields'
down_revision: Union[str, None] = '0035_discipline'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('goals', sa.Column('start_date', sa.Date(), nullable=True))
    op.add_column('goals', sa.Column('priority', sa.String(length=8), server_default='medium', nullable=False))
    op.add_column('goals', sa.Column('progress_pct', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_goals_priority', 'goals', "priority IN ('low','medium','high')")
    op.create_check_constraint('ck_goals_progress_pct', 'goals', 'progress_pct IS NULL OR progress_pct BETWEEN 0 AND 100')


def downgrade() -> None:
    op.drop_constraint('ck_goals_progress_pct', 'goals', type_='check')
    op.drop_constraint('ck_goals_priority', 'goals', type_='check')
    op.drop_column('goals', 'progress_pct')
    op.drop_column('goals', 'priority')
    op.drop_column('goals', 'start_date')
