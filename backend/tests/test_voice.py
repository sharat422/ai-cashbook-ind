"""Multilingual voice entry: transcription brain + /voice/parse agent endpoint."""

import openai
import pytest

import app.ai as ai
import app.routers.ai_routes as ai_routes


# --- transcribe_audio (the brain) -------------------------------------------

def test_transcribe_audio_calls_openai_and_trims(monkeypatch):
    monkeypatch.setattr(ai.settings, "openai_api_key", "test-key")

    class FakeResp:
        text = "  రమేష్‌కు 2500 ఇచ్చాను  "  # Telugu, with surrounding space

    captured = {}

    class FakeTranscriptions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeResp()

    class FakeClient:
        def __init__(self, **_):
            self.audio = type("A", (), {"transcriptions": FakeTranscriptions()})()

    monkeypatch.setattr(openai, "OpenAI", FakeClient)

    out = ai.transcribe_audio(
        b"fake-audio", "clip.m4a", language="te", prompt="hint about rupees"
    )
    assert out == "రమేష్‌కు 2500 ఇచ్చాను"  # trimmed
    assert captured["file"] == ("clip.m4a", b"fake-audio")
    assert captured["model"] == ai.settings.openai_transcribe_model
    assert captured["language"] == "te"  # explicit language forwarded
    assert captured["prompt"] == "hint about rupees"  # vocabulary bias forwarded


def test_transcribe_audio_omits_language_and_prompt_when_absent(monkeypatch):
    monkeypatch.setattr(ai.settings, "openai_api_key", "test-key")
    captured = {}

    class FakeClient:
        def __init__(self, **_):
            self.audio = type(
                "A", (), {"transcriptions": type("T", (), {
                    "create": lambda _self, **kw: (captured.update(kw), type("R", (), {"text": "ok"})())[1]
                })()}
            )()

    monkeypatch.setattr(openai, "OpenAI", FakeClient)
    ai.transcribe_audio(b"x", "c.m4a")
    assert "language" not in captured  # auto-detect
    assert "prompt" not in captured


def test_transcribe_audio_requires_key(monkeypatch):
    monkeypatch.setattr(ai.settings, "openai_api_key", "")
    with pytest.raises(RuntimeError):
        ai.transcribe_audio(b"x")


# --- /voice/parse (transcribe → parse agent) --------------------------------

def _post_audio(client, headers, **data):
    return client.post(
        "/api/v1/voice/parse",
        headers=headers,
        files={"audio": ("clip.m4a", b"fake-audio-bytes", "audio/m4a")},
        data=data,
    )


def test_voice_parse_transcribes_then_parses(user, client, monkeypatch):
    # Whisper returns a Hinglish sentence; parse turns it into a transaction.
    monkeypatch.setattr(
        ai_routes, "transcribe_audio", lambda *a, **k: "ramesh ko 2500 ka maal diya"
    )
    r = _post_audio(client, user.headers, today="2026-06-01")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["transcript"] == "ramesh ko 2500 ka maal diya"
    assert body["amount"] == 2500
    assert body["type"] == "credit"  # "diya" = gave on credit


def test_voice_parse_forwards_language_and_cashbook_prompt(user, client, monkeypatch):
    captured = {}

    def fake(audio_bytes, filename, language=None, prompt=None):
        captured["language"] = language
        captured["prompt"] = prompt
        return "ramesh ko 500 diya"

    monkeypatch.setattr(ai_routes, "transcribe_audio", fake)
    r = _post_audio(client, user.headers, language="hi", today="2026-06-01")
    assert r.status_code == 200, r.text
    assert captured["language"] == "hi"  # user's configured language
    assert "rupees" in captured["prompt"].lower()  # the cashbook bias prompt


def test_voice_parse_502_when_transcription_fails(user, client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no key / api down")

    monkeypatch.setattr(ai_routes, "transcribe_audio", boom)
    r = _post_audio(client, user.headers)
    assert r.status_code == 502
    assert "transcribe" in r.json()["detail"].lower()


def test_voice_parse_422_on_silence(user, client, monkeypatch):
    monkeypatch.setattr(ai_routes, "transcribe_audio", lambda *a, **k: "")
    r = _post_audio(client, user.headers)
    assert r.status_code == 422


def test_voice_parse_maps_openai_4xx_to_422(user, client, monkeypatch):
    """OpenAI rejects undecodable/too-short audio with a 4xx (it carries a
    .status_code). That's a client audio problem, so we return 422 (the app
    treats it as 'try again or type'), not a 502 upstream failure."""

    class FakeBadRequest(Exception):
        status_code = 400

    def bad_audio(*a, **k):
        raise FakeBadRequest("audio file could not be decoded")

    monkeypatch.setattr(ai_routes, "transcribe_audio", bad_audio)
    r = _post_audio(client, user.headers)
    assert r.status_code == 422


def test_voice_parse_requires_auth(client):
    r = client.post(
        "/api/v1/voice/parse",
        files={"audio": ("c.m4a", b"x", "audio/m4a")},
    )
    assert r.status_code in (401, 403)
