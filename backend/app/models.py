import uuid
from decimal import Decimal
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .crypto import EncryptedText
from .database import Base


def gen_id() -> str:
    return uuid.uuid4().hex


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    mobile: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    businesses: Mapped[list["Business"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class BusinessMember(Base):
    """Links a user to a business with a role — the basis of RBAC.

    A business can have many members; a user can belong to many businesses
    (v1 uses the first active membership as the active business). The original
    creator is seeded as an 'owner' member.
    """

    __tablename__ = "business_members"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))  # owner | accountant | staff
    status: Mapped[str] = mapped_column(String(20), default="active")
    # Mobile the owner invited (for display before that user first logs in).
    invited_by_mobile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("business_id", "user_id", name="uq_member_business_user"),
    )


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    business_name: Mapped[str] = mapped_column(String(200))
    owner_name: Mapped[str] = mapped_column(String(200))
    business_type: Mapped[str] = mapped_column(String(60))
    state: Mapped[str] = mapped_column(String(80))
    gst_registered: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    user: Mapped[User] = relationship(back_populates="businesses")


class Income(Base):
    __tablename__ = "incomes"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(60))
    date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    notes: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(60))
    vendor: Mapped[str] = mapped_column(String(200))
    date: Mapped[str] = mapped_column(String(10), index=True)
    notes: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class RecurringExpense(Base):
    """A template for a repeating expense (rent, salary, subscriptions…).

    Stores a cadence; the next due date is computed by `app.recurring`. Posting
    an occurrence creates a real Expense row and rolls `next_due_date` forward.
    """

    __tablename__ = "recurring_expenses"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    amount: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(60))
    vendor: Mapped[str] = mapped_column(String(200))
    frequency: Mapped[str] = mapped_column(String(20))  # weekly|monthly|yearly|custom
    interval: Mapped[int] = mapped_column(Integer, default=1)  # every N units
    # Preserves the intended day-of-month for monthly templates across short months.
    anchor_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_due_date: Mapped[str] = mapped_column(String(10), index=True)  # YYYY-MM-DD
    last_posted_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    full_name: Mapped[str] = mapped_column(String(200), index=True)
    mobile: Mapped[str] = mapped_column(String(20), index=True)
    gst_number: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    business_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    notes: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    outstanding_amount: Mapped[float] = mapped_column(Float, default=0.0)
    last_transaction_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_overdue: Mapped[bool] = mapped_column(Boolean, default=False)
    # INR; None = no limit. Server-side so staff on a beat see the same limit.
    credit_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    # Monotonic optimistic-concurrency token: +1 on every edit. A stale edit
    # from a second device (lower version) is rejected instead of clobbering.
    # An integer avoids the same-microsecond collisions a timestamp token has.
    version: Mapped[int] = mapped_column(Integer, default=1)

    ledger: Mapped[list["LedgerEntry"]] = relationship(
        back_populates="customer", cascade="all, delete-orphan"
    )


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(String(20))  # 'credit' | 'payment'
    amount: Mapped[float] = mapped_column(Float)
    date: Mapped[str] = mapped_column(String(10), index=True)
    invoice_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    payment_method: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    reference_number: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    # Who recorded it (set by the server from the token) and, when recorded from
    # a beat day-list, which beat. Both feed the per-beat daily close.
    salesman_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    beat_id: Mapped[str | None] = mapped_column(
        ForeignKey("beats.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # GST invoice fields — credit entries only, all null for a non-GST sale.
    # The tax split is computed by the server (app/gst.py) when the entry is
    # saved and never recomputed, so a later rate change can't alter it.
    # `amount` is then the invoice total (taxable + taxes).
    customer_gstin: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    hsn_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    place_of_supply: Mapped[str | None] = mapped_column(String(2), nullable=True)  # state code
    gst_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    price_includes_gst: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    taxable_value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cgst: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    sgst: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    igst: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    customer: Mapped[Customer] = relationship(back_populates="ledger")


class BankImport(Base):
    """One uploaded bank statement. The file hash makes re-imports a no-op."""

    __tablename__ = "bank_imports"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    file_hash: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("business_id", "file_hash", name="uq_bank_import_hash"),
    )


class BankLine(Base):
    """A money-in line from a bank statement, matched by hand to a collection."""

    __tablename__ = "bank_lines"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    import_id: Mapped[str] = mapped_column(
        ForeignKey("bank_imports.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[str] = mapped_column(String(10), index=True)
    amount_paise: Mapped[int] = mapped_column(Integer)  # exact; no float money
    utr: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    narration: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    # Set only by a person confirming the match. Unique: one entry, one line.
    matched_entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    confirmed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    confirmed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Beat(Base):
    """A fixed route of retailers a staff member visits on set weekdays."""

    __tablename__ = "beats"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    weekdays: Mapped[str] = mapped_column(String(20))  # "0,3" = Mon + Thu (Mon=0)
    assigned_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class BeatRetailer(Base):
    __tablename__ = "beat_retailers"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    beat_id: Mapped[str] = mapped_column(
        ForeignKey("beats.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    visit_order: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("beat_id", "customer_id", name="uq_beat_retailer"),
    )


VISIT_OUTCOMES = ("visited_ordered", "visited_no_order", "not_visited")


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    beat_id: Mapped[str] = mapped_column(
        ForeignKey("beats.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    outcome: Mapped[str] = mapped_column(String(20))  # one of VISIT_OUTCOMES
    reason: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    promise_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    visited_at: Mapped[str] = mapped_column(String(40))  # ISO, +05:30 (IST)
    # Offline sync key: a retried upload returns the first row, never a second.
    client_id: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("business_id", "client_id", name="uq_visit_client"),
    )


class Item(Base):
    """A product or service in the business catalog (for GST invoicing)."""

    __tablename__ = "items"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), index=True)
    type: Mapped[str] = mapped_column(String(20), default="product")  # product | service
    sale_price: Mapped[float] = mapped_column(Float, default=0.0)
    purchase_price: Mapped[float] = mapped_column(Float, default=0.0)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)  # pcs, kg, hr…
    hsn_sac: Mapped[str | None] = mapped_column(String(20), nullable=True)  # HSN/SAC code
    gst_rate: Mapped[float] = mapped_column(Float, default=0.0)  # 0/5/12/18/28
    track_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    # Total across godown and vans, kept in step with StockMove by app/stock.py.
    stock_qty: Mapped[float] = mapped_column(Float, default=0.0)
    # Alert when total stock is below this; None = no alert.
    low_stock_threshold: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


STOCK_KINDS = ("opening", "purchase", "sale", "transfer", "count")


class StockMove(Base):
    """One change to one item's stock at one place — the stock ledger and its
    audit log. Stock at a place = the sum of its moves; nothing else stores it.

    location: 'godown', or 'van' with van_user_id = the salesperson. A transfer
    is two moves (godown −q, van +q) sharing group_id; a stock count writes one
    move per counted item (quantity = counted − system, 0 when it matched).
    """

    __tablename__ = "stock_moves"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    location: Mapped[str] = mapped_column(String(10))  # godown | van
    # No FK: a van's history stays attributed after the salesperson leaves.
    van_user_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(20))  # STOCK_KINDS
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3))  # signed
    # Count moves only: the physical count (system stock = counted − quantity).
    counted: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    group_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    client_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        # Retry-safe: the app's client_id goes on the first move of a request only.
        UniqueConstraint("business_id", "client_id", name="uq_stock_move_client"),
    )


