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
    scope: str = "single_sku"  # or "sku_group": the item_ids count together
    level: str = "line"  # or "bill": once per bill, on the total after line schemes
    min_bill_value: Decimal | None = None
    retailer_id: str | None = None
    amount_off: Decimal | None = None

    @classmethod
    def of(cls, s, item_ids) -> "Rule":
        return cls(id=s.id, name=s.name, type=s.type, item_ids=set(item_ids), scope=s.scope or "single_sku",
                   level=s.level or "line", min_bill_value=_dec(s.min_bill_value), retailer_id=s.retailer_id,
                   amount_off=_dec(s.amount_off),
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


def _percent(rule: Rule, qty: Decimal) -> Decimal | None:
    """The % off this quantity earns (percent or slab), or None."""
    if rule.type == "percent":
        return rule.percent if qty >= (rule.min_qty or ZERO_QTY) else None
    if rule.type == "slab":
        reached = [p for m, p in rule.slabs if qty >= m]  # slabs are stored ascending
        return reached[-1] if reached else None  # the highest slab reached
    return None


def _off(pct: Decimal, amount: Decimal) -> Benefit:
    # A discount can never exceed the line, so no scheme makes a bill negative.
    return Benefit(None, ZERO_QTY, min(money(amount * pct / 100), amount))


def benefit(rule: Rule, item_id: str, qty: Decimal, amount: Decimal) -> Benefit | None:
    """What this scheme gives a line, or None when the line doesn't qualify."""
    if rule.type == "buy_get":
        sets = qty // rule.buy_qty
        return Benefit(item_id, sets * rule.free_qty, ZERO) if sets >= 1 else None
    if rule.type == "free_goods":
        sets = qty // rule.min_qty
        return Benefit(rule.free_item_id, sets * rule.free_qty, ZERO) if sets >= 1 else None
    pct = _percent(rule, qty)
    return None if pct is None else _off(pct, amount)


def _group(rule: Rule, lines: list[dict], idx: list[int], rate_of) -> dict[int, Benefit] | None:
    """A group scheme over lines `idx`: the quantity is their sum. Free goods
    go on the cheapest line (its SKU for buy-get; the scheme's free item for
    free-goods); a % off applies to every line. None when they don't qualify."""
    total = sum((lines[i]["quantity"] for i in idx), ZERO_QTY)
    cheapest = min(idx, key=lambda i: (rate_of(lines[i]["item_id"]), i))
    if rule.type in ("buy_get", "free_goods"):
        b = benefit(rule, lines[cheapest]["item_id"], total, ZERO)
        if b is None:
            return None
        return {i: (b if i == cheapest else Benefit(None, ZERO_QTY, ZERO)) for i in idx}
    pct = _percent(rule, total)
    if pct is None:
        return None
    return {i: _off(pct, lines[i]["amount"]) for i in idx}


def evaluate(lines: list[dict], rules: list[Rule], day: str, rate_of) -> list[dict]:
    """For each line {item_id, quantity, amount}: the applied scheme (or None)
    and the schemes that could have applied but didn't, with the reason.
    `rate_of(item_id)` prices free goods for the scheme value.

    Schemes go in priority order (1 before 2); each line gets one. A single-SKU
    scheme takes each line that qualifies on its own; a group scheme adds up
    its SKUs' lines not already taken and, if that total qualifies, takes them
    all (so no line counts towards two schemes)."""
    applied: dict[int, dict] = {}
    skipped: dict[int, list] = {i: [] for i in range(len(lines))}

    def lose(i: int, rule: Rule) -> None:
        w = applied[i]["rule"]
        skipped[i].append({"rule": rule, "reason":
                           f"Not applied: '{w.name}' has priority ({w.priority} before {rule.priority})."})

    def win(i: int, rule: Rule, b: Benefit, group: dict | None = None) -> None:
        free_value = money(b.free_qty * rate_of(b.free_item_id)) if b.free_item_id else ZERO
        applied[i] = {"rule": rule, "benefit": b, "value": b.discount + free_value, "group": group}

    for rule in sorted((r for r in rules if r.live_on(day)), key=lambda r: r.priority):
        idx = [i for i, ln in enumerate(lines) if ln["item_id"] in rule.item_ids]
        if not idx:
            continue
        if rule.scope == "sku_group":
            free = [i for i in idx if i not in applied]
            if free and (got := _group(rule, lines, free, rate_of)):
                gift = next((i for i, b in got.items() if b.free_item_id), None)
                group = {"lines": [(lines[i]["item_id"], lines[i]["quantity"]) for i in free],
                         "total": sum((lines[i]["quantity"] for i in free), ZERO_QTY),
                         "freeLine": lines[gift]["item_id"] if gift is not None else None}
                for i, b in got.items():
                    win(i, rule, b, group)
            taken = [i for i in idx if i in applied and applied[i]["rule"] is not rule]
            if taken and _group(rule, lines, idx, rate_of):  # would have qualified with them
                for i in taken:
                    lose(i, rule)
            continue
        for i in idx:
            b = benefit(rule, lines[i]["item_id"], lines[i]["quantity"], lines[i]["amount"])
            if b is None:
                continue
            if i in applied:
                lose(i, rule)
            else:
                win(i, rule, b)
    return [{"applied": applied.get(i), "not_applied": skipped[i]} for i in range(len(lines))]


def evaluate_bill(rules: list[Rule], day: str, customer_id: str | None, base: Decimal) -> tuple[dict | None, list]:
    """Bill-level schemes, once per bill on `base` (the total after line
    schemes): the highest-priority one that qualifies (min bill value, and the
    retailer if it's for one) applies; the others that qualified are "not
    applied" with the reason. Never stacked; never more than the bill."""
    hits = []
    for rule in sorted((r for r in rules if r.level == "bill" and r.live_on(day)), key=lambda r: r.priority):
        if rule.retailer_id and rule.retailer_id != customer_id:
            continue
        if base < (rule.min_bill_value or ZERO):
            continue
        off = rule.amount_off if rule.type == "amount_off" else money(base * (rule.percent or ZERO) / 100)
        hits.append((rule, min(money(off), base)))
    if not hits:
        return None, []
    (winner, off), rest = hits[0], hits[1:]
    return {"rule": winner, "discount": off}, [
        {"rule": r, "reason": f"Not applied: '{winner.name}' has priority ({winner.priority} before {r.priority})."}
        for r, _ in rest]


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
             "percent": None, "slabs": None, "amount_off": None}
    if kind == "amount_off":  # bill level only: ₹ off the bill
        return {**blank, "amount_off": money(_pos(body.amount_off, "the amount off"))}
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
