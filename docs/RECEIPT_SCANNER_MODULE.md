# AI Receipt Scanner Module

Capture a receipt photo, extract the key fields with an AI vision model, show a
confidence score per field, let the user correct anything, and create an expense
draft — pre-filled and ready to save.

## Flow

```
Camera / Gallery  →  Capture  →  Upload  →  OCR  →  AI Categorization  →  Create Expense Draft
   (ReceiptCaptureScreen)            (ReceiptReviewScreen: progress → review/correct)   (AddExpense, prefilled)
```

## Extracted fields

Each comes back with a **confidence** score (0–1), rendered as a colour-coded
badge; fields below 0.6 are flagged **"please verify"**.

| Field | Type |
| --- | --- |
| Vendor Name | text |
| Invoice Number | text |
| GST Number | text |
| Amount | INR |
| Tax Amount | INR |
| Date | date |
| **Category** (AI-suggested) | one of the expense categories |

## Architecture (clean)

```
features/receipt-scanner/
├── domain/        # ExtractedField<T> + confidence, ReceiptExtraction, ScanStage, repository, scanReceipt use case
├── data/          # DTO + mapper, remote (FastAPI /receipts/scan multipart), repository
├── presentation/
│   ├── hooks/useScanReceipt.ts          # React Query mutation + staged progress
│   ├── components/                       # ConfidenceBadge, ScanProgress, ExtractedFieldRow
│   └── screens/                          # ReceiptCaptureScreen, ReceiptReviewScreen
└── di.ts
```

- **Confidence** is a first-class domain concept (`ExtractedField<T> = {value, confidence}`); `confidenceLevel()` / `needsReview()` live in the domain.
- **Manual correction**: the review screen seeds local editable state from the extraction; the user edits any field (each shows its confidence) before creating the draft.
- **Create Expense Draft**: the corrected values are passed to the existing **Add Expense** screen via route params (`initialValues` + `initialAttachment`), so the draft flows through the same validation + **offline-first / optimistic** pipeline as a manually-entered expense. Invoice no. / GSTIN / tax are folded into the expense notes.
- The single backend call does upload → OCR → categorization; the client advances the **Upload → OCR → AI Categorizing** stepper on a short timer for feedback.

### Reuse

Builds on existing reusable components — `AmountInput`, `DateField`, `TextField`, `ChipSelect`, `ErrorState`, `Screen`, `Button` — plus the shared `Attachment` type. The image picker is `react-native-image-picker` (already a dependency).

## Required environment variables

### App (client)

In `.env` (copy from `.env.example`), read via [`src/config/env.ts`](../src/config/env.ts):

| Variable                   | Required | Default                | Description                                            |
| -------------------------- | -------- | ---------------------- | ------------------------------------------------------ |
| `API_BASE_URL`             | yes      | `http://10.0.2.2:8000` | FastAPI host.                                          |
| `API_VERSION`              | yes      | `v1`                   | Version segment.                                       |
| `RECEIPT_SCAN_TIMEOUT_MS`  | no       | `45000`                | Timeout for the scan request (OCR is slower than usual). |

### Backend (FastAPI)

| Variable           | Required | Default            | Description                                  |
| ------------------ | -------- | ------------------ | -------------------------------------------- |
| `ANTHROPIC_API_KEY`| yes      | —                  | Anthropic API key for the vision model.      |
| `RECEIPT_MODEL`    | no       | `claude-opus-4-8`  | Claude model used for OCR + extraction.      |

> Camera/photo access also needs the native permission strings — see
> [INCOME_MODULE.md](./INCOME_MODULE.md#native-setup-for-attachments)
> (`NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` on iOS).

## Backend contract

### `POST /api/v1/receipts/scan`

`multipart/form-data` with a single file part **`receipt`** (jpeg/png).

Response `200` — each field is a `{value, confidence}` pair:

```json
{
  "vendor_name":    {"value": "Indian Oil", "confidence": 0.97},
  "invoice_number": {"value": "INV-20451",  "confidence": 0.88},
  "gst_number":     {"value": "29ABCDE1234F1Z5", "confidence": 0.74},
  "amount":         {"value": 1840, "confidence": 0.95},
  "tax_amount":     {"value": 280,  "confidence": 0.66},
  "date":           {"value": "2026-06-10", "confidence": 0.91},
  "category":       {"value": "Fuel", "confidence": 0.9}
}
```

`value` may be `null` and `confidence` `0` when a field isn't present on the
receipt. Errors use FastAPI's `{"detail": "..."}` shape (shown in the error
state).

### Reference backend — Claude vision OCR + structured extraction

Uses the official **Anthropic Python SDK** with the vision model and
**structured outputs** (`output_config.format`) so the response is guaranteed to
match the schema. Model defaults to **`claude-opus-4-8`**.

