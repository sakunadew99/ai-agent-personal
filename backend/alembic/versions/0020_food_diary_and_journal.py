"""food diary (what you ate, when) and the daily journal

Revision ID: 0020_food_journal
Revises: 0019_invest
Create Date: 2026-11-15 19:00:00.000000

Expand-only: two nullable meal columns and one new table. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.models.types


revision: str = '0020_food_journal'
down_revision: Union[str, None] = '0019_invest'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('meal_logs', sa.Column('foods', sa.Text(), nullable=True))
    op.add_column('meal_logs', sa.Column('eaten_time', sa.Time(), nullable=True))
    op.create_table('journal_entries',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('mood', sa.Integer(), nullable=True),
    sa.Column('did', sa.Text(), nullable=True),
    sa.Column('positives', app.models.types.JsonDict, nullable=False),
    sa.Column('negatives', app.models.types.JsonDict, nullable=False),
    sa.Column('gratitude', app.models.types.JsonDict, nullable=False),
    sa.Column('lesson', sa.Text(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('tags', app.models.types.JsonDict, nullable=False),
    sa.Column('ai_reflection', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('mood IS NULL OR mood BETWEEN 1 AND 5', name='ck_journal_entries_mood'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'local_date', name='uq_journal_entries_user_date')
    )
    op.create_index(op.f('ix_journal_entries_user_id'), 'journal_entries', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_journal_entries_user_id'), table_name='journal_entries')
    op.drop_table('journal_entries')
    op.drop_column('meal_logs', 'eaten_time')
    op.drop_column('meal_logs', 'foods')
