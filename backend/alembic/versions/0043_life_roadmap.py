"""life roadmap: saved roadmap steps (with a measurable target) and saved daily / weekly / monthly / yearly reviews

Revision ID: 0043_life_roadmap
Revises: 0042_money_plan
Create Date: 2026-11-28 18:00:00.000000

Expand-only: two new tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0043_life_roadmap'
down_revision: Union[str, None] = '0042_money_plan'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('roadmap_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('phase', sa.String(length=12), nullable=False),
    sa.Column('area', sa.String(length=12), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('metric', sa.String(length=32), nullable=False),
    sa.Column('target_value', sa.Numeric(18, 2), nullable=True),
    sa.Column('target_date', sa.Date(), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('source', sa.String(length=8), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("phase IN ('now','m1_3','m3_6','m6_12','y1_3')", name='ck_roadmap_items_phase'),
    sa.CheckConstraint("area IN ('money','learn','earn','career','health','mind')", name='ck_roadmap_items_area'),
    sa.CheckConstraint("status IN ('todo','doing','done','dropped')", name='ck_roadmap_items_status'),
    sa.CheckConstraint("source IN ('auto','user','ai')", name='ck_roadmap_items_source'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_roadmap_items_user_id'), 'roadmap_items', ['user_id'], unique=False)

    op.create_table('roadmap_reviews',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('data', JSON, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('daily','weekly','monthly','yearly')", name='ck_roadmap_reviews_kind'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'kind', 'period_start', name='uq_roadmap_reviews_user_kind_period'))
    op.create_index(op.f('ix_roadmap_reviews_user_id'), 'roadmap_reviews', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_roadmap_reviews_user_id'), table_name='roadmap_reviews')
    op.drop_table('roadmap_reviews')
    op.drop_index(op.f('ix_roadmap_items_user_id'), table_name='roadmap_items')
    op.drop_table('roadmap_items')
