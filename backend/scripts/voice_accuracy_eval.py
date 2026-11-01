"""Transcription accuracy check for Ask AI voice input (Muse only).

Sends each recorded clip through the SAME Muse realtime setup the app uses
(app.routers.voice_live.muse_handshake, PCM 24 kHz mono, 60 s cap) and
compares the transcript with what was actually said. No other provider is
ever called.

Prepare a folder:
    clips/
      manifest.csv        columns: file,language,label,expected
      01.m4a  02.wav ...
  - language: the code the app would send (the user's voice language), e.g.
    hi, en. Use hi for Hinglish.
  - label: free text for grouping, e.g. "Hinglish, noisy shop".
  - expected: exactly what was said, written the way you want it transcribed
    (Roman script for Hinglish, Devanagari for Hindi).

Run (from backend/, with META_MODEL_API_KEY set in backend/.env):
    python -m scripts.voice_accuracy_eval path/to/clips

Prints per-clip and per-label word accuracy (1 - word error rate) and writes
results.csv next to the manifest. Audio other than 24 kHz mono 16-bit WAV is
converted with the bundled ffmpeg (imageio-ffmpeg).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import re
import subprocess
import sys
import wave
from collections import defaultdict
from pathlib import Path

from app.config import settings
from app.routers import voice_live

SAMPLE_RATE = 24000
FRAME_BYTES = 4800          # 0.1 s of 16-bit mono at 24 kHz
MAX_SECONDS = voice_live.PURPOSES["chatbot"]["max_seconds"]

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def normalize(text: str) -> list[str]:
    """Lowercase, drop punctuation and the rupee sign, split into words."""
    return _PUNCT.sub(" ", (text or "").lower().replace("₹", " ")).split()


def word_error_rate(expected: str, got: str) -> float:
    """Word-level Levenshtein distance / number of expected words."""
    ref, hyp = normalize(expected), normalize(got)
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1] / len(ref)


def accuracy(expected: str, got: str) -> float:
    return max(0.0, 1.0 - word_error_rate(expected, got))


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------
def load_pcm(path: Path) -> tuple[bytes, bool]:
    """24 kHz mono 16-bit PCM, capped at the app's 60 s. Returns (pcm, truncated)."""
    pcm = None
    if path.suffix.lower() == ".wav":
        with wave.open(str(path), "rb") as w:
            if (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (SAMPLE_RATE, 1, 2):
                pcm = w.readframes(w.getnframes())
    if pcm is None:
        import imageio_ffmpeg

        pcm = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path),
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"],
            check=True, capture_output=True,
        ).stdout
    limit = MAX_SECONDS * SAMPLE_RATE * 2
    return pcm[:limit], len(pcm) > limit


# ---------------------------------------------------------------------------
# Muse
# ---------------------------------------------------------------------------
async def transcribe(pcm: bytes, language: str | None, realtime: bool = True) -> str:
    async with voice_live.connect(voice_live.muse_realtime_url(), open_timeout=10,
                                  close_timeout=3, max_size=65536) as upstream:
        await upstream.send(json.dumps(voice_live.muse_handshake(language)))
        ack = json.loads(await asyncio.wait_for(upstream.recv(), timeout=10))
        if not ack.get("sessionId"):
            raise RuntimeError("Muse handshake failed")
        for i in range(0, len(pcm), FRAME_BYTES):
            await upstream.send(pcm[i:i + FRAME_BYTES])
            if realtime:  # stream like a phone would, not faster
                await asyncio.sleep(FRAME_BYTES / (SAMPLE_RATE * 2))
        await upstream.send(json.dumps({"type": "endStream"}))
        transcript = ""
        async for raw in upstream:
            event = json.loads(raw)
            if event.get("type") == "error":
                raise RuntimeError("Muse returned an error")
            if event.get("type") == "transcript":
                transcript = event.get("transcript") or ""
                if event.get("final") is True:
                    return transcript
        return transcript


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def run(folder: Path, realtime: bool = True) -> list[dict]:
    if not settings.meta_model_api_key:
        raise SystemExit("META_MODEL_API_KEY is not set (backend/.env). Muse is the only provider used.")
    with open(folder / "manifest.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    results = []
    for row in rows:
        clip = folder / row["file"]
        try:
            pcm, truncated = load_pcm(clip)
            got = asyncio.run(transcribe(pcm, row.get("language") or None, realtime))
            error = ""
        except Exception as exc:  # noqa: BLE001 — report per clip, keep going
            got, truncated, error = "", False, f"{type(exc).__name__}: {exc}"
        results.append({
            "file": row["file"], "label": row.get("label", ""), "language": row.get("language", ""),
            "expected": row["expected"], "transcript": got,
            "accuracy": round(accuracy(row["expected"], got), 3) if not error else 0.0,
            "truncated_to_60s": truncated, "error": error,
        })
    with open(folder / "results.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0]) if results else ["file"])
        writer.writeheader()
        writer.writerows(results)
    return results


def summarize(results: list[dict]) -> str:
    lines = [f"{'file':<14} {'label':<26} {'acc':>5}  transcript"]
    for r in results:
        note = f"  [ERROR {r['error']}]" if r["error"] else ("  [cut at 60 s]" if r["truncated_to_60s"] else "")
        lines.append(f"{r['file']:<14} {r['label'][:26]:<26} {r['accuracy']:>5.0%}  {r['transcript']}{note}")
    groups: dict[str, list[float]] = defaultdict(list)
    for r in results:
        groups[r["label"] or "(no label)"].append(r["accuracy"])
    lines.append("")
    for label, accs in sorted(groups.items()):
        lines.append(f"{label:<40} {sum(accs) / len(accs):>5.0%}  ({len(accs)} clips)")
    if results:
        overall = sum(r["accuracy"] for r in results) / len(results)
        lines.append(f"{'OVERALL':<40} {overall:>5.0%}  ({len(results)} clips)")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Muse transcription accuracy on recorded clips.")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--fast", action="store_true", help="send audio faster than real time")
    args = parser.parse_args(argv)
    print(summarize(run(args.folder, realtime=not args.fast)))
    print(f"\nWrote {args.folder / 'results.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
