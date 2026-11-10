import uuid
from decimal import Decimal
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy import text
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
    # What the owner calls this person ("Ravi", "Van 2 – Suresh"); shown on
    # teams, vans, beats and logs instead of the mobile number.
    display_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
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
    # The seller's own GSTIN, printed on every GST invoice; its first two
    # digits are the seller's state for CGST/SGST vs IGST.
    gstin: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
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

    # An offline retry reuses its client_id; two retries racing each other
    # must still produce one row. (NULLs don't collide.)
    __table_args__ = (Index("uq_income_client", "business_id", "client_id", unique=True),)


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

    __table_args__ = (Index("uq_expense_client", "business_id", "client_id", unique=True),)


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
    # +1 on every limit change; 0 = never set. A stale limit save gets a 409.
    credit_limit_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
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
    # A UPI payment saved by an app version from before the UTR rule, with no
    # UTR: accepted (never lost) and flagged until the owner adds the UTR.
    utr_missing: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Bank-transfer / cheque references: a WARNING on repeats, never a block
    # (cheque numbers repeat across banks, accounts and years). ref_hash is a
    # blind index of rail + reference (+ bank + account for a cheque), not
    # unique; ref_duplicate_of is the earlier entry the warning named.
    cheque_bank: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    cheque_account: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    ref_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ref_duplicate_of: Mapped[str | None] = mapped_column(String(40), nullable=True)
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
    # Quantity and unit of the invoice line (Rule 46; GSTR-1 table 12).
    gst_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    gst_uqc: Mapped[str | None] = mapped_column(String(3), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    customer: Mapped[Customer] = relationship(back_populates="ledger")

    __table_args__ = (Index("uq_ledger_client", "customer_id", "client_id", unique=True),)


class AccessLog(Base):
    """What an accountant opened or exported (and any write they were refused).
    Written on every accountant API call; the owner reads it under Team."""

    __tablename__ = "access_logs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    mobile: Mapped[str] = mapped_column(String(20))
    action: Mapped[str] = mapped_column(String(10))  # view | export | denied
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso, index=True)


class ImportLog(Base):
    """One khata import from Excel/CSV: who, when, which file, what happened,
    and a backup of the books (the "Your data" workbook) taken just before."""

    __tablename__ = "import_logs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    imported_by: Mapped[str] = mapped_column(String(60))  # "owner · 98xxxxxx10" at the time
    file_name: Mapped[str] = mapped_column(String(200))
    rows_imported: Mapped[int] = mapped_column(Integer)
    rows_skipped: Mapped[int] = mapped_column(Integer)
    new_retailers: Mapped[int] = mapped_column(Integer, default=0)
    # base64 .xlsx, encrypted at rest like the rest of the customer data.
    backup: Mapped[str] = mapped_column(EncryptedText)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


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
    # Soft delete: the statement and its lines stay for the record, but they
    # leave every list and total; file_hash is freed so it can be re-imported.
    deleted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # The real hash while deleted, so a restore can tell whether the same file
    # was imported again in the meantime.
    deleted_file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

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
    # Legacy one-to-one match (before BankMatch); moved into bank_matches on
    # boot and no longer written. ponytail: drop once every server has migrated.
    matched_entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    confirmed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    confirmed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    deleted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)  # its statement was deleted


class CashCount(Base):
    """Cash physically counted at day end for a beat (or the whole business).
    Every count is kept; the latest is the one shown. It is only compared
    with the cash recorded — it never changes a sale or a payment."""

    __tablename__ = "cash_counts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[str] = mapped_column(String(10), index=True)
    beat_id: Mapped[str | None] = mapped_column(String(40), nullable=True)  # None = whole business
    # The salesperson whose cash this is; None = the whole beat (or business).
    user_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    counted_paise: Mapped[int] = mapped_column(Integer)
    counted_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    note: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


