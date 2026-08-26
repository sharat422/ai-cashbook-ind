import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {useCreditLimitStore} from '@features/customer-intel/store/creditLimit.store';
import {usePendingLedgerStore} from '@features/customers/presentation/store/pendingLedger.store';
import {useExpenseStore} from '@features/expense/presentation/store/expense.store';
import {useIncomeStore} from '@features/income/presentation/store/income.store';
import {useInboxStore} from '@/services/notifications/inbox.store';
import {resetBusinessData} from './sessionReset';

describe('resetBusinessData', () => {
  it('wipes every business-scoped store so data cannot leak across businesses', () => {
    // Seed each store as if business A had been used on this device.
    useIncomeStore.setState({
      entries: [{id: 'i1'} as never],
      queue: [{localId: 'q1'} as never],
    });
    useExpenseStore.setState({
      entries: [{id: 'e1'} as never],
      queue: [{localId: 'q2'} as never],
    });
    usePendingLedgerStore.setState({entries: [{localId: 'l1'} as never]});
    useCreditLimitStore.setState({limits: {cust1: 5000}});
    useCollectionSettingsStore.setState({upiId: 'a@upi', payeeName: 'Shop A'});
    useInboxStore.getState().add({title: 'hi', body: 'there'} as never);

    resetBusinessData();

    // Business B (or a different user) must start clean.
    expect(useIncomeStore.getState().entries).toEqual([]);
    expect(useIncomeStore.getState().queue).toEqual([]);
    expect(useExpenseStore.getState().entries).toEqual([]);
    expect(useExpenseStore.getState().queue).toEqual([]);
    expect(usePendingLedgerStore.getState().entries).toEqual([]);
    expect(useCreditLimitStore.getState().limits).toEqual({});
    expect(useCollectionSettingsStore.getState().upiId).toBe('');
    expect(useCollectionSettingsStore.getState().payeeName).toBe('');
    expect(useInboxStore.getState().notifications).toEqual([]);
  });

  it('preserves store actions after resetting (only data is cleared)', () => {
    resetBusinessData();
    // Actions still work, proving we merged rather than replaced state.
    useIncomeStore.getState().addEntry({id: 'new'} as never);
    expect(useIncomeStore.getState().entries).toHaveLength(1);
    resetBusinessData();
    expect(useIncomeStore.getState().entries).toEqual([]);
  });
});
