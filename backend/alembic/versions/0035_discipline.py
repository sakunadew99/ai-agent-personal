"""personal discipline & digital wellbeing: commitments and check-ins

Revision ID: 0035_discipline
Revises: 0034_notes_wellness
Create Date: 2026-11-23 18:00:00.000000

Expand-only: two new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0035_discipline'
down_revision: Union[str, None] = '0034_notes_wellness'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('discipline_goals',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('reasons', sa.Text(), nullable=True),
    sa.Column('replacements', JSON, nullable=True),
    sa.Column('started_on', sa.Date(), nullable=False),
    sa.Column('streak_start', sa.Date(), nullable=False),
    sa.Column('best_streak', sa.Integer(), nullable=False),
    sa.Column('resets', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('porn_free','nofap','screen','custom')", name='ck_discipline_goals_kind'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_discipline_goals_user_id'), 'discipline_goals', ['user_id'], unique=False)
    op.create_table('discipline_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('goal_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('trigger', sa.String(length=20), nullable=True),
    sa.Column('intensity', sa.Integer(), nullable=True),
    sa.Column('action', sa.String(length=80), nullable=True),
    sa.Column('stayed', sa.Boolean(), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('local_hour', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('ok','urge','motivation','reset')", name='ck_discipline_events_kind'),
    sa.CheckConstraint('intensity IS NULL OR intensity BETWEEN 1 AND 5', name='ck_discipline_events_intensity'),
    sa.ForeignKeyConstraint(['goal_id'], ['discipline_goals.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_discipline_events_user_id'), 'discipline_events', ['user_id'], unique=False)
    op.create_index(op.f('ix_discipline_events_goal_id'), 'discipline_events', ['goal_id'], unique=False)
    op.create_index(op.f('ix_discipline_events_local_date'), 'discipline_events', ['local_date'], unique=False)


def downgrade() -> None:
    for c in ('local_date', 'goal_id', 'user_id'):
        op.drop_index(op.f(f'ix_discipline_events_{c}'), table_name='discipline_events')
    op.drop_table('discipline_events')
    op.drop_index(op.f('ix_discipline_goals_user_id'), table_name='discipline_goals')
    op.drop_table('discipline_goals')
