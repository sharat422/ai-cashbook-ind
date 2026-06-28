/**
 * Composition root for the Receipt Scanner feature: binds the use case to the
 * concrete repository. Presentation imports from here only.
 */
import {receiptScannerRepository} from './data/receipt.repository';
import {scanReceiptUseCase} from './domain/usecases/scanReceipt';

export const receiptScannerUseCases = {
  scan: scanReceiptUseCase(receiptScannerRepository),
};
