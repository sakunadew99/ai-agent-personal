from app.core.clock import now_utc
from app.models.entities import AuditLog


def audit(db, user_id, action: str, resource: str, resource_id=None, details=None, actor: str = "user") -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            actor=actor,
            action=action,
            resource=resource,
            resource_id=None if resource_id is None else str(resource_id),
            details=details or {},
            created_at=now_utc(),
        )
    )
