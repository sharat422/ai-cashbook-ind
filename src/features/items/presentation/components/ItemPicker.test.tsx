/** BL9: the item picker searches the server as you type and loads 50 more as
 *  you scroll — no request ever asks for the whole catalogue. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {ItemPicker} from './ItemPicker';

jest.setTimeout(60_000);
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@/shared/hooks/useDebouncedValue', () => ({useDebouncedValue: <T,>(v: T) => v}));

type Opts = {limit?: number; offset?: number; type?: string};
/** 300 products: "Atta 000"…"Atta 251", then "Lux Soap 00"…"Lux Soap 47". */
const ALL = [...Array.from({length: 252}, (_, i) => `Atta ${String(i).padStart(3, '0')}`),
  ...Array.from({length: 48}, (_, i) => `Lux Soap ${String(i).padStart(2, '0')}`)]
  .map((name, i) => ({id: `i${i}`, name, type: 'product', salePrice: 10}));
const mockList = jest.fn(async (q: string, {limit = 50, offset = 0}: Opts = {}) => {
  const hits = ALL.filter(i => i.name.toLowerCase().includes(q.toLowerCase()));
  const next = offset + limit < hits.length ? String(offset + limit) : null;
  return {items: hits.slice(offset, offset + limit), nextCursor: next, total: hits.length};
});
jest.mock('@features/items/data/item.remote', () => ({
  itemRemote: {list: (q: string, o: Opts) => mockList(q, o)},
}));

const settle = () => act(async () => { await new Promise(res => setTimeout(res, 0)); });
const byId = (r: ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && (n.props.onPress || n.props.onEndReached || n.props.onChangeText))[0];
/** What the list holds (loaded pages), not just the rows on screen. */
const loaded = (r: ReactTestRenderer): {id: string; name: string}[] => byId(r, 'p-list').props.data;
const shown = (r: ReactTestRenderer) => loaded(r).length;

async function open(onPick = jest.fn()): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <ItemPicker testID="p" label="Add item" placeholder="Pick" onPick={onPick} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { byId(r, 'p').props.onPress(); });
  await settle();
  return r;
}

beforeEach(() => mockList.mockClear());

test('scrolling loads the next 50, and no request asks for the whole catalogue', async () => {
  const r = await open();
  expect(mockList).toHaveBeenLastCalledWith('', {limit: 50, offset: 0, type: 'product'});
  expect(shown(r)).toBe(50);
  await act(async () => { byId(r, 'p-list').props.onEndReached(); });
  await settle();
  expect(mockList).toHaveBeenLastCalledWith('', {limit: 50, offset: 50, type: 'product'});
  expect(shown(r)).toBe(100);
  await act(async () => { byId(r, 'p-list').props.onEndReached(); });
  await settle();
  expect(shown(r)).toBe(150);  // past the old 100 stop
  for (const [, opts] of mockList.mock.calls) expect((opts as Opts).limit).toBe(50);
  act(() => r.unmount());
});

test('typing searches the server and finds items beyond the first 100', async () => {
  const onPick = jest.fn();
  const r = await open(onPick);
  await act(async () => { byId(r, 'p-search').props.onChangeText('soap'); });
  await settle();
  expect(mockList).toHaveBeenLastCalledWith('soap', {limit: 50, offset: 0, type: 'product'});
  expect(shown(r)).toBe(48);
  const last = loaded(r).at(-1)!;  // the very last item in the catalogue
  expect(last.id).toBe('i299');
  await act(async () => { byId(r, 'p-list').props.renderItem({item: last}).props.onPress(); });
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({name: 'Lux Soap 47'}));
  act(() => r.unmount());
});
