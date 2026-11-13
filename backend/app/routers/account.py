"""Self-service data rights (DPDP): export everything, and delete the account.

- GET  /account/export  — the user's full data as JSON (right to access/port).
- GET  /account/export.xlsx, /account/balances.pdf — the current business's
                          data as Excel / a balances PDF ("Your data" screen).
                          Free on every plan: no plan or payment check, ever.
- DELETE /account       — hard-delete the user and everything they own, after an
                          explicit typed confirmation, and log the deletion for
                          our compliance record (right to erasure).

Business-profile correction lives in auth.py (PATCH /businesses/me).
"""

import json
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import data_export
from ..calc import today_iso
from ..database import get_db
from ..deps import require
from ..doc_i18n import LANGUAGES, Tr, translator
from ..gst_reports import XLSX
from ..rbac import REPORTS_EXPORT
from ..models import (
    AccountDeletionLog,
    AiDecision,
    BankImport,
    BankLine,
    Bill,
    BillLine,
    GstRateChangeLog,
    Beat,
    BeatRetailer,
    Visit,
    Business,
    BusinessMember,
    Customer,
    Expense,
    Feedback,
    Income,
    Item,
    ItemUnit,
    StockMonthLock,
    LedgerEntry,
    RecurringExpense,
    Scheme,
    SchemeApplication,
    SchemeItem,
    StatementEvent,
    StatementLink,
    StockMove,
    User,
    now_iso,
    AccessLog,
    BankMatch,
    BeatAssignment,
    CashCount,
    CaTestResult,
    CashDeposit,
    CreditNote,
    Supplier,
    GstInvoiceNumber,
    ImportLog,
    PaymentUtr,
    StockLevel,
)
from ..security import get_current_user
from ..serializers import (
    business_dto,
    customer_dto,
    expense_dto,
    income_dto,
    item_dto,
    ledger_dto,
    recurring_expense_dto,
)

router = APIRouter(tags=["account"])

# The user must type this exactly to delete (there's no password — OTP auth).
DELETE_CONFIRMATION = "DELETE MY ACCOUNT"


def _owned_businesses(db: Session, user: User) -> list[Business]:
    return db.scalars(select(Business).where(Business.user_id == user.id)).all()


