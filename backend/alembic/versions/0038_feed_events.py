"""learning reels: what you watched, liked, skipped, saved or hid (drives the "For you" ranking)

Revision ID: 0038_feed_events
Revises: 0037_body_measurements
Create Date: 2026-11-24 10:00:00.000000

Expand-only: one new table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0038_feed_events'
down_revision: Union[str, None] = '0037_body_measurements'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('feed_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('video_id', sa.String(length=40), nullable=False),
    sa.Column('channel_id', sa.String(length=40), nullable=True),
    sa.Column('category', sa.String(length=12), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=True),
    sa.Column('action', sa.String(length=10), nullable=False),
    sa.Column('seconds', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("action IN ('view','complete','like','unlike','save','skip','hide')", name='ck_feed_events_action'),
    sa.CheckConstraint('seconds BETWEEN 0 AND 86400', name='ck_feed_events_seconds'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_feed_events_user_id'), 'feed_events', ['user_id'], unique=False)
    op.create_index('ix_feed_events_user_video', 'feed_events', ['user_id', 'video_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_feed_events_user_video', table_name='feed_events')
    op.drop_index(op.f('ix_feed_events_user_id'), table_name='feed_events')
    op.drop_table('feed_events')
