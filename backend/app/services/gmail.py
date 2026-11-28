"""Gmail inbox summary (read-only): your latest unread primary emails, for the morning brief and Today.

Only metadata (from, subject, date) and Google's short snippet are read, with the gmail.readonly permission you granted.
Nothing is sent, deleted or marked. Email content is untrusted data: it's shown to you, never followed as instructions.
"""
from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from app.services import google_oauth as g


def _header(headers: list[dict], name: str) -> str:
    return next((str(h.get("value", "")) for h in headers if str(h.get("name", "")).lower() == name.lower()), "")


def inbox(db: Session, user_id, limit: int = 5) -> dict:
    conn = g.get_connection(db, user_id, "gmail")
    if conn is None or conn.status != "connected":
        return {"status": "expired" if conn is not None and conn.status == "expired" else "not_connected", "emails": [], "unread": 0}
    from app.core import cache
    return cache.cached(user_id, f"gmail:{limit}", lambda: _fetch(db, conn, limit), min(300, cache.TTL_SECONDS))


def _fetch(db: Session, conn, limit: int) -> dict:
    try:
        code, data = g.call(db, conn, "GET", f"{g.GMAIL_API}/messages", {"q": "is:unread category:primary newer_than:2d", "maxResults": limit})
        if code != 200:
            return {"status": "error", "emails": [], "unread": 0}
        out = []
        for m in (data.get("messages") or [])[:limit]:
            c2, msg = g.call(db, conn, "GET", f"{g.GMAIL_API}/messages/{m['id']}",
                             {"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]})
            if c2 != 200:
                continue
            hs = (msg.get("payload") or {}).get("headers") or []
            sender = _header(hs, "From")
            out.append({"id": m["id"], "from": sender.split("<")[0].strip().strip('"')[:80] or sender[:80], "subject": _header(hs, "Subject")[:160] or "(no subject)",
                        "snippet": str(msg.get("snippet") or "")[:200], "url": f"https://mail.google.com/mail/u/0/#inbox/{m['id']}"})
        return {"status": "connected", "emails": out, "unread": int(data.get("resultSizeEstimate") or len(out))}
    except g.Expired:
        return {"status": "expired", "emails": [], "unread": 0}
    except httpx.HTTPError:
        return {"status": "error", "emails": [], "unread": 0}
