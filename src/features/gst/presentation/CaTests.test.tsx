/**
 * G11: GST reports → CA test. The owner saves the result on the server; past
 * results are listed (month, CA, re-typed, Offline Tool errors, date), the note
 * opens in full, and Share sends the saved record. Read-only roles can't save.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Share, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {GstReportsScreen} from './GstReportsScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

let mockOwner = true;
jest.mock('@features/auth/hooks', () => ({usePermissions: () => ({can: () => mockOwner})}));
const saved = {
  id: 't1', testedMonth: '2026-10', caName: 'Rao & Co', tallyVersion: 'TallyPrime 5.1', offlineToolVersion: null,
  recordsExported: 40, recordsImported: 40, fieldsRetyped: 2, offlineToolErrors: 1,
  discrepancyNote: 'Place of supply typed for 2 invoices.', testedAt: '2026-11-10T11:05:00.000000+05:30',
};
const mockSave = jest.fn(async (..._a: unknown[]) => saved);
jest.mock('@features/gst/data/gst.remote', () => ({
  gstRemote: {
    summary: async () => ({invoices: 40, rateChanges: 0, taxableValue: '0', cgst: '0', sgst: '0', igst: '0', total: '0'}),
    caTests: async () => [saved],
    saveCaTest: (...a: unknown[]) => mockSave(...a),
    download: jest.fn(),
  },
}));

const byId = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && (n.props.onPress || n.props.onChangeText));
const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c !== 'object').join('')).join(' ');

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <GstReportsScreen navigation={{} as any} route={{} as any} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  return r;
}

test('the owner saves a result; past results list and share from the saved record', async () => {
  mockOwner = true;
  const share = jest.spyOn(Share, 'share').mockResolvedValue({action: 'sharedAction'} as any);
  const r = await render();
  try {
    expect(textOf(r)).toContain('Rao & Co');
    expect(textOf(r)).toContain('2 fields re-typed · 1 Offline Tool errors');
    await act(async () => { byId(r, 'ca-imported')[0].props.onChangeText('40'); });
    await act(async () => { byId(r, 'ca-retyped')[0].props.onChangeText('0'); });
    await act(async () => {
      byId(r, 'ca-name')[0].props.onChangeText('Rao & Co');
      byId(r, 'ca-tally')[0].props.onChangeText('TallyPrime 5.1');
      byId(r, 'ca-note')[0].props.onChangeText('None');
    });
    await act(async () => { byId(r, 'ca-save')[0].props.onPress(); });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
      caName: 'Rao & Co', tallyVersion: 'TallyPrime 5.1', fieldsRetyped: 0, recordsImported: 40,
      recordsExported: 40, discrepancyNote: 'None'}));
    await act(async () => { byId(r, 'ca-share-t1')[0].props.onPress(); });
    const [{message}] = share.mock.calls[0] as [{message: string}];
    expect(message).toContain('CA Rao & Co');
    expect(message).toContain('Place of supply typed for 2 invoices.');
  } finally {
    act(() => r.unmount());
  }
});

test('read-only roles see past results but cannot save', async () => {
  mockOwner = false;
  const r = await render();
  try {
    expect(textOf(r)).toContain('Rao & Co');
    expect(byId(r, 'ca-save')).toHaveLength(0);
  } finally {
    act(() => r.unmount());
  }
});
