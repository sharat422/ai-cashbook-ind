"""Authenticated PCM relay. Provider credentials never leave the backend."""

import asyncio
import base64
import json
import logging
import time

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials
from websockets.asyncio.client import connect

from ..ai import MUSE_LANGUAGES
from ..chatbot.guardrails import voice_seconds_left
from ..chatbot.loop import MESSAGES
from ..config import settings
from ..database import SessionLocal
from ..deps import get_current_membership, require, require_ai_consent
from ..models import AiDecision
from ..rbac import DATA_VIEW, ENTRY_CREATE
from ..security import get_current_user

router = APIRouter(tags=["ai"])
log = logging.getLogger("cashbook.ai")
# One concurrent voice session per user per worker; deployment-wide quotas
# remain enforced by Muse.
_active: set[str] = set()

# PCM_24KHZ, 16-bit mono: 48,000 bytes per second of audio.
BYTES_PER_SECOND = 48000
# Per purpose: the permission it needs and the longest recording allowed.
# "entry" = voice entry of transactions; "chatbot" = Ask AI (read-only).
PURPOSES = {
    "entry": {"permission": ENTRY_CREATE, "max_seconds": 120},
    "chatbot": {"permission": DATA_VIEW, "max_seconds": 60},
}


def _authorize(token: str, purpose: str) -> tuple[str, str, float]:
    """(user_id, business_id, max seconds for this session)."""
    with SessionLocal() as db:
        user = get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db)
        require_ai_consent(user, db)
        business = require(PURPOSES[purpose]["permission"])(get_current_membership(user, db))
        max_seconds = PURPOSES[purpose]["max_seconds"]
        if purpose == "chatbot":
            # Daily Ask AI voice budget per merchant (voice entry isn't capped).
            left = voice_seconds_left(db, business.id)
            if left <= 0:
                raise HTTPException(429, MESSAGES["limit_voice"]["hinglish"].format(
                    minutes=settings.chatbot_voice_seconds_per_day // 60))
            max_seconds = min(max_seconds, left)
        return user.id, business.id, max_seconds


def _log_usage(business_id: str, user_id: str, purpose: str, seconds: float) -> None:
    """Muse minutes per merchant, for cost tracking. Logged even when the
    session failed: Muse bills for the audio it received."""
    meta = {"event": "muse_usage", "merchant_id": business_id, "user_id": user_id,
            "purpose": purpose, "seconds": round(seconds, 2), "model": settings.muse_transcribe_model}
    log.info(json.dumps(meta))
    with SessionLocal() as db:
        db.add(AiDecision(business_id=business_id, kind="voice_usage", input_text=None,
                          output_json=json.dumps(meta), confidence=None))
        db.commit()


def muse_handshake(language) -> dict:
    """First frame of a Muse realtime session (also used by
    scripts/voice_accuracy_eval.py, so tests hit exactly the app's setup)."""
    handshake = {
        "authorization": {"accessToken": f"Bearer {settings.meta_model_api_key}"},
        "model": settings.muse_transcribe_model,
        "audioEncoding": "PCM_24KHZ", "mode": "PUSH_TO_TALK",
        "partialMode": "CUMULATIVE", "emitAudioProgress": False,
        "keywords": ["rupees", "lakh", "hazaar", "udhaar", "jama", "baaki"],
    }
    if isinstance(language, str) and language in MUSE_LANGUAGES:
        handshake["languageBias"] = [MUSE_LANGUAGES[language]]
    return handshake


def muse_realtime_url() -> str:
    url = settings.meta_model_base_url.rstrip("/").replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    return f"{url}/asr/realtime"


async def _relay(client: WebSocket, upstream, max_seconds: int, usage: dict) -> None:
    started = time.monotonic()
    audio_bytes = 0
    final = False

    async def send_audio():
        nonlocal audio_bytes
        while True:
            raw = await asyncio.wait_for(client.receive_text(), timeout=15)
            if len(raw) > 65536:
                raise ValueError("Audio frame is too large.")
            event = json.loads(raw)
            if event.get("type") == "endStream":
                await upstream.send(json.dumps({"type": "endStream"}))
                return
            if event.get("type") != "audio" or not isinstance(event.get("audio"), str):
                raise ValueError("Expected PCM audio or endStream.")
            pcm = base64.b64decode(event["audio"], validate=True)
            if not pcm or len(pcm) % 2:
                raise ValueError("Invalid 16-bit PCM frame.")
            audio_bytes += len(pcm)
            seconds = audio_bytes / BYTES_PER_SECOND
            usage["seconds"] = seconds
            if seconds > max_seconds or seconds > time.monotonic() - started + 5:
                raise ValueError("Recording is too long or audio arrived too quickly.")
            await upstream.send(pcm)
            await client.send_json({"type": "audioAccepted", "bytes": audio_bytes})

    async def receive_text():
        nonlocal final
        async for raw in upstream:
            event = json.loads(raw)
            if event.get("type") == "error":
                raise RuntimeError("Muse rejected the live audio session.")
            if event.get("type") == "transcript":
                final = event.get("final") is True
                await client.send_json({
                    "type": "transcript", "transcript": event["transcript"], "final": final,
                })
        if not final:
            raise RuntimeError("Muse disconnected before completing the transcript.")

    sender = asyncio.create_task(send_audio())
    receiver = asyncio.create_task(receive_text())
    try:
        done, _ = await asyncio.wait({sender, receiver}, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
        if receiver not in done:
            # endStream only ends input: keep receiving the finalized transcript.
            await asyncio.wait_for(receiver, timeout=30)
    finally:
        sender.cancel()
        receiver.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)


@router.websocket("/voice/live")
async def voice_live(client: WebSocket):
    await client.accept()
    user_id = None
    usage: dict = {"seconds": 0.0}
    session = None
    try:
        # Token is in the first frame, never a URL/query string or provider key.
        raw = await asyncio.wait_for(client.receive_text(), timeout=10)
        if len(raw) > 8192:
            raise ValueError("Invalid voice handshake.")
        hello = json.loads(raw)
        if not isinstance(hello, dict) or not isinstance(hello.get("token"), str):
            raise HTTPException(401, "Authentication required.")
        purpose = hello.get("purpose", "entry")
        if purpose not in PURPOSES:
            raise HTTPException(400, "Unknown voice purpose.")
        authenticated_id, business_id, max_seconds = await asyncio.to_thread(_authorize, hello["token"], purpose)
        if authenticated_id in _active:
            raise HTTPException(429, "A voice recording is already active.")
        if not settings.meta_model_api_key:
            raise HTTPException(503, "Live voice transcription is not configured.")
        _active.add(authenticated_id)
        user_id = authenticated_id
        session = (business_id, authenticated_id, purpose)
        async with asyncio.timeout(160):
            async with connect(muse_realtime_url(), open_timeout=10, close_timeout=3, max_size=65536) as upstream:
                await upstream.send(json.dumps(muse_handshake(hello.get("language"))))
                ack = json.loads(await asyncio.wait_for(upstream.recv(), timeout=10))
                if not ack.get("sessionId"):
                    raise RuntimeError("Muse handshake failed.")
                await client.send_json({"type": "ready"})
                await _relay(client, upstream, max_seconds, usage)
        await client.close(code=1000)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        status = exc.status_code if isinstance(exc, HTTPException) else 502
        message = exc.detail if isinstance(exc, HTTPException) else "Live transcription interrupted. Please try again or type your entry."
        # Don't log handshake frames or exceptions that could contain credentials.
        log.warning("Live voice session failed: %s", type(exc).__name__)
        try:
            await client.send_json({"type": "error", "status": status, "message": message})
            await client.close(code=1008 if status < 500 else 1011)
        except (RuntimeError, WebSocketDisconnect):
            pass
    finally:
        try:
            # Record minutes BEFORE releasing the session, so anything that sees
            # the session as closed (a new session, the daily cap) also sees them.
            if session is not None and usage["seconds"] > 0:
                await asyncio.to_thread(_log_usage, *session, usage["seconds"])
        finally:
            if user_id is not None:
                _active.discard(user_id)
