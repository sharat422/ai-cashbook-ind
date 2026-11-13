"""AC7: one line for the accountant audit log per Ask AI answer: the question
(masked) and the figures the answer cited, never the answer text.

    "Asked: total outstanding. Used: Syntaro ₹2,500.00; 1 customer"

Figures come from the final answer, which the assistant only gives from its
read-only tools: each of this business's customers named in it, with the ₹
amount that follows the name, then any other ₹ amounts (totals). The question
is masked first: no phone number, account or card number, OTP, IFSC code or
UPI id / email reaches the log."""
from __future__ import annotations

import re

_MONEY = re.compile(r"₹\s?\d[\d,]*(?:\.\d+)?")
_HANDLE = re.compile(r"\S+@\S+")                      # UPI id or email
_IFSC = re.compile(r"\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b")
_DIGITS = re.compile(r"(?<![₹\d,.])\d[\d\s-]{2,}\d")  # 4+ digits not after ₹: phone, account, OTP, card


def mask(text: str) -> str:
    text = _HANDLE.sub("[hidden]", text)
    text = _IFSC.sub("[hidden]", text)
    return _DIGITS.sub(lambda m: "•" * 4 if sum(c.isdigit() for c in m.group()) >= 4 else m.group(), text)


def ask_line(question: str, answer: str, customer_names: list[str]) -> str:
    asked = mask(" ".join(question.split())).rstrip(" ?.!")[:120]
    # Customers named in the answer: longest names first, never overlapping
    # ("Ramesh" inside "Ramesh Traders" is one customer, not two).
    spans: list[tuple[int, int]] = []
    for name in sorted({n.strip() for n in customer_names if n and len(n.strip()) >= 2}, key=len, reverse=True):
        for m in re.finditer(re.escape(name), answer):
            if not any(s < m.end() and m.start() < e for s, e in spans):
                spans.append((m.start(), m.end()))
    spans.sort()
    amounts = [(m.start(), m.group()) for m in _MONEY.finditer(answer)]
    paired: set[int] = set()
    used: list[str] = []
    for i, (start, end) in enumerate(spans):
        # The name's amount: the first one after it (before the next name), else
        # the nearest one before it (after the previous name): "₹2,500 hai, Syntaro se".
        stop = spans[i + 1][0] if i + 1 < len(spans) else len(answer)
        back = spans[i - 1][1] if i else 0
        hit = next((j for j, (pos, _) in enumerate(amounts) if end <= pos < stop and j not in paired), None)
        if hit is None:
            hit = next((j for j in reversed(range(len(amounts)))
                        if back <= amounts[j][0] < start and j not in paired), None)
        if hit is None:
            used.append(answer[start:end])
        else:
            paired.add(hit)
            used.append(f"{answer[start:end]} {amounts[hit][1]}")
    used += [a for j, (_, a) in enumerate(amounts) if j not in paired]
    if not used:
        return f"Asked: {asked}. Used: none"
    names = len({answer[s:e] for s, e in spans})
    tail = f"; {names} customer{'' if names == 1 else 's'}" if names else ""
    return f"Asked: {asked}. Used: {'; '.join(used)}{tail}"[:500]