class GstRateChangeLog(Base):
    """Every change to an item's GST rate. Old invoices keep the rate and tax
    they were saved with; this log is the audit trail for the CA."""

    __tablename__ = "gst_rate_change_logs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str | None] = mapped_column(
        ForeignKey("items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    item_name: Mapped[str] = mapped_column(String(200))
    old_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    new_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    changed_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    changed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class Feedback(Base):
    """User-submitted feedback / bug reports, with device diagnostics attached."""

    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    user_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    business_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(20), default="feedback")  # feedback | bug
    message: Mapped[str] = mapped_column(Text)
    diagnostics: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class AiDecision(Base):
    """Audit log of AI outputs (categorization / receipt scan / insights)."""

    __tablename__ = "ai_decisions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(40))
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_json: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class UserConsent(Base):
    """One consent decision, for ONE purpose, per user.

    Consent is stored granularly — one row per (user, purpose) — never as a
    single combined "agreed" flag. Each row records what was decided (granted),
    when (updated_at), and under which policy the decision was made
    (policy_version), so every purpose can be granted or withdrawn
    independently and the decision is auditable. created_at is the first
    decision; updated_at moves on every change.
    """

    __tablename__ = "user_consents"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(40))  # core | marketing | ai
    granted: Mapped[bool] = mapped_column(Boolean, default=False)
    policy_version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("user_id", "purpose", name="uq_consent_user_purpose"),
    )

class AccountDeletionLog(Base):
    """Compliance record that an account was deleted — deliberately holds NO
    personal data. We keep the opaque user id (a random uuid, not PII), a masked
    mobile (last 4 digits), the timestamp, and counts of what was removed, so we
    can prove a deletion happened without retaining the data we just erased."""

    __tablename__ = "account_deletion_log"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(40), index=True)  # opaque, not PII
    mobile_masked: Mapped[str] = mapped_column(String(20))
    requested_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    counts_json: Mapped[str] = mapped_column(Text)  # JSON: rows deleted per table
