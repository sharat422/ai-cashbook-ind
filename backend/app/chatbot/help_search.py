"""Keyword search over the merchant help guide (app/chatbot/help_docs/*.md).

Each doc starts with a small header (title, screen, screen_label, keywords).
Scoring, per doc:
  +3 for every keyword phrase that appears in the query,
  +2 for every query word found in the title or keywords,
  +1 for every query word found only in the body.
A doc must match at least one title/keyword word; body-only matches never
count. So a question that merely shares a word with a doc's text ("GST
filing" vs "GST number") finds nothing rather than a wrong article. ponytail: keyword scoring; move to embeddings if the guide
grows past a few dozen docs or synonyms keep missing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

DOCS_DIR = Path(__file__).parent / "help_docs"
MAX_RESULTS = 3
MIN_SCORE = 2  # i.e. at least one title/keyword word

_WORD = re.compile(r"[a-z0-9ऀ-ॿ]+")
# Question filler (English + Hinglish) that says nothing about the topic.
_STOPWORDS = {
    "a", "an", "the", "i", "me", "my", "we", "you", "your", "is", "are", "do", "does",
    "can", "how", "what", "where", "when", "to", "in", "on", "of", "for", "and", "or",
    "it", "this", "that", "with", "app", "bolcash", "please", "pls", "tell",
    "kaise", "kese", "kya", "hai", "hain", "ho", "kar", "karu", "karun", "kare", "karein",
    "karna", "karte", "ka", "ki", "ke", "ko", "se", "me", "mein", "mai", "main", "hum",
    "mujhe", "batao", "bataiye", "bata", "sakta", "sakte", "skta", "nahi", "na", "ye", "yeh",
    "कैसे", "क्या", "है", "में", "का", "की", "के", "को", "से",
}


@dataclass(frozen=True)
class HelpDoc:
    source: str
    title: str
    screen: str
    screen_label: str
    keywords: tuple[str, ...]
    body: str


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOPWORDS}


def _parse(path: Path) -> HelpDoc:
    text = path.read_text(encoding="utf-8")
    _, header, body = text.split("---", 2)
    meta = dict(line.split(":", 1) for line in header.strip().splitlines())
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    return HelpDoc(
        source=path.name,
        title=meta["title"],
        screen=meta["screen"],
        screen_label=meta["screen_label"],
        keywords=tuple(k.strip().lower() for k in meta["keywords"].split(",") if k.strip()),
        body=body.strip(),
    )


DOCS: list[HelpDoc] = [_parse(p) for p in sorted(DOCS_DIR.glob("*.md"))]


def _score(doc: HelpDoc, query: str, q_words: set[str]) -> int:
    phrase_hits = sum(1 for k in doc.keywords if " " in k and k in query)
    head = _words(doc.title + " " + " ".join(doc.keywords))
    head_hits = len(q_words & head)
    if not (phrase_hits or head_hits):
        return 0  # body-only matches never qualify
    body = _words(doc.body)
    return 3 * phrase_hits + 2 * head_hits + len((q_words - head) & body)


def search(query: str) -> list[dict]:
    """Top matching docs (best first), each with its file name as `source`."""
    normalized = " ".join(str(query or "").lower().split())
    q_words = _words(normalized)
    if not q_words:
        return []
    scored = sorted(((_score(d, normalized, q_words), d) for d in DOCS),
                    key=lambda sd: (-sd[0], sd[1].source))
    return [
        {"source": d.source, "title": d.title, "screen": d.screen,
         "screen_label": d.screen_label, "content": d.body}
        for score, d in scored[:MAX_RESULTS] if score >= MIN_SCORE
    ]
