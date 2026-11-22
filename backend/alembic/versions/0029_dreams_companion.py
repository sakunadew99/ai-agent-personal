"""dream-to-action goals (horizon, why, success, path) and how often the companion may ask

Revision ID: 0029_dreams
Revises: 0028_fsrs
Create Date: 2026-11-22 12:00:00.000000

Expand-only: nullable goal columns, a self-link for sub-goals, and two check-in settings columns with a default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0029_dreams'
down_revision: Union[str, None] = '0028_fsrs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column('goals', sa.Column('horizon', sa.String(length=8), nullable=True))
    op.add_column('goals', sa.Column('why', sa.Text(), nullable=True))
    op.add_column('goals', sa.Column('success', sa.Text(), nullable=True))
    op.add_column('goals', sa.Column('skills', JSON, nullable=True))
    op.add_column('goals', sa.Column('resources', JSON, nullable=True))
    op.add_column('goals', sa.Column('challenges', JSON, nullable=True))
    op.add_column('goals', sa.Column('next_action', sa.String(length=300), nullable=True))
    op.add_column('goals', sa.Column('parent_id', sa.Uuid(), nullable=True))
    op.create_index(op.f('ix_goals_parent_id'), 'goals', ['parent_id'], unique=False)
    op.create_foreign_key('fk_goals_parent_id_goals', 'goals', 'goals', ['parent_id'], ['id'], ondelete='SET NULL')
    op.create_check_constraint('ck_goals_horizon', 'goals', "horizon IS NULL OR horizon IN ('today','week','month','year','3y','5y','10y')")
    op.add_column('checkin_settings', sa.Column('ask_frequency', sa.String(length=10), server_default='useful', nullable=False))
    op.add_column('checkin_settings', sa.Column('last_question_on', sa.Date(), nullable=True))
    op.create_check_constraint('ck_checkin_settings_ask', 'checkin_settings', "ask_frequency IN ('daily','few_weekly','useful','off')")


def downgrade() -> None:
    op.drop_constraint('ck_checkin_settings_ask', 'checkin_settings', type_='check')
    op.drop_column('checkin_settings', 'last_question_on')
    op.drop_column('checkin_settings', 'ask_frequency')
    op.drop_constraint('ck_goals_horizon', 'goals', type_='check')
    op.drop_constraint('fk_goals_parent_id_goals', 'goals', type_='foreignkey')
    op.drop_index(op.f('ix_goals_parent_id'), table_name='goals')
    for col in ('parent_id', 'next_action', 'challenges', 'resources', 'skills', 'success', 'why', 'horizon'):
        op.drop_column('goals', col)
