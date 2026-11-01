"""Read-only account tools for the chatbot (plain functions, no framework).

Contract for every tool:
- First argument after `db` is `merchant_id` (= the business id). The API layer
  passes the id of the authenticated user's business; it never comes from the
  LLM. Every query below is filtered by it.
- A merchant asking about a customer it doesn't own gets the same empty result
  as for a customer that doesn't exist, so nothing leaks.
- Exact data: amounts are summed as decimals (no rounding, no float noise),
  dates are returned as stored (YYYY-MM-DD). Missing data is null / empty,
  never estimated.
- Read-only: nothing here writes to the database.
- Phone numbers are masked; GST numbers, addresses and notes are never returned.
- Every call is written to the audit log (see _audit) with merchant_id, tool,
  parameters (customer names masked), timestamp and the customer ids returned.
"""

import functools
import inspect
import json
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..calc import IST
from ..models import Business, Customer, Expense, Income, LedgerEntry
from ..monitoring import _mask as mask_mobile
from . import help_search

audit_log = logging.getLogger("cashbook.chatbot.audit")

PERIODS = ("today", "this_week", "this_month")
MAX_LIMIT = 50
MAX_DAYS = 365


class ToolError(ValueError):
    """Invalid arguments. Reported as {"error": ...}; contains no merchant data."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _today() -> date:
    return datetime.now(IST).date()


def _sum(amounts) -> float:
    """Exact sum of stored amounts (decimal arithmetic, no rounding)."""
    return float(sum((Decimal(str(a)) for a in amounts), Decimal("0")))


def _int(value, default: int, lo: int, hi: int, field: str) -> int:
    if value is None:
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ToolError(f"{field} must be an integer")
    return max(lo, min(n, hi))


def _period_range(period: str) -> tuple[str, str]:
    if period not in PERIODS:
        raise ToolError(f"period must be one of: {', '.join(PERIODS)}")
    today = _today()
    if period == "today":
        start = today
    elif period == "this_week":
        start = today - timedelta(days=today.weekday())  # Monday (IST)
    else:
        start = today.replace(day=1)
    return start.isoformat(), today.isoformat()


def _norm(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _mask_name(name) -> str:
    """'Ramesh' -> 'R*****' for logs: shows what kind of lookup it was, not who."""
    name = str(name or "").strip()
    return name[:1] + "*" * (len(name) - 1) if name else ""


def _merchant_exists(db: Session, merchant_id) -> bool:
    return bool(merchant_id) and db.get(Business, str(merchant_id)) is not None


def _customers(db: Session, merchant_id: str) -> list[Customer]:
    return list(db.scalars(
        select(Customer).where(Customer.business_id == merchant_id)
        .options(selectinload(Customer.ledger))
    ))


def _balance(c: Customer) -> float:
    """Exact balance from the khata (credits - payments, decimal arithmetic).
    The stored outstanding_amount is a float running sum and can carry noise
    like 1999.8999999999996, so it isn't used for answers."""
    credits = _sum(e.amount for e in c.ledger if e.type == "credit")
    payments = _sum(e.amount for e in c.ledger if e.type == "payment")
    return float(Decimal(str(credits)) - Decimal(str(payments)))


def _owned_customer(db: Session, merchant_id: str, customer_id) -> Customer | None:
    c = db.get(Customer, str(customer_id or ""))
    return c if c is not None and c.business_id == merchant_id else None


def _payments(db: Session, merchant_id: str, frm: str, to: str) -> list[LedgerEntry]:
    return list(db.scalars(
        select(LedgerEntry)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == merchant_id, LedgerEntry.type == "payment",
               LedgerEntry.date >= frm, LedgerEntry.date <= to)
    ))


