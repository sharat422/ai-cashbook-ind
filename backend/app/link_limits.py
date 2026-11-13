"""Rate limits on the public statement links, /s/* (ST8).

Not about guessing (the token is 192-bit random) but about a bot hammering the
endpoint, and one link shared in a group and opened a thousand times:
  * per IP:   60 requests a minute on /s/*;
  * per link: 100 requests an hour.
It's a rate, not a ban: sliding windows, so a retailer is never locked out
for longer than the window, and a link's first open always goes through.
Separate from the API-wide limiter in monitoring.py, which is off in debug;
these stay on everywhere.
"""
from __future__ import annotations

import time

from .monitoring import SlidingWindow

PER_IP = (60, 60)          # requests, seconds
PER_LINK = (100, 3600)

_clock = time.monotonic
_ip = SlidingWindow(PER_IP[1])
_link = SlidingWindow(PER_LINK[1])


def reset() -> None:
    """Fresh windows (tests; the process keeps them otherwise)."""
    global _ip, _link
    _ip, _link = SlidingWindow(PER_IP[1]), SlidingWindow(PER_LINK[1])


def client_ip(request) -> str:
    """The first hop of X-Forwarded-For (Render's proxy), else the socket peer —
    the same rule as the API-wide limiter in main.py."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def hit(ip: str, link_id: str | None) -> tuple[str, int, int] | None:
    """Count this request; (which limit, count, limit) if it's over one, else None."""
    now = _clock()
    by_ip = _ip.hit(ip, now)
    by_link = _link.hit(link_id, now) if link_id else 0
    if by_ip > PER_IP[0]:
        return ("IP", by_ip, PER_IP[0])
    if by_link > PER_LINK[0]:
        return ("link", by_link, PER_LINK[0])
    return None
