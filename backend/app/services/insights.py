from sqlalchemy import select

from app.models.entities import Goal, Task


def insight_facts(db, user):
    tasks = db.scalars(select(Task).where(Task.user_id == user.id, Task.status.notin_(["done", "cancelled"])).order_by(Task.priority.desc()).limit(10)).all()
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id, Goal.status == "active").order_by(Goal.due_date.asc().nullslast()).limit(10)).all()
    return {
        "open_tasks": [{"title": item.title, "priority": item.priority, "due_at": item.due_at.isoformat() if item.due_at else None} for item in tasks],
        "active_goals": [{"title": item.title, "current": str(item.current_value), "target": str(item.target_value) if item.target_value is not None else None, "due_date": item.due_date.isoformat() if item.due_date else None} for item in goals],
    }
