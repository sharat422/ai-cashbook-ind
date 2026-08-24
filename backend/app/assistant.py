"""AI Business Assistant — natural-language analytics.

Design: the LLM only *classifies* the question into an intent + params (period,
customer name). The actual numbers are computed here from the database, so the
answer is always accurate (never hallucinated). Falls back to a keyword
classifier when no OpenAI key is set.
"""

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import Business, Customer, Expense, Income, LedgerEntry

log = logging.getLogger("cashbook.assistant")

INTENTS = [
    "top_debtors",
    "collections",
    "overdue",
    "top_expenses",
    "sales",
    "compare_months",
    "customer_purchases",
    "unknown",
]

PERIODS = [
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "all_time",
]

_PERIOD_LABEL = {
    "today": "today",
    "yesterday": "yesterday",
    "this_week": "in the last 7 days",
    "last_week": "last week",
    "this_month": "this month",
    "last_month": "last month",
    "all_time": "in total",
}


def _today():
    return datetime.now(timezone.utc).date()


def _inr(x: float) -> str:
    return f"₹{round(x):,}"


def _period_range(period: str, today) -> tuple[str, str]:
    if period == "today":
        return today.isoformat(), today.isoformat()
    if period == "yesterday":
        y = today - timedelta(days=1)
        return y.isoformat(), y.isoformat()
    if period == "this_week":
        return (today - timedelta(days=6)).isoformat(), today.isoformat()
    if period == "last_week":
        return (today - timedelta(days=13)).isoformat(), (today - timedelta(days=7)).isoformat()
    if period == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        return last_prev.replace(day=1).isoformat(), last_prev.isoformat()
    if period == "all_time":
        return "0000-01-01", "9999-12-31"
    # this_month (default)
    return today.replace(day=1).isoformat(), today.isoformat()


def _month_prefix(base, months_back: int) -> str:
    y, m = base.year, base.month - months_back
    while m <= 0:
        m += 12
        y -= 1
    return f"{y:04d}-{m:02d}"


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
def _heuristic_classify(text: str) -> dict:
    low = text.lower()
    period = "this_month"
    if "yesterday" in low:
        period = "yesterday"
    elif "today" in low:
        period = "today"
    elif "last week" in low:
        period = "last_week"
    elif "this week" in low or "week" in low:
        period = "this_week"
    elif "last month" in low:
        period = "last_month"

    if any(w in low for w in ("owe", "owes", "debtor", "who owes")):
        intent = "top_debtors"
    elif "compare" in low or " vs " in low or "versus" in low:
        intent = "compare_months"
    elif any(w in low for w in ("late", "overdue")):
        intent = "overdue"
    elif any(w in low for w in ("expense", "spent", "spend", "biggest expense")):
        intent = "top_expenses"
    elif any(w in low for w in ("collect", "collection", "received", "payment")):
        intent = "collections"
    elif any(w in low for w in ("purchase", "purchased", "bought", "buy")):
        intent = "customer_purchases"
    elif any(w in low for w in ("sell", "sold", "sale", "sales", "revenue")):
        intent = "sales"
    else:
        intent = "unknown"

    return {"intent": intent, "period": period, "customer_name": None, "months": 3}


def classify_question(text: str) -> dict:
    if not settings.openai_api_key:
        return _heuristic_classify(text)
    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        prompt = (
            "You route an Indian shopkeeper's question about their cashbook into "
            "an intent. Return ONLY JSON with keys: intent, period, customer_name, "
            "months.\n"
            f"intent one of: {', '.join(INTENTS)}.\n"
            f"period one of: {', '.join(PERIODS)} (default this_month).\n"
            "customer_name: the party name if the question is about ONE specific "
            "customer, else null.\n"
            "months: integer window for customer_purchases (default 3).\n\n"
            "Guidance: 'who owes the most'=top_debtors; 'how much did I collect'="
            "collections; 'who is late'=overdue; 'biggest expenses'=top_expenses; "
            "'how much did I sell'=sales; 'compare this month with last'="
            "compare_months; 'how much did X purchase'=customer_purchases.\n\n"
            f'Question: "{text}"'
        )
        resp = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        intent = data.get("intent")
        if intent not in INTENTS:
            intent = "unknown"
        period = data.get("period")
        if period not in PERIODS:
            period = "this_month"
        return {
            "intent": intent,
            "period": period,
            "customer_name": data.get("customer_name"),
            "months": int(data.get("months") or 3),
        }
    except Exception as exc:  # noqa: BLE001
        log.warning("assistant classify failed, using heuristic: %s", exc)
        return _heuristic_classify(text)


# ---------------------------------------------------------------------------
# Answering (deterministic)
# ---------------------------------------------------------------------------
def _match_customer(db, business, question, name):
    customers = db.scalars(
        select(Customer).where(Customer.business_id == business.id)
    ).all()
    if name:
        nl = name.strip().lower()
        for c in customers:
            if c.full_name.strip().lower() == nl:
                return c
        for c in customers:
            if nl in c.full_name.strip().lower():
                return c
    # Fall back: any customer whose name appears in the raw question.
    ql = question.lower()
    for c in customers:
        if c.full_name.strip().lower() in ql:
            return c
    return None


