/**
 * Telugu-first acceptance tests.
 *
 * 1. Switching to Telugu changes entry, statement and error screens — not just home.
 * 2. A Telugu-only user can make a first entry, send a reminder and do a daily
 *    close: every word they see on those screens is in Telugu.
 * 3. Free export works from "Your data" (no plan involved) and the draft banner shows.
 * 4. Entry / statement screens never show an English-only error.
 *
 * "English-only" = a visible string with an English word, after removing the
 * customer/business names in the fixture and words that are the same in every
 * language (₹, UPI, PDF, Excel, WhatsApp…; see hardcodedText.ts).
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';

import {ApiError, apiErrorMessage, NetworkError} from '@api/client';
import {ErrorState} from '@components/ui';
import {StatementDocument} from '@features/customers/presentation/components/StatementDocument';
import {ReceivePaymentSheet} from '@features/customers/presentation/components/ReceivePaymentSheet';
import type {Customer} from '@features/customers/domain/entities';
import type {CustomerStatement} from '@features/customers/domain/customerStatement';
import {validateCustomerDraft} from '@features/customers/domain/validation';
import {validateExpenseDraft} from '@features/expense/domain/validation';
import {SendReminderSheet} from '@features/reminders/presentation/components/SendReminderSheet';
import {QuickAddScreen} from '@features/transactions/presentation/screens/QuickAddScreen';
import {DailyCloseScreen} from '@features/reconciliation/presentation/screens/DailyCloseScreen';
import {YourDataScreen} from '@features/account/presentation/screens/YourDataScreen';
import {useAuthStore} from '@store/auth.store';
import {formatDisplayDate, formatTimestampDate, istDate} from '@utils/date';
import {validateMobile} from '@utils/validation';
import {hasWords} from './hardcodedText';
import {translate} from './useT';

jest.setTimeout(30_000);

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', writeFile: jest.fn()}));
jest.mock('react-native-share', () => ({default: {open: jest.fn()}}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const mockCreateIncome = jest.fn();
const mockCreateExpense = jest.fn();
jest.mock('@features/income/presentation/hooks', () => ({
  useConnectivity: () => true,
  useCreateIncome: () => ({mutate: mockCreateIncome, isPending: false}),
}));
jest.mock('@features/expense/presentation/hooks', () => ({
  useCreateExpense: () => ({mutate: mockCreateExpense, isPending: false}),
}));
const mockDispatch = jest.fn(async (_: unknown) => 'sent');
jest.mock('@features/reminders/presentation/dispatch', () => ({
  dispatchReminder: (input: unknown) => mockDispatch(input),
}));
const mockClose = {
  date: '2026-11-07', beatId: null, creditCollected: '2500.00', cashInHand: '1000.00',
  upiClaimed: '1500.00', bankClaimed: '0.00', otherClaimed: '0.00', verified: '1000.00',
  creditGiven: '4000.00', difference: '500.00',
  collections: [
    {id: 'c1', customerId: 'x', customerName: 'రమేష్ కిరాణా', date: '2026-11-07', amount: '1000.00',
      mode: 'cash', reference: null, beatId: null, salesmanId: null, verified: true},
    {id: 'c2', customerId: 'y', customerName: 'లక్ష్మి స్టోర్స్', date: '2026-11-07', amount: '1500.00',
      mode: 'upi', reference: '412345678901', beatId: null, salesmanId: null, verified: false},
  ],
};
jest.mock('@features/reconciliation/presentation/hooks', () => ({
  useDailyClose: () => ({data: mockClose, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn()}),
}));
jest.mock('@features/beats/presentation/hooks', () => ({
  useBeats: () => ({data: [], isLoading: false}),
}));
const mockDownload = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@api/download', () => ({downloadAndShare: (...a: unknown[]) => mockDownload(...a)}));

const NAMES = ['రమేష్ కిరాణా', 'లక్ష్మి స్టోర్స్', 'శ్రీ బాలాజీ ఏజెన్సీస్', '412345678901'];
const TELUGU = /[ఀ-౿]/;

const customer: Customer = {
  id: 'cust-1', fullName: 'రమేష్ కిరాణా', mobile: '9876543210', outstandingAmount: 1500,
  isOverdue: false, createdAt: '2026-10-01T00:00:00Z',
};
const statement: CustomerStatement = {
  from: '2026-10-01', to: '2026-11-07', openingBalance: 0, closingBalance: 1500, totalCredit: 2500,
  totalPayment: 1000, outstanding: 1500,
  rows: [
    {id: 'e1', type: 'credit', amount: 2500, date: '2026-10-05', balance: 2500} as never,
    {id: 'e2', type: 'payment', amount: 1000, date: '2026-10-20', balance: 1500, paymentMethod: 'upi'} as never,
  ],
};

const setLanguage = (l: 'en' | 'te') => {
  act(() => {
    useAuthStore.setState({preferredLanguage: l});
  });
};

/** Every string a user can read: Text content and input placeholders. */
function visible(r: ReactTestRenderer): string[] {
  const out: string[] = [];
  for (const n of r.root.findAllByType(Text)) {
    const own = ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string' || typeof c === 'number');
    if (own.length) out.push(own.join(''));
  }
  for (const n of r.root.findAllByType(TextInput)) {
    if (n.props.placeholder) out.push(String(n.props.placeholder));
  }
  return out.filter(s => s.trim());
}

