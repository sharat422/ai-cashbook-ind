# Receipt OCR comparison and verification

The reference `logistics_ai_bol_scanner/services/geminiService.ts` sends the
document image to Gemini and enforces a JSON schema for BOL summary fields and
line items. Its App displays results and automatically saves valid extractions.

Cashbook already sends receipt images to Claude on the backend using a forced
structured tool response. It previously extracted only vendor, invoice, GSTIN,
total, tax, date and category. The same image-to-structured-data approach now
also requests a complete, original-language transcription: all item rows,
quantities, rates, taxes, discounts, addresses and payment details. Claude and
server-only credentials are retained; no new provider or dependency is needed.

Users can edit the transcription and summary fields in Receipt Review. Creating
the expense draft carries the reviewed transcription into notes and keeps the
receipt attachment. The user must still save the expense explicitly. Empty
results show retry/manual entry instead of presenting a successful blank scan.
Older backend responses without transcription remain supported.

## Manual verification

1. Configure `ANTHROPIC_API_KEY` on the backend and enable AI consent for the user.
2. Scan a receipt with multiple items, decimal prices, a discount, separate taxes
   and a payment reference. Check all readable text appears in All receipt details
   and the amount is the final payable total.
3. Correct an item and the total, create the draft, and verify notes, fields and
   attachment. Confirm nothing is saved until Save is pressed. Save and reopen.
4. Try a blurry photo or an unavailable provider. Verify retry and manual entry.
5. Try a long receipt. Expense notes support the server's 5,000-character limit;
   longer notes must be edited before saving, without silent truncation. The
   original image remains attached. OCR accuracy must always be reviewed.

New labels use the existing English fallback until locale generation is run.
