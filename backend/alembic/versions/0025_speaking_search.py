"""speaking coach sessions and cached search vectors

Revision ID: 0025_speak
Revises: 0024_media
Create Date: 2026-11-20 09:00:00.000000

Expand-only: two new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0025_speak'
down_revision: Union[str, None] = '0024_media'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('speaking_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('lang', sa.String(length=2), nullable=False),
    sa.Column('topic', sa.String(length=200), nullable=True),
    sa.Column('transcript', sa.Text(), nullable=False),
    sa.Column('seconds', sa.Integer(), nullable=False),
    sa.Column('words', sa.Integer(), nullable=False),
    sa.Column('wpm', sa.Integer(), nullable=False),
    sa.Column('fillers', sa.Integer(), nullable=False),
    sa.Column('score', sa.Integer(), nullable=False),
    sa.Column('details', JSON, nullable=True),
    sa.Column('feedback', sa.Text(), nullable=True),
    sa.Column('source', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("lang IN ('en','de')", name='ck_speaking_sessions_lang'),
    sa.CheckConstraint("source IN ('device','whisper')", name='ck_speaking_sessions_source'),
    sa.CheckConstraint('seconds BETWEEN 5 AND 1800', name='ck_speaking_sessions_seconds'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_speaking_sessions_user_id'), 'speaking_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_speaking_sessions_created_at'), 'speaking_sessions', ['created_at'], unique=False)
    op.create_table('text_vectors',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('text_hash', sa.String(length=64), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=False),
    sa.Column('vector', JSON, nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'text_hash', 'model', name='uq_text_vectors_user_hash_model')
    )
    op.create_index(op.f('ix_text_vectors_user_id'), 'text_vectors', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_text_vectors_user_id'), table_name='text_vectors')
    op.drop_table('text_vectors')
    op.drop_index(op.f('ix_speaking_sessions_created_at'), table_name='speaking_sessions')
    op.drop_index(op.f('ix_speaking_sessions_user_id'), table_name='speaking_sessions')
    op.drop_table('speaking_sessions')
