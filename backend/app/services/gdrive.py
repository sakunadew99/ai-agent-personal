"""Google Drive backup: your Sakuna export saved as a JSON file in a "Sakuna backups" folder in YOUR Google Drive.

Scope: drive.file only, so Sakuna can see and change just the files it created (never your other Drive files).
Runs when you tap "Back up now", and every Sunday evening if you switched weekly backups on (that switch is your
standing OK; every backup is audited). The newest 8 backups are kept; older Sakuna backups are removed.
The export leaves out passwords, tokens and encrypted fields (same as Settings → Export).
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import now_utc, zone
from app.models.entities import Notification, UserProfile
from app.services import google_oauth as g
from app.services.audit import audit

DRIVE_API = "https://www.googleapis.com/drive/v3"
UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
FOLDER = "Sakuna backups"
FOLDER_MIME = "application/vnd.google-apps.folder"
KEEP = 8


def _conn(db: Session, user_id):
    conn = g.get_connection(db, user_id, "drive")
    return conn if conn is not None and conn.status == "connected" else None


def _upload(token: str, name: str, folder_id: str, data: bytes) -> tuple[int, dict]:
    """Multipart upload (metadata + file). Tests replace this."""
    boundary = "sakuna" + secrets.token_hex(8)
    meta = json.dumps({"name": name, "parents": [folder_id], "mimeType": "application/json"})
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\n"
            f"Content-Type: application/json\r\n\r\n").encode() + data + f"\r\n--{boundary}--".encode()
    r = httpx.post(UPLOAD_API, params={"uploadType": "multipart", "fields": "id,name,webViewLink"}, content=body, timeout=90,
                   headers={"Authorization": f"Bearer {token}", "Content-Type": f"multipart/related; boundary={boundary}"})
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {}


def _folder(db: Session, conn) -> str:
    q = f"name = '{FOLDER}' and mimeType = '{FOLDER_MIME}' and trashed = false"
    code, data = g.call(db, conn, "GET", f"{DRIVE_API}/files", {"q": q, "fields": "files(id)", "pageSize": 1})
    if code == 200 and data.get("files"):
        return data["files"][0]["id"]
    code, data = g.call(db, conn, "POST", f"{DRIVE_API}/files", body={"name": FOLDER, "mimeType": FOLDER_MIME})
    if code not in (200, 201) or not data.get("id"):
        raise RuntimeError(f"Couldn't create the Drive folder ({code})")
    return data["id"]


def backup_now(db: Session, user_id, source: str = "manual") -> dict:
    from app.services import smart
    conn = _conn(db, user_id)
    if conn is None:
        return {"ok": False, "status": "not_connected", "message": "Connect Google Drive in Settings → Connections first."}
    try:
        folder = _folder(db, conn)
        p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        local = now_utc().astimezone(zone(p.timezone if p else "Asia/Colombo"))
        name = f"sakuna-backup-{local.strftime('%Y-%m-%d-%H%M')}.json"
        data = json.dumps(smart.export_all(db, user_id), default=str, ensure_ascii=False).encode()
        code, out = _upload(g.access_token(db, conn), name, folder, data)
        if code == 401:
            code, out = _upload(g.access_token(db, conn, force_refresh=True), name, folder, data)
        if code not in (200, 201):
            return {"ok": False, "status": "error", "message": f"Google Drive refused the upload ({code})."}
        removed = _prune(db, conn, folder)
    except g.Expired:
        return {"ok": False, "status": "expired", "message": "Google Drive needs reconnecting."}
    except (httpx.HTTPError, RuntimeError) as exc:
        return {"ok": False, "status": "error", "message": str(exc)[:200] if isinstance(exc, RuntimeError) else "Couldn't reach Google Drive."}
    audit(db, user_id, "backup.drive", "user", user_id, {"source": source, "bytes": len(data), "removed_old": removed})
    return {"ok": True, "status": "connected", "name": name, "bytes": len(data), "url": out.get("webViewLink"), "removed_old": removed}


def _prune(db: Session, conn, folder: str) -> int:
    q = f"'{folder}' in parents and trashed = false and name contains 'sakuna-backup-'"
    code, data = g.call(db, conn, "GET", f"{DRIVE_API}/files", {"q": q, "orderBy": "createdTime desc", "fields": "files(id,name)", "pageSize": 50})
    if code != 200:
        return 0
    n = 0
    for f in (data.get("files") or [])[KEEP:]:
        c, _ = g.call(db, conn, "DELETE", f"{DRIVE_API}/files/{f['id']}")
        n += c in (200, 204)
    return n


def status(db: Session, user_id) -> dict:
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    conn = g.get_connection(db, user_id, "drive")
    return {"connected": conn is not None and conn.status == "connected", "connection": g.describe(conn),
            "auto": bool((p.app_prefs or {}).get("drive_backup")) if p else False, "configured": g.configured()}


def set_auto(db: Session, user_id, on: bool) -> dict:
    p = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    prefs = dict(p.app_prefs or {})
    prefs["drive_backup"] = bool(on)
    p.app_prefs = prefs
    audit(db, user_id, "backup.drive_auto", "user", user_id, {"on": bool(on)})
    return status(db, user_id)


def weekly_due(db: Session, now: datetime | None = None) -> int:
    """Sunday 20:00+ (your time): one backup per week for everyone who switched weekly Drive backups on."""
    now = now or now_utc()
    done = 0
    for p in db.scalars(select(UserProfile)).all():
        if not (p.app_prefs or {}).get("drive_backup"):
            continue
        local = now.astimezone(zone(p.timezone))
        if local.weekday() != 6 or local.hour < 20:
            continue
        key = f"drive-backup:{p.user_id}:{local.isocalendar()[0]}-{local.isocalendar()[1]}"
        if db.scalar(select(Notification.id).where(Notification.user_id == p.user_id, Notification.dedupe_key == key)):
            continue
        out = backup_now(db, p.user_id, "weekly")
        db.add(Notification(user_id=p.user_id, kind="reminder", dedupe_key=key,
                            title="💾 Weekly backup saved to Google Drive" if out["ok"] else "💾 Weekly Drive backup didn't work",
                            body=out.get("name") if out["ok"] else out.get("message", "Open Settings → Backup.")))
        done += 1
    return done
