"""Plain-dict serializers producing the exact JSON the mobile DTOs expect.

The app's auth/business DTOs are camelCase; all other DTOs are snake_case.
"""

from .models import Business, Customer, Expense, Income, LedgerEntry


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
