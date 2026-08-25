"""Plain-dict serializers producing the exact JSON the mobile DTOs expect.

The app's auth/business DTOs are camelCase; all other DTOs are snake_case.
"""

from .models import (
    Business,
    Customer,
    Expense,
    Income,
    Item,
    LedgerEntry,
    RecurringExpense,
)


def income_dto(m: Income) -> dict:
    return {
        "id": m.id,
        "amount": m.amount,
        "category": m.category,
        "date": m.date,
        "notes": m.notes,
        "attachment_url": m.attachment_url,
        "created_at": m.created_at,
    }


def expense_dto(m: Expense) -> dict:
    return {
        "id": m.id,
        "amount": m.amount,
        "category": m.category,
        "vendor": m.vendor,
        "date": m.date,
        "notes": m.notes,
        "attachment_url": m.attachment_url,
        "created_at": m.created_at,
    }


def customer_dto(m: Customer) -> dict:
    return {
        "id": m.id,
        "full_name": m.full_name,
        "mobile": m.mobile,
        "gst_number": m.gst_number,
        "business_name": m.business_name,
        "address": m.address,
        "notes": m.notes,
        "outstanding_amount": m.outstanding_amount,
        "last_transaction_date": m.last_transaction_date,
        "is_overdue": m.is_overdue,
        "created_at": m.created_at,
    }


def ledger_dto(m: LedgerEntry) -> dict:
    return {
        "id": m.id,
        "type": m.type,
        "amount": m.amount,
        "date": m.date,
        "invoice_number": m.invoice_number,
        "notes": m.notes,
        "payment_method": m.payment_method,
        "reference_number": m.reference_number,
        "attachment_url": m.attachment_url,
        "created_at": m.created_at,
    }


def item_dto(m: Item) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "type": m.type,
        "sale_price": m.sale_price,
        "purchase_price": m.purchase_price,
        "unit": m.unit,
        "hsn_sac": m.hsn_sac,
        "gst_rate": m.gst_rate,
        "track_stock": m.track_stock,
        "stock_qty": m.stock_qty,
        "created_at": m.created_at,
    }


def recurring_expense_dto(m: RecurringExpense, *, today: str | None = None) -> dict:
    from .recurring import is_due

    return {
        "id": m.id,
        "name": m.name,
        "amount": m.amount,
        "category": m.category,
        "vendor": m.vendor,
        "frequency": m.frequency,
        "interval": m.interval,
        "anchor_day": m.anchor_day,
        "next_due_date": m.next_due_date,
        "last_posted_date": m.last_posted_date,
        "notes": m.notes,
        "active": m.active,
        "is_due": bool(m.active and today and is_due(m.next_due_date, today)),
        "created_at": m.created_at,
    }


def business_dto(m: Business) -> dict:
    # camelCase to match the app's Business type.
    return {
        "id": m.id,
        "businessName": m.business_name,
        "ownerName": m.owner_name,
        "businessType": m.business_type,
        "state": m.state,
        "gstRegistered": m.gst_registered,
    }
