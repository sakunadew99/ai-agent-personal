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
    "delete_task",      # deleting asks first (assistant: "delete the dentist task")
]
# Adding to your OWN buy list / wish list buys nothing and is easy to undo, so it runs when you ask (level A).
# Change a tool to "approval" in your permissions to be asked first.
LIST_TOOLS = [
    "add_to_buy_list",
    "add_to_wishlist",
    "exam_update",      # log study minutes / a score, or change your own exam plan
    "log_life_area",    # "called my mother" -> a check-in for Family (your own log, easy to delete)
    "log_water",        # "drank 500 ml water"
    "log_habit",        # "did my workout" -> today's tick for that habit
    "complete_task",    # "finished the report" -> done (Undo in the chat reopens it)
    "edit_task",        # "move the report to Friday 5pm", "make it high priority", "rename it to ..."
    "rename_habit",     # "rename my gym habit to Morning gym"
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
    for name in LIST_TOOLS:
        db.add(UserPermission(user_id=user.id, tool_name=name, mode="allow"))


def mode_for(db, user_id, tool_name: str) -> str:
    from sqlalchemy import select

    from app.models.entities import UserPermission

    row = db.scalar(
        select(UserPermission).where(UserPermission.user_id == user_id, UserPermission.tool_name == tool_name)
    )
    if row is not None:
        return row.mode
    return "approval" if tool_name in WRITE_TOOLS else "allow"