class CashDeposit(Base):
    """Cash the owner already took to the bank (kind "deposit"), or cash kept
    back in the shop as float (kind "float") — a record of money moved, never
    a sale or a collection, and never edited: a short deposit is a deposit
    row plus a float row. A deposit is matched to its bank line through
    bank_matches (deposit_id), like a collection."""

    __tablename__ = "cash_deposits"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    beat_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)  # None = whole business
    # The salesperson whose cash this is; None = the whole beat (or business).
    user_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="deposit")  # deposit | float
    amount_paise: Mapped[int] = mapped_column(Integer)
    counted_cash_id: Mapped[str | None] = mapped_column(
        ForeignKey("cash_counts.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    deleted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        CheckConstraint("kind IN ('deposit', 'float')", name="ck_cash_deposit_kind"),
        CheckConstraint("amount_paise > 0", name="ck_cash_deposit_amount"),
    )


class BankMatch(Base):
    """An allocation: part of a bank line paying part of a collection. One line
    can cover several collections (₹1,000 = ₹600 + ₹400), or one collection can
    be split across several lines (₹600 + ₹400 transfers for a ₹1,000 payment);
    never both at once. Rows saved together share group_id and are undone
    together; a collection is only ever fully allocated. Undo keeps the row
    (undone_at/by) as the record."""

    __tablename__ = "bank_matches"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    bank_line_id: Mapped[str] = mapped_column(
        ForeignKey("bank_lines.id", ondelete="CASCADE"), index=True
    )
    # A collection, or (deposit_id) a cash deposit; exactly one of the two.
    entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="CASCADE"), index=True, nullable=True
    )
    deposit_id: Mapped[str | None] = mapped_column(
        ForeignKey("cash_deposits.id", ondelete="CASCADE"), index=True, nullable=True
    )
    amount_paise: Mapped[int] = mapped_column(Integer)
    group_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    # 0 for a collection's first line, 1, 2… for the other lines of a split.
    part: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    confirmed_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    confirmed_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    undone_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    undone_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    undo_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        # One active match per collection, enforced by the database: a second
        # match would reuse part 0. A split's other lines are parts 1, 2…
        Index("uq_bank_match_active_part", "entry_id", "part", unique=True,
              sqlite_where=text("undone_at IS NULL"), postgresql_where=text("undone_at IS NULL")),
        # A deposit is in at most one active match.
        Index("uq_bank_match_active_deposit", "deposit_id", unique=True,
              sqlite_where=text("undone_at IS NULL AND deposit_id IS NOT NULL"),
              postgresql_where=text("undone_at IS NULL AND deposit_id IS NOT NULL")),
    )


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
    # Soft delete: gone from every list, but its visits and daily closes stay.
    deleted_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # assigned_user_id mirrors the open primary assignment (older app versions
    # read it); who may work the beat is decided by beat_assignments.
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)


BEAT_ROLES = ("primary", "secondary")


class BeatAssignment(Base):
    """Who works a beat, and when. A beat can have several staff; exactly one
    open primary at a time, who owns the beat's daily close. Ending an
    assignment sets valid_to (last day it applies); history stays."""

    __tablename__ = "beat_assignments"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    beat_id: Mapped[str] = mapped_column(ForeignKey("beats.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10))  # BEAT_ROLES
    valid_from: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD (IST)
    valid_to: Mapped[str | None] = mapped_column(String(10), nullable=True)  # last day; None = open
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        # Exactly one open primary per beat, enforced by the database.
        Index("uq_beat_open_primary", "beat_id", unique=True,
              sqlite_where=text("role = 'primary' AND valid_to IS NULL"),
              postgresql_where=text("role = 'primary' AND valid_to IS NULL")),
        CheckConstraint("role IN ('primary', 'secondary')", name="ck_beat_assignment_role"),
    )


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
    # Purchases only: who it was bought from, at what price, on which bill.
    supplier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    bill_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        # Retry-safe: the app's client_id goes on the first move of a request only.
        UniqueConstraint("business_id", "client_id", name="uq_stock_move_client"),
    )


class StockLevel(Base):
    """Current stock of one item at one place. Changed only by a single
    conditional UPDATE (app/stock.py), so two sales at the same moment can't
    both take the last box; the CHECK is the database's own backstop."""

    __tablename__ = "stock_levels"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    location: Mapped[str] = mapped_column(String(10))  # godown | van
    van_key: Mapped[str] = mapped_column(String(40), default="")  # "" = godown, else van user id
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("0"))

    __table_args__ = (
        UniqueConstraint("business_id", "item_id", "location", "van_key", name="uq_stock_level_place"),
        CheckConstraint("qty >= 0", name="ck_stock_level_not_negative"),
    )


SCHEME_TYPES = ("buy_get", "slab", "percent", "free_goods")


class Scheme(Base):
    """An FMCG trade scheme the owner sets up; applied automatically at billing.

    buy_get    : buy `buy_qty`, get `free_qty` of the same SKU free (10+1).
    slab       : quantity slabs, each a % off (`slabs` = JSON [[min_qty, pct], …]).
    percent    : `percent` off the line when quantity ≥ `min_qty`.
    free_goods : every `min_qty` bought gives `free_qty` of `free_item_id`.
    `priority`: 1 wins over 2 when two schemes could apply to the same line.
    """

    __tablename__ = "schemes"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(20))  # SCHEME_TYPES
    valid_from: Mapped[str] = mapped_column(String(10))
    valid_to: Mapped[str] = mapped_column(String(10))  # inclusive
    priority: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    buy_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    free_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    free_item_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    min_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    percent: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    slabs: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("business_id", "priority", name="uq_scheme_priority"),
    )


