"""life os phase 7: CSE investing (prices, trades, watchlist rules, alerts)

Revision ID: 0019_invest
Revises: 0018_news_digest
Create Date: 2026-11-15 18:00:00.000000

Expand-only: four new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0019_invest'
down_revision: Union[str, None] = '0018_news_digest'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('stock_prices',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('symbol', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=True),
    sa.Column('trade_date', sa.Date(), nullable=False),
    sa.Column('close', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('prev_close', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('open', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('high', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('low', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('change_pct', sa.Numeric(precision=9, scale=3), nullable=True),
    sa.Column('volume', sa.BigInteger(), nullable=True),
    sa.Column('turnover', sa.Numeric(precision=20, scale=2), nullable=True),
    sa.Column('market_cap', sa.Numeric(precision=22, scale=2), nullable=True),
    sa.Column('source', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("source IN ('cse','upload','manual')", name='ck_stock_prices_source'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'symbol', 'trade_date', name='uq_stock_prices_user_symbol_date')
    )
    op.create_index('ix_stock_prices_user_date', 'stock_prices', ['user_id', 'trade_date'], unique=False)
    op.create_index(op.f('ix_stock_prices_user_id'), 'stock_prices', ['user_id'], unique=False)

    op.create_table('stock_trades',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('symbol', sa.String(length=20), nullable=False),
    sa.Column('trade_date', sa.Date(), nullable=False),
    sa.Column('side', sa.String(length=8), nullable=False),
    sa.Column('quantity', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('price', sa.Numeric(precision=14, scale=4), nullable=False),
    sa.Column('fees', sa.Numeric(precision=14, scale=2), server_default='0', nullable=False),
    sa.Column('currency', sa.String(length=3), server_default='LKR', nullable=False),
    sa.Column('note', sa.String(length=200), nullable=True),
    sa.Column('source', sa.String(length=8), server_default='manual', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("side IN ('buy','sell','dividend')", name='ck_stock_trades_side'),
    sa.CheckConstraint('quantity > 0', name='ck_stock_trades_quantity'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_stock_trades_user_symbol', 'stock_trades', ['user_id', 'symbol'], unique=False)
    op.create_index(op.f('ix_stock_trades_user_id'), 'stock_trades', ['user_id'], unique=False)

    op.create_table('watch_items',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('symbol', sa.String(length=20), nullable=False),
    sa.Column('sector', sa.String(length=60), nullable=True),
    sa.Column('target_buy', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('stop_loss', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('take_profit', sa.Numeric(precision=14, scale=2), nullable=True),
    sa.Column('max_pe', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('min_yield', sa.Numeric(precision=6, scale=2), nullable=True),
    sa.Column('eps', sa.Numeric(precision=14, scale=4), nullable=True),
    sa.Column('dps', sa.Numeric(precision=14, scale=4), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'symbol', name='uq_watch_items_user_symbol')
    )
    op.create_index(op.f('ix_watch_items_user_id'), 'watch_items', ['user_id'], unique=False)

    op.create_table('stock_alerts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('symbol', sa.String(length=20), nullable=False),
    sa.Column('rule', sa.String(length=16), nullable=False),
    sa.Column('trade_date', sa.Date(), nullable=False),
    sa.Column('message', sa.String(length=300), nullable=False),
    sa.Column('status', sa.String(length=6), server_default='new', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('new','seen')", name='ck_stock_alerts_status'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'symbol', 'rule', 'trade_date', name='uq_stock_alerts_user_symbol_rule_date')
    )
    op.create_index(op.f('ix_stock_alerts_user_id'), 'stock_alerts', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_stock_alerts_user_id'), table_name='stock_alerts')
    op.drop_table('stock_alerts')
    op.drop_index(op.f('ix_watch_items_user_id'), table_name='watch_items')
    op.drop_table('watch_items')
    op.drop_index(op.f('ix_stock_trades_user_id'), table_name='stock_trades')
    op.drop_index('ix_stock_trades_user_symbol', table_name='stock_trades')
    op.drop_table('stock_trades')
    op.drop_index(op.f('ix_stock_prices_user_id'), table_name='stock_prices')
    op.drop_index('ix_stock_prices_user_date', table_name='stock_prices')
    op.drop_table('stock_prices')
