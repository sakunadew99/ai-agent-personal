"""Tiny per-user response cache for the heaviest read-only pages (Life Compass, About you, Exams, Invest, week/month views).

Why: those pages combine many queries; opening Home or switching tabs shouldn't recompute everything each time.
Safety: entries live at most TTL seconds, and ANY write by the same user (any non-GET request) clears that user's entries
at once (see deps.get_current_user), so you never see stale numbers after you change something. Per process, in memory,
never shared between users.
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

TTL_SECONDS = 900          # every change you make bumps your version, so a longer TTL never shows stale data to you
MAX_ENTRIES = 2000
_lock = threading.Lock()
_versions: dict[str, int] = {}
_store: dict[tuple[str, str], tuple[int, float, Any]] = {}


def bump(user_id) -> None:
    """Something changed for this user: drop their cached pages."""
    with _lock:
        _versions[str(user_id)] = _versions.get(str(user_id), 0) + 1


def cached(user_id, key: str, compute: Callable[[], Any], ttl: int | None = None) -> Any:
    ttl = TTL_SECONDS if ttl is None else ttl
    uid = str(user_id)
    if ttl <= 0:
        return compute()
    with _lock:
        version = _versions.get(uid, 0)
        hit = _store.get((uid, key))
        if hit and hit[0] == version and time.monotonic() - hit[1] < ttl:
            return hit[2]
    value = compute()
    with _lock:
        if len(_store) >= MAX_ENTRIES:
            for old in sorted(_store, key=lambda k: _store[k][1])[: MAX_ENTRIES // 4]:
                _store.pop(old, None)
        _store[(uid, key)] = (_versions.get(uid, 0) if _versions.get(uid, 0) == version else -1, time.monotonic(), value)
    return value


def clear() -> None:
    with _lock:
        _versions.clear()
        _store.clear()
