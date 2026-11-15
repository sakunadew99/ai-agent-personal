"""life os phase 4: AI workers and their daily notes

Revision ID: 0016_ai_workers
Revises: 0015_exam_coach
Create Date: 2026-11-15 15:00:00.000000

Expand-only: two new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0016_ai_workers'
down_revision: Union[str, None] = '0015_exam_coach'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ai_workers',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('key', sa.String(length=32), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('run_time', sa.Time(), nullable=False),
    sa.Column('days', app.models.types.JsonDict, nullable=False),
    sa.Column('use_ai', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('daily_token_budget', sa.Integer(), server_default='3000', nullable=False),
    sa.Column('last_run_date', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('daily_token_budget BETWEEN 0 AND 100000', name='ck_ai_workers_budget'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'key', name='uq_ai_workers_user_key')
    )
    op.create_index(op.f('ix_ai_workers_user_id'), 'ai_workers', ['user_id'], unique=False)

    op.create_table('worker_notes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('worker_key', sa.String(length=32), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('facts', app.models.types.JsonDict, nullable=False),
    sa.Column('actions', app.models.types.JsonDict, nullable=False),
    sa.Column('used_ai', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('status', sa.String(length=10), server_default='new', nullable=False),
    sa.Column('feedback', sa.String(length=4), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('new','read','done','dismissed')", name='ck_worker_notes_status'),
    sa.CheckConstraint("feedback IS NULL OR feedback IN ('up','down')", name='ck_worker_notes_feedback'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'worker_key', 'local_date', name='uq_worker_notes_user_worker_date')
    )
    op.create_index('ix_worker_notes_user_date', 'worker_notes', ['user_id', 'local_date'], unique=False)
    op.create_index(op.f('ix_worker_notes_user_id'), 'worker_notes', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_worker_notes_user_id'), table_name='worker_notes')
    op.drop_index('ix_worker_notes_user_date', table_name='worker_notes')
    op.drop_table('worker_notes')
    op.drop_index(op.f('ix_ai_workers_user_id'), table_name='ai_workers')
    op.drop_table('ai_workers')
