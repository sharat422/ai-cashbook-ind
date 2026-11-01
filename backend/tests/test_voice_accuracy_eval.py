"""scripts/voice_accuracy_eval.py: scoring maths and a run against a fake Muse."""

import asyncio
import csv
import json
import wave
from contextlib import asynccontextmanager

import pytest

from app.routers import voice_live
from scripts import voice_accuracy_eval as ev


@pytest.mark.parametrize("expected,got,acc", [
    ("Ramesh ka balance kitna hai", "ramesh ka balance kitna hai?", 1.0),
    ("Ramesh ka balance kitna hai", "Suresh ka balance kitna hai", 0.8),   # 1 substitution / 5
    ("sabse zyada kaun deta hai", "sabse zyada deta hai", 0.8),            # 1 deletion / 5
    ("₹500 mile", "500 mile", 1.0),                                        # rupee sign ignored
    ("Ramesh", "", 0.0),
    ("रमेश का बैलेंस", "रमेश का बैलेंस।", 1.0),                              # Devanagari kept
])
def test_word_accuracy(expected, got, acc):
    assert ev.accuracy(expected, got) == pytest.approx(acc)


@pytest.fixture
def fake_muse(monkeypatch):
    monkeypatch.setattr(ev.settings, "meta_model_api_key", "test-meta-key")
    seen = {"handshakes": [], "audio_bytes": 0}

    class Upstream:
        def __init__(self):
            self.events = asyncio.Queue()

        async def recv(self):
            return json.dumps({"sessionId": "s1"})

        async def send(self, message):
            if isinstance(message, bytes):
                seen["audio_bytes"] += len(message)
            elif json.loads(message).get("type") == "endStream":
                await self.events.put(json.dumps({"type": "transcript", "transcript": "ramesh ka balance", "final": True}))
                await self.events.put(None)
            else:
                seen["handshakes"].append(json.loads(message))

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
        yield Upstream()

    monkeypatch.setattr(voice_live, "connect", connect)
    return seen


def _wav(path, seconds):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(24000)
        w.writeframes(b"\x00\x00" * int(24000 * seconds))


def test_run_uses_the_apps_muse_setup_and_writes_results(tmp_path, fake_muse, capsys):
    _wav(tmp_path / "01.wav", 0.5)
    _wav(tmp_path / "02.wav", 61)  # longer than the app allows
    with open(tmp_path / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "language", "label", "expected"])
        w.writerow(["01.wav", "hi", "Hinglish noisy", "Ramesh ka balance"])
        w.writerow(["02.wav", "hi", "Hinglish noisy", "Ramesh ka balance kitna hai"])

    assert ev.main([str(tmp_path), "--fast"]) == 0
    out = capsys.readouterr().out
    assert "OVERALL" in out and "[cut at 60 s]" in out
    # Exactly the handshake the app's relay sends, with the clip's language.
    assert fake_muse["handshakes"] == [voice_live.muse_handshake("hi")] * 2
    assert fake_muse["audio_bytes"] == int(24000 * 0.5) * 2 + 60 * 24000 * 2
    rows = list(csv.DictReader(open(tmp_path / "results.csv", encoding="utf-8")))
    assert [r["accuracy"] for r in rows] == ["1.0", "0.6"]
    assert rows[1]["truncated_to_60s"] == "True"


def test_refuses_to_run_without_muse_key(tmp_path, monkeypatch):
    monkeypatch.setattr(ev.settings, "meta_model_api_key", "")
    (tmp_path / "manifest.csv").write_text("file,language,label,expected\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="META_MODEL_API_KEY"):
        ev.run(tmp_path)
