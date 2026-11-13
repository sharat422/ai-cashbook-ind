/**
 * IM7 on the import log: the owner gets "Undo this import" on an import that
 * can be undone (confirm first), the reasons where it can't, and "Undone on…"
 * once it was. IM6: the limits show before a file is picked.
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert, Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import type {ImportLogEntry} from '../import.remote';
import {KhataImportScreen} from './KhataImportScreen';

jest.setTimeout(90_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(), types: {allFiles: '*/*'}, errorCodes: {}, isErrorWithCode: () => false,
}));
jest.mock('@api/download', () => ({downloadAndShare: jest.fn()}));
let mockOwner = true;
jest.mock('@features/auth/hooks', () => ({
  usePermissions: () => ({can: (p: string) => p !== 'entry.delete' || mockOwner}),
}));
const base = {createdAt: '2026-11-10T10:00:00Z', rowsImported: 3, rowsSkipped: 0, newRetailers: 1, importedBy: 'owner · 98'};
const mockLogs: ImportLogEntry[] = [
  {...base, id: 'new', fileName: 'march.csv', canUndo: true, blockers: [], undoneAt: null},
  {...base, id: 'old', fileName: 'feb.csv', canUndo: false, undoneAt: null, blockers: [
    {reason: 'retailer_edited', retailer: 'Sita Kirana'},
    {reason: 'entry_used', row: 4, retailer: 'Hari Stores', amount: 300, date: '2026-11-08'},
  ]},
  {...base, id: 'gone', fileName: 'jan.csv', canUndo: false, blockers: [], undoneAt: '2026-11-12T09:00:00Z'},
];
const mockUndo = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock('../import.remote', () => ({
  ...jest.requireActual('../import.remote'),
  importRemote: {history: async () => mockLogs, undo: (...a: unknown[]) => mockUndo(...a)},
}));

async function open(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <KhataImportScreen navigation={{} as any} route={{} as any} />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)); });
  return r;
}
const text = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map(n => ([] as unknown[]).concat(n.props.children).join('')).join('\n');
const pressable = (r: ReactTestRenderer, id: string) => r.root.findAll(n => n.props.testID === id && n.props.onPress);

test('the owner can undo an undoable import, sees why another cannot, and when one was undone', async () => {
  mockOwner = true;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const r = await open();
  expect(text(r)).toContain('First sheet only · up to 10,000 rows · 5 MB');      // IM6, before any file
  expect(pressable(r, 'import-undo-new').length).toBeGreaterThan(0);
  expect(pressable(r, 'import-undo-old')).toHaveLength(0);
  const shown = text(r);
  expect(shown).toContain("Can't be undone: work done since depends on it.");
  expect(shown).toContain('Sita Kirana: details changed since the import');
  expect(shown).toContain('Row 4 (Hari Stores, ₹300, 08 Nov 2026) has been used since');
  expect(r.root.findAll(n => n.props.testID === 'import-undone-gone').length).toBeGreaterThan(0);

  await act(async () => { pressable(r, 'import-undo-new')[0].props.onPress(); });
  const [title, , buttons] = alert.mock.calls[0] as [string, string, {text: string; onPress?: () => Promise<void>}[]];
  expect(title).toBe('Undo this import?');
  expect(mockUndo).not.toHaveBeenCalled();                                      // nothing before the confirm
  await act(async () => { await buttons.find(b => b.text === 'Undo import')!.onPress!(); });
  expect(mockUndo).toHaveBeenCalledWith('new');
  alert.mockRestore();
  act(() => r.unmount());
});

test('staff get no Undo', async () => {
  mockOwner = false;
  const r = await open();
  expect(pressable(r, 'import-undo-new')).toHaveLength(0);
  act(() => r.unmount());
});
