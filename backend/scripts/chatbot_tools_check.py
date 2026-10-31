"""Run all six read-only chatbot tools for one merchant and print the results.

For checking the tools' numbers against the app by hand (phase 1 acceptance).
It NEVER writes: it opens a session, the tools only SELECT, and it rolls back.

Usage (from backend/; DATABASE_URL picks the database, e.g. staging):

    python -m scripts.chatbot_tools_check <merchant_id>
    python -m scripts.chatbot_tools_check <merchant_id> --customer "Ramesh" --period this_week

<merchant_id> is the business id (Business.id), e.g. from GET /api/v1/businesses/me.
The output contains that merchant's customer names and balances: run it only
for a merchant you are allowed to see, and don't paste it anywhere public.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from app.chatbot.tools import (
    get_business_summary,
    get_collections_summary,
    get_customer_balance,
    get_top_defaulters,
    list_recent_transactions,
    search_customer,
)
from app.database import SessionLocal


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("merchant_id")
    parser.add_argument("--customer", help="name for search_customer / get_customer_balance")
    parser.add_argument("--period", default="this_month", choices=["today", "this_week", "this_month"])
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)  # audit lines -> stderr

    with SessionLocal() as db:
        mid = args.merchant_id
        results = {
            "get_business_summary": get_business_summary(db, mid),
            "list_recent_transactions": list_recent_transactions(db, mid, limit=args.limit, days=args.days),
            "get_top_defaulters": get_top_defaulters(db, mid, limit=args.limit),
            "get_collections_summary": get_collections_summary(db, mid, period=args.period),
        }
        if args.customer:
            results["search_customer"] = search_customer(db, mid, name=args.customer)
            results["get_customer_balance"] = get_customer_balance(db, mid, customer_name=args.customer)
        db.rollback()

    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
