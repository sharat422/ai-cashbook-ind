import {toReceiptExtraction, type ReceiptExtractionDto} from './receipt.dto';

const empty = {value: null, confidence: 0};
const dto: ReceiptExtractionDto = {
  vendor_name: empty,
  invoice_number: empty,
  gst_number: empty,
  amount: {value: 26.25, confidence: 0.95},
  tax_amount: empty,
  date: empty,
  category: empty,
};

it('preserves full receipt details and decimal totals', () => {
  const text = 'Tea 2 x 12.50 = 25.00\nGST 1.25\nUPI ref 123';
  const result = toReceiptExtraction({
    ...dto,
    receipt_text: {value: text, confidence: 0.9},
  });
  expect(result.receiptText.value).toBe(text);
  expect(result.amount.value).toBe(26.25);
});

it('supports older servers without a full transcription', () => {
  expect(toReceiptExtraction(dto).receiptText).toEqual({
    value: '',
    confidence: 0,
  });
});
