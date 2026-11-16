"""habit reminder/icon/target, buy-list need-by date, subscriptions and renewals

Revision ID: 0021_subscriptions
Revises: 0020_food_journal
Create Date: 2026-11-16 10:00:00.000000

Expand-only: four nullable columns and one new table. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0021_subscriptions'
down_revision: Union[str, None] = '0020_food_journal'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('habits', sa.Column('icon', sa.String(length=8), nullable=True))
    op.add_column('habits', sa.Column('reminder_time', sa.Time(), nullable=True))
    op.add_column('habits', sa.Column('target_per_week', sa.Integer(), nullable=True))
    op.add_column('buy_list_items', sa.Column('need_by', sa.Date(), nullable=True))
    op.create_table('subscriptions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('category', sa.String(length=16), nullable=False),
    sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('cycle', sa.String(length=10), nullable=False),
    sa.Column('next_due', sa.Date(), nullable=False),
    sa.Column('remind_days', sa.Integer(), nullable=False),
    sa.Column('auto_renews', sa.Boolean(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('link', sa.String(length=500), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('last_paid_on', sa.Date(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("cycle IN ('weekly','monthly','quarterly','yearly')", name='ck_subscriptions_cycle'),
    sa.CheckConstraint("category IN ('subscription','bill','insurance','loan','rent','membership','other')", name='ck_subscriptions_category'),
    sa.CheckConstraint('remind_days BETWEEN 0 AND 60', name='ck_subscriptions_remind_days'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_subscriptions_user_id'), 'subscriptions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_subscriptions_user_id'), table_name='subscriptions')
    op.drop_table('subscriptions')
    op.drop_column('buy_list_items', 'need_by')
    op.drop_column('habits', 'target_per_week')
    op.drop_column('habits', 'reminder_time')
    op.drop_column('habits', 'icon')