def _by_method(payments: list[LedgerEntry]) -> dict:
    """Totals per payment method as stored by the app (cash, upi, bank, ...).
    Cash and UPI are always present; entries saved without a method are
    reported as not_recorded rather than guessed."""
    groups: dict[str, list[float]] = {"cash": [], "upi": []}
    for p in payments:
        groups.setdefault((p.payment_method or "").strip().lower() or "not_recorded", []).append(p.amount)
    return {method: _sum(amounts) for method, amounts in groups.items()}


def _customer_brief(c: Customer) -> dict:
    return {
        "customer_id": c.id,
        "name": c.full_name,
        "business_name": c.business_name,
        "mobile_masked": mask_mobile(c.mobile) if c.mobile else None,
        "balance": _balance(c),
        "is_overdue": c.is_overdue,
        "last_transaction_date": c.last_transaction_date,
    }


def _owing_since(db: Session, customer: Customer) -> str | None:
    """Date of the oldest credit not yet covered, applying payments oldest-first."""
    entries = sorted(customer.ledger, key=lambda e: (e.date, e.created_at))
    paid = sum((Decimal(str(e.amount)) for e in entries if e.type == "payment"), Decimal("0"))
    for e in entries:
        if e.type != "credit":
            continue
        paid -= Decimal(str(e.amount))
        if paid < 0:
            return e.date
    return None


# ---------------------------------------------------------------------------
# Audit logging
# ---------------------------------------------------------------------------
_NAME_PARAMS = {"customer_name", "name", "query"}  # free text: masked in logs


def _audit(tool: str, merchant_id, params: dict, result: dict) -> None:
    ids: list[str] = []
    for key in ("customer", "matches", "customers", "defaulters"):
        value = result.get(key)
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, dict) and item.get("customer_id"):
                ids.append(item["customer_id"])
    audit_log.info(json.dumps({
        "event": "chatbot_tool_call",
        "ts": datetime.now(timezone.utc).isoformat(),
        "merchant_id": merchant_id,
        "tool": tool,
        "params": {k: (_mask_name(v) if k in _NAME_PARAMS else v) for k, v in params.items()},
        "result_customer_ids": ids,
        "error": result.get("error"),
    }))


TOOLS: dict = {}


def tool(empty: dict):
    """Register a tool. Unknown merchants get `empty`; bad arguments get an
    error dict; every call (successful or not) is audited."""
    def wrap(fn):
        sig = inspect.signature(fn)

        @functools.wraps(fn)
        def call(db: Session, merchant_id, **params) -> dict:
            try:
                sig.bind(db, merchant_id, **params)
                bad_params = False
            except TypeError:
                bad_params = True
            if bad_params:
                result = {"error": f"invalid parameters for {fn.__name__}"}
            elif not _merchant_exists(db, merchant_id):
                result = dict(empty)
            else:
                try:
                    result = fn(db, str(merchant_id), **params)
                except ToolError as exc:
                    result = {"error": str(exc)}
            _audit(fn.__name__, merchant_id, params, result)
            return result
        TOOLS[fn.__name__] = call
        return call
    return wrap


# ---------------------------------------------------------------------------
# The six tools
# ---------------------------------------------------------------------------
@tool(empty={"total_outstanding": 0.0, "customers_owing": 0, "collected_this_month": 0.0,
             "collections_by_method": {}})
def get_business_summary(db: Session, merchant_id: str) -> dict:
    """Total outstanding, total collected this month, and the cash vs UPI split.
    total_outstanding sums positive balances only (advances aren't netted off)."""
    frm, to = _period_range("this_month")
    owing = [b for b in (_balance(c) for c in _customers(db, merchant_id)) if b > 0]
    payments = _payments(db, merchant_id, frm, to)
    return {
        "total_outstanding": _sum(owing),
        "customers_owing": len(owing),
        "collected_this_month": _sum(p.amount for p in payments),
        "collections_count": len(payments),
        "collections_by_method": _by_method(payments),
        "month_from": frm,
        "month_to": to,
        "as_of": to,
    }


