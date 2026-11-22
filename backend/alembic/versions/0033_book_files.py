"""e-book link on books (Google Drive PDF or any https PDF)

Revision ID: 0033_book_files
Revises: 0032_books
Create Date: 2026-11-23 12:00:00.000000

Expand-only: one nullable column. Older code ignores it, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0033_book_files'
down_revision: Union[str, None] = '0032_books'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('books', sa.Column('file_url', sa.String(length=600), nullable=True))


def downgrade() -> None:
    op.drop_column('books', 'file_url')
