"""life os phase 3: exam coach (plans, scores, study and practice logs)

Revision ID: 0015_exam_coach
Revises: 0014_focus_engine
Create Date: 2026-11-15 14:00:00.000000

Expand-only: three new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0015_exam_coach'
down_revision: Union[str, None] = '0014_focus_engine'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('exam_plans',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('exam', sa.String(length=8), nullable=False),
    sa.Column('variant', sa.String(length=16), nullable=False),
    sa.Column('target_score', sa.Numeric(precision=5, scale=1), nullable=False),
    sa.Column('exam_date', sa.Date(), nullable=False),
    sa.Column('date_is_estimate', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('daily_minutes', sa.Integer(), nullable=False),
    sa.Column('study_days', app.models.types.JsonDict, nullable=False),
    sa.Column('study_time', sa.Time(), nullable=True),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("exam IN ('ielts','goethe')", name='ck_exam_plans_exam'),
    sa.CheckConstraint('daily_minutes BETWEEN 10 AND 240', name='ck_exam_plans_minutes'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'exam', name='uq_exam_plans_user_exam')
    )
    op.create_index(op.f('ix_exam_plans_user_id'), 'exam_plans', ['user_id'], unique=False)

    op.create_table('exam_scores',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('plan_id', sa.Uuid(), nullable=False),
    sa.Column('skill', sa.String(length=16), nullable=False),
    sa.Column('score', sa.Numeric(precision=5, scale=1), nullable=False),
    sa.Column('taken_on', sa.Date(), nullable=False),
    sa.Column('source', sa.String(length=8), nullable=False),
    sa.Column('note', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("source IN ('mock','practice','real','estimate')", name='ck_exam_scores_source'),
    sa.ForeignKeyConstraint(['plan_id'], ['exam_plans.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_exam_scores_plan_date', 'exam_scores', ['plan_id', 'taken_on'], unique=False)
    op.create_index(op.f('ix_exam_scores_user_id'), 'exam_scores', ['user_id'], unique=False)

    op.create_table('exam_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('plan_id', sa.Uuid(), nullable=False),
    sa.Column('skill', sa.String(length=16), nullable=False),
    sa.Column('kind', sa.String(length=12), nullable=False),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('prompt', sa.Text(), nullable=True),
    sa.Column('answer', sa.Text(), nullable=True),
    sa.Column('feedback', app.models.types.JsonDict, nullable=True),
    sa.Column('estimated_score', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('used_ai', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('practice','vocab','mock','writing','speaking')", name='ck_exam_logs_kind'),
    sa.CheckConstraint('minutes BETWEEN 0 AND 600', name='ck_exam_logs_minutes'),
    sa.ForeignKeyConstraint(['plan_id'], ['exam_plans.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_exam_logs_plan_date', 'exam_logs', ['plan_id', 'local_date'], unique=False)
    op.create_index(op.f('ix_exam_logs_user_id'), 'exam_logs', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_exam_logs_user_id'), table_name='exam_logs')
    op.drop_index('ix_exam_logs_plan_date', table_name='exam_logs')
    op.drop_table('exam_logs')
    op.drop_index(op.f('ix_exam_scores_user_id'), table_name='exam_scores')
    op.drop_index('ix_exam_scores_plan_date', table_name='exam_scores')
    op.drop_table('exam_scores')
    op.drop_index(op.f('ix_exam_plans_user_id'), table_name='exam_plans')
    op.drop_table('exam_plans')
