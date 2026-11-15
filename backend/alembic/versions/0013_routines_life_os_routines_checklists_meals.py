"""life os phase 1: routines, checklists, meal logs, work and gym days

Revision ID: 0013_routines
Revises: 0012_balance_vault
Create Date: 2026-11-15 12:00:00.000000

Expand-only: new tables and two nullable profile columns. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0013_routines'
down_revision: Union[str, None] = '0012_balance_vault'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_profiles', sa.Column('work_days', app.models.types.JsonDict, nullable=True))
    op.add_column('user_profiles', sa.Column('gym_days', app.models.types.JsonDict, nullable=True))

    op.create_table('routines',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('icon', sa.String(length=8), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=True),
    sa.Column('duration_minutes', sa.Integer(), nullable=False),
    sa.Column('day_rule', sa.String(length=8), server_default='fixed', nullable=False),
    sa.Column('days', app.models.types.JsonDict, nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('routine','checklist')", name='ck_routines_kind'),
    sa.CheckConstraint('duration_minutes BETWEEN 5 AND 720', name='ck_routines_duration'),
    sa.CheckConstraint("day_rule IN ('fixed','gym','work','off')", name='ck_routines_day_rule'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_routines_user_id'), 'routines', ['user_id'], unique=False)

    op.create_table('routine_steps',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('routine_id', sa.Uuid(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('detail', sa.String(length=200), nullable=True),
    sa.Column('essential', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['routine_id'], ['routines.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_routine_steps_routine_id'), 'routine_steps', ['routine_id'], unique=False)
    op.create_index(op.f('ix_routine_steps_user_id'), 'routine_steps', ['user_id'], unique=False)

    op.create_table('routine_runs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('routine_id', sa.Uuid(), nullable=False),
    sa.Column('run_date', sa.Date(), nullable=False),
    sa.Column('mode', sa.String(length=8), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('done_step_ids', app.models.types.JsonDict, nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('open','done','skipped')", name='ck_routine_runs_status'),
    sa.CheckConstraint("mode IN ('full','short')", name='ck_routine_runs_mode'),
    sa.ForeignKeyConstraint(['routine_id'], ['routines.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('routine_id', 'run_date', name='uq_routine_runs_routine_date')
    )
    op.create_index(op.f('ix_routine_runs_routine_id'), 'routine_runs', ['routine_id'], unique=False)
    op.create_index(op.f('ix_routine_runs_user_id'), 'routine_runs', ['user_id'], unique=False)
    op.create_index('ix_routine_runs_user_date', 'routine_runs', ['user_id', 'run_date'], unique=False)

    op.create_table('meal_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('meal', sa.String(length=10), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('slow', sa.Boolean(), nullable=False),
    sa.Column('no_screen', sa.Boolean(), nullable=False),
    sa.Column('upright', sa.Boolean(), nullable=False),
    sa.Column('stopped_80', sa.Boolean(), nullable=False),
    sa.Column('walked_after', sa.Boolean(), nullable=False),
    sa.Column('note', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("meal IN ('breakfast','lunch','dinner','snack')", name='ck_meal_logs_meal'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_meal_logs_local_date'), 'meal_logs', ['local_date'], unique=False)
    op.create_index(op.f('ix_meal_logs_user_id'), 'meal_logs', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_meal_logs_user_id'), table_name='meal_logs')
    op.drop_index(op.f('ix_meal_logs_local_date'), table_name='meal_logs')
    op.drop_table('meal_logs')
    op.drop_index('ix_routine_runs_user_date', table_name='routine_runs')
    op.drop_index(op.f('ix_routine_runs_user_id'), table_name='routine_runs')
    op.drop_index(op.f('ix_routine_runs_routine_id'), table_name='routine_runs')
    op.drop_table('routine_runs')
    op.drop_index(op.f('ix_routine_steps_user_id'), table_name='routine_steps')
    op.drop_index(op.f('ix_routine_steps_routine_id'), table_name='routine_steps')
    op.drop_table('routine_steps')
    op.drop_index(op.f('ix_routines_user_id'), table_name='routines')
    op.drop_table('routines')
    op.drop_column('user_profiles', 'gym_days')
    op.drop_column('user_profiles', 'work_days')
