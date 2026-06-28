import {apiRequest} from '@api/client';
import {ENV} from '@config/env';
import type {
  Attachment,
  ReceiptExtraction,
} from '@features/receipt-scanner/domain/entities';
import {toReceiptExtraction, type ReceiptExtractionDto} from './receipt.dto';

/**
 * Remote data source — uploads the receipt image to the FastAPI backend, which
 * runs OCR + AI extraction (vision model) and returns the structured result.
 *
 *   POST /api/v1/receipts/scan   (multipart/form-data, field: "receipt")
 *     200 -> ReceiptExtractionDto
 */
export const receiptRemote = {
  async scan(image: Attachment): Promise<ReceiptExtraction> {
    const form = new FormData();
    form.append('receipt', {
      uri: image.uri,
      name: image.fileName,
      type: image.type,
    } as unknown as Blob);

    const dto = await apiRequest<ReceiptExtractionDto>('/receipts/scan', {
      method: 'POST',
      body: form,
      timeoutMs: ENV.receiptScanTimeoutMs,
    });
    return toReceiptExtraction(dto);
  },
};