class SchemeItem(Base):
    """A SKU a scheme applies to."""

    __tablename__ = "scheme_items"

    scheme_id: Mapped[str] = mapped_column(
        ForeignKey("schemes.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[str] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Bill(Base):
    """An item bill to a retailer. Its total goes to the retailer's credit
    ledger (ledger_entry_id) and its goods, paid and free, leave stock."""

    __tablename__ = "bills"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    bill_number: Mapped[str] = mapped_column(String(20))
    date: Mapped[str] = mapped_column(String(10), index=True)
    location: Mapped[str] = mapped_column(String(10))  # godown | van
    van_user_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2))  # scheme discounts
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2))  # never negative
    ledger_entry_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("business_id", "bill_number", name="uq_bill_number"),
        UniqueConstraint("business_id", "client_id", name="uq_bill_client"),
    )


class BillLine(Base):
    __tablename__ = "bill_lines"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    bill_id: Mapped[str] = mapped_column(ForeignKey("bills.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(String(40))  # no FK: history outlives the item
    item_name: Mapped[str] = mapped_column(String(200))
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class SchemeApplication(Base):
    """The scheme log: one row per scheme considered for a bill line —
    'applied' (a scheme line on the bill) or 'not_applied' with the reason.
    Names and values are copied, so editing a scheme never rewrites history."""

    __tablename__ = "scheme_applications"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    bill_id: Mapped[str] = mapped_column(ForeignKey("bills.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[str] = mapped_column(String(40), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)
    scheme_id: Mapped[str] = mapped_column(String(40), index=True)
    scheme_name: Mapped[str] = mapped_column(String(120))
    scheme_type: Mapped[str] = mapped_column(String(20))
    item_id: Mapped[str] = mapped_column(String(40), index=True)  # the billed SKU
    item_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20))  # applied | not_applied
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3))  # billed qty of the SKU
    free_item_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    free_item_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    free_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2))  # off the bill
    value: Mapped[Decimal] = mapped_column(Numeric(12, 2))  # discount + free goods at rate


class StatementLink(Base):
    """A browser link to ONE retailer's statement, for someone without the app.

    Only a SHA-256 of the token is stored; the link resolves to exactly this
    customer_id/business_id and nothing else (there is no customer parameter).
    """

    __tablename__ = "statement_links"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    period_from: Mapped[str | None] = mapped_column(String(10), nullable=True)  # None = all
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    expires_at: Mapped[str] = mapped_column(String(40))


STATEMENT_EVENTS = ("opt_in", "opt_out", "sent", "blocked", "link_created", "viewed")


class StatementEvent(Base):
    """WhatsApp-statement consent and delivery log for one retailer of one
    distributor. Current consent = the latest opt_in/opt_out row; none = no."""

    __tablename__ = "statement_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))  # STATEMENT_EVENTS
    source: Mapped[str] = mapped_column(String(20))  # owner | retailer | system
    channel: Mapped[str | None] = mapped_column(String(30), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso, index=True)


class PaymentUtr(Base):
    """One row per UPI payment's UTR, per business. A UTR identifies exactly
    one UPI transaction, so a second payment with the same UTR is a typo or a
    reused-UTR fraud — never a real second payment. The UTR itself stays
    encrypted on the entry; this holds only its keyed hash."""

    __tablename__ = "payment_utrs"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    utr_hash: Mapped[str] = mapped_column(String(64))
    ledger_entry_id: Mapped[str] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (UniqueConstraint("business_id", "utr_hash", name="uq_payment_utr"),)


class GstInvoiceNumber(Base):
    """Every GST invoice number the server has issued, per business per
    financial year. Unique and consecutive (Rule 46). Kept when the entry is
    deleted (ledger_entry_id becomes NULL = cancelled), so numbers are never
    reused and gaps are explained."""

    __tablename__ = "gst_invoice_numbers"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=gen_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    fy: Mapped[str] = mapped_column(String(5))  # "26-27"
    serial: Mapped[int] = mapped_column(Integer)
    number: Mapped[str] = mapped_column(String(16))
    ledger_entry_id: Mapped[str | None] = mapped_column(
        ForeignKey("ledger_entries.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)

    __table_args__ = (
        UniqueConstraint("business_id", "fy", "serial", name="uq_gst_invoice_serial"),
        UniqueConstraint("business_id", "fy", "number", name="uq_gst_invoice_number"),
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