function englishOnly(strings: string[]): string[] {
  return strings.filter(s => hasWords(NAMES.reduce((acc, n) => acc.split(n).join(''), s)));
}

const pressText = (r: ReactTestRenderer, label: string) => {
  const target = r.root.findAll(n => typeof n.props.onPress === 'function' &&
    n.findAllByType(Text).some(t => ([] as unknown[]).concat(t.props.children).join('') === label));
  if (!target.length) throw new Error(`no button "${label}"`);
  // Innermost match: a sheet backdrop also "contains" the button text.
  return act(async () => { await target[target.length - 1].props.onPress(); });
};

const nav = {navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn()} as any;

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({preferredLanguage: 'en', business: null});
});

describe('1. switching to Telugu changes entry, statement and error screens', () => {
  it.each([
    ['entry: receive payment', () => <ReceivePaymentSheet visible outstanding={1500} onClose={jest.fn()} onSubmit={jest.fn()} />],
    ['entry: quick add', () => <QuickAddScreen navigation={nav} route={{params: {type: 'expense'}} as any} />],
    ['statement', () => <StatementDocument customer={customer} statement={statement} businessName="శ్రీ బాలాజీ ఏజెన్సీస్" />],
    ['error', () => <ErrorState onRetry={jest.fn()} />],
    ['daily close', () => <DailyCloseScreen navigation={nav} route={{params: {}} as any} />],
  ])('%s', async (_, ui) => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(ui()); });
    expect(englishOnly(visible(r)).length).toBeGreaterThan(0); // starts in English
    setLanguage('te');
    const after = visible(r);
    expect(englishOnly(after)).toEqual([]);
    expect(after.some(s => TELUGU.test(s))).toBe(true);
    act(() => r.unmount());
  });

  it('server and network errors read in Telugu (the English detail is kept for logs)', () => {
    setLanguage('te');
    const err = new ApiError(422, apiErrorMessage(422, 'amount: Input should be greater than 0'), 'amount: …');
    expect(err.message).toMatch(TELUGU);
    expect(hasWords(err.message)).toBe(false);
    for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 503]) {
      expect(hasWords(apiErrorMessage(status, 'English detail'))).toBe(false);
    }
    expect(new NetworkError().message).toMatch(TELUGU);
    setLanguage('en');
    expect(apiErrorMessage(422, 'Amount must be positive')).toBe('Amount must be positive');
  });
});

