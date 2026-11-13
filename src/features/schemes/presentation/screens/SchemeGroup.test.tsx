/** SC2 on the phone: with two or more SKUs picked, the owner can count them
 *  together ("any 10"); the form shows the group and saves scope sku_group. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {SchemeFormScreen} from './SchemeFormScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/items/data/item.remote', () => ({
  itemRemote: {list: async () => ({items: [
    {id: 'a', name: 'Soap A', type: 'product'}, {id: 'b', name: 'Soap B', type: 'product'}], nextCursor: null, total: 2})},
}));
const mockSave = jest.fn();
jest.mock('@features/schemes/presentation/hooks', () => ({
  useSchemeMutations: () => ({save: {mutate: mockSave, isPending: false}, remove: {mutate: jest.fn(), isPending: false}}),
}));

/** Pick an item through the paged catalogue picker. */
const pick = async (r: ReactTestRenderer, id: string) => {
  const press = (tid: string) => r.root.findAll(n => n.props.testID === tid && typeof n.props.onPress === 'function')[0].props.onPress();
  await act(async () => { press('scheme-item-picker'); });
  await act(async () => { await new Promise(res => setTimeout(res, 400)); });  // the search debounce
  await act(async () => { press(`scheme-item-picker-item-${id}`); });
};

test('two SKUs can be counted together and saved as a group scheme', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <SchemeFormScreen navigation={{goBack: jest.fn()} as any} route={{params: {}} as any} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise(res => setTimeout(res, 0)); });
  try {
    const scope = () => r.root.findAll(n => n.props.label === 'How do these SKUs count?' && n.props.onChange);
    await pick(r, 'a');
    expect(scope()).toHaveLength(0);  // one SKU: nothing to group
    await pick(r, 'b');
    await act(async () => { scope()[0].props.onChange(true); });
    const group = r.root.findAll(n => n.props.testID === 'scheme-group' && typeof n.props.children === 'string')[0];
    expect(group.props.children).toContain('Soap A + Soap B');
    const saveBtn = r.root.findAll(n => typeof n.props.onPress === 'function' && n.props.title === 'Save')[0]
      ?? r.root.findAll(n => typeof n.props.onPress === 'function' && /save/i.test(String(n.props.title ?? '')))[0];
    await act(async () => { saveBtn.props.onPress(); });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({input: expect.objectContaining({scope: 'sku_group', itemIds: ['a', 'b']})}),
      expect.anything());
  } finally {
    act(() => r.unmount());
  }
});
