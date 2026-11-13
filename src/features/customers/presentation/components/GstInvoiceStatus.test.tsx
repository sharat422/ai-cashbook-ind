/**
 * G10 on the phone: a draft shows Issue / Delete and isn't in the balance; an
 * issued invoice shows its number, locked, with Cancel (no edit form); a
 * cancelled one says so and isn't in the balance either.
 */
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {buildLedger, type LedgerEntry} from '@features/customers/domain/ledger';
import {GstInvoiceStatus} from './GstInvoiceStatus';

const mockIssue = jest.fn();
const mockCancel = jest.fn();
const mockDelete = jest.fn();
jest.mock('@features/customers/presentation/hooks/useLedgerMutations', () => ({
  useLedgerMutations: () => ({
    issueInvoice: {mutate: mockIssue, isPending: false},
    cancelInvoice: {mutate: mockCancel, isPending: false},
    deleteDraft: {mutate: mockDelete, isPending: false},
  }),
}));

const entry = (id: string, gstStatus: LedgerEntry['gstStatus'], amount = 1180, invoiceNumber?: string): LedgerEntry =>
  ({id, type: 'credit', amount, date: '2026-11-09', createdAt: `2026-11-09T0${id.length}:00`, gstStatus, invoiceNumber});

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string').join('')).join(' ');
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => { r.root.findAll(n => n.props.testID === id && n.props.onPress)[0].props.onPress(); });
};
const confirmAlert = () => {
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  buttons.find((b: {style?: string}) => b.style !== 'cancel').onPress();
};

beforeEach(() => { jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });

test('drafts and cancelled invoices are left out of the balance', () => {
  const ledger = buildLedger([entry('a', undefined, 500), entry('bb', 'draft', 1180), entry('ccc', 'cancelled', 700),
    entry('dddd', 'issued', 300)]);
  expect(ledger.outstanding).toBe(800);
});

test('a draft offers Issue (after confirming) and Delete', async () => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<GstInvoiceStatus customerId="c1" entry={entry('d1', 'draft')} />); });
  expect(textOf(r)).toContain('no number yet');
  await press(r, 'gst-issue-d1');
  expect(mockIssue).not.toHaveBeenCalled(); // asks first
  confirmAlert();
  expect(mockIssue).toHaveBeenCalledWith('d1', expect.anything());
  await press(r, 'gst-delete-d1');
  expect(mockDelete).toHaveBeenCalledWith('d1', expect.anything());
  act(() => r.unmount());
});

test('an issued invoice is locked with its number and only offers Cancel', async () => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<GstInvoiceStatus customerId="c1" entry={entry('i1', 'issued', 1180, '26-27/00007')} />); });
  expect(textOf(r)).toContain('26-27/00007');
  expect(textOf(r)).toContain('locked');
  expect(r.root.findAll(n => n.props.testID === 'gst-issue-i1')).toHaveLength(0);
  await press(r, 'gst-cancel-i1');
  confirmAlert();
  expect(mockCancel).toHaveBeenCalledWith('i1', expect.anything());
  act(() => r.unmount());

  await act(async () => { r = create(<GstInvoiceStatus customerId="c1" entry={entry('x', 'cancelled', 1180, '26-27/00008')} />); });
  expect(textOf(r)).toContain('Cancelled · 26-27/00008');
  act(() => r.unmount());
});
