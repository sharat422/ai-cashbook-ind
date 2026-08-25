"""Pure scheduling logic for recurring expenses — no DB, fully testable.

An SMB sets up templates like "shop rent every month" or "staff salary every
month on the 5th". The template stores a *frequency* + *interval*; from any due
date we can compute the next one. Numbers are computed here (deterministic), the
router just persists them.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

# Supported cadences. `interval` means "every N of these":
#   weekly  -> every N weeks   (N*7 days)
#   monthly -> every N months  (day clamped to the target month's length)
#   yearly  -> every N years   (Feb-29 clamped to Feb-28 in non-leap years)
#   custom  -> every N days
FREQUENCIES = ("weekly", "monthly", "yearly", "custom")


def _parse(iso: str) -> date:
    return date.fromisoformat(iso)


def add_months(d: date, months: int) -> date:
    """Add `months` to `d`, clamping the day to the target month's length so
    Jan-31 + 1 month = Feb-28/29 rather than overflowing into March."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, last_day))


def next_occurrence(
    current_iso: str,
    frequency: str,
    interval: int = 1,
    *,
    anchor_day: int | None = None,
) -> str:
    """Return the ISO date of the occurrence after `current_iso`.

    `anchor_day` (monthly only) preserves the intended day-of-month across
    short months: a rent due on the 31st keeps landing on each month's last
    valid day, then returns to 31 where the month allows it.
    """
    if interval < 1:
        raise ValueError("interval must be >= 1")
    if frequency not in FREQUENCIES:
        raise ValueError(f"unknown frequency: {frequency}")

    d = _parse(current_iso)

    if frequency == "weekly":
        return (d + timedelta(weeks=interval)).isoformat()
    if frequency == "custom":
        return (d + timedelta(days=interval)).isoformat()
    if frequency == "yearly":
        return add_months(d, 12 * interval).isoformat()

    # monthly
    nxt = add_months(d, interval)
    if anchor_day is not None:
        last_day = calendar.monthrange(nxt.year, nxt.month)[1]
        nxt = date(nxt.year, nxt.month, min(anchor_day, last_day))
    return nxt.isoformat()


def is_due(next_due_iso: str, today_iso: str) -> bool:
    """True when a template's next occurrence has arrived (or is overdue)."""
    return _parse(next_due_iso) <= _parse(today_iso)


def catch_up(
    next_due_iso: str,
    frequency: str,
    interval: int,
    today_iso: str,
    *,
    anchor_day: int | None = None,
    max_steps: int = 600,
) -> str:
    """Roll a due date forward until it is strictly after today.

    Used after posting an occurrence so a template that was ignored for several
    cycles doesn't stay perpetually "due" — it advances to the next *future*
    date in one shot. `max_steps` guards against pathological input.
    """
    nxt = next_due_iso
    steps = 0
    while is_due(nxt, today_iso) and steps < max_steps:
        nxt = next_occurrence(nxt, frequency, interval, anchor_day=anchor_day)
        steps += 1
    return nxt