@router.get("/account/export")
def export_account(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Everything we hold for this user, as portable JSON."""
    out: dict = {
        "schema_version": 2,
        "exported_at": now_iso(),
        "account": {
            "id": user.id,
            "mobile": user.mobile,
            "created_at": user.created_at,
        },
        "businesses": [],
    }
    for b in _owned_businesses(db, user):
        customers = db.scalars(
            select(Customer).where(Customer.business_id == b.id)
        ).all()
        cust_ids = [c.id for c in customers]
        ledger = (
            db.scalars(
                select(LedgerEntry).where(LedgerEntry.customer_id.in_(cust_ids))
            ).all()
            if cust_ids
            else []
        )
        out["businesses"].append({
            # Every table, from the one shared builder (also behind the Excel export).
            "all_tables": data_export.sections(db, b),
            "business": business_dto(b),
            "incomes": [income_dto(x) for x in db.scalars(
                select(Income).where(Income.business_id == b.id)).all()],
            "expenses": [expense_dto(x) for x in db.scalars(
                select(Expense).where(Expense.business_id == b.id)).all()],
            "customers": [customer_dto(c) for c in customers],
            "ledger_entries": [ledger_dto(x) for x in ledger],
            "items": [item_dto(x) for x in db.scalars(
                select(Item).where(Item.business_id == b.id)).all()],
            "recurring_expenses": [recurring_expense_dto(x) for x in db.scalars(
                select(RecurringExpense).where(RecurringExpense.business_id == b.id)).all()],
            "team": [
                {"user_id": m.user_id, "role": m.role, "status": m.status,
                 "invited_by_mobile": m.invited_by_mobile}
                for m in db.scalars(
                    select(BusinessMember).where(BusinessMember.business_id == b.id)).all()
            ],
        })
    return out


def _download(data: bytes, media_type: str, name: str) -> Response:
    return Response(data, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "Cache-Control": "no-store"})


def _owner_language(lang: str | None) -> Tr:
    """The app sends the owner's language (TE5). Reviewed strings only, English
    where none; an older app (no `lang`) or an unknown one gets English, as before."""
    return translator(lang if lang in LANGUAGES else "en")


@router.get("/account/export.xlsx")
def export_workbook(
    lang: str | None = Query(None, max_length=10),
    business: Business = Depends(require(REPORTS_EXPORT)),
    db: Session = Depends(get_db),
) -> Response:
    """Customers, ledger, income and expenses in one Excel file."""
    return _download(data_export.workbook(db, business, _owner_language(lang)), XLSX,
                     f"Bolcash_data_{today_iso()}.xlsx")


@router.get("/account/balances.pdf")
def export_balances(
    lang: str | None = Query(None, max_length=10),
    business: Business = Depends(require(REPORTS_EXPORT)),
    db: Session = Depends(get_db),
) -> Response:
    """Every customer's balance, printable."""
    return _download(data_export.balances_pdf(db, business, _owner_language(lang)), "application/pdf",
                     f"Bolcash_balances_{today_iso()}.pdf")


class DeleteAccountBody(BaseModel):
    confirmation: str


@router.delete("/account")
def delete_account(
    body: DeleteAccountBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Permanently delete the user and everything they own. Requires the exact
    confirmation phrase. Writes a PII-free deletion record for compliance."""
    if body.confirmation.strip() != DELETE_CONFIRMATION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f'Type "{DELETE_CONFIRMATION}" exactly to confirm deletion.',
        )

    counts: dict[str, int] = defaultdict(int)
    businesses = _owned_businesses(db, user)
    biz_ids = [b.id for b in businesses]

    if biz_ids:
        cust_ids = [
            c.id for c in db.scalars(
                select(Customer).where(Customer.business_id.in_(biz_ids))).all()
        ]
        # Children first, then parents — explicit so it works regardless of
        # whether the DB enforces ON DELETE CASCADE (SQLite often doesn't).
        beat_ids = [b.id for b in db.scalars(
            select(Beat).where(Beat.business_id.in_(biz_ids))).all()]
        counts["bank_matches"] += db.query(BankMatch).filter(
            BankMatch.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["cash_deposits"] += db.query(CashDeposit).filter(
            CashDeposit.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["suppliers"] += db.query(Supplier).filter(
            Supplier.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["ca_test_results"] += db.query(CaTestResult).filter(
            CaTestResult.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["credit_notes"] += db.query(CreditNote).filter(
            CreditNote.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["bank_lines"] += db.query(BankLine).filter(
            BankLine.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["bank_imports"] += db.query(BankImport).filter(
            BankImport.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["visits"] += db.query(Visit).filter(
            Visit.business_id.in_(biz_ids)).delete(synchronize_session=False)
        if beat_ids:
            counts["beat_assignments"] += db.query(BeatAssignment).filter(
                BeatAssignment.beat_id.in_(beat_ids)).delete(synchronize_session=False)
            counts["beat_retailers"] += db.query(BeatRetailer).filter(
                BeatRetailer.beat_id.in_(beat_ids)).delete(synchronize_session=False)
        counts["beats"] += db.query(Beat).filter(
            Beat.business_id.in_(biz_ids)).delete(synchronize_session=False)
        # Rows that point at ledger entries go first (no SQLite cascade).
        for model in (PaymentUtr, GstInvoiceNumber):
            counts[model.__tablename__] += db.query(model).filter(
                model.business_id.in_(biz_ids)).delete(synchronize_session=False)
        if cust_ids:
            counts["ledger_entries"] += db.query(LedgerEntry).filter(
                LedgerEntry.customer_id.in_(cust_ids)
            ).delete(synchronize_session=False)
        item_ids = select(Item.id).where(Item.business_id.in_(biz_ids))
        counts["stock_month_locks"] += db.query(StockMonthLock).filter(
            StockMonthLock.business_id.in_(biz_ids)).delete(synchronize_session=False)
        counts["item_units"] += db.query(ItemUnit).filter(
            ItemUnit.item_id.in_(item_ids)).delete(synchronize_session=False)
        bill_ids = [b.id for b in db.scalars(select(Bill).where(Bill.business_id.in_(biz_ids))).all()]
        scheme_ids = [x.id for x in db.scalars(select(Scheme).where(Scheme.business_id.in_(biz_ids))).all()]
        if bill_ids:
            counts["bill_lines"] += db.query(BillLine).filter(
                BillLine.bill_id.in_(bill_ids)).delete(synchronize_session=False)
        if scheme_ids:
            counts["scheme_items"] += db.query(SchemeItem).filter(
                SchemeItem.scheme_id.in_(scheme_ids)).delete(synchronize_session=False)
        for model in (StatementLink, StatementEvent, SchemeApplication, Bill, Scheme, GstRateChangeLog, StockMove, StockLevel, ImportLog, AccessLog, CashCount, Income, Expense, Item, RecurringExpense, Customer,
                      AiDecision):
            counts[model.__tablename__] += db.query(model).filter(
                model.business_id.in_(biz_ids)
            ).delete(synchronize_session=False)
        counts["business_members"] += db.query(BusinessMember).filter(
            BusinessMember.business_id.in_(biz_ids)
        ).delete(synchronize_session=False)
        counts["businesses"] += db.query(Business).filter(
            Business.id.in_(biz_ids)
        ).delete(synchronize_session=False)

    # The user's memberships in OTHER people's businesses, and their feedback.
    counts["business_members"] += db.query(BusinessMember).filter(
        BusinessMember.user_id == user.id
    ).delete(synchronize_session=False)
    counts["feedback"] += db.query(Feedback).filter(
        Feedback.user_id == user.id
    ).delete(synchronize_session=False)

    # Record the deletion (no PII) BEFORE removing the user row.
    mobile = user.mobile or ""
    masked = f"***{mobile[-4:]}" if len(mobile) >= 4 else "***"
    db.add(AccountDeletionLog(
        user_id=user.id,
        mobile_masked=masked,
        counts_json=json.dumps(dict(counts)),
    ))

    counts["users"] += db.query(User).filter(
        User.id == user.id
    ).delete(synchronize_session=False)

    db.commit()
    return {"deleted": True, "counts": dict(counts)}
