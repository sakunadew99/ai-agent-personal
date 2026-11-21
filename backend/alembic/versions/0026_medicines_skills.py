"""medicines + dose log, skills + practice sessions

Revision ID: 0026_meds_skills
Revises: 0025_speak
Create Date: 2026-11-21 09:00:00.000000

Expand-only: four new tables. Older code ignores them, so a rollback is safe.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0026_meds_skills'
down_revision: Union[str, None] = '0025_speak'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _base():
    return [sa.Column('id', sa.Uuid(), nullable=False), sa.Column('user_id', sa.Uuid(), nullable=False)]


def upgrade() -> None:
    op.create_table('medicines', *_base(),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('dose', sa.String(length=60), nullable=True),
    sa.Column('icon', sa.String(length=8), nullable=False),
    sa.Column('times', JSON, nullable=False),
    sa.Column('days', JSON, nullable=True),
    sa.Column('with_food', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('stock', sa.Integer(), nullable=True),
    sa.Column('per_dose', sa.Integer(), nullable=False),
    sa.Column('refill_at', sa.Integer(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('per_dose > 0', name='ck_medicines_per_dose'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_medicines_user_id'), 'medicines', ['user_id'], unique=False)
    op.create_table('medicine_logs', *_base(),
    sa.Column('medicine_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('slot', sa.String(length=5), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('logged_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('taken','skipped')", name='ck_medicine_logs_status'),
    sa.ForeignKeyConstraint(['medicine_id'], ['medicines.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('medicine_id', 'local_date', 'slot', name='uq_medicine_logs_dose'))
    op.create_index(op.f('ix_medicine_logs_user_id'), 'medicine_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_medicine_logs_medicine_id'), 'medicine_logs', ['medicine_id'], unique=False)
    op.create_table('skills', *_base(),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('category', sa.String(length=20), nullable=False),
    sa.Column('icon', sa.String(length=8), nullable=False),
    sa.Column('level', sa.Integer(), nullable=False),
    sa.Column('weekly_minutes', sa.Integer(), nullable=False),
    sa.Column('goal', sa.String(length=200), nullable=True),
    sa.Column('trainer', sa.String(length=10), nullable=True),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('level BETWEEN 1 AND 10', name='ck_skills_level'),
    sa.CheckConstraint('weekly_minutes BETWEEN 0 AND 3000', name='ck_skills_weekly'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_skills_user_id'), 'skills', ['user_id'], unique=False)
    op.create_table('skill_sessions', *_base(),
    sa.Column('skill_id', sa.Uuid(), nullable=False),
    sa.Column('local_date', sa.Date(), nullable=False),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('rating', sa.Integer(), nullable=True),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('metrics', JSON, nullable=True),
    sa.Column('source', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('minutes BETWEEN 1 AND 600', name='ck_skill_sessions_minutes'),
    sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'))
    op.create_index(op.f('ix_skill_sessions_user_id'), 'skill_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_skill_sessions_skill_id'), 'skill_sessions', ['skill_id'], unique=False)
    op.create_index(op.f('ix_skill_sessions_local_date'), 'skill_sessions', ['local_date'], unique=False)


def downgrade() -> None:
    for table, cols in (('skill_sessions', ['local_date', 'skill_id', 'user_id']), ('skills', ['user_id']),
                        ('medicine_logs', ['medicine_id', 'user_id']), ('medicines', ['user_id'])):
        for c in cols:
            op.drop_index(op.f(f'ix_{table}_{c}'), table_name=table)
        op.drop_table(table)
