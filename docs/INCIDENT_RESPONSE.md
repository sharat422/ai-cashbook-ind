# Incident response — if you suspect a data breach

One page. Follow it in order. Don't panic, don't delete anything, don't stay quiet.
"Breach" = anyone who shouldn't have access to customer data (names, mobiles,
ledgers, amounts) may have gotten it, or data was changed/destroyed.

> ⚖️ Not legal advice. India's DPDP Act 2023 and CERT-In rules apply to you.
> Confirm current timelines with the official sources (links at the bottom); the
> numbers below are safe working defaults.

## 0. How you'll find out
Real-time alerts (Sentry email + WhatsApp) for: **failed-login spikes**,
**API-error bursts from one account**, **unusual export volume**, and **server
errors** (auth/DB). A user report or a suspicious Render log counts too.

## 1. CONTAIN — first, stop the bleeding (target: within 1 hour)
- [ ] **Preserve evidence first.** Don't wipe anything. Screenshot the alert;
      download the relevant **Render → Logs**. You need these later.
- [ ] **Rotate the keys** in Render → each service → Environment (then redeploy):
      `JWT_SECRET` (logs everyone out — kills stolen tokens), `APP_ENCRYPTION_KEY`
      (rotate as `new,old`, run `scripts/encrypt_backfill.py`), `OPENAI_API_KEY`,
      `ANTHROPIC_API_KEY`, `WHATSAPP_ACCESS_TOKEN`.
- [ ] **Lock the entry point.** If it's a single abusive account, remove/suspend
      it. If exfiltration is active, take the service offline (Render → Suspend)
      or set the DB **Access Control** allowlist to just your IP.
- [ ] **Change your own passwords** for Render, GitHub, email, the AI providers.

## 2. ASSESS — what actually happened (target: within 24 hours)
- [ ] **What data?** Names+mobiles? Ledger amounts? Attachments? GST/addresses
      (these are encrypted at rest — lower exposure).
- [ ] **Whose, and how many?** Which businesses/customers. Rough count of records.
- [ ] **How?** Stolen token, brute-forced OTP, exposed key, DB access? Use the
      Render logs + Sentry trail. Run `python -m scripts.reconcile` to spot
      tampering (duplicate/altered rows).
- [ ] **Is it still open?** Confirm the hole is closed before you tell anyone it's
      contained.
- [ ] Write down a one-paragraph factual summary: what, when, how, scope.

## 3. NOTIFY — who to tell, and when
Timelines below are the safe working deadlines — **start these clocks from the
moment you notice, not when you finish assessing.**

- [ ] **CERT-In (India) — within 6 HOURS** of noticing, for any real cyber
      incident (unauthorised access, data breach). Report at
      **incident@cert-in.org.in** / https://www.cert-in.org.in. This is the
      tightest clock — do it even while still assessing.
- [ ] **Affected users (Data Principals) — as soon as possible (treat ≤72h as the
      deadline).** Plain-language message: *what happened, what data of theirs was
      involved, what you've done, and what they should do* (e.g. watch for scam
      calls/messages referencing their dues; you never ask for OTP/PIN).
- [ ] **Data Protection Board of India — as soon as feasible (≤72h working
      deadline)** under the DPDP Act. Provide the facts summary from step 2.
      Confirm the exact form/portal in the current DPDP Rules.
- [ ] If payment/bank data of a partner was involved, notify that partner/bank too.
- [ ] Keep a copy of every notification and its timestamp.

## 4. RECOVER
- [ ] Patch the root cause (the specific hole — not just symptoms) and redeploy.
- [ ] If data was destroyed/altered, restore from the latest good **Render
      Postgres backup** and verify with `scripts/reconcile.py`.
- [ ] Force re-login is already done via the `JWT_SECRET` rotation in step 1.
- [ ] Confirm alerts are quiet and metrics are back to normal.

## 5. AFTER (within a week)
- [ ] Write a short post-mortem: timeline, cause, impact, fix, what changed.
- [ ] Fix the class of problem (add a test, tighten a limit, add an alert).
- [ ] Update this checklist with anything you learned.

## Keep handy (fill in)
- Render dashboard: dashboard.render.com — services & DB env vars, logs, backups.
- Where secrets live: Render → service → Environment (never in git).
- Sentry project (alerts): _______________________
- Owner alert number (`OWNER_ALERT_MOBILE`): _______________________
- Your DPDP "Data Fiduciary" contact on record: _______________________
- CERT-In: incident@cert-in.org.in · https://www.cert-in.org.in
- DPDP Act / Board & current Rules: https://www.meity.gov.in (verify timelines here)
