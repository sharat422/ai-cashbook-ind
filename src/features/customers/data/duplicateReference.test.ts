/**
 * A bank/cheque reference that repeats an earlier payment is saved, and the
 * person is told which earlier payment to check. No warning, no alert.
 */
import {Alert} from 'react-native';

import {warnIfDuplicateReference} from '@features/customers/presentation/hooks/useLedgerMutations';
import {toLedgerEntry, type LedgerEntryDto} from './ledger.dto';

jest.mock('@features/customers/di', () => ({ledgerUseCases: {}}));

const dto: LedgerEntryDto = {
  id: 'e2', type: 'payment', amount: 1500, date: '2026-11-08', invoice_number: null, notes: null,
  payment_method: 'cheque', reference_number: '004512', attachment_url: null, created_at: '2026-11-08T10:00:00Z',
  cheque_bank: 'SBI Main Road', cheque_account: '1234',
};

test('a saved payment with a repeated reference shows who paid it first', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const entry = toLedgerEntry({...dto, warning: {entryId: 'e1', customerName: 'Ravi Stores', amount: '1500.00', date: '2026-11-01'}});
  expect([entry.chequeBank, entry.chequeAccount]).toEqual(['SBI Main Road', '1234']);
  warnIfDuplicateReference(entry);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(String(alert.mock.calls[0][1])).toContain('Ravi Stores');

  alert.mockClear();
  warnIfDuplicateReference(toLedgerEntry(dto));
  expect(alert).not.toHaveBeenCalled();
});
