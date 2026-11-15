"""life os phase 6: news sources, items, daily digests, and news interests on the profile

Revision ID: 0018_news_digest
Revises: 0017_learns_you
Create Date: 2026-11-15 17:00:00.000000

Expand-only: three new tables and one nullable profile column. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0018_news_digest'
down_revision: Union[str, None] = '0017_learns_you'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user_profiles', sa.Column('news_interests', app.models.types.JsonDict, nullable=True))

    op.create_table('news_sources',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('topic', sa.String(length=16), nullable=False),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('last_fetched_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("topic IN ('ai','tech','sri_lanka','markets','learning','other')", name='ck_news_sources_topic'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'url', name='uq_news_sources_user_url')
    )
    op.create_index(op.f('ix_news_sources_user_id'), 'news_sources', ['user_id'], unique=False)

    op.create_table('news_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('source_id', sa.Uuid(), nullable=False),
    sa.Column('url', sa.String(length=1000), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('excerpt', sa.Text(), nullable=True),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('topic', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=10), server_default='new', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('new','saved','dismissed')", name='ck_news_items_status'),
    sa.ForeignKeyConstraint(['source_id'], ['news_sources.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'url', name='uq_news_items_user_url')
    )
    op.create_index(op.f('ix_news_items_source_id'), 'news_items', ['source_id'], unique=False)
    op.create_index('ix_news_items_user_published', 'news_items', ['user_id', 'published_at'], unique=False)
    op.create_index(op.f('ix_news_items_user_id'), 'news_items', ['user_id'], unique=False)

    op.create_table('news_digests',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('intro', sa.Text(), nullable=False),
    sa.Column('items', app.models.types.JsonDict, nullable=False),
    sa.Column('used_ai', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'local_date', name='uq_news_digests_user_date')
    )
    op.create_index(op.f('ix_news_digests_user_id'), 'news_digests', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_news_digests_user_id'), table_name='news_digests')
    op.drop_table('news_digests')
    op.drop_index(op.f('ix_news_items_user_id'), table_name='news_items')
    op.drop_index('ix_news_items_user_published', table_name='news_items')
    op.drop_index(op.f('ix_news_items_source_id'), table_name='news_items')
    op.drop_table('news_items')
    op.drop_index(op.f('ix_news_sources_user_id'), table_name='news_sources')
    op.drop_table('news_sources')
    op.drop_column('user_profiles', 'news_interests')
