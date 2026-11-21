"""FSRS spaced repetition: stability and difficulty per flashcard

Revision ID: 0028_fsrs
Revises: 0027_skin
Create Date: 2026-11-22 09:00:00.000000

Expand-only: two nullable columns. Older code ignores them; existing cards start from their SM-2 history on next review.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0028_fsrs'
down_revision: Union[str, None] = '0027_skin'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('flashcards', sa.Column('stability', sa.Float(), nullable=True))
    op.add_column('flashcards', sa.Column('difficulty', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('flashcards', 'difficulty')
    op.drop_column('flashcards', 'stability')
