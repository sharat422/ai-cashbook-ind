import base64
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from ..ai import categorize_text, parse_transaction, scan_receipt, transcribe_audio
from ..database import get_db
from ..deps import require
from ..rbac import ENTRY_CREATE
from ..models import AiDecision, Business

router = APIRouter(tags=["ai"])


class CategorizeBody(BaseModel):
    text: str


class ParseTransactionBody(BaseModel):
    text: str
    # Client's local date (YYYY-MM-DD); defaults to server UTC today.
    today: str | None = None


@router.post("/parse-transaction")
def parse_transaction_route(
    body: ParseTransactionBody,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    """Turn a spoken/typed sentence (any of several Indian languages) into a
    structured transaction: {customer_name, type, amount, category, date}."""
    today = body.today or datetime.now(timezone.utc).date().isoformat()
    result = parse_transaction(body.text, today)

    db.add(AiDecision(
        business_id=business.id,
        kind="voice_transaction",
        input_text=body.text,
        output_json=json.dumps(result),
        confidence=result.get("confidence"),
    ))
    db.commit()
    return result


@router.post("/voice/parse")
def voice_parse_route(
    audio: UploadFile = File(...),
    today: str | None = Form(None),
    language: str | None = Form(None),
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    """The multilingual voice 'agent': transcribe spoken audio (Whisper
    auto-detects the language) then parse it into a structured transaction.
    Returns the parse result plus the raw `transcript` so the app can show what
    was heard for confirmation/editing before saving."""
    day = today or datetime.now(timezone.utc).date().isoformat()
    audio_bytes = audio.file.read()
    if not audio_bytes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty audio.")

    try:
        transcript = transcribe_audio(
            audio_bytes, audio.filename or "audio.m4a", language or None
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Couldn't transcribe the audio. Please try again, or type it instead.",
        ) from exc

    if not transcript:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Didn't catch any speech — please try again.",
        )

    result = parse_transaction(transcript, day)
    result["transcript"] = transcript

    db.add(AiDecision(
        business_id=business.id,
        kind="voice_parse",
        input_text=transcript,
        output_json=json.dumps(result),
        confidence=result.get("confidence"),
    ))
    db.commit()
    return result


@router.post("/categorize")
def categorize(
    body: CategorizeBody,
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    category, confidence = categorize_text(body.text)
    result = {"category": category, "confidence": confidence}

    db.add(AiDecision(
        business_id=business.id,
        kind="categorization",
        input_text=body.text,
        output_json=json.dumps(result),
        confidence=confidence,
    ))
    db.commit()
    return result


@router.post("/receipts/scan")
def scan(
    receipt: UploadFile = File(...),
    business: Business = Depends(require(ENTRY_CREATE)),
    db: Session = Depends(get_db),
) -> dict:
    raw = receipt.file.read()
    image_b64 = base64.b64encode(raw).decode("ascii")
    media_type = receipt.content_type or "image/jpeg"

    result = scan_receipt(image_b64, media_type)

    db.add(AiDecision(
        business_id=business.id,
        kind="receipt_scan",
        input_text=receipt.filename,
        output_json=json.dumps(result),
        confidence=None,
    ))
    db.commit()
    return result
