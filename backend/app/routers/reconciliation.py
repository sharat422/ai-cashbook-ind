"""Manual UPI/bank reconciliation and the daily close. No endpoint here moves
money, collects payments or logs in to a bank; it only reads an uploaded
statement and records which line a person says matches which collection."""

import json
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .. import reconciliation as svc
from ..bank_statement import StatementError
from ..calc import today_iso
from ..database import get_db
from ..deps import accountant_read_only, get_current_membership, require
from ..models import AccessLog, Business, User
from ..rbac import DATA_VIEW, ENTRY_EDIT
from ..security import get_current_user
from ..validation import validate_date

router = APIRouter(tags=["reconciliation"])

MAX_FILE_BYTES = 5 * 1024 * 1024


class ConfirmBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bank_line_id: str | None = Field(default=None, alias="bankLineId", max_length=40)
    # Several lines: one collection paid in several transfers (₹600 + ₹400),
    # or several transfers paying several collections (entryIds).
    bank_line_ids: list[str] = Field(default_factory=list, alias="bankLineIds", max_length=10)
    entry_id: str | None = Field(default=None, alias="entryId", max_length=40)
    entry_ids: list[str] = Field(default_factory=list, alias="entryIds", max_length=50)


class MatchBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bank_line_id: str = Field(alias="bankLineId", max_length=40)
    entry_ids: list[str] = Field(alias="entryIds", min_length=1, max_length=50)


async def _statement(file: UploadFile) -> bytes:
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "The file is larger than 5 MB.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    return data


