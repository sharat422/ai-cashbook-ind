import type {Attachment, ReceiptExtraction} from './entities';

/**
 * Repository contract for the receipt scanner. Implemented by the data layer,
 * which uploads the image to the backend for OCR + AI extraction.
 */
export interface ReceiptScannerRepository {
  /** Upload a receipt image and return the structured, scored extraction. */
  scan(image: Attachment): Promise<ReceiptExtraction>;
}
