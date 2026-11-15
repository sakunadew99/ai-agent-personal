"""life os phase 2: focus engine (target, break, next step, rating) and avoid habits

Revision ID: 0014_focus_engine
Revises: 0013_routines
Create Date: 2026-11-15 13:00:00.000000

Expand-only: nullable columns and a defaulted habit kind. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0014_focus_engine'
down_revision: Union[str, None] = '0013_routines'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('focus_sessions', sa.Column('target', sa.String(length=200), nullable=True))
    op.add_column('focus_sessions', sa.Column('break_minutes', sa.Integer(), nullable=True))
    op.add_column('focus_sessions', sa.Column('next_step', sa.String(length=300), nullable=True))
    op.add_column('focus_sessions', sa.Column('rating', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_focus_sessions_rating', 'focus_sessions', 'rating IS NULL OR rating BETWEEN 1 AND 5')
    op.add_column('habits', sa.Column('kind', sa.String(length=8), server_default='build', nullable=False))
    op.create_check_constraint('ck_habits_kind', 'habits', "kind IN ('build','avoid')")


def downgrade() -> None:
    op.drop_constraint('ck_habits_kind', 'habits', type_='check')
    op.drop_column('habits', 'kind')
    op.drop_constraint('ck_focus_sessions_rating', 'focus_sessions', type_='check')
    op.drop_column('focus_sessions', 'rating')
    op.drop_column('focus_sessions', 'next_step')
    op.drop_column('focus_sessions', 'break_minutes')
    op.drop_column('focus_sessions', 'target')
