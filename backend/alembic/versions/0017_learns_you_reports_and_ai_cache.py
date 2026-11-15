"""life os phase 5: weekly 'about you' reports and the AI answer cache

Revision ID: 0017_learns_you
Revises: 0016_ai_workers
Create Date: 2026-11-15 16:00:00.000000

Expand-only: two new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0017_learns_you'
down_revision: Union[str, None] = '0016_ai_workers'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('insight_reports',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('week_start', sa.Date(), nullable=False),
    sa.Column('data', app.models.types.JsonDict, nullable=False),
    sa.Column('findings', app.models.types.JsonDict, nullable=False),
    sa.Column('change', app.models.types.JsonDict, nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('used_ai', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'week_start', name='uq_insight_reports_user_week')
    )
    op.create_index(op.f('ix_insight_reports_user_id'), 'insight_reports', ['user_id'], unique=False)

    op.create_table('ai_cache',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('feature', sa.String(length=64), nullable=False),
    sa.Column('response', sa.Text(), nullable=False),
    sa.Column('tokens', sa.Integer(), nullable=False),
    sa.Column('hits', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'key', name='uq_ai_cache_user_key')
    )
    op.create_index(op.f('ix_ai_cache_user_id'), 'ai_cache', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ai_cache_user_id'), table_name='ai_cache')
    op.drop_table('ai_cache')
    op.drop_index(op.f('ix_insight_reports_user_id'), table_name='insight_reports')
    op.drop_table('insight_reports')
