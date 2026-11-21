"""skin / glow checks (numbers only, no photos)

Revision ID: 0027_skin
Revises: 0026_meds_skills
Create Date: 2026-11-21 15:00:00.000000

Expand-only: one new table. Older code ignores it, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0027_skin'
down_revision: Union[str, None] = '0026_meds_skills'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('skin_checks',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('score', sa.Integer(), nullable=False),
    sa.Column('metrics', sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
    sa.Column('note', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('score BETWEEN 0 AND 100', name='ck_skin_checks_score'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_skin_checks_user_id'), 'skin_checks', ['user_id'], unique=False)
    op.create_index(op.f('ix_skin_checks_created_at'), 'skin_checks', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_skin_checks_created_at'), table_name='skin_checks')
    op.drop_index(op.f('ix_skin_checks_user_id'), table_name='skin_checks')
    op.drop_table('skin_checks')
