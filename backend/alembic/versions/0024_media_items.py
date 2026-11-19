"""your own video library (Google Drive / YouTube / web links)

Revision ID: 0024_media
Revises: 0023_privacy
Create Date: 2026-11-19 09:00:00.000000

Expand-only: one new table. Older code ignores it, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0024_media'
down_revision: Union[str, None] = '0023_privacy'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('media_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('url', sa.String(length=600), nullable=False),
    sa.Column('provider', sa.String(length=8), nullable=False),
    sa.Column('file_id', sa.String(length=120), nullable=True),
    sa.Column('folder', sa.String(length=60), nullable=False),
    sa.Column('minutes_watched', sa.Integer(), nullable=False),
    sa.Column('last_opened_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("provider IN ('drive','youtube','web')", name='ck_media_items_provider'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'url', name='uq_media_items_user_url')
    )
    op.create_index(op.f('ix_media_items_user_id'), 'media_items', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_media_items_user_id'), table_name='media_items')
    op.drop_table('media_items')
