import {useMutation} from '@tanstack/react-query';
import {useCallback, useRef, useState} from 'react';

import {receiptScannerUseCases} from '@features/receipt-scanner/di';
import type {
  Attachment,
  ReceiptExtraction,
  ScanStage,
} from '@features/receipt-scanner/domain/entities';

/**
 * Drives a receipt scan and the visible pipeline stages.
 *
 * The backend does upload → OCR → AI categorization in one request, so we
 * advance the stepper on a short timer for feedback (Upload → OCR →
 * Categorizing) and snap to `done`/`error` when the request settles.
 */
export function useScanReceipt() {
  const [stage, setStage] = useState<ScanStage>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const mutation = useMutation<ReceiptExtraction, Error, Attachment>({
    mutationFn: image => receiptScannerUseCases.scan(image),
    onMutate: () => {
      clearTimers();
      setStage('uploading');
      timers.current.push(setTimeout(() => setStage('processing'), 700));
      timers.current.push(setTimeout(() => setStage('categorizing'), 1800));
    },
    onSuccess: () => {
      clearTimers();
      setStage('done');
    },
    onError: () => {
      clearTimers();
      setStage('error');
    },
  });

  const reset = useCallback(() => {
    clearTimers();
    setStage('idle');
    mutation.reset();
  }, [clearTimers, mutation]);

  return {
    scan: mutation.mutate,
    stage,
    extraction: mutation.data,
    isScanning: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    reset,
  };
}
