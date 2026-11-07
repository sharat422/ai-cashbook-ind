"""FMCG trade schemes: apply the right one at billing and log it.

Phase 1: apply and log only — no scheme claim filing or claim automation.
One scheme per bill line: when several could apply, the owner's priority
(1 beats 2) decides and the others are logged "not applied" with the reason.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException

PAISA = Decimal("0.01")
ZERO_QTY = Decimal("0.000")
ZERO = Decimal("0.00")

TYPE_LABEL = {"buy_get": "Buy X get Y free", "slab": "Quantity slab", "percent": "% off",
              "free_goods": "Free goods"}


def money(x: Decimal) -> Decimal:
    return x.quantize(PAISA, rounding=ROUND_HALF_UP)


@dataclass
class Rule:
    id: str
    name: str
    type: str
    item_ids: set[str]
    valid_from: str
    valid_to: str
    priority: int
    active: bool = True
    buy_qty: Decimal | None = None
    free_qty: Decimal | None = None
    free_item_id: str | None = None
    min_qty: Decimal | None = None
    percent: Decimal | None = None
    slabs: list[tuple[Decimal, Decimal]] = field(default_factory=list)

    @classmethod
    def of(cls, s, item_ids) -> "Rule":
        return cls(id=s.id, name=s.name, type=s.type, item_ids=set(item_ids),
                   valid_from=s.valid_from, valid_to=s.valid_to, priority=s.priority,
                   active=s.active, buy_qty=_dec(s.buy_qty), free_qty=_dec(s.free_qty),
                   free_item_id=s.free_item_id, min_qty=_dec(s.min_qty), percent=_dec(s.percent),
                   slabs=[(Decimal(a), Decimal(b)) for a, b in json.loads(s.slabs or "[]")])

    def live_on(self, day: str) -> bool:
        """Active and inside its dates (both inclusive). Expired = never applies."""
        return self.active and self.valid_from <= day <= self.valid_to


def _dec(x) -> Decimal | None:
    return None if x is None else Decimal(str(x))


@dataclass
class Benefit:
    free_item_id: str | None
    free_qty: Decimal
    discount: Decimal  # already capped at the line amount


def benefit(rule: Rule, item_id: str, qty: Decimal, amount: Decimal) -> Benefit | None:
    """What this scheme gives a line, or None when the line doesn't qualify."""
    if rule.type == "buy_get":
        sets = qty // rule.buy_qty
        return Benefit(item_id, sets * rule.free_qty, ZERO) if sets >= 1 else None
    if rule.type == "free_goods":
        sets = qty // rule.min_qty
        return Benefit(rule.free_item_id, sets * rule.free_qty, ZERO) if sets >= 1 else None
    if rule.type == "percent":
        pct = rule.percent if qty >= (rule.min_qty or ZERO_QTY) else None
    elif rule.type == "slab":
        reached = [p for m, p in rule.slabs if qty >= m]  # slabs are stored ascending
        pct = reached[-1] if reached else None  # the highest slab reached
    else:
        return None
    if pct is None:
        return None
    # A discount can never exceed the line, so no scheme makes a bill negative.
    return Benefit(None, ZERO_QTY, min(money(amount * pct / 100), amount))


def evaluate(lines: list[dict], rules: list[Rule], day: str, rate_of) -> list[dict]:
    """For each line {item_id, quantity, amount}: the applied scheme (or None)
    and the schemes that could have applied but didn't, with the reason.
    `rate_of(item_id)` prices free goods for the scheme value."""
    out = []
    for line in lines:
        candidates = []
        for rule in sorted(rules, key=lambda r: r.priority):
            if line["item_id"] not in rule.item_ids or not rule.live_on(day):
                continue
            b = benefit(rule, line["item_id"], line["quantity"], line["amount"])
            if b is not None:
                candidates.append((rule, b))
        applied = None
        skipped = []
        if candidates:
            winner, b = candidates[0]
            free_value = money(b.free_qty * rate_of(b.free_item_id)) if b.free_item_id else ZERO
            applied = {"rule": winner, "benefit": b, "value": b.discount + free_value}
            for rule, _ in candidates[1:]:
                skipped.append({"rule": rule, "reason":
                                f"Not applied: '{winner.name}' has priority "
                                f"({winner.priority} before {rule.priority})."})
        out.append({"applied": applied, "not_applied": skipped})
    return out


# ------------------------------------------------------------ validation

def _reject(msg: str) -> HTTPException:
    return HTTPException(422, msg)


def _pos(value, what: str, *, whole: bool = False) -> Decimal:
    try:
        d = Decimal(str(value))
    except Exception:  # noqa: BLE001
        raise _reject(f"Enter {what}.") from None
    if not d.is_finite() or d <= 0 or d != d.quantize(Decimal("0.001")) or (whole and d % 1):
        raise _reject(f"{what[0].upper() + what[1:]} must be more than 0"
                      + (", in whole units." if whole else "."))
    return d


def _pct(value) -> Decimal:
    try:
        d = Decimal(str(value))
    except Exception:  # noqa: BLE001
        raise _reject("Enter the % off.") from None
    if not d.is_finite() or d <= 0 or d > 100 or d != d.quantize(PAISA):
        raise _reject("% off must be more than 0 and at most 100.")
    return d


def clean_config(kind: str, body) -> dict:
    """Validated type-specific fields for the Scheme row."""
    blank = {"buy_qty": None, "free_qty": None, "free_item_id": None, "min_qty": None,
             "percent": None, "slabs": None}
    if kind == "buy_get":
        return {**blank, "buy_qty": _pos(body.buy_qty, "the quantity to buy", whole=True),
                "free_qty": _pos(body.free_qty, "the free quantity", whole=True)}
    if kind == "free_goods":
        if not body.free_item_id:
            raise _reject("Pick the free item.")
        return {**blank, "min_qty": _pos(body.min_qty, "the quantity to buy", whole=True),
                "free_qty": _pos(body.free_qty, "the free quantity", whole=True),
                "free_item_id": body.free_item_id}
    if kind == "percent":
        min_qty = Decimal(str(body.min_qty)) if body.min_qty not in (None, "") else None
        if min_qty is not None and min_qty < 0:
            raise _reject("Minimum quantity can't be negative.")
        return {**blank, "percent": _pct(body.percent), "min_qty": min_qty}
    if kind == "slab":
        slabs = body.slabs or []
        if not 1 <= len(slabs) <= 10:
            raise _reject("Add 1 to 10 slabs.")
        clean = [(_pos(s[0], "the slab quantity"), _pct(s[1])) for s in slabs]
        mins = [m for m, _ in clean]
        if mins != sorted(set(mins)):
            raise _reject("Slab quantities must go up, with no repeats.")
        return {**blank, "slabs": json.dumps([[f"{m:f}", f"{p:f}"] for m, p in clean])}
    raise _reject("Scheme type must be 10+1 (buy_get), slab, percent or free_goods.")
