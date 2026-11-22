"""soft-skills role-play sessions

Revision ID: 0030_roleplay
Revises: 0029_dreams
Create Date: 2026-11-22 18:00:00.000000

Expand-only: one new table. Older code ignores it, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0030_roleplay'
down_revision: Union[str, None] = '0029_dreams'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('roleplay_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('scenario', sa.String(length=32), nullable=False),
    sa.Column('skill', sa.String(length=20), nullable=False),
    sa.Column('messages', JSON, nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('score', sa.Integer(), nullable=True),
    sa.Column('feedback', JSON, nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("status IN ('open','done')", name='ck_roleplay_sessions_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_roleplay_sessions_user_id'), 'roleplay_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_roleplay_sessions_created_at'), 'roleplay_sessions', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_roleplay_sessions_created_at'), table_name='roleplay_sessions')
    op.drop_index(op.f('ix_roleplay_sessions_user_id'), table_name='roleplay_sessions')
    op.drop_table('roleplay_sessions')
