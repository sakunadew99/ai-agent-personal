"""body measurements: weight, tape measurements and body-fat check-ins

Revision ID: 0037_body_measurements
Revises: 0036_goal_fields
Create Date: 2026-11-23 22:00:00.000000

Expand-only: one new table, plus optional height and sex on the profile.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0037_body_measurements'
down_revision: Union[str, None] = '0036_goal_fields'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('body_measurements',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('measured_on', sa.Date(), nullable=False),
    sa.Column('weight_kg', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('waist_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('chest_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('hips_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('neck_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('arm_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('thigh_cm', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('body_fat_pct', sa.Numeric(precision=4, scale=1), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('body_fat_pct IS NULL OR body_fat_pct BETWEEN 2 AND 70', name='ck_body_measurements_fat'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'measured_on', name='uq_body_measurements_user_day'))
    op.create_index(op.f('ix_body_measurements_user_id'), 'body_measurements', ['user_id'], unique=False)
    op.add_column('user_profiles', sa.Column('height_cm', sa.Integer(), nullable=True))
    op.add_column('user_profiles', sa.Column('sex', sa.String(length=6), nullable=True))


def downgrade() -> None:
    op.drop_column('user_profiles', 'sex')
    op.drop_column('user_profiles', 'height_cm')
    op.drop_index(op.f('ix_body_measurements_user_id'), table_name='body_measurements')
    op.drop_table('body_measurements')