def answer_question(db: Session, business: Business, question: str) -> dict:
    parsed = classify_question(question)
    intent = parsed["intent"]
    period = parsed["period"]
    today = _today()
    frm, to = _period_range(period, today)
    label = _PERIOD_LABEL.get(period, "this month")

    incomes = db.scalars(select(Income).where(Income.business_id == business.id)).all()
    expenses = db.scalars(select(Expense).where(Expense.business_id == business.id)).all()
    customers = db.scalars(
        select(Customer).where(Customer.business_id == business.id)
    ).all()
    ledger = db.scalars(
        select(LedgerEntry)
        .join(Customer, LedgerEntry.customer_id == Customer.id)
        .where(Customer.business_id == business.id)
    ).all()
    payments = [e for e in ledger if e.type == "payment"]
    credits = [e for e in ledger if e.type == "credit"]

    if intent == "top_debtors":
        rows = sorted(
            (c for c in customers if c.outstanding_amount > 0),
            key=lambda c: c.outstanding_amount,
            reverse=True,
        )[:5]
        if not rows:
            return {"intent": intent, "answer": "No one owes you right now — all settled! 🎉", "items": []}
        top = rows[0]
        answer = f"{top.full_name} owes you the most: {_inr(top.outstanding_amount)}."
        if len(rows) > 1:
            answer += " Next: " + ", ".join(
                f"{c.full_name} ({_inr(c.outstanding_amount)})" for c in rows[1:3]
            )
        return {
            "intent": intent,
            "answer": answer,
            "items": [{"name": c.full_name, "amount": c.outstanding_amount} for c in rows],
        }

    if intent == "collections":
        total = sum(p.amount for p in payments if frm <= p.date <= to)
        return {"intent": intent, "answer": f"You collected {_inr(total)} {label}.", "amount": total, "period": period}

    if intent == "sales":
        total = sum(i.amount for i in incomes if frm <= i.date <= to)
        return {"intent": intent, "answer": f"You sold {_inr(total)} {label}.", "amount": total, "period": period}

    if intent == "overdue":
        rows = sorted(
            (c for c in customers if c.is_overdue and c.outstanding_amount > 0),
            key=lambda c: c.outstanding_amount,
            reverse=True,
        )
        if not rows:
            return {"intent": intent, "answer": "No overdue customers right now. 👍", "items": []}
        total = sum(c.outstanding_amount for c in rows)
        answer = (
            f"{len(rows)} customer{'s' if len(rows) != 1 else ''} are late, owing "
            f"{_inr(total)} in total. Chase first: "
            + ", ".join(f"{c.full_name} ({_inr(c.outstanding_amount)})" for c in rows[:3])
            + "."
        )
        return {
            "intent": intent,
            "answer": answer,
            "items": [{"name": c.full_name, "amount": c.outstanding_amount} for c in rows],
        }

    if intent == "top_expenses":
        buckets: dict[str, float] = defaultdict(float)
        for e in expenses:
            if frm <= e.date <= to:
                buckets[e.category] += e.amount
        rows = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)[:5]
        if not rows:
            return {"intent": intent, "answer": f"No expenses recorded {label}.", "items": []}
        answer = f"Your biggest expenses {label}: " + ", ".join(
            f"{cat} {_inr(amt)}" for cat, amt in rows[:3]
        ) + "."
        return {
            "intent": intent,
            "answer": answer,
            "items": [{"name": cat, "amount": amt} for cat, amt in rows],
        }

    if intent == "compare_months":
        this_m, last_m = _month_prefix(today, 0), _month_prefix(today, 1)

        def m_sum(items, mp):
            return sum(x.amount for x in items if x.date.startswith(mp))

        ts, ls = m_sum(incomes, this_m), m_sum(incomes, last_m)
        te, le = m_sum(expenses, this_m), m_sum(expenses, last_m)
        tc = sum(p.amount for p in payments if p.date.startswith(this_m))
        lc = sum(p.amount for p in payments if p.date.startswith(last_m))

        def delta(cur, prev):
            if not prev:
                return "n/a"
            return f"{'+' if cur >= prev else ''}{round((cur - prev) / prev * 100)}%"

        answer = (
            f"This month vs last month — Sales: {_inr(ts)} vs {_inr(ls)} ({delta(ts, ls)}); "
            f"Collections: {_inr(tc)} vs {_inr(lc)} ({delta(tc, lc)}); "
            f"Expenses: {_inr(te)} vs {_inr(le)} ({delta(te, le)})."
        )
        return {
            "intent": intent,
            "answer": answer,
            "this_month": {"sales": ts, "collections": tc, "expenses": te},
            "last_month": {"sales": ls, "collections": lc, "expenses": le},
        }

    if intent == "customer_purchases":
        customer = _match_customer(db, business, question, parsed.get("customer_name"))
        if not customer:
            return {
                "intent": intent,
                "answer": "I couldn't find that customer. Try their exact name.",
                "items": [],
            }
        months = max(1, min(parsed.get("months") or 3, 12))
        cust_credits = [c for c in credits if c.customer_id == customer.id]
        rows = []
        total = 0.0
        for i in range(months - 1, -1, -1):
            mp = _month_prefix(today, i)
            amt = sum(c.amount for c in cust_credits if c.date.startswith(mp))
            rows.append({"month": mp, "amount": amt})
            total += amt
        parts = ", ".join(f"{r['month']} {_inr(r['amount'])}" for r in rows)
        answer = (
            f"{customer.full_name} purchased {_inr(total)} over the last "
            f"{months} months ({parts})."
        )
        return {"intent": intent, "answer": answer, "customer": customer.full_name, "items": rows, "total": total}

    # unknown
    return {
        "intent": "unknown",
        "answer": (
            "I can answer things like: who owes the most, how much you collected "
            "this month, who's late, your biggest expenses, how much you sold last "
            "week, compare this month with last, or how much a customer purchased."
        ),
        "items": [],
    }
