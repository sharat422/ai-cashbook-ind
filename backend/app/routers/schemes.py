import json
import re
from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import billing, stock
from .. import scheme_claims as claims
from .. import schemes as rules_mod
from ..database import get_db
from ..errors import AppError
from ..gst_reports import XLSX
from ..deps import get_current_membership, require
from ..models import (Bill, BillLine, BillSeries, Business, Customer, Item, Scheme, SchemeApplication, SchemeClaim, SchemeItem,
                      User, gen_id, now_iso)
from ..calc import today_iso
from ..gst import financial_year
from ..rbac import DATA_VIEW, ENTRY_CREATE, ENTRY_EDIT, REPORTS_VIEW, SETTINGS_MANAGE, role_can
from ..security import get_current_user
from ..validation import validate_date, validate_notes, validate_text

router = APIRouter(tags=["schemes"])


class SchemeBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str
    type: str
    item_ids: list[str] = Field(alias="itemIds", max_length=500)
    valid_from: str = Field(alias="validFrom")
    valid_to: str = Field(alias="validTo")
    priority: int = Field(ge=1, le=999)
    active: bool = True
    buy_qty: str | float | None = Field(default=None, alias="buyQty")
    free_qty: str | float | None = Field(default=None, alias="freeQty")
    free_item_id: str | None = Field(default=None, alias="freeItemId")
    min_qty: str | float | None = Field(default=None, alias="minQty")
    percent: str | float | None = None
    slabs: list[tuple[str | float, str | float]] | None = None
    # single_sku (each SKU on its own) or sku_group (the SKUs count together: "any 10").
    scope: str = "single_sku"
    # line (per bill line) or bill (once per bill, on the total after line schemes).
    level: str = "line"
    min_bill_value: str | float | None = Field(default=None, alias="minBillValue")
    retailer_id: str | None = Field(default=None, alias="retailerId")  # bill level: one retailer only
    amount_off: str | float | None = Field(default=None, alias="amountOff")


class LineBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    item_id: str = Field(alias="itemId")
    quantity: str | float
    rate: str | float | None = None  # default: the item's sale price


class BillBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str | None = Field(default=None, alias="clientId", max_length=80)
    customer_id: str = Field(alias="customerId")
    date: str
    location: str = "van"
    van_user_id: str | None = Field(default=None, alias="vanUserId")
    beat_id: str | None = Field(default=None, alias="beatId")  # feeds that beat's daily close
    queued: bool = False  # sent from the offline queue: schemes are re-checked against today
    lines: list[LineBody]


def _q(x) -> str:
    return f"{Decimal(x).quantize(stock.QTY):f}"


def scheme_dto(s: Scheme, item_ids: list[str], names: dict[str, str] | None = None) -> dict:
    names = names or {}
    return {"id": s.id, "name": s.name, "type": s.type, "itemIds": item_ids,
            # Names with the ids, so the app never loads the catalogue to show a scheme.
            "itemNames": [names.get(i, "") for i in item_ids],
            "freeItemName": names.get(s.free_item_id, "") if s.free_item_id else None,
            "validFrom": s.valid_from, "validTo": s.valid_to, "priority": s.priority,
            "active": s.active,
            "buyQty": None if s.buy_qty is None else _q(s.buy_qty),
            "freeQty": None if s.free_qty is None else _q(s.free_qty),
            "freeItemId": s.free_item_id,
            "minQty": None if s.min_qty is None else _q(s.min_qty),
            "percent": None if s.percent is None else f"{Decimal(s.percent):.2f}",
            "slabs": json.loads(s.slabs) if s.slabs else None,
            "scope": s.scope or "single_sku", "level": s.level or "line",
            "minBillValue": None if s.min_bill_value is None else f"{Decimal(s.min_bill_value):.2f}",
            "retailerId": s.retailer_id,
            "amountOff": None if s.amount_off is None else f"{Decimal(s.amount_off):.2f}"}


def _names(db: Session, business: Business, ids) -> dict[str, str]:
    ids = [i for i in set(ids) if i]
    return dict(db.execute(select(Item.id, Item.name).where(Item.business_id == business.id,
                                                            Item.id.in_(ids))).all()) if ids else {}


