import type {Attachment, ReceiptExtraction} from '../entities';
import type {ReceiptScannerRepository} from '../repository';

/** Use case: scan a receipt image into a structured extraction. */
export function scanReceiptUseCase(repo: ReceiptScannerRepository) {
  return (image: Attachment): Promise<ReceiptExtraction> => repo.scan(image);
}
