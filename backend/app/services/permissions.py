READ_TOOLS = [
    "get_dashboard",
    "list_tasks",
    "list_goals",
    "search_memories",
    "get_financial_summary",
    "get_health_summary",
    "get_daily_plan",
]
WRITE_TOOLS = [
    "create_task",
    "update_task",
    "create_goal",
    "save_memory",
    "create_daily_plan",
    "create_expense",
]


def seed_user_defaults(db, user) -> None:
    from app.models.entities import CareerProfile, CheckinSetting, UserPermission, UserProfile

    db.add(UserProfile(user_id=user.id))
    db.add(CheckinSetting(user_id=user.id, interval_minutes=30, enabled=True))
    db.add(CareerProfile(user_id=user.id, skills=[]))
    for name in READ_TOOLS:
        db.add(UserPermission(user_id=user.id, tool_name=name, mode="allow"))
    for name in WRITE_TOOLS:
        db.add(UserPermission(user_id=user.id, tool_name=name, mode="approval"))


def mode_for(db, user_id, tool_name: str) -> str:
    from sqlalchemy import select

    from app.models.entities import UserPermission

    row = db.scalar(
        select(UserPermission).where(UserPermission.user_id == user_id, UserPermission.tool_name == tool_name)
    )
    if row is not None:
        return row.mode
    return "approval" if tool_name in WRITE_TOOLS else "allow"
