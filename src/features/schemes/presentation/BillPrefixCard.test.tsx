/** BL10 in Settings: the owner sees the prefix with the next full number as
 *  the example, and a new prefix is saved for new bills. */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {Alert} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {BillPrefixCard} from './BillPrefixCard';

jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
const mockSet = jest.fn(async (prefix: string) => ({prefix, financialYear: '26-27', nextNumber: `${prefix}-26-27-8`}));
jest.mock('@features/schemes/data/schemes.remote', () => ({
  schemesRemote: {
    billSeries: async () => ({prefix: 'B', financialYear: '26-27', nextNumber: 'B-26-27-8'}),
    setBillPrefix: (p: string) => mockSet(p),
  },
}));

const settle = () => act(async () => { await new Promise(res => setTimeout(res, 0)); });
const node = (r: ReactTestRenderer, id: string, prop: string) =>
  r.root.findAll(n => n.props.testID === id && prop in n.props)[0];
const example = (r: ReactTestRenderer) =>
  r.root.findAll(n => n.props.testID === 'bill-prefix-example')[0].findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children).join('');

test('the prefix shows the next full number and saves for new bills', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient()}><BillPrefixCard /></QueryClientProvider>);
  });
  await settle();
  expect(node(r, 'bill-prefix', 'value').props.value).toBe('B');
  expect(example(r)).toContain('B-26-27-8');
  await act(async () => { node(r, 'bill-prefix', 'onChangeText').props.onChangeText('s-b'); });
  expect(example(r)).toContain('SB-26-27-8');  // letters and digits only, upper case
  await act(async () => { node(r, 'bill-prefix-save', 'onPress').props.onPress(); });
  await settle();
  expect(mockSet).toHaveBeenCalledWith('SB');
  expect(Alert.alert).toHaveBeenCalledWith('Prefix saved', 'Next bill: SB-26-27-8');
  act(() => r.unmount());
});
