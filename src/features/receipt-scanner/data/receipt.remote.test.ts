import {apiRequest} from '@api/client';
import {receiptRemote} from './receipt.remote';

jest.mock('@api/client', () => ({apiRequest: jest.fn()}));

const image = {
  uri: 'file:///receipt.jpg',
  fileName: 'receipt.jpg',
  type: 'image/jpeg',
};
const empty = {value: null, confidence: 0};
const draft = {
  vendor_name: empty,
  invoice_number: empty,
  gst_number: empty,
  amount: empty,
  tax_amount: empty,
  date: empty,
  category: empty,
};

it('sends unreadable or unavailable OCR to retry/manual entry', async () => {
  (apiRequest as jest.Mock).mockResolvedValueOnce(draft);
  await expect(receiptRemote.scan(image)).rejects.toThrow('No receipt details');
});

it('allows a partial transcription for the user to complete', async () => {
  (apiRequest as jest.Mock).mockResolvedValueOnce({
    ...draft,
    receipt_text: {value: 'Tea 2 x 12.50', confidence: 0.5},
  });
  await expect(receiptRemote.scan(image)).resolves.toMatchObject({
    receiptText: {value: 'Tea 2 x 12.50'},
  });
});
