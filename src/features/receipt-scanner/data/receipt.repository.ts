import type {
  Attachment,
  ReceiptExtraction,
} from '@features/receipt-scanner/domain/entities';
import type {ReceiptScannerRepository} from '@features/receipt-scanner/domain/repository';
import {receiptRemote} from './receipt.remote';

/** Concrete repository backed by the FastAPI remote source. */
export const receiptScannerRepository: ReceiptScannerRepository = {
  scan(image: Attachment): Promise<ReceiptExtraction> {
    return receiptRemote.scan(image);
  },
};