def _items_of(db: Session, scheme_ids: list[str]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = defaultdict(list)
    for sid, iid in db.execute(select(SchemeItem.scheme_id, SchemeItem.item_id)
                               .where(SchemeItem.scheme_id.in_(scheme_ids))).all():
        out[sid].append(iid)
    return out


def _owned_scheme(db: Session, business: Business, scheme_id: str) -> Scheme:
    s = db.get(Scheme, scheme_id)
    if s is None or s.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheme not found")
    return s


def _apply_body(db: Session, business: Business, s: Scheme, body: SchemeBody) -> list[str]:
    s.name = validate_text(body.name, "Scheme name", 120)
    s.valid_from, s.valid_to = validate_date(body.valid_from), validate_date(body.valid_to)
    if s.valid_from > s.valid_to:
        raise HTTPException(422, "The scheme ends before it starts.")
    item_ids = list(dict.fromkeys(body.item_ids))
    if body.level not in ("line", "bill"):
        raise HTTPException(422, "Level must be line or bill.")
    if body.level == "bill":
        if body.type not in ("amount_off", "percent"):
            raise HTTPException(422, "A bill scheme is ₹ off (amount_off) or % off (percent).")
        item_ids = []  # the whole bill
    elif body.type == "amount_off":
        raise HTTPException(422, "₹ off is a bill scheme; for a line use % off or a slab.")
    if not item_ids and body.level == "line":
        raise HTTPException(422, "Pick at least one item for the scheme.")
    for item_id in item_ids:
        stock.owned_item(db, business, item_id)
    s.type = body.type
    for key, value in rules_mod.clean_config(body.type, body).items():
        setattr(s, key, value)
    if s.free_item_id:
        stock.owned_item(db, business, s.free_item_id)
    s.priority, s.active = body.priority, body.active
    if body.scope not in ("single_sku", "sku_group"):
        raise HTTPException(422, "Scope must be single_sku or sku_group.")
    if body.scope == "sku_group" and len(item_ids) < 2:
        raise HTTPException(422, "A group scheme needs at least two SKUs.")
    s.scope = body.scope
    s.level = body.level
    s.min_bill_value = s.retailer_id = None
    if body.level == "bill":
        try:
            s.min_bill_value = Decimal(str(body.min_bill_value or 0)).quantize(Decimal("0.01"))
        except Exception:  # noqa: BLE001
            raise HTTPException(422, "Enter the minimum bill value.") from None
        if s.min_bill_value < 0:
            raise HTTPException(422, "The minimum bill value can't be negative.")
        if body.retailer_id:
            c = db.get(Customer, body.retailer_id)
            if c is None or c.business_id != business.id:
                raise HTTPException(404, "Retailer not found")
            s.retailer_id = c.id
    return item_ids


def _save_scheme(db: Session, business: Business, s: Scheme, item_ids: list[str]) -> dict:
    db.query(SchemeItem).filter(SchemeItem.scheme_id == s.id).delete(synchronize_session=False)
    db.add_all([SchemeItem(scheme_id=s.id, item_id=i) for i in item_ids])
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        other = db.scalars(select(Scheme).where(Scheme.business_id == business.id,
                                                Scheme.priority == s.priority)).first()
        raise HTTPException(422, f"Priority {s.priority} is already used by "
                                 f"'{other.name if other else 'another scheme'}'. "
                                 "Each scheme needs its own priority.") from None
    return scheme_dto(s, item_ids, _names(db, business, [*item_ids, s.free_item_id]))


@router.get("/schemes")
def list_schemes(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(select(Scheme).where(Scheme.business_id == business.id)
                      .order_by(Scheme.priority)).all()
    items = _items_of(db, [s.id for s in rows])
    names = _names(db, business, [i for ids in items.values() for i in ids] + [s.free_item_id for s in rows])
    return [scheme_dto(s, items.get(s.id, []), names) for s in rows]


@router.post("/schemes")
def create_scheme(
    body: SchemeBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    s = Scheme(id=gen_id(), business_id=business.id)
    item_ids = _apply_body(db, business, s, body)
    db.add(s)
    return _save_scheme(db, business, s, item_ids)


@router.patch("/schemes/{scheme_id}")
def update_scheme(
    scheme_id: str,
    body: SchemeBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    """Changes apply to new bills only; the log keeps what was applied."""
    # Last write wins, by decision (IM3): schemes are settings the owner changes rarely,
    # from one phone; a version check would only add conflicts. Beats differ (two
    # owners reorder one beat's shops at once) and carry a version. Don't "fix" this.
    s = _owned_scheme(db, business, scheme_id)
    return _save_scheme(db, business, s, _apply_body(db, business, s, body))


@router.delete("/schemes/{scheme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scheme(
    scheme_id: str,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> None:
    s = _owned_scheme(db, business, scheme_id)
    db.query(SchemeItem).filter(SchemeItem.scheme_id == s.id).delete(synchronize_session=False)
    db.delete(s)
    db.commit()


# ------------------------------------------------------------------ bills

def _member(membership: tuple[Business, str]) -> tuple[Business, str]:
    if not role_can(membership[1], ENTRY_CREATE):
        raise HTTPException(403, "You don't have permission to do that.")
    return membership


@router.post("/bills/preview")
def preview_bill(
    body: BillBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    db: Session = Depends(get_db),
) -> dict:
    """Lines, scheme lines and totals the server will save — nothing is saved."""
    business, _ = _member(membership)
    return billing.preview_dto(billing.compute(db, business, validate_date(body.date), body.lines,
                                               customer_id=body.customer_id))


@router.post("/bills")
def create_bill(
    body: BillBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = _member(membership)
    bill = billing.save(db, business, user, role, customer_id=body.customer_id,
                        day=validate_date(body.date), location=body.location,
                        van_user_id=body.van_user_id, lines_in=body.lines,
                        client_id=body.client_id, beat_id=body.beat_id,
                        queued=body.queued)
    return billing.bill_dto(db, bill)


class BillPrefixBody(BaseModel):
    prefix: str = Field(min_length=1, max_length=10)


@router.get("/bill-series")
def get_bill_series(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """The bill number prefix and the next number (this financial year)."""
    return billing.series_dto(db, business, today_iso())


@router.put("/bill-series")
def set_bill_prefix(
    body: BillPrefixBody,
    business: Business = Depends(require(SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: the prefix for new bills from now on (this year's series and
    later). Bills already numbered keep their numbers."""
    prefix = body.prefix.strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{1,6}", prefix):
        raise HTTPException(422, "Use 1 to 6 letters or digits for the prefix, e.g. SB.")
    db.execute(select(Business.id).where(Business.id == business.id).with_for_update())
    fy = financial_year(today_iso())
    billing.series_for(db, business, fy)
    db.execute(update(BillSeries).where(BillSeries.business_id == business.id, BillSeries.financial_year >= fy)
               .values(prefix=prefix))
    db.commit()
    return billing.series_dto(db, business, today_iso())


class CancelBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    # The lines to return (their item ids); empty = cancel the whole bill.
    item_ids: list[str] = Field(default_factory=list, alias="itemIds", max_length=200)


@router.post("/bills/{bill_id}/cancel")
def cancel_bill(
    bill_id: str,
    body: CancelBody | None = None,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: cancel a bill, or return some lines, by a reversal bill (never an
    edit). Returns the reversal bill."""
    rev = billing.cancel(db, business, user, bill_id, (body.item_ids if body else None) or None, today_iso())
    return billing.bill_dto(db, rev)


# --- Bill PDF share: the statements' one door (svc.share_statement_pdf, ST3) ---

def _owned_bill(db: Session, business: Business, bill_id: str) -> Bill:
    bill = db.get(Bill, bill_id)
    if bill is None or bill.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bill not found")
    return bill


class BillShareBody(BaseModel):
    channel: str = "whatsapp"


@router.post("/bills/{bill_id}/share")
def share_bill(
    bill_id: str,
    body: BillShareBody | None = None,
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Share or save the bill PDF. WhatsApp (and the open share sheet) only with
    the retailer's opt-in; email and save always, logged. The PDF itself comes
    from `pdfUrl`, valid a few minutes — nothing else issues it."""
    from .. import statements as st
    channel = (body or BillShareBody()).channel
    bill = _owned_bill(db, business, bill_id)
    customer = db.get(Customer, bill.customer_id)
    token = st.share_statement_pdf(db, business, customer, channel, user, f"Bill {bill.bill_number}",
                                   subject=f"bill:{bill.id}")
    return {"status": "ready", "channel": channel, "mobile": customer.mobile,
            "pdfUrl": f"/bills/{bill.id}.pdf?share={token}",
            "message": f"{business.business_name}: bill {bill.bill_number} of {bill.date}."}


@router.get("/bills/{bill_id}.pdf")
def bill_pdf(
    bill_id: str,
    share: str | None = Query(None),
    business: Business = Depends(require(DATA_VIEW)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """The bill as a PDF — only through the share above (its `share` token). A
    plain download can't be passed on to WhatsApp unchecked."""
    from .. import statements as st
    bill = _owned_bill(db, business, bill_id)
    customer = db.get(Customer, bill.customer_id)
    if not st.pdf_token_ok(f"bill:{bill.id}", share):
        st.log(db, business.id, customer.id, "blocked", "system", channel="bill_pdf",
               note=f"Bill {bill.bill_number}: PDF asked for without the consent-checked share", user=user)
        db.commit()
        raise HTTPException(403, "Share the bill from the bill screen: it checks the retailer's consent first.")
    lines = db.scalars(select(BillLine).where(BillLine.bill_id == bill.id)).all()
    apps = db.scalars(select(SchemeApplication).where(SchemeApplication.bill_id == bill.id)).all()
    pdf = st.render_bill(business, customer, bill, lines, apps,
                         st.balance_after_bill(db, customer, bill.ledger_entry_id, bill.date))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Bill_{bill.bill_number}.pdf"'})


@router.get("/bills/{bill_id}")
def get_bill(
    bill_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    bill = db.get(Bill, bill_id)
    if bill is None or bill.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Bill not found")
    return billing.bill_dto(db, bill)


# ------------------------------------------------------------- log & report

def _period(from_: str, to: str) -> tuple[str, str]:
    start, end = validate_date(from_), validate_date(to)
    if start > end:
        raise HTTPException(422, "The start date is after the end date.")
    return start, end


@router.get("/schemes/log")
def scheme_log(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    customer_id: str | None = Query(None, alias="customerId"),
    bill_id: str | None = Query(None, alias="billId"),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Every scheme considered on bills in the period — applied and not."""
    start, end = _period(from_, to)
    q = select(SchemeApplication, Bill.bill_number).join(Bill, Bill.id == SchemeApplication.bill_id) \
        .where(SchemeApplication.business_id == business.id,
               SchemeApplication.date >= start, SchemeApplication.date <= end)
    if customer_id:
        q = q.where(SchemeApplication.customer_id == customer_id)
    if bill_id:
        q = q.where(SchemeApplication.bill_id == bill_id)
    rows = db.execute(q.order_by(SchemeApplication.date.desc(), Bill.bill_number)).all()
    return [{**billing.application_dto(a), "billNumber": number} for a, number in rows]


@router.get("/schemes/report")
def scheme_report(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    scheme_id: str | None = Query(None, alias="schemeId"),
    item_id: str | None = Query(None, alias="itemId"),
    business: Business = Depends(require(REPORTS_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    """Applied schemes by scheme and SKU for the period, with totals."""
    start, end = _period(from_, to)
    return report_rows(db, business, start, end, scheme_id, item_id)


def report_rows(db: Session, business: Business, start: str, end: str,
                scheme_id: str | None = None, item_id: str | None = None) -> dict:
    """The Scheme Report's figures: what claims are made from, so the two always agree."""
    # Applied rows, less the reversals of returned bills: the report nets them out.
    q = select(SchemeApplication).where(
        SchemeApplication.business_id == business.id, SchemeApplication.status.in_(("applied", "reversed")),
        SchemeApplication.date >= start, SchemeApplication.date <= end)
    if scheme_id:
        q = q.where(SchemeApplication.scheme_id == scheme_id)
    if item_id:
        q = q.where(SchemeApplication.item_id == item_id)
    groups: dict[tuple, dict] = {}
    zero_q, zero_m = Decimal("0.000"), Decimal("0.00")
    for a in db.scalars(q).all():
        g = groups.setdefault((a.scheme_id, a.item_id), {
            "schemeId": a.scheme_id, "schemeName": a.scheme_name, "schemeType": a.scheme_type,
            "itemId": a.item_id, "itemName": a.item_name, "bills": set(),
            "quantity": zero_q, "freeQty": zero_q, "discount": zero_m, "value": zero_m})
        if a.status == "applied":
            g["bills"].add(a.bill_id)
        g["quantity"] += a.quantity
        g["freeQty"] += a.free_qty
        g["discount"] += a.discount
        g["value"] += a.value
    cancelled = set(db.scalars(select(Bill.id).where(Bill.business_id == business.id, Bill.status == "cancelled")))
    for g in groups.values():
        g["bills"] -= cancelled  # a fully cancelled bill no longer counts
    rows = sorted(groups.values(), key=lambda g: (g["schemeName"], g["itemName"]))
    out = [{**g, "bills": len(g["bills"]), "quantity": _q(g["quantity"]), "freeQty": _q(g["freeQty"]),
            "discount": f"{g['discount']:.2f}", "value": f"{g['value']:.2f}"} for g in rows]
    return {"from": start, "to": end, "rows": out,
            "totalDiscount": f"{sum((g['discount'] for g in rows), zero_m):.2f}",
            "totalValue": f"{sum((g['value'] for g in rows), zero_m):.2f}",
            "totalFreeQty": _q(sum((g["freeQty"] for g in rows), zero_q))}


# --- Scheme claims: what a scheme gave away in a period, claimed from the supplier --

class ClaimBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    scheme_id: str = Field(alias="schemeId")
    from_: str = Field(alias="from")
    to: str


class ClaimEdit(BaseModel):
    status: str | None = None
    note: str | None = None  # "" clears it


def _claim(db: Session, business: Business, claim_id: str) -> SchemeClaim:
    c = db.get(SchemeClaim, claim_id)
    if c is None or c.business_id != business.id:
        raise HTTPException(404, "Claim not found.")
    return c


@router.get("/schemes/claims")
def list_claims(business: Business = Depends(require(REPORTS_VIEW)), db: Session = Depends(get_db)) -> list[dict]:
    return [claims.claim_dto(c) for c in db.scalars(select(SchemeClaim).where(
        SchemeClaim.business_id == business.id).order_by(SchemeClaim.created_at.desc()))]


@router.post("/schemes/claims")
def file_claim(body: ClaimBody, business: Business = Depends(require(SETTINGS_MANAGE)),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """Assemble a claim from the scheme log: the report's rows for the scheme and
    period, copied as they stand. One live claim per scheme and period (a rejected
    one can be claimed again)."""
    start, end = _period(body.from_, body.to)
    report = report_rows(db, business, start, end, body.scheme_id)
    rows = report["rows"]
    if not rows or Decimal(report["totalValue"]) <= 0:
        raise AppError(422, "claim_empty", "Nothing was given away on this scheme in that period, so there's "
                       "nothing to claim.")
    name = rows[0]["schemeName"]
    clash = db.scalars(select(SchemeClaim).where(
        SchemeClaim.business_id == business.id, SchemeClaim.scheme_id == body.scheme_id,
        SchemeClaim.status != "rejected", SchemeClaim.period_from <= end, SchemeClaim.period_to >= start)).first()
    if clash:
        raise AppError(409, "claim_exists", f"There's already a claim for {name} from {clash.period_from} to "
                       f"{clash.period_to}.", scheme=name, start=clash.period_from, end=clash.period_to)
    bills = len({a.bill_id for a in db.scalars(select(SchemeApplication).where(
        SchemeApplication.business_id == business.id, SchemeApplication.scheme_id == body.scheme_id,
        SchemeApplication.status == "applied", SchemeApplication.date >= start, SchemeApplication.date <= end))}
        - set(db.scalars(select(Bill.id).where(Bill.business_id == business.id, Bill.status == "cancelled"))))
    lines = [{k: r[k] for k in ("itemId", "itemName", "bills", "quantity", "freeQty", "discount", "value")} for r in rows]
    c = SchemeClaim(business_id=business.id, scheme_id=body.scheme_id, scheme_name=name,
                    scheme_type=rows[0]["schemeType"], period_from=start, period_to=end, bills=bills,
                    total_qty=sum((Decimal(r["quantity"]) for r in rows), Decimal("0")),
                    total_free_qty=Decimal(report["totalFreeQty"]), total_discount=Decimal(report["totalDiscount"]),
                    total_value=Decimal(report["totalValue"]), lines=json.dumps(lines), created_by=user.id)
    db.add(c)
    db.commit()
    return claims.claim_dto(c)


@router.patch("/schemes/claims/{claim_id}")
def edit_claim(claim_id: str, body: ClaimEdit, business: Business = Depends(require(SETTINGS_MANAGE)),
               db: Session = Depends(get_db)) -> dict:
    """The claim's status as the supplier answers, and their answer in a note.
    The figures never change: a new claim is made for a different period."""
    c = _claim(db, business, claim_id)
    if body.status is not None:
        if body.status not in claims.STATUSES:
            raise HTTPException(422, "Status must be draft, filed, approved, rejected or paid.")
        if body.status != "draft" and c.filed_at is None:
            c.filed_at = now_iso()
        c.status = body.status
    if body.note is not None:
        c.note = validate_notes(body.note, 1000)
    c.updated_at = now_iso()
    db.commit()
    return claims.claim_dto(c)


@router.get("/schemes/claims/{claim_id}.pdf")
def claim_pdf(claim_id: str, business: Business = Depends(require(REPORTS_VIEW)), db: Session = Depends(get_db)):
    c = _claim(db, business, claim_id)
    return Response(claims.render_pdf(business, c), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Claim_{c.id[:8]}.pdf"'})


@router.get("/schemes/claims/{claim_id}.xlsx")
def claim_xlsx(claim_id: str, business: Business = Depends(require(REPORTS_VIEW)), db: Session = Depends(get_db)):
    c = _claim(db, business, claim_id)
    return Response(claims.render_xlsx(business, c), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="Claim_{c.id[:8]}.xlsx"'})
