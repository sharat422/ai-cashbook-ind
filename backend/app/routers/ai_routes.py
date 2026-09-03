import base64
import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from ..ai import (
    CASHBOOK_TRANSCRIBE_PROMPT,
    categorize_text,
    parse_transaction,
    scan_receipt,
    transcribe_audio,
)
from ..config import settings
from ..database import get_db
from ..deps import require
from ..rbac import ENTRY_CREATE
from ..models import AiDecision, Business

log = logging.getLogger("cashbook.ai")
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
            audio_bytes,
            audio.filename or "audio.m4a",
            language=language or None,  # explicit customer language, or auto
            prompt=CASHBOOK_TRANSCRIBE_PROMPT,  # bias toward amounts/currency
        )
    except Exception as exc:  # noqa: BLE001
        # Always record WHY on the server — without this the real Whisper error
        # (undecodable audio vs. auth vs. upstream outage) is invisible.
        log.exception(
            "voice transcribe failed: filename=%s bytes=%d content_type=%s language=%s",
            audio.filename, len(audio_bytes), audio.content_type, language,
        )
        reason = f"{type(exc).__name__}: {exc}"

        # OpenAI rejects undecodable / too-short / too-large audio with a 4xx.
        # That's a client audio problem the user fixes by re-recording, so map it
        # to 422 (the app treats 422 as "didn't catch that — try again or type"),
        # and keep 502 only for genuine upstream/transport failures.
        upstream_status = getattr(exc, "status_code", None)
        is_bad_audio = isinstance(upstream_status, int) and 400 <= upstream_status < 500

        if is_bad_audio:
            detail = "Didn't catch clear audio — please try again, or type it instead."
            code = status.HTTP_422_UNPROCESSABLE_ENTITY
        else:
            detail = "Couldn't transcribe the audio. Please try again, or type it instead."
            code = status.HTTP_502_BAD_GATEWAY

        # On staging (debug) append the technical reason so it also lands in the
        # app's shareable error log; production keeps the friendly message only.
        if settings.debug:
            detail = f"{detail} [{reason[:300]}]"
        raise HTTPException(code, detail) from exc

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
