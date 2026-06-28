# AI Expense Categorization Service

Classify free-text receipt / transaction descriptions into an expense category,
with a confidence score. GPT-backed, with an **offline rule-engine fallback**,
and every decision is **stored for future learning**.

## Input / Output

**Input:** receipt text (free text).
**Output:**

```json
{
  "category": "Fuel",
  "confidence": 0.93
}
```

The client adds a `source` (`ai` | `rule`) so the UI can show whether GPT or the
fallback produced the result.

### Categories

`Rent`, `Salary`, `Food`, `Travel`, `Fuel`, `Inventory`, `Utilities`,
`Marketing`, `Miscellaneous`.

## Architecture (clean)

```
features/categorization/
├── domain/
│   ├── entities.ts          # AI_CATEGORIES, CategorizationResult, CategorizationDecision
│   ├── ruleEngine.ts        # pure keyword fallback categorizer
│   ├── repository.ts        # contract
│   └── usecases/categorizeExpense.ts
├── data/
│   ├── categorization.dto.ts        # {category, confidence} mapper
│   ├── categorization.remote.ts     # POST /categorize (OpenAI-backed)
│   ├── categorization.local.ts      # wraps the decision store
│   └── categorization.repository.ts # AI → rule fallback, records every decision
├── presentation/
│   ├── store/categorization.store.ts # persisted learning log (Zustand)
│   ├── hooks/useCategorize.ts
│   ├── components/                    # CategoryResultCard, DecisionHistory
│   └── screens/CategorizationScreen.tsx
└── di.ts
```

### How it works

1. **GPT first** — [repository](../src/features/categorization/data/categorization.repository.ts)
   calls the FastAPI `/categorize` endpoint (OpenAI GPT).
2. **Fallback rule engine** — if the backend is unavailable (offline, timeout,
   error), [`categorizeByRules`](../src/features/categorization/domain/ruleEngine.ts)
   runs locally: keyword scoring across categories, confidence capped at 0.8 so
   it's distinguishable from a confident AI result. The service therefore
   **always returns a result**.
3. **Store decisions for learning** — every decision (input, result, source,
   timestamp) is persisted to AsyncStorage. The user can **correct** the
   category; the correction is stored on the decision (`userCorrectedCategory`).
   That corrected set is the labelled data you'd later export to fine-tune the
   model or tune the rule keywords. The **Learning log** on the screen shows the
   history, with corrections marked "learned".

### UI/UX

- Dark result card with the predicted category, a colour-coded **confidence
  bar** (amber below the threshold), and an **AI / Rule** source badge.
- One-tap **correction chips**; "Try an example" to seed sample text.
- **Use in new expense** carries the category into the Add Expense form.

## Why OpenAI here (and where the key lives)

This service is specified to use the **OpenAI GPT API**. The call runs on the
**FastAPI backend**, never in the mobile app — the OpenAI key must not ship in a
client binary. The RN client only talks to your backend.

## Required environment variables

### App (client) — `.env`, read via [`src/config/env.ts`](../src/config/env.ts)

| Variable                              | Required | Default                | Description                                  |
| ------------------------------------- | -------- | ---------------------- | -------------------------------------------- |
| `API_BASE_URL`                        | yes      | `http://10.0.2.2:8000` | FastAPI host.                                |
| `API_VERSION`                         | yes      | `v1`                   | Version segment.                             |
| `CATEGORIZATION_CONFIDENCE_THRESHOLD` | no       | `0.6`                  | Below this, the result is flagged for review.|

### Backend (FastAPI)

| Variable          | Required | Default        | Description                       |
| ----------------- | -------- | -------------- | --------------------------------- |
| `OPENAI_API_KEY`  | yes      | —              | OpenAI API key.                   |
| `OPENAI_MODEL`    | no       | `gpt-4o-mini`  | Chat model used for classification.|

## Backend contract

### `POST /api/v1/categorize`

Request: `{ "text": "INDIAN OIL ... Petrol ... ₹2968" }`
Response `200`: `{ "category": "Fuel", "confidence": 0.93 }`

Errors use FastAPI's `{"detail": "..."}` shape. On **any** backend failure the
app silently falls back to the rule engine — so to exercise the AI path the
endpoint must be reachable.

### Reference backend — OpenAI GPT with structured output

```python
# pip install fastapi "uvicorn[standard]" openai pydantic
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI

app = FastAPI()
client = OpenAI()  # reads OPENAI_API_KEY from the environment
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

CATEGORIES = ["Rent", "Salary", "Food", "Travel", "Fuel",
              "Inventory", "Utilities", "Marketing", "Miscellaneous"]

class CategorizeIn(BaseModel):
    text: str

SCHEMA = {
    "name": "expense_category",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": CATEGORIES},
            "confidence": {"type": "number"},
        },
        "required": ["category", "confidence"],
        "additionalProperties": False,
    },
}

SYSTEM = (
    "You categorize Indian small-business expenses from receipt or transaction "
    f"text into exactly one of: {CATEGORIES}. Return a confidence between 0 and "
    "1 reflecting how certain you are. If nothing fits, use 'Miscellaneous' with "
    "low confidence."
)

@app.post("/api/v1/categorize")
def categorize(body: CategorizeIn):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    completion = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": body.text[:2000]},
        ],
        response_format={"type": "json_schema", "json_schema": SCHEMA},
        temperature=0,
    )
    import json
    data = json.loads(completion.choices[0].message.content)
    return {"category": data["category"], "confidence": float(data["confidence"])}
```

Run with `uvicorn main:app --host 0.0.0.0 --port 8000`.

> The model's `confidence` is a self-report, not a calibrated probability —
> treat the threshold as a UX heuristic, and lean on the stored corrections to
> measure real accuracy over time.

## Manual testing steps

### Setup
1. Backend: `export OPENAI_API_KEY=sk-...`, run the stub on port 8000.
2. App: `cp .env.example .env`, set `API_BASE_URL`; `npm install` →
   `npm run android` / `npm run ios`.
3. Log in + create a business → Dashboard → **✨ Categorize**.

### 1. AI categorization (happy path)
1. Tap **Try an example** (fills a fuel receipt) → **Categorize**.
2. Expect the result card to show **Fuel** with a green confidence bar and the
   **✨ AI (GPT)** badge. Confirm the backend received `POST /categorize`.
3. Try other inputs (e.g. "Swiggy lunch for staff ₹640" → Food; "Facebook ads
   campaign ₹5000" → Marketing).

### 2. Confidence threshold
1. Enter vague text (e.g. "payment ₹500"). If confidence is below
   `CATEGORIZATION_CONFIDENCE_THRESHOLD`, the bar turns amber and a "review"
   hint appears.

### 3. Fallback rule engine (offline)
1. Enable **Airplane mode** (or stop the backend) → categorize "Petrol diesel
   Indian Oil ₹2000".
2. Expect a result with the **⚙︎ Rule engine** badge and a capped confidence
   (≤80%), and the correct category from keywords (Fuel).
3. Try text with no keywords ("random note") → **Miscellaneous**, low confidence.

### 4. Correction + learning log
1. After any result, tap a **correction chip** (e.g. change to **Inventory**) →
   "Saved for future learning" appears.
2. Scroll to the **Learning log** — the entry shows the original category struck
   through with `→ Inventory` and a **learned** tag.
3. Force-quit and reopen the app → the log persists (stored decisions).
4. Tap **Clear** to empty the log.

### 5. Use in expense
1. Tap **Use in new expense** → Add Expense opens with the category pre-selected
   (Inventory/Marketing map to Miscellaneous, which the expense form supports).

## Type-check

```bash
npm run tsc
```
