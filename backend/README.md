# Smart CashBook — Backend (FastAPI)

REST backend for the AI Smart CashBook mobile app. Matches the exact request/
response contracts the React Native client expects (the `*.dto.ts` / `*.remote.ts`
files), with offline-friendly idempotency and graceful AI fallbacks.

## Stack
- **FastAPI** + **SQLAlchemy 2.0** (SQLite by default, PostgreSQL optional)
- **PyJWT** bearer auth
- **OpenAI GPT** → expense categorization + khata insights
- **Anthropic Claude** (`claude-opus-4-8`) → receipt OCR/extraction

## Quick start

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # then edit if needed
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

- Tables auto-create on startup (SQLite file `cashbook.db`). No migration step.
- Interactive docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

### Point the mobile app at it
In the app's root `.env`, set `API_BASE_URL`:
- Android emulator → `http://10.0.2.2:8000`
- iOS simulator → `http://localhost:8000`
- Physical device → `http://<your-LAN-ip>:8000` (also set `PUBLIC_BASE_URL` here to the same)

Rebuild the app after changing its `.env` (react-native-config inlines at build time).

## Auth & dev login
1. `POST /api/v1/auth/otp/request { mobile }` → `{ verificationId, mobile }`. In
   `DEBUG=true` the real OTP is printed to the server log.
2. `POST /api/v1/auth/otp/verify { verificationId, mobile, otp }` → `{ token, user }`.
   In debug, the master OTP **`123456`** is always accepted — matches the app's hint.
3. `POST /api/v1/businesses` (Bearer token) creates the business; afterwards all
   data endpoints resolve that business from the token.

## AI keys (optional)
Set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env` to enable real AI. With
keys unset, every AI endpoint still returns 200 via a deterministic fallback
(keyword categorization, heuristic insights, empty receipt draft) so the app is
fully usable without spending tokens.

## Endpoints (all under `/api/v1`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/otp/request`, `/auth/otp/verify` | OTP login |
| POST/GET | `/businesses`, `/businesses/me` | onboarding |
| GET/POST | `/incomes` | income (multipart create) |
| GET/POST | `/expenses` | expense (multipart create) |
| GET/POST/PATCH/DELETE | `/customers`, `/customers/{id}` | customer CRUD (cursor list) |
| GET/POST | `/customers/{id}/ledger` | credit / payment entries |
| GET | `/transactions` | unified history (search/filter/sort/cursor) |
| GET | `/dashboard/summary` | dashboard widgets |
| GET | `/summary/daily?date=` | daily summary |
| GET | `/khata/summary?from&to&branch&business` | khata dashboard |
| GET | `/khata/insights` | AI insights (OpenAI) |
| POST | `/categorize` | AI categorization (OpenAI) |
| POST | `/receipts/scan` | AI receipt extraction (Claude) |

## PostgreSQL
Set `DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/cashbook`. Tables
auto-create, or apply `schema.sql` manually.

## Notes / production hardening
- OTPs are stored in-memory (dev). Use Redis + a real SMS provider in production.
- Amounts are stored as float for simplicity; switch to `Numeric` for exact money.
- `/transactions` merges income+expense in Python — fine for a stub. For very
  large datasets back it with a SQL `UNION` + keyset cursor.
- Add Alembic for schema migrations before deploying.
