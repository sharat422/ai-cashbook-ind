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


# --- Muse Voice Transcribe (primary) + Whisper fallback ---------------------

def test_transcribe_prefers_muse_when_configured(monkeypatch):
    """With META_MODEL_API_KEY set, audio goes to Muse (not OpenAI), with the
    OpenAI-compatible multipart fields and Bearer auth."""
    monkeypatch.setattr(ai.settings, "meta_model_api_key", "meta-key")
    monkeypatch.setattr(ai.settings, "openai_api_key", "sk-should-not-be-used")
    import httpx

    captured = {}

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"text": "  ramesh ko 2500 diya  ", "language": "hi"}

    def fake_post(url, **kw):
        captured["url"] = url
        captured.update(kw)
        return FakeResp()

    monkeypatch.setattr(httpx, "post", fake_post)

    out = ai.transcribe_audio(b"audio", "clip.m4a", language="hi", prompt="hint")
    assert out == "ramesh ko 2500 diya"  # trimmed
    assert captured["url"].endswith("/asr/transcribe")
    assert captured["files"]["file"] == ("clip.m4a", b"audio")
    assert captured["data"]["model"] == ai.settings.muse_transcribe_model
    assert captured["data"]["language"] == "hi"
    assert captured["headers"]["Authorization"] == "Bearer meta-key"


def test_transcribe_falls_back_to_whisper_on_muse_error(monkeypatch):
    monkeypatch.setattr(ai.settings, "meta_model_api_key", "meta-key")
    monkeypatch.setattr(ai.settings, "openai_api_key", "sk-key")
    import httpx

    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("muse down"))
    )

    class FakeClient:
        def __init__(self, **_):
            self.audio = type("A", (), {"transcriptions": type("T", (), {
                "create": lambda _s, **kw: type("R", (), {"text": "whisper result"})()
            })()})()

    monkeypatch.setattr(openai, "OpenAI", FakeClient)
    assert ai.transcribe_audio(b"x", "c.m4a", language="hi") == "whisper result"


def test_transcribe_reraises_muse_error_when_no_whisper_key(monkeypatch):
    monkeypatch.setattr(ai.settings, "meta_model_api_key", "meta-key")
    monkeypatch.setattr(ai.settings, "openai_api_key", "")
    import httpx

    monkeypatch.setattr(
        httpx, "post", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("muse down"))
    )
    with pytest.raises(RuntimeError, match="muse down"):
        ai.transcribe_audio(b"x")


def test_extract_transcript_prefers_text_then_turns_then_segments():
    assert ai._extract_transcript({"text": "hi"}) == "hi"
    assert ai._extract_transcript(
        {"text": "", "turns": [{"text": "a"}, {"text": "b"}]}
    ) == "a b"
    assert ai._extract_transcript(
        {"segments": [{"text": "x"}, {"text": "y"}]}
    ) == "x y"
    assert ai._extract_transcript({}) == ""


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


def test_voice_parse_retries_auto_detect_when_forced_language_empty(user, client, monkeypatch):
    """A forced language that yields an empty transcript (e.g. 'Telugu' set but
    Hinglish spoken) retries with auto-detect instead of failing."""
    calls = []

    def fake(audio_bytes, filename, language=None, prompt=None):
        calls.append(language)
        return "" if language else "Ramesh ko 2500 diya"  # empty when forced, ok on auto

    monkeypatch.setattr(ai_routes, "transcribe_audio", fake)
    r = _post_audio(client, user.headers, language="te")
    assert r.status_code == 200, r.text
    assert calls == ["te", None]  # tried forced first, then auto-detect
    assert r.json()["transcript"] == "Ramesh ko 2500 diya"


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
