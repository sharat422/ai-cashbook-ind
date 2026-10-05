"""Read-only data reconciliation report.

Detects data anomalies that the current lookup-before-insert idempotency and the
owner-membership model can leave behind under concurrent requests:

  * duplicate money rows sharing a tenant idempotency key
    - incomes / expenses:  (business_id, client_id)
    - ledger entries:      (customer_id, client_id)
    - recurring posts:     expenses whose client_id is "recur:<id>:<date>"
  * owner/business anomalies
    - businesses with NO active owner (locked out)
    - businesses whose creator (businesses.user_id) is not an active owner
    - businesses with more than one active owner (informational)

It NEVER writes or deletes anything — it opens a session, runs SELECTs, prints a
report, and rolls back. Deciding what to do about any duplicate money record is
a human call; this tool only surfaces them.

Usage (point at a DISPOSABLE / sanitized copy, never a live customer DB):

    # from backend/
    DATABASE_URL="postgresql+psycopg2://user:pass@host:5432/cashbook_sanitized" \
        python -m scripts.reconcile            # human-readable
    ... python -m scripts.reconcile --json     # machine-readable

Exit code: 0 if clean, 1 if any anomaly was found (usable as a CI gate).
"""

from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import engine
from app.models import (
    Business,
    BusinessMember,
    Customer,
    Expense,
    Income,
    LedgerEntry,
)

# Cap how many offending keys we list per check (counts are always exact).
SAMPLE_LIMIT = 50


def _dupe_groups(session: Session, model, key_cols: list) -> list[dict]:
    """Return {key..., count} for each group of `key_cols` with >1 row, ignoring
    rows whose idempotency key is NULL (those were never meant to be unique)."""
    client_id = model.client_id
    rows = session.execute(
        select(*key_cols, func.count().label("n"))
        .where(client_id.is_not(None))
        .group_by(*key_cols)
        .having(func.count() > 1)
        .order_by(func.count().desc())
    ).all()
    names = [c.key for c in key_cols]
    return [
        {**{name: getattr(r, name) for name in names}, "count": r.n}
        for r in rows[:SAMPLE_LIMIT]
    ], len(rows)


def reconcile(session: Session) -> dict:
    """Compute the full read-only reconciliation report as plain data."""
    report: dict = {"duplicates": {}, "owners": {}}

    inc_sample, inc_total = _dupe_groups(
        session, Income, [Income.business_id, Income.client_id]
    )
    exp_sample, exp_total = _dupe_groups(
        session, Expense, [Expense.business_id, Expense.client_id]
    )
    led_sample, led_total = _dupe_groups(
        session, LedgerEntry, [LedgerEntry.customer_id, LedgerEntry.client_id]
    )
    report["duplicates"] = {
        "incomes": {"groups": inc_total, "sample": inc_sample},
        "expenses": {"groups": exp_total, "sample": exp_sample},
        "ledger_entries": {"groups": led_total, "sample": led_sample},
    }

    # Recurring-post duplicates are a labelled subset of expense duplicates.
    recur_dupes = [
        g
        for g in exp_sample
        if isinstance(g.get("client_id"), str) and g["client_id"].startswith("recur:")
    ]
    report["duplicates"]["recurring_posts"] = {
        "groups": len(recur_dupes),
        "sample": recur_dupes,
    }

    # --- Owner / business integrity -----------------------------------------
    active_owners: dict[str, int] = {}
    active_owner_users: dict[str, set[str]] = {}
    for m in session.scalars(
        select(BusinessMember).where(
            BusinessMember.role == "owner", BusinessMember.status == "active"
        )
    ).all():
        active_owners[m.business_id] = active_owners.get(m.business_id, 0) + 1
        active_owner_users.setdefault(m.business_id, set()).add(m.user_id)

    no_owner, multi_owner, creator_not_owner = [], [], []
    for b in session.scalars(select(Business)).all():
        n = active_owners.get(b.id, 0)
        if n == 0:
            no_owner.append(b.id)
        elif n > 1:
            multi_owner.append({"business_id": b.id, "active_owners": n})
        if b.user_id not in active_owner_users.get(b.id, set()):
            creator_not_owner.append({"business_id": b.id, "creator_user_id": b.user_id})

    report["owners"] = {
        "businesses_without_active_owner": no_owner[:SAMPLE_LIMIT],
        "businesses_without_active_owner_total": len(no_owner),
        "businesses_with_multiple_active_owners": multi_owner[:SAMPLE_LIMIT],
        "businesses_with_multiple_active_owners_total": len(multi_owner),
        "creator_not_active_owner": creator_not_owner[:SAMPLE_LIMIT],
        "creator_not_active_owner_total": len(creator_not_owner),
    }

    report["clean"] = (
        inc_total == 0
        and exp_total == 0
        and led_total == 0
        and len(no_owner) == 0
        and len(creator_not_owner) == 0
    )
    return report


def _print_human(report: dict) -> None:
    d = report["duplicates"]
    o = report["owners"]
    print("=== Data reconciliation report (READ-ONLY) ===\n")
    print("Duplicate idempotency-key groups (same key used by >1 row):")
    print(f"  incomes         (business_id, client_id): {d['incomes']['groups']}")
    print(f"  expenses        (business_id, client_id): {d['expenses']['groups']}")
    print(f"    of which recurring posts               : {d['recurring_posts']['groups']}")
    print(f"  ledger_entries  (customer_id, client_id): {d['ledger_entries']['groups']}")
    print("\nOwner / business integrity:")
    print(f"  businesses with NO active owner (locked out): {o['businesses_without_active_owner_total']}")
    print(f"  creator is not an active owner              : {o['creator_not_active_owner_total']}")
    print(f"  businesses with >1 active owner (info)      : {o['businesses_with_multiple_active_owners_total']}")
    for label, key in (
        ("Sample duplicate incomes", "incomes"),
        ("Sample duplicate expenses", "expenses"),
        ("Sample duplicate ledger entries", "ledger_entries"),
    ):
        sample = d[key]["sample"]
        if sample:
            print(f"\n{label}:")
            for g in sample[:10]:
                print(f"  {g}")
    if report["clean"]:
        print("\nNo anomalies found.")
    else:
        print("\nAnomalies found. No records were modified. Review before any action.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only data reconciliation report")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = parser.parse_args(argv)

    # Read-only: run inside a transaction we always roll back.
    with Session(engine) as session:
        try:
            report = reconcile(session)
        finally:
            session.rollback()

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        _print_human(report)
    return 0 if report["clean"] else 1


if __name__ == "__main__":
    sys.exit(main())
