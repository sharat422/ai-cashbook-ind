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
