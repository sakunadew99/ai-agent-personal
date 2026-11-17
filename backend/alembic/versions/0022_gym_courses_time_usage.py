"""gym sets, courses, coding profiles, hour-by-hour time entries, daily phone usage

Revision ID: 0022_gym_time
Revises: 0021_subscriptions
Create Date: 2026-11-17 09:00:00.000000

Expand-only: five new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0022_gym_time'
down_revision: Union[str, None] = '0021_subscriptions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _base():
    return [sa.Column('id', sa.Uuid(), nullable=False), sa.Column('user_id', sa.Uuid(), nullable=False)]


def _owner(table: str):
    return [sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'), sa.PrimaryKeyConstraint('id')]


def upgrade() -> None:
    op.create_table('workout_sets', *_base(),
                    sa.Column('workout_id', sa.Uuid(), nullable=False),
                    sa.Column('exercise', sa.String(length=80), nullable=False),
                    sa.Column('set_no', sa.Integer(), nullable=False),
                    sa.Column('weight_kg', sa.Numeric(precision=6, scale=2), nullable=True),
                    sa.Column('reps', sa.Integer(), nullable=True),
                    sa.Column('seconds', sa.Integer(), nullable=True),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint('reps IS NULL OR reps BETWEEN 0 AND 1000', name='ck_workout_sets_reps'),
                    sa.CheckConstraint('weight_kg IS NULL OR weight_kg BETWEEN 0 AND 1000', name='ck_workout_sets_weight'),
                    sa.ForeignKeyConstraint(['workout_id'], ['workouts.id'], ondelete='CASCADE'),
                    *_owner('workout_sets'))
    op.create_index(op.f('ix_workout_sets_user_id'), 'workout_sets', ['user_id'], unique=False)
    op.create_index(op.f('ix_workout_sets_workout_id'), 'workout_sets', ['workout_id'], unique=False)

    op.create_table('courses', *_base(),
                    sa.Column('platform', sa.String(length=40), nullable=False),
                    sa.Column('title', sa.String(length=200), nullable=False),
                    sa.Column('url', sa.String(length=500), nullable=True),
                    sa.Column('status', sa.String(length=10), nullable=False),
                    sa.Column('progress_pct', sa.Integer(), nullable=False),
                    sa.Column('hours_spent', sa.Numeric(precision=7, scale=1), nullable=False),
                    sa.Column('target_date', sa.Date(), nullable=True),
                    sa.Column('certificate_url', sa.String(length=500), nullable=True),
                    sa.Column('notes', sa.Text(), nullable=True),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint("status IN ('planned','active','paused','done')", name='ck_courses_status'),
                    sa.CheckConstraint('progress_pct BETWEEN 0 AND 100', name='ck_courses_progress'),
                    *_owner('courses'))
    op.create_index(op.f('ix_courses_user_id'), 'courses', ['user_id'], unique=False)

    op.create_table('coding_profiles', *_base(),
                    sa.Column('platform', sa.String(length=16), nullable=False),
                    sa.Column('username', sa.String(length=60), nullable=False),
                    sa.Column('stats', app.models.types.JsonDict, nullable=False),
                    sa.Column('history', app.models.types.JsonDict, nullable=False),
                    sa.Column('checked_at', sa.DateTime(timezone=True), nullable=True),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint("platform IN ('leetcode','hackerrank','github','codeforces')", name='ck_coding_profiles_platform'),
                    sa.UniqueConstraint('user_id', 'platform', name='uq_coding_profiles_user_platform'),
                    *_owner('coding_profiles'))
    op.create_index(op.f('ix_coding_profiles_user_id'), 'coding_profiles', ['user_id'], unique=False)

    op.create_table('time_entries', *_base(),
                    sa.Column('local_date', sa.Date(), nullable=False),
                    sa.Column('start_time', sa.Time(), nullable=False),
                    sa.Column('end_time', sa.Time(), nullable=False),
                    sa.Column('category', sa.String(length=16), nullable=False),
                    sa.Column('note', sa.String(length=300), nullable=True),
                    sa.Column('source', sa.String(length=10), nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint("category IN ('work','deep_work','meeting','study','exercise','commute','chores','family','social','rest','entertainment','wasted','sleep','other')",
                                       name='ck_time_entries_category'),
                    sa.CheckConstraint("source IN ('manual','prompt','focus','routine')", name='ck_time_entries_source'),
                    *_owner('time_entries'))
    op.create_index(op.f('ix_time_entries_user_id'), 'time_entries', ['user_id'], unique=False)
    op.create_index(op.f('ix_time_entries_local_date'), 'time_entries', ['local_date'], unique=False)

    op.create_table('device_usage', *_base(),
                    sa.Column('local_date', sa.Date(), nullable=False),
                    sa.Column('total_minutes', sa.Integer(), nullable=False),
                    sa.Column('distracting_minutes', sa.Integer(), nullable=False),
                    sa.Column('productive_minutes', sa.Integer(), nullable=False),
                    sa.Column('pickups', sa.Integer(), nullable=False),
                    sa.Column('apps', app.models.types.JsonDict, nullable=False),
                    sa.Column('hourly', app.models.types.JsonDict, nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
                    sa.UniqueConstraint('user_id', 'local_date', name='uq_device_usage_user_date'),
                    *_owner('device_usage'))
    op.create_index(op.f('ix_device_usage_user_id'), 'device_usage', ['user_id'], unique=False)


def downgrade() -> None:
    for table, extra in [('device_usage', []), ('time_entries', ['local_date']), ('coding_profiles', []), ('courses', []), ('workout_sets', ['workout_id'])]:
        for col in extra:
            op.drop_index(op.f(f'ix_{table}_{col}'), table_name=table)
        op.drop_index(op.f(f'ix_{table}_user_id'), table_name=table)
        op.drop_table(table)
