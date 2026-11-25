"""water logs, affirmations and mindset entries (scripting, gratitude, WOOP plans, affirmation reads)

Revision ID: 0040_water_mindset
Revises: 0039_usage_hour_apps
Create Date: 2026-11-25 12:00:00.000000

Expand-only: three new tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0040_water_mindset'
down_revision: Union[str, None] = '0039_usage_hour_apps'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('water_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('ml', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('ml BETWEEN 1 AND 3000', name='ck_water_logs_ml'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_water_logs_user_id'), 'water_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_water_logs_local_date'), 'water_logs', ['local_date'], unique=False)
    op.create_table('affirmations',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('text', sa.String(length=300), nullable=False),
    sa.Column('category', sa.String(length=12), nullable=False),
    sa.Column('favorite', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("category IN ('confidence','discipline','health','money','calm','study','custom')", name='ck_affirmations_category'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_affirmations_user_id'), 'affirmations', ['user_id'], unique=False)
    op.create_table('mindset_entries',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=12), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('data', JSON, nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('scripting','gratitude','woop','affirm_read')", name='ck_mindset_entries_kind'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_mindset_entries_user_id'), 'mindset_entries', ['user_id'], unique=False)
    op.create_index(op.f('ix_mindset_entries_local_date'), 'mindset_entries', ['local_date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_mindset_entries_local_date'), table_name='mindset_entries')
    op.drop_index(op.f('ix_mindset_entries_user_id'), table_name='mindset_entries')
    op.drop_table('mindset_entries')
    op.drop_index(op.f('ix_affirmations_user_id'), table_name='affirmations')
    op.drop_table('affirmations')
    op.drop_index(op.f('ix_water_logs_local_date'), table_name='water_logs')
    op.drop_index(op.f('ix_water_logs_user_id'), table_name='water_logs')
    op.drop_table('water_logs')