def _mapping(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError as err:
        raise HTTPException(422, "Column mapping is not valid.") from err
    if not isinstance(value, dict):
        raise HTTPException(422, "Column mapping is not valid.")
    return value


@router.post("/reconciliation/preview")
async def preview_statement(
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    date_format: str | None = Form(None, alias="dateFormat"),
    business: Business = Depends(require(ENTRY_EDIT)),
) -> dict:
    """The column-mapping screen: headers, the columns we'd use, the first
    lines as read with the chosen date format. Saves nothing."""
    data = await _statement(file)
    try:
        return svc.preview_statement(data, file.filename or "", _mapping(mapping), date_format)
    except StatementError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/reconciliation/import")
async def import_statement(
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    date_format: str | None = Form(None, alias="dateFormat"),
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    data = await _statement(file)
    try:
        return svc.import_statement(db, business, data, file.filename or "", _mapping(mapping), date_format)
    except StatementError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/reconciliation/imports")
def list_imports(
    deleted: bool = Query(False),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Imported statements; `?deleted=true` lists deleted ones to restore."""
    return svc.imports(db, business, deleted)


@router.post("/reconciliation/statements/{import_id}/restore")
def restore_statement(
    import_id: str,
    request: Request,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: bring a deleted statement back, its lines unmatched. Live: no-op."""
    out = svc.restore_import(db, business, user, import_id)
    if out["restored"]:
        db.add(AccessLog(business_id=business.id, user_id=user.id, mobile=user.mobile, action="restore",
                         method="POST", path=request.url.path[:300]))
        db.commit()
    return out


@router.delete("/reconciliation/imports/{import_id}")
def delete_import(
    import_id: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Soft-delete a statement; its matches are undone first."""
    return svc.delete_import(db, business, user, import_id)


@router.get("/reconciliation/lines/{line_id}/candidates")
def match_candidates(
    line_id: str,
    search: str = Query("", max_length=60),
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Matching by hand: unmatched non-cash collections, any date."""
    return svc.candidates(db, business, line_id, search)


@router.get("/reconciliation/collections/{entry_id}/lines")
def line_candidates(
    entry_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Open bank lines to split one collection across."""
    return svc.line_candidates(db, business, entry_id)


@router.get("/reconciliation/lines/{line_id}/lines")
def other_lines(
    line_id: str,
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Other open bank lines to add to a match with this one."""
    return svc.other_lines(db, business, line_id)


@router.post("/reconciliation/match")
def match(
    body: MatchBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """One or more collections against a bank line (e.g. ₹1,000 = ₹600 + ₹400)."""
    return svc.match(db, business, user, [body.bank_line_id], body.entry_ids)


@router.post("/reconciliation/lines/{line_id}/undo")
def undo(
    line_id: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return svc.undo(db, business, user, line_id)


@router.get("/reconciliation/matched")
def matched(business: Business = Depends(require(DATA_VIEW)), db: Session = Depends(get_db)) -> list[dict]:
    return svc.matched(db, business)


@router.get("/reconciliation/suggestions")
def suggestions(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return svc.suggest(db, business)[0]


@router.post("/reconciliation/confirm")
def confirm(
    body: ConfirmBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    lines = body.bank_line_ids or ([body.bank_line_id] if body.bank_line_id else [])
    entries = body.entry_ids or ([body.entry_id] if body.entry_id else [])
    return svc.confirm(db, business, user, lines, entries)


@router.get("/reconciliation/exceptions")
def exceptions(
    business: Business = Depends(require(DATA_VIEW)),
    db: Session = Depends(get_db),
) -> dict:
    return svc.exceptions(db, business)


@router.get("/daily-close")
def daily_close(
    beat_id: str | None = Query(None, max_length=40),
    date: str | None = Query(None),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    business, role = membership
    day = validate_date(date) if date else today_iso()
    return svc.daily_close(db, business, user, role, beat_id or None, day)


class CashCountBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    date: str
    beat_id: str | None = Field(default=None, alias="beatId", max_length=40)
    counted: Decimal = Field(alias="counted")
    note: str | None = Field(default=None, max_length=200)
    user_id: str | None = Field(default=None, alias="userId", max_length=40)  # None = the whole beat


class DepositBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    date: str
    beat_id: str | None = Field(default=None, alias="beatId", max_length=40)
    amount: Decimal
    kind: str = Field(default="deposit", max_length=10)  # deposit | float (kept back)
    note: str | None = Field(default=None, max_length=200)
    user_id: str | None = Field(default=None, alias="userId", max_length=40)  # None = the whole beat


class DepositMatchBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    bank_line_id: str = Field(alias="bankLineId", max_length=40)


@router.get("/reconciliation/deposits")
def list_deposits(
    date: str | None = Query(None),
    beat_id: str | None = Query(None, alias="beatId", max_length=40),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Cash deposits and cash kept back for a day. Staff: their own beat only."""
    business, role = membership
    return svc.list_deposits(db, business, user, role, validate_date(date) if date else today_iso(), beat_id or None)


@router.post("/reconciliation/deposits")
def record_deposit(
    body: DepositBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Owner: record cash already taken to the bank, or kept back as float."""
    return svc.record_deposit(db, business, user, membership[1], day=validate_date(body.date),
                              beat_id=body.beat_id or None, amount=body.amount, kind=body.kind, note=body.note,
                              user_id=body.user_id or None)


@router.delete("/reconciliation/deposits/{deposit_id}")
def delete_deposit(
    deposit_id: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    return svc.delete_deposit(db, business, deposit_id)


@router.get("/reconciliation/deposits/{deposit_id}/lines")
def deposit_lines(
    deposit_id: str,
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> list[dict]:
    return svc.deposit_line_candidates(db, business, deposit_id)


@router.post("/reconciliation/deposits/{deposit_id}/match")
def match_deposit(
    deposit_id: str,
    body: DepositMatchBody,
    business: Business = Depends(require(ENTRY_EDIT)),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """A deposit to its bank line; undo is the bank line's Undo (§37K.3)."""
    return svc.match_deposit(db, business, user, deposit_id, body.bank_line_id)


@router.post("/daily-close/cash-count")
def cash_count(
    body: CashCountBody,
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Record the cash physically counted; returns the daily close with over/short."""
    business, role = membership
    if role == "accountant":
        raise accountant_read_only()
    return svc.record_count(db, business, user, role, day=validate_date(body.date),
                            beat_id=body.beat_id or None, counted=body.counted, note=body.note,
                            user_id=body.user_id or None)
