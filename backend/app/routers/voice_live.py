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
from ..config import settings
from ..database import SessionLocal
from ..deps import get_current_membership, require, require_ai_consent
from ..rbac import ENTRY_CREATE
from ..security import get_current_user

router = APIRouter(tags=["ai"])
log = logging.getLogger("cashbook.ai")
# One concurrent voice entry per user per worker; deployment-wide quotas remain
# enforced by Muse. Sessions are bounded to two minutes of microphone audio.
_active: set[str] = set()


def _authorize(token: str) -> str:
    with SessionLocal() as db:
        user = get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db)
        require_ai_consent(user, db)
        require(ENTRY_CREATE)(get_current_membership(user, db))
        return user.id


async def _relay(client: WebSocket, upstream) -> None:
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
            seconds = audio_bytes / 48000
            if seconds > 120 or seconds > time.monotonic() - started + 5:
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
    try:
        # Token is in the first frame, never a URL/query string or provider key.
        raw = await asyncio.wait_for(client.receive_text(), timeout=10)
        if len(raw) > 8192:
            raise ValueError("Invalid voice handshake.")
        hello = json.loads(raw)
        if not isinstance(hello, dict) or not isinstance(hello.get("token"), str):
            raise HTTPException(401, "Authentication required.")
        authenticated_id = await asyncio.to_thread(_authorize, hello["token"])
        if authenticated_id in _active:
            raise HTTPException(429, "A voice recording is already active.")
        if not settings.meta_model_api_key:
            raise HTTPException(503, "Live voice transcription is not configured.")
        _active.add(authenticated_id)
        user_id = authenticated_id
        handshake = {
            "authorization": {"accessToken": f"Bearer {settings.meta_model_api_key}"},
            "model": settings.muse_transcribe_model,
            "audioEncoding": "PCM_24KHZ", "mode": "PUSH_TO_TALK",
            "partialMode": "CUMULATIVE", "emitAudioProgress": False,
            "keywords": ["rupees", "lakh", "hazaar", "udhaar", "jama", "baaki"],
        }
        language = hello.get("language")
        if isinstance(language, str) and language in MUSE_LANGUAGES:
            handshake["languageBias"] = [MUSE_LANGUAGES[language]]
        url = settings.meta_model_base_url.rstrip("/").replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        async with asyncio.timeout(160):
            async with connect(f"{url}/asr/realtime", open_timeout=10, close_timeout=3, max_size=65536) as upstream:
                await upstream.send(json.dumps(handshake))
                ack = json.loads(await asyncio.wait_for(upstream.recv(), timeout=10))
                if not ack.get("sessionId"):
                    raise RuntimeError("Muse handshake failed.")
                await client.send_json({"type": "ready"})
                await _relay(client, upstream)
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
        if user_id is not None:
            _active.discard(user_id)
