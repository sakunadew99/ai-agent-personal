"""money plan: debt details, monthly net-worth snapshots, income streams and their hours

Revision ID: 0042_money_plan
Revises: 0041_app_prefs
Create Date: 2026-11-28 12:00:00.000000

Expand-only: three nullable columns on liabilities (yearly interest %, minimum payment, due day) and three new tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0042_money_plan'
down_revision: Union[str, None] = '0041_app_prefs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('liabilities', sa.Column('apr_pct', sa.Numeric(6, 2), nullable=True))
    op.add_column('liabilities', sa.Column('min_payment', sa.Numeric(14, 2), nullable=True))
    op.add_column('liabilities', sa.Column('due_day', sa.Integer(), nullable=True))
    op.create_check_constraint('ck_liabilities_apr_pct', 'liabilities', 'apr_pct IS NULL OR (apr_pct >= 0 AND apr_pct <= 200)')
    op.create_check_constraint('ck_liabilities_due_day', 'liabilities', 'due_day IS NULL OR (due_day BETWEEN 1 AND 31)')

    op.create_table('money_snapshots',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('month', sa.String(length=7), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('net_worth', sa.Numeric(18, 2), nullable=False),
    sa.Column('income', sa.Numeric(18, 2), nullable=False),
    sa.Column('spending', sa.Numeric(18, 2), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'month', 'currency', name='uq_money_snapshots_user_month_currency'))
    op.create_index(op.f('ix_money_snapshots_user_id'), 'money_snapshots', ['user_id'], unique=False)

    op.create_table('income_streams',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('income_source', sa.String(length=32), nullable=True),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('job','freelance','tutoring','product','content','investing','business','other')", name='ck_income_streams_kind'),
    sa.CheckConstraint("status IN ('active','paused','stopped')", name='ck_income_streams_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'name', name='uq_income_streams_user_name'))
    op.create_index(op.f('ix_income_streams_user_id'), 'income_streams', ['user_id'], unique=False)

    op.create_table('stream_logs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('stream_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('earned', sa.Numeric(14, 2), nullable=True),
    sa.Column('note', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('minutes BETWEEN 0 AND 1440', name='ck_stream_logs_minutes'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['stream_id'], ['income_streams.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_stream_logs_user_id'), 'stream_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_stream_logs_stream_id'), 'stream_logs', ['stream_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_stream_logs_stream_id'), table_name='stream_logs')
    op.drop_index(op.f('ix_stream_logs_user_id'), table_name='stream_logs')
    op.drop_table('stream_logs')
    op.drop_index(op.f('ix_income_streams_user_id'), table_name='income_streams')
    op.drop_table('income_streams')
    op.drop_index(op.f('ix_money_snapshots_user_id'), table_name='money_snapshots')
    op.drop_table('money_snapshots')
    op.drop_constraint('ck_liabilities_due_day', 'liabilities', type_='check')
    op.drop_constraint('ck_liabilities_apr_pct', 'liabilities', type_='check')
    op.drop_column('liabilities', 'due_day')
    op.drop_column('liabilities', 'min_payment')
    op.drop_column('liabilities', 'apr_pct')
