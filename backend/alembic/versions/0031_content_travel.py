"""content studio items and travel wish list

Revision ID: 0031_content_travel
Revises: 0030_roleplay
Create Date: 2026-11-22 21:00:00.000000

Expand-only: two new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0031_content_travel'
down_revision: Union[str, None] = '0030_roleplay'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('content_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('platform', sa.String(length=10), nullable=False),
    sa.Column('topic', sa.String(length=120), nullable=True),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('script', sa.Text(), nullable=True),
    sa.Column('scheduled_on', sa.Date(), nullable=True),
    sa.Column('published_on', sa.Date(), nullable=True),
    sa.Column('url', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('idea','scripted','recorded','published')", name='ck_content_items_status'),
    sa.CheckConstraint("platform IN ('short','linkedin','youtube','carousel')", name='ck_content_items_platform'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_content_items_user_id'), 'content_items', ['user_id'], unique=False)
    op.create_table('travel_wishes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('destination', sa.String(length=120), nullable=False),
    sa.Column('key', sa.String(length=32), nullable=True),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('planned_on', sa.Date(), nullable=True),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('people', sa.Integer(), nullable=False),
    sa.Column('tier', sa.String(length=8), nullable=False),
    sa.Column('budget_lkr', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('wish','planned','done')", name='ck_travel_wishes_status'),
    sa.CheckConstraint("tier IN ('budget','mid','luxury')", name='ck_travel_wishes_tier'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_travel_wishes_user_id'), 'travel_wishes', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_travel_wishes_user_id'), table_name='travel_wishes')
    op.drop_table('travel_wishes')
    op.drop_index(op.f('ix_content_items_user_id'), table_name='content_items')
    op.drop_table('content_items')