@tool(empty={"status": "not_found", "customer": None})
def get_customer_balance(db: Session, merchant_id: str, customer_name: str | None = None,
                         customer_id: str | None = None) -> dict:
    """Balance for one customer. Several name matches (and no single exact one)
    -> 'ambiguous' with the candidates (never picks one); resolve with customer_id."""
    if customer_id:
        c = _owned_customer(db, merchant_id, customer_id)
        return {"status": "found", "customer": _customer_brief(c)} if c else {"status": "not_found", "customer": None}
    query = _norm(customer_name)
    if not query:
        raise ToolError("customer_name or customer_id is required")
    matches = [c for c in _customers(db, merchant_id) if query in _norm(c.full_name)]
    if not matches:
        return {"status": "not_found", "customer": None}
    # A single EXACT full-name match wins ("Ramesh" when "Ramesh Traders" also
    # exists). Two customers with the same exact name are still ambiguous.
    exact = [c for c in matches if _norm(c.full_name) == query]
    if len(exact) == 1:
        matches = exact
    if len(matches) > 1:
        return {"status": "ambiguous", "customer": None,
                "matches": [_customer_brief(c) for c in matches]}
    return {"status": "found", "customer": _customer_brief(matches[0])}


@tool(empty={"transactions": [], "from": None, "to": None})
def list_recent_transactions(db: Session, merchant_id: str, limit: int | None = None,
                             days: int | None = None, older_than_days: int | None = None) -> dict:
    """Incomes, expenses and khata entries, newest first. Either the last `days`
    days, or (older_than_days) everything dated at least that many days ago.
    `customer` is set for khata entries only (incomes/expenses have no customer)."""
    limit = _int(limit, 10, 1, MAX_LIMIT, "limit")
    if older_than_days is not None:
        cutoff = _int(older_than_days, 0, 0, 3650, "older_than_days")
        to = (_today() - timedelta(days=cutoff)).isoformat()
        frm = "0000-01-01"
    else:
        days = _int(days, 30, 1, MAX_DAYS, "days")
        to = _today().isoformat()
        frm = (_today() - timedelta(days=days - 1)).isoformat()
    rows = [
        {"id": i.id, "date": i.date, "type": "income", "amount": i.amount, "customer": None,
         "category": i.category, "_ts": i.created_at}
        for i in db.scalars(select(Income).where(Income.business_id == merchant_id,
                                                  Income.date >= frm, Income.date <= to))
    ] + [
        {"id": e.id, "date": e.date, "type": "expense", "amount": e.amount, "customer": None,
         "category": e.category, "_ts": e.created_at}
        for e in db.scalars(select(Expense).where(Expense.business_id == merchant_id,
                                                   Expense.date >= frm, Expense.date <= to))
    ] + [
        {"id": e.id, "date": e.date, "type": e.type, "amount": e.amount, "customer": name,
         "category": None, "_ts": e.created_at}
        for e, name in db.execute(
            select(LedgerEntry, Customer.full_name)
            .join(Customer, LedgerEntry.customer_id == Customer.id)
            .where(Customer.business_id == merchant_id, LedgerEntry.date >= frm, LedgerEntry.date <= to))
    ]
    rows.sort(key=lambda r: (r["date"], r["_ts"]), reverse=True)
    for r in rows:
        del r["_ts"]
    # "older than" has no real start date: report only the cutoff.
    return {"from": None if older_than_days is not None else frm, "to": to,
            "total_found": len(rows), "transactions": rows[:limit]}


