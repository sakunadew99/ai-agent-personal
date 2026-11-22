"""notes notebook and guided wellness sessions (pelvic floor / Kegel)

Revision ID: 0034_notes_wellness
Revises: 0033_book_files
Create Date: 2026-11-23 15:00:00.000000

Expand-only: two new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0034_notes_wellness'
down_revision: Union[str, None] = '0033_book_files'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('notes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('tags', JSON, nullable=True),
    sa.Column('color', sa.String(length=8), nullable=False),
    sa.Column('pinned', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("color IN ('default','green','blue','amber','red','violet','pink','teal')", name='ck_notes_color'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_notes_user_id'), 'notes', ['user_id'], unique=False)
    op.create_index(op.f('ix_notes_updated_at'), 'notes', ['updated_at'], unique=False)
    op.create_table('wellness_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('level', sa.Integer(), nullable=False),
    sa.Column('sets', sa.Integer(), nullable=False),
    sa.Column('reps', sa.Integer(), nullable=False),
    sa.Column('hold_s', sa.Integer(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('kegel')", name='ck_wellness_sessions_kind'),
    sa.CheckConstraint('level BETWEEN 1 AND 4', name='ck_wellness_sessions_level'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_wellness_sessions_user_id'), 'wellness_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_wellness_sessions_local_date'), 'wellness_sessions', ['local_date'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_wellness_sessions_local_date'), table_name='wellness_sessions')
    op.drop_index(op.f('ix_wellness_sessions_user_id'), table_name='wellness_sessions')
    op.drop_table('wellness_sessions')
    op.drop_index(op.f('ix_notes_updated_at'), table_name='notes')
    op.drop_index(op.f('ix_notes_user_id'), table_name='notes')
    op.drop_table('notes')
