"""Khata import from Excel/CSV: preview (dry run, writes nothing), import,
the import log, and the backup taken before each import."""

import base64
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ledger_import as svc
from ..database import get_db
from ..deps import get_current_membership, require
from ..models import Business, ImportLog, User
from ..rbac import ENTRY_EDIT, REPORTS_EXPORT
from ..security import get_current_user

router = APIRouter(tags=["imports"])

MAX_FILE_BYTES = 5 * 1024 * 1024


async def _read(file: UploadFile) -> bytes:
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


@router.post("/imports/preview")
async def preview(
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> dict:
    """Dry run: what this file would import. Never writes anything."""
    data = await _read(file)
    try:
        return svc.preview_dto(svc.plan(db, business, data, file.filename or "", _mapping(mapping)))
    except svc.ImportFileError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/imports")
async def run_import(
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    business: Business = Depends(require(ENTRY_EDIT)),
    membership: tuple[Business, str] = Depends(get_current_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    data = await _read(file)
    try:
        log = svc.run(db, business, user, membership[1], data, file.filename or "", _mapping(mapping))
    except svc.ImportFileError as err:
        raise HTTPException(422, str(err)) from err
    return svc.log_dto(log)


@router.get("/imports")
def list_imports(
    business: Business = Depends(require(ENTRY_EDIT)),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.scalars(select(ImportLog).where(ImportLog.business_id == business.id)
                      .order_by(ImportLog.created_at.desc())).all()
    return [svc.log_dto(r) for r in rows]


@router.get("/imports/{import_id}/backup.xlsx")
def download_backup(
    import_id: str,
    business: Business = Depends(require(REPORTS_EXPORT)),
    db: Session = Depends(get_db),
) -> Response:
    """The books as they were just before this import."""
    log = db.get(ImportLog, import_id)
    if log is None or log.business_id != business.id:
        raise HTTPException(404, "Import not found.")
    return Response(
        base64.b64decode(log.backup),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="before_import_{log.created_at[:10]}.xlsx"',
                 "Cache-Control": "no-store"},
    )
