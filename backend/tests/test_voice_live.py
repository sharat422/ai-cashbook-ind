import asyncio
import base64
import json
from contextlib import asynccontextmanager

import pytest
from starlette.websockets import WebSocketDisconnect

from app.routers import voice_live as live


@pytest.fixture
def muse(monkeypatch):
    monkeypatch.setattr(live.settings, "meta_model_api_key", "test-meta-key")
    sent = []

    class Upstream:
        async def recv(self):
            return json.dumps({"sessionId": "test-session"})

        async def send(self, message):
            sent.append(message)
            if isinstance(message, bytes):
                await self.events.put(json.dumps({"type": "transcript", "transcript": "Ramesh 50", "final": False}))
            elif json.loads(message).get("type") == "endStream":
                await self.events.put(json.dumps({"type": "transcript", "transcript": "Ramesh 500 rupees.", "final": True}))
                await self.events.put(None)

        def __aiter__(self):
            return self

        async def __anext__(self):
            item = await self.events.get()
            if item is None:
                raise StopAsyncIteration
            return item

    @asynccontextmanager
    async def connect(url, **kwargs):
        assert url.endswith("/asr/realtime")
        upstream = Upstream()
        upstream.events = asyncio.Queue()
        yield upstream

    monkeypatch.setattr(live, "connect", connect)
    return sent


def hello(user, **kwargs):
    return {"token": user.headers["Authorization"].removeprefix("Bearer "), **kwargs}


def assert_sessions_closed(client):
    # TestClient.close enqueues a disconnect; wait for the server to handle it.
    async def wait_for_cleanup():
        for _ in range(100):
            if not live._active:
                return
            await asyncio.sleep(0.01)
        assert not live._active
    client.portal.call(wait_for_cleanup)


def test_live_stream_partials_final_and_handshake(client, user, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user, language="te"))
        assert ws.receive_json() == {"type": "ready"}
        pcm = b"\x00\x00" * 1920
        ws.send_json({"type": "audio", "audio": base64.b64encode(pcm).decode()})
        events = [ws.receive_json(), ws.receive_json()]
        assert {"type": "audioAccepted", "bytes": len(pcm)} in events
        assert {"type": "transcript", "transcript": "Ramesh 50", "final": False} in events
        ws.send_json({"type": "endStream"})
        assert ws.receive_json() == {"type": "transcript", "transcript": "Ramesh 500 rupees.", "final": True}
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 1000
    handshake = json.loads(muse[0])
    assert handshake["authorization"] == {"accessToken": "Bearer test-meta-key"}
    assert handshake["audioEncoding"] == "PCM_24KHZ"
    assert handshake["languageBias"] == ["Telugu"]
    assert handshake["partialMode"] == "CUMULATIVE"
    assert handshake["mode"] == "PUSH_TO_TALK"
    assert muse[1] == pcm
    assert json.loads(muse[2]) == {"type": "endStream"}
    assert_sessions_closed(client)


def test_live_requires_authentication_before_provider(client, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json({"token": "invalid"})
        assert ws.receive_json()["status"] == 401
    assert not muse


def test_live_requires_consent_before_provider(client, make_user, muse):
    user = make_user(ai_consent=False)
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user))
        assert ws.receive_json()["status"] == 403
    assert not muse


def test_live_rejects_invalid_pcm(client, user, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user))
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "audio", "audio": "not-base64"})
        assert ws.receive_json()["type"] == "error"
    assert len(muse) == 1
    assert_sessions_closed(client)


def test_live_releases_session_on_disconnect(client, user, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user))
        assert ws.receive_json()["type"] == "ready"
    assert_sessions_closed(client)


def test_live_allows_only_one_session_per_user(client, user, muse):
    with client.websocket_connect("/api/v1/voice/live") as first:
        first.send_json(hello(user))
        assert first.receive_json()["type"] == "ready"
        with client.websocket_connect("/api/v1/voice/live") as second:
            second.send_json(hello(user))
            assert second.receive_json()["status"] == 429
        assert live._active
    assert_sessions_closed(client)


# --- Ask AI (purpose="chatbot"): view permission, 60 s cap, usage per merchant ---

def _usage_rows(business_id):
    from app.database import SessionLocal
    from app.models import AiDecision

    with SessionLocal() as s:
        rows = s.query(AiDecision).filter_by(business_id=business_id, kind="voice_usage").all()
        return [json.loads(r.output_json) for r in rows]


def _speak(ws, frames=1):
    pcm = b"\x00\x00" * 1920  # 0.08 s at 24 kHz, 16-bit mono
    for _ in range(frames):
        ws.send_json({"type": "audio", "audio": base64.b64encode(pcm).decode()})
    return len(pcm) * frames


def test_chatbot_purpose_transcribes_and_logs_minutes(client, user, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user, purpose="chatbot", language="hi"))
        assert ws.receive_json() == {"type": "ready"}
        _speak(ws)
        ws.send_json({"type": "endStream"})
        # audioAccepted / partial / final can interleave: read until the final one.
        for _ in range(10):
            event = ws.receive_json()
            if event.get("type") == "transcript" and event.get("final") is True:
                break
        else:
            pytest.fail("no final transcript")
    assert_sessions_closed(client)  # usage is now logged before the session is released
    usage = _usage_rows(user.business["id"])[-1]
    assert usage["purpose"] == "chatbot" and usage["seconds"] == 0.08
    assert usage["merchant_id"] == user.business["id"] and usage["event"] == "muse_usage"


def test_staff_can_use_voice_entry_but_not_ask_ai(client, make_user, muse):
    from test_rbac import _member
    from conftest import _login

    _, staff_headers = _member(make_user, client, "staff")
    # _member logs staff in without AI consent; grant it so only the role differs.
    client.put("/api/v1/consents", headers=staff_headers,
               json={"choices": [{"purpose": "ai", "granted": True}]})
    staff = type("U", (), {"headers": staff_headers})()
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(staff, purpose="chatbot"))
        assert ws.receive_json()["status"] == 403
    assert not muse
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(staff))  # default purpose: voice entry
        assert ws.receive_json() == {"type": "ready"}
    assert_sessions_closed(client)


def test_unknown_purpose_is_rejected(client, user, muse):
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user, purpose="dictation"))
        assert ws.receive_json()["status"] == 400
    assert not muse


def test_recording_cap_depends_on_purpose(client, user, muse, monkeypatch):
    # Shrink the Ask AI cap below one frame so the cap is what trips, not timing.
    monkeypatch.setitem(live.PURPOSES, "chatbot", {**live.PURPOSES["chatbot"], "max_seconds": 0.05})
    assert live.PURPOSES["entry"]["max_seconds"] == 120
    with client.websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json(hello(user, purpose="chatbot"))
        assert ws.receive_json()["type"] == "ready"
        _speak(ws)
        # The over-cap frame is refused before it is accepted or relayed.
        assert ws.receive_json()["type"] == "error"
    assert_sessions_closed(client)


def test_production_cap_for_ask_ai_is_60_seconds():
    assert live.PURPOSES["chatbot"] == {"permission": "data.view", "max_seconds": 60}
