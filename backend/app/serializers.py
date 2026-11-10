from decimal import Decimal
"""Plain-dict serializers producing the exact JSON the mobile DTOs expect.

The app's auth/business DTOs are camelCase; all other DTOs are snake_case.
"""

from .gst import money
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
        "credit_limit": m.credit_limit,
        "credit_limit_version": m.credit_limit_version or 0,
        "created_at": m.created_at,
        "updated_at": m.updated_at or m.created_at,
        # Optimistic-concurrency token the client echoes back on edit.
        "version": m.version or 1,
    }


def ledger_dto(m: LedgerEntry) -> dict:
    return {
        "id": m.id,
        "client_id": m.client_id,
        "type": m.type,
        "amount": m.amount,
        "date": m.date,
        "invoice_number": m.invoice_number,
        "utr_missing": bool(m.utr_missing),
        "notes": m.notes,
        "payment_method": m.payment_method,
        "reference_number": m.reference_number,
        "cheque_bank": m.cheque_bank,
        "cheque_account": m.cheque_account,
        "ref_duplicate_of": m.ref_duplicate_of,
        "attachment_url": m.attachment_url,
        "salesman_id": m.salesman_id,
        "beat_id": m.beat_id,
        "gst": gst_dto(m),
        "created_at": m.created_at,
    }


def gst_dto(m: LedgerEntry) -> dict | None:
    """The saved tax split of a GST invoice (exact strings), else None."""
    if m.gst_rate is None:
        return None
    return {
        "rate": f"{m.gst_rate.normalize():f}",
        "hsn": m.hsn_code,
        "customer_gstin": m.customer_gstin,
        "place_of_supply": m.place_of_supply,
        "price_includes_gst": bool(m.price_includes_gst),
        "taxable_value": money(m.taxable_value),
        "cgst": money(m.cgst),
        "sgst": money(m.sgst),
        "igst": money(m.igst),
        "quantity": None if m.gst_quantity is None else f"{Decimal(m.gst_quantity).normalize():f}",
        "uqc": m.gst_uqc,
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
        "low_stock_threshold": None if m.low_stock_threshold is None
        else float(m.low_stock_threshold),
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
        "gstin": m.gstin,
    }
