"""Matching customer names across scripts and spellings.

AI Entry saves a name in the app's language (నరేన్ for Telugu) while older
customers are in English letters (Naren), and people spell names many ways
(Laxmi / Lakshmi). `loose()` turns any name into one rough Latin key so these
compare equal: Indian scripts are romanized letter by letter, then spelling
variants are folded. The keys are only for comparing, never shown.

The Indian scripts in Unicode (Devanagari, Bengali, Gurmukhi, Gujarati, Oriya,
Tamil, Telugu, Kannada, Malayalam) share one letter layout, 0x80 code points
each from U+0900, so one table by offset covers them all.
"""

import re

_CONS =dict(zip(range(0x15, 0x3A), (
    "k kh g gh n ch chh j jh n t th d dh n t th d dh n n p ph b bh m y r r l l zh v sh sh s h").split()))
_CONS.update({0x58: "k", 0x59: "kh", 0x5A: "g", 0x5B: "z", 0x5C: "r", 0x5D: "rh", 0x5E: "f", 0x5F: "y"})
_VOWEL = dict(zip(range(0x05, 0x15), "a a i i u u ri li e e e ai o o o au".split()))
_MATRA = dict(zip(range(0x3E, 0x4D), "a i i u u ri ri e e e ai o o o au".split()))
_SIGN = {0x01: "n", 0x02: "n", 0x03: "h",
         (1, 0x4E): "t",                                     # Bengali khanda ta
         (2, 0x70): "n",                                     # Gurmukhi tippi
         (8, 0x4E): "r", (8, 0x54): "m", (8, 0x55): "y", (8, 0x56): "l",  # Malayalam
         **{(8, o): v for o, v in zip(range(0x7A, 0x80), "n n r l l k".split())}}  # chillus
_NO_VOWEL = (0x4D, 0x71)  # virama, Gurmukhi addak: the consonant before has no "a"
_NUKTA = {"s": "sh", "j": "z", "ph": "f", "d": "r", "dh": "rh"}
_TAMIL, _SCHWA_DROPPED = 5, {0, 1, 2, 3}  # Hindi/Bengali/Punjabi/Gujarati: नरेन is Naren, not Narena
# ponytail: letter-by-letter, no dictionary. Tamil can't tell k/g, t/d, p/b
# apart, so loose() folds voicing everywhere; schwa inside a Hindi word stays
# (कमला -> kamala), which the 80% likeness in the chatbot absorbs.
_FOLD = (("ksh", "x"), ("ee", "i"), ("oo", "u"), ("aa", "a"), ("w", "v"), ("z", "j"), ("ph", "f"), ("h", ""))
_DEVOICE = str.maketrans("gjdb", "kctp")


def _indic(ch: str) -> tuple[int, int] | None:
    cp = ord(ch) - 0x900
    return divmod(cp, 0x80) if 0 <= cp < 0x480 else None


def has_indic(text: str) -> bool:
    return any(_indic(ch) for ch in text)


def romanize(text: str) -> str:
    """నరేన్ -> naren, रमेश -> ramesh, லக்ஷ்மி -> lakshmi. Other text is kept."""
    out: list[str] = []
    pending = None  # script of the last consonant while it still might get an inherent "a"
    for i, ch in enumerate(text):
        script, off = _indic(ch) or (None, -1)
        if off == 0x3C:  # nukta: ਸ਼ = ਸ + ਼, ज़, फ़, ड़
            if out and out[-1] in _NUKTA:
                out[-1] = _NUKTA[out[-1]]
            continue
        if off in _MATRA or off in _NO_VOWEL:  # vowel sign, virama
            out.append(_MATRA.get(off, ""))
            pending = None
            continue
        if pending is not None and not (script is None and pending in _SCHWA_DROPPED):
            out.append("a")
        pending = None
        if script is None:
            out.append(ch)
        elif cons := ("s" if (script, off) == (_TAMIL, 0x1A) else _CONS.get(off)):  # Tamil ச: Suresh
            out.append(cons)
            pending = script
        elif off == 0x02 and i + 1 < len(text) and _CONS.get((_indic(text[i + 1]) or (0, 0))[1], " ")[0] in "pbm":
            out.append("m")  # anusvara before p/b/m: Sampath, not Sanpath
        else:
            out.append(_SIGN.get((script, off)) or _SIGN.get(off) or _VOWEL.get(off, ""))
    if pending is not None and pending not in _SCHWA_DROPPED:
        out.append("a")
    return "".join(out)


def loose(text) -> str:
    """Rough Latin key of a name: Naren, నరేన్ and नरेन all give "naren";
    Laxmi and Lakshmi both give "laxmi"."""
    key = romanize(" ".join(str(text or "").lower().split()))
    for a, b in _FOLD:
        key = key.replace(a, b)
    return re.sub(r"y\b", "i", key).translate(_DEVOICE)  # Reddy = రెడ్డి


def _cross_script(a: str, b: str) -> bool:
    return has_indic(a) or has_indic(b)


def contains(hay: str, word: str) -> bool:
    """`word` is in `hay` ignoring case; across scripts too when either is in an
    Indian script ("Naren" finds నరేన్ and the other way round). English against
    English stays a plain match."""
    if word.lower() in hay.lower():
        return True
    key = loose(word)
    return _cross_script(hay, word) and bool(key) and key in loose(hay)


def same_name(a: str, b: str) -> bool:
    """Same name ignoring case; across scripts too (Naren = నరేన్)."""
    return a.lower() == b.lower() or (_cross_script(a, b) and loose(a) == loose(b))
