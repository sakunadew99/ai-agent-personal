"""Small polling worker for persistent in-app check-ins and due task reminders."""
import time
from datetime import datetime, timedelta

from sqlalchemy import select

from app.core.clock import now_utc, zone
from app.core.database import SessionLocal
from app.models.entities import CheckinSetting, Notification, Task, UserProfile


def process_once() -> None:
    now = now_utc()
    with SessionLocal() as db:
        settings = db.scalars(select(CheckinSetting).where(CheckinSetting.enabled.is_(True))).all()
        for setting in settings:
            profile = db.scalar(select(UserProfile).where(UserProfile.user_id == setting.user_id))
            if profile is None:
                continue
            tz = zone(profile.timezone)
            local_now = now.astimezone(tz)
            if setting.quiet_start and setting.quiet_end:
                local_time = local_now.timetz().replace(tzinfo=None)
                if setting.quiet_start <= setting.quiet_end:
                    quiet = setting.quiet_start <= local_time < setting.quiet_end
                else:
                    quiet = local_time >= setting.quiet_start or local_time < setting.quiet_end
                if quiet:
                    continue
            # Round to each user's configured check-in interval and use a stable
            # dedupe key so repeated worker polls never multiply notifications.
            interval = max(5, setting.interval_minutes)
            boundary_seconds = interval * 60
            rounded = datetime.fromtimestamp(int(now.timestamp() // boundary_seconds * boundary_seconds), tz=tz)
            if abs((local_now - rounded).total_seconds()) > 75:
                continue
            key = f"checkin:{setting.user_id}:{rounded.isoformat()}"
            exists = db.scalar(select(Notification.id).where(Notification.user_id == setting.user_id, Notification.dedupe_key == key))
            if exists is None:
                db.add(Notification(user_id=setting.user_id, title="Quick check-in", body="How is your focus going? Take a moment to update your progress.", kind="checkin", dedupe_key=key))
        due_tasks = db.scalars(select(Task).where(Task.status.in_(["todo", "in_progress"]), Task.due_at.is_not(None), Task.due_at <= now + timedelta(minutes=5))).all()
        for task in due_tasks:
            key = f"task-due:{task.id}:{task.due_at.isoformat()}"
            exists = db.scalar(select(Notification.id).where(Notification.user_id == task.user_id, Notification.dedupe_key == key))
            if exists is None:
                db.add(Notification(user_id=task.user_id, title="Task coming up", body=task.title, kind="reminder", dedupe_key=key))
        # Phase 4: AI workers whose time has come today (each runs once a day; failures are isolated).
        try:
            from app.services.ai_workers import run_due
            run_due(db, now)
        except Exception:  # noqa: BLE001 - reminders above must still be saved
            import logging
            logging.exception("AI workers round failed")
        db.commit()


if __name__ == "__main__":
    while True:
        try:
            process_once()
        except Exception:
            # Keep the background service alive; container logging captures tracebacks.
            import logging
            logging.exception("Check-in worker iteration failed")
        time.sleep(60)