```python
# pip install fastapi "uvicorn[standard]" anthropic python-multipart
import base64, json, os
from fastapi import FastAPI, File, HTTPException, UploadFile
from anthropic import Anthropic

app = FastAPI()
client = Anthropic()  # reads ANTHROPIC_API_KEY from the environment
MODEL = os.environ.get("RECEIPT_MODEL", "claude-opus-4-8")

CATEGORIES = ["Rent", "Salary", "Fuel", "Food", "Travel", "Utilities", "Miscellaneous"]

def _field(props):  # {value, confidence} pair
    return {
        "type": "object",
        "properties": {
            "value": props,
            "confidence": {"type": "number"},
        },
        "required": ["value", "confidence"],
        "additionalProperties": False,
    }

SCHEMA = {
    "type": "object",
    "properties": {
        "vendor_name":    _field({"type": ["string", "null"]}),
        "invoice_number": _field({"type": ["string", "null"]}),
        "gst_number":     _field({"type": ["string", "null"]}),
        "amount":         _field({"type": ["number", "null"]}),
        "tax_amount":     _field({"type": ["number", "null"]}),
        "date":           _field({"type": ["string", "null"]}),
        "category":       _field({"type": "string", "enum": CATEGORIES}),
    },
    "required": ["vendor_name", "invoice_number", "gst_number",
                 "amount", "tax_amount", "date", "category"],
    "additionalProperties": False,
}

PROMPT = (
    "You are a receipt parser for an Indian small-business cashbook. "
    "Extract the vendor name, invoice/bill number, GSTIN, total amount (whole "
    "INR), tax/GST amount (whole INR), and date (YYYY-MM-DD). Also classify the "
    f"expense into exactly one category from {CATEGORIES}. For every field give "
    "a confidence between 0 and 1 reflecting how sure you are from the image. "
    "Use null for any field not present on the receipt."
)

@app.post("/api/v1/receipts/scan")
async def scan_receipt(receipt: UploadFile = File(...)):
    media_type = receipt.content_type or "image/jpeg"
    data = await receipt.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty image")
    b64 = base64.standard_b64encode(data).decode()

    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": PROMPT},
            ],
        }],
    )

    # With structured outputs the text block is guaranteed to match SCHEMA.
    text = next(b.text for b in message.content if b.type == "text")
    return json.loads(text)
```

Run with `uvicorn main:app --host 0.0.0.0 --port 8000`.

> Notes: structured outputs are supported on `claude-opus-4-8`. For high-volume
> use you can add `thinking={"type": "adaptive"}` for tougher receipts, or move
> scans to the Batches API. Keep `RECEIPT_SCAN_TIMEOUT_MS` comfortably above the
> model's typical latency.

## Manual testing steps

### Setup
1. Backend: `export ANTHROPIC_API_KEY=sk-ant-...`, run the reference stub on port 8000.
2. App: `cp .env.example .env`, set `API_BASE_URL`; `npm install` →
   `npm run android` / `npm run ios`.
3. Log in + create a business → on the Dashboard tap **📷 Scan receipt**.

### 1. Capture
1. Tap **📷 Take photo** → capture a receipt (or **Choose from gallery**).
2. The app advances to the review screen and shows the **Upload → OCR → AI
   Categorizing** stepper over a thumbnail of the photo.

### 2. Extraction + confidence
1. When the scan completes, the six fields + AI category appear pre-filled.
2. Each field shows a **confidence badge** (High/Medium/Low + %). Low-confidence
   fields (<60%) show a red **"please verify"** hint.
3. Confirm the values roughly match the receipt.

### 3. Manual correction
1. Edit the **Vendor**, **Amount**, **Tax**, **Invoice**, or **GST** fields and
   change the **Date**; pick a different **Category** chip.
2. Values update live; editing doesn't re-trigger a scan.

### 4. Create expense draft
1. Tap **Create expense draft** → you land on **Add Expense**, pre-filled with
   the corrected amount, category, vendor, date, the receipt image as the
   attachment, and notes containing `Invoice: … · GSTIN: … · Tax: ₹…`.
2. Save → it flows through the normal expense pipeline (validation, optimistic
   insert, offline queue) and appears in Recent activity / history.

### 5. Error + recovery
1. Stop the backend (or use a blurry/blank image that errors) → the review
   screen shows **"Couldn't read the receipt"** with **Try again** and **Enter
   manually**.
2. **Try again** re-runs the scan; **Enter manually** opens Add Expense with the
   image attached and empty fields.

### 6. Slow network
1. Throttle the network → confirm the request honours `RECEIPT_SCAN_TIMEOUT_MS`
   (default 45s) rather than the standard 15s API timeout.

## Type-check

```bash
npm run tsc
```