@tool(empty={"defaulters": []})
def get_top_defaulters(db: Session, merchant_id: str, limit: int | None = None,
                       sort: str | None = None) -> dict:
    """Customers who owe money with since when (oldest unpaid credit) and for how
    many days. sort="amount" (default): biggest balance first; sort="oldest":
    longest-owed first, so "whose debt is oldest" is simply the first row."""
    limit = _int(limit, 5, 1, MAX_LIMIT, "limit")
    sort = sort or "amount"
    if sort not in ("amount", "oldest"):
        raise ToolError("sort must be one of: amount, oldest")
    today = _today()
    rows = []
    for c in _customers(db, merchant_id):
        if _balance(c) > 0:
            since = _owing_since(db, c)
            rows.append({
                **_customer_brief(c),
                "owing_since": since,
                "days_owing": (today - date.fromisoformat(since)).days if since else None,
            })
    if sort == "oldest":
        rows.sort(key=lambda r: (r["owing_since"] or "9999-12-31", -r["balance"]))
    else:
        rows.sort(key=lambda r: r["balance"], reverse=True)
    return {"as_of": today.isoformat(), "sort": sort, "total_customers_owing": len(rows),
            "defaulters": rows[:limit]}


@tool(empty={"total_collected": 0.0, "count": 0, "from": None, "to": None})
def get_collections_summary(db: Session, merchant_id: str, period: str | None = None) -> dict:
    """Money collected from customers today / this week (Mon-today) / this month."""
    period = period or "this_month"
    frm, to = _period_range(period)
    payments = _payments(db, merchant_id, frm, to)
    return {
        "period": period,
        "from": frm,
        "to": to,
        "total_collected": _sum(p.amount for p in payments),
        "count": len(payments),
        "by_method": _by_method(payments),
    }


@tool(empty={"matches": []})
def search_customer(db: Session, merchant_id: str, name: str | None = None) -> dict:
    """Every customer whose name contains `name` (case/space-insensitive), with ids."""
    query = _norm(name)
    if not query:
        raise ToolError("name is required")
    return {"matches": [_customer_brief(c) for c in _customers(db, merchant_id)
                        if query in _norm(c.full_name)]}


@tool(empty={"income_total": 0.0, "expense_total": 0.0, "from": None, "to": None})
def get_cashbook_summary(db: Session, merchant_id: str, period: str | None = None) -> dict:
    """Income (sales) and expenses recorded in the cashbook for today / this week
    (Mon-today) / this month. Not the same as collections: collections are
    payments from khata customers (get_collections_summary)."""
    period = period or "this_month"
    frm, to = _period_range(period)
    incomes = db.scalars(select(Income).where(
        Income.business_id == merchant_id, Income.date >= frm, Income.date <= to)).all()
    expenses = db.scalars(select(Expense).where(
        Expense.business_id == merchant_id, Expense.date >= frm, Expense.date <= to)).all()
    income_total = _sum(i.amount for i in incomes)
    expense_total = _sum(e.amount for e in expenses)
    return {
        "period": period,
        "from": frm,
        "to": to,
        "income_total": income_total,
        "income_count": len(incomes),
        "expense_total": expense_total,
        "expense_count": len(expenses),
        "net": float(Decimal(str(income_total)) - Decimal(str(expense_total))),
    }


# ---------------------------------------------------------------------------
# Help guide (phase 3): not merchant data, but audited like the others.
# ---------------------------------------------------------------------------
HELP_TOOL = "search_help_docs"


@tool(empty={"results": []})
def search_help_docs(db: Session, merchant_id: str, query: str | None = None) -> dict:
    """Top 2-3 help-guide docs for a how-to question, with file names as sources.
    An empty list means the topic is not in the help guide."""
    if not str(query or "").strip():
        raise ToolError("query is required")
    return {"results": help_search.search(query)}


ACCOUNT_TOOLS = tuple(name for name in TOOLS if name != HELP_TOOL)


def run_tool(db: Session, merchant_id: str, name: str, args) -> dict:
    """Dispatch an LLM tool call by name (used by the chat loop)."""
    fn = TOOLS.get(name)
    if fn is None:
        return {"error": f"unknown tool {name!r}"}
    if not isinstance(args, dict):
        return {"error": "arguments must be a JSON object"}
    # The merchant is fixed by the server; an LLM-supplied merchant_id is ignored.
    args = {k: v for k, v in args.items() if k not in ("merchant_id", "db")}
    return fn(db, merchant_id, **args)
