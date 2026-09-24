"""Consent purposes and the current policy version — the server-side source of
truth for what a user can consent to and which ones are required.

Purposes are kept separate on purpose (pun intended): a user may grant or
withdraw each independently, and each decision is stored with its own timestamp
and the policy version it was made under.
"""

# Bump when the terms/privacy policy materially changes. Stored on every consent
# row so we know which policy a decision was made under (and can re-prompt).
CURRENT_POLICY_VERSION = "2026-09-21"

# Necessary to provide the service — the user cannot use the app without it, so
# it is always required (shown, but not un-checkable).
PURPOSE_CORE = "core"
# Optional, opt-in (unchecked by default): promotional messages.
PURPOSE_MARKETING = "marketing"
# Optional, opt-in (unchecked by default): sending the user's data to AI models
# for insights/parsing. Required only if the user wants AI features.
PURPOSE_AI = "ai"

CONSENT_PURPOSES = (PURPOSE_CORE, PURPOSE_MARKETING, PURPOSE_AI)
REQUIRED_PURPOSES = (PURPOSE_CORE,)
OPTIONAL_PURPOSES = (PURPOSE_MARKETING, PURPOSE_AI)


def is_required(purpose: str) -> bool:
    return purpose in REQUIRED_PURPOSES