describe('2. a Telugu-only user: first entry, reminder, daily close', () => {
  beforeEach(() => setLanguage('te'));

  it('makes a first entry without seeing English', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<QuickAddScreen navigation={nav} route={{params: {type: 'expense'}} as any} />); });
    await pressText(r, translate('te', 'txn.saveExpense')); // no amount yet
    expect(englishOnly(visible(r))).toEqual([]);
    expect(visible(r)).toContain(translate('te', 'ai.enterAmount'));
    await act(async () => { r.root.findAllByType(TextInput)[0].props.onChangeText('500'); });
    await pressText(r, translate('te', 'txn.saveExpense'));
    expect(mockCreateExpense).toHaveBeenCalledWith(expect.objectContaining({amount: 500}), expect.anything());
    // Expanded details (category chips, date, photo) are Telugu too.
    await pressText(r, translate('te', 'txn.addDetails'));
    expect(englishOnly(visible(r))).toEqual([]);
    expect(visible(r)).toContain(translate('te', 'cat.Fuel'));
  });

  it('sends a reminder in Telugu', async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<SendReminderSheet visible customer={customer} outstanding={1500} businessName="శ్రీ బాలాజీ ఏజెన్సీస్" onClose={jest.fn()} />);
    });
    expect(englishOnly(visible(r))).toEqual([]);
    await pressText(r, translate('te', 'reminders.send', {channel: translate('te', 'reminders.channel.whatsapp')}));
    const sent = mockDispatch.mock.calls[0][0] as {message: string};
    expect(sent.message).toMatch(TELUGU); // the customer gets Telugu too
    expect(sent.message).toContain('₹1,500');
    expect(visible(r)).toContain(translate('te', 'reminders.sentVia', {channel: translate('te', 'reminders.channel.whatsapp')}));
    expect(englishOnly(visible(r))).toEqual([]);
  });

  it('does the daily close in Telugu', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<DailyCloseScreen navigation={nav} route={{params: {}} as any} />); });
    const seen = visible(r);
    expect(englishOnly(seen)).toEqual([]);
    expect(seen).toContain(translate('te', 'close.difference'));
    expect(seen).toContain('₹500.00');
    expect(seen).toContain(translate('te', 'close.notInBank'));
  });
});

describe('3. free export from Your data', () => {
  it('downloads Excel and PDF with no plan, and shows the wording as a blocked draft', async () => {
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<YourDataScreen />); });
    expect(r.root.findAllByProps({testID: 'draft-banner'}).length).toBeGreaterThan(0);
    const seen = visible(r).join('\n');
    expect(seen).toContain(translate('te', 'yourData.draft.keep')); // Telugu…
    expect(seen).toContain(translate('en', 'yourData.draft.keep')); // …and English
    await act(async () => { await r.root.findByProps({testID: 'export-excel'}).props.onPress(); });
    await act(async () => { await r.root.findByProps({testID: 'export-pdf'}).props.onPress(); });
    expect(mockDownload.mock.calls.map(c => c[0])).toEqual(['/account/export.xlsx', '/account/balances.pdf']);
  });
});

describe('4. entry and statement errors are never English-only', () => {
  it('form validation reads in Telugu', () => {
    setLanguage('te');
    const messages = [
      validateMobile(''), validateMobile('123'),
      ...Object.values(validateCustomerDraft({fullName: '', mobile: '12'})),
      ...Object.values(validateExpenseDraft({amount: 0, category: 'x' as never, date: '2999-01-01', vendor: ''})),
    ];
    expect(messages.length).toBeGreaterThan(4);
    for (const m of messages) expect(hasWords(String(m))).toBe(false);
  });
});

describe('IST dates and Indian numbers', () => {
  it('dates follow IST, not UTC or the phone zone', () => {
    // 20:00 UTC on 6 Nov is 01:30 on 7 Nov in India.
    expect(istDate(new Date('2026-11-06T20:00:00Z'))).toBe('2026-11-07');
    expect(formatTimestampDate('2026-11-06T20:00:00+00:00')).toBe('07 Nov 2026');
    useAuthStore.setState({preferredLanguage: 'te'});
    expect(formatDisplayDate('2026-11-07')).toBe(`07 ${translate('te', 'date.mon.11')} 2026`);
  });

  it('a sale entered at 00:30 IST is not "in the future"', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-06T19:00:00Z')); // 00:30 IST on 7 Nov
    try {
      expect(validateExpenseDraft({amount: 10, category: 'Fuel', date: '2026-11-07', vendor: ''}).date).toBeUndefined();
      expect(validateExpenseDraft({amount: 10, category: 'Fuel', date: '2026-11-08', vendor: ''}).date).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });
});
