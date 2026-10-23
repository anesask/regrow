"""Request guards: sliding-window rate limits, admin lockout and security headers."""

import threading
import time
from collections import deque

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

_lock = threading.Lock()
_hits: dict[tuple[str, str], deque] = {}


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, key: str, limit: int, window_s: int) -> None:
    """Allow `limit` events per `window_s` seconds per (bucket, key); raise 429 beyond that."""
    now = time.monotonic()
    with _lock:
        q = _hits.setdefault((bucket, key), deque())
        while q and now - q[0] > window_s:
            q.popleft()
        if len(q) >= limit:
            retry = int(window_s - (now - q[0])) + 1
            raise HTTPException(429, f"too many requests, retry in {retry}s", headers={"Retry-After": str(retry)})
        q.append(now)


def reset(bucket: str | None = None) -> None:
    """Clear counters (tests)."""
    with _lock:
        for k in [k for k in _hits if bucket is None or k[0] == bucket]:
            del _hits[k]


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/data/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response
