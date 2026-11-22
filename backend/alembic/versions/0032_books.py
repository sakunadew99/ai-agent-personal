"""reading: books, reading sessions, yearly reading goal

Revision ID: 0032_books
Revises: 0031_content_travel
Create Date: 2026-11-23 09:00:00.000000

Expand-only: two new tables and two nullable profile columns. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0032_books'
down_revision: Union[str, None] = '0031_content_travel'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table('books',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('author', sa.String(length=200), nullable=False),
    sa.Column('total_pages', sa.Integer(), nullable=True),
    sa.Column('current_page', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('format', sa.String(length=8), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=True),
    sa.Column('cover_url', sa.String(length=500), nullable=True),
    sa.Column('source_key', sa.String(length=80), nullable=True),
    sa.Column('started_on', sa.Date(), nullable=True),
    sa.Column('finished_on', sa.Date(), nullable=True),
    sa.Column('rating', sa.Integer(), nullable=True),
    sa.Column('highlights', JSON, nullable=True),
    sa.Column('takeaways', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('want','reading','finished','paused')", name='ck_books_status'),
    sa.CheckConstraint("format IN ('paper','ebook','audio')", name='ck_books_format'),
    sa.CheckConstraint('rating IS NULL OR rating BETWEEN 1 AND 5', name='ck_books_rating'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'title', 'author', name='uq_books_user_title_author'))
    op.create_index(op.f('ix_books_user_id'), 'books', ['user_id'], unique=False)
    op.create_table('book_sessions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('book_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('from_page', sa.Integer(), nullable=False),
    sa.Column('to_page', sa.Integer(), nullable=False),
    sa.Column('pages', sa.Integer(), nullable=False),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('pages >= 0', name='ck_book_sessions_pages'),
    sa.CheckConstraint('minutes BETWEEN 0 AND 600', name='ck_book_sessions_minutes'),
    sa.ForeignKeyConstraint(['book_id'], ['books.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_book_sessions_user_id'), 'book_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_book_sessions_book_id'), 'book_sessions', ['book_id'], unique=False)
    op.create_index(op.f('ix_book_sessions_local_date'), 'book_sessions', ['local_date'], unique=False)
    op.add_column('user_profiles', sa.Column('reading_goal_books', sa.Integer(), nullable=True))
    op.add_column('user_profiles', sa.Column('reading_daily_minutes', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_profiles', 'reading_daily_minutes')
    op.drop_column('user_profiles', 'reading_goal_books')
    for c in ('local_date', 'book_id', 'user_id'):
        op.drop_index(op.f(f'ix_book_sessions_{c}'), table_name='book_sessions')
    op.drop_table('book_sessions')
    op.drop_index(op.f('ix_books_user_id'), table_name='books')
    op.drop_table('books')
