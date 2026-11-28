/**
 * Vans: the owner names each van and who drives it (Settings → Vans); the Stock
 * screen's van line shows the van's name, never a phone number, and the stock
 * figures are the same as before (still the driver's).
 */
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {useAuthStore} from '@store/auth.store';
import {StockScreen} from './StockScreen';
import {VansScreen} from './VansScreen';

jest.setTimeout(60_000);
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));
jest.mock('@components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', writeFile: jest.fn()}));
jest.mock('react-native-share', () => ({default: {open: jest.fn()}}));

const mockAdd = jest.fn();
const mockEdit = jest.fn();
let mockVans: object[] = [];
jest.mock('@features/stock/data/stock.remote', () => ({
  stockRemote: {
    vans: async () => mockVans,
    addVan: (...a: unknown[]) => mockAdd(...a),
    editVan: (...a: unknown[]) => mockEdit(...a),
    suppliers: async () => [],
    levels: async () => ({
      items: [{id: 'soap', name: 'Soap', unit: 'box', godown: '30.000', vans: {sheeran: '20.000'}, total: '50.000',
        low: false, purchasePrice: 0, salePrice: 0, lowStockThreshold: null}],
      vans: [{vanId: 'v1', userId: 'sheeran', name: 'Van 1', registration: 'KA 01 AB 1234', staffName: 'Sheeran'}],
    }),
  },
}));
jest.mock('@features/team/presentation/hooks', () => ({
  useTeam: () => ({data: [
    {userId: 'sheeran', name: 'Sheeran', mobile: '9876500001', role: 'staff', status: 'active'},
    {userId: 'ca', name: 'CA', mobile: '9876500002', role: 'accountant', status: 'active'},
  ]}),
}));

async function mount(el: React.ReactElement) {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Gupta Traders', role: 'owner'} as never});
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>{el}</QueryClientProvider>);
  });
  await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  return r;
}
/** Every piece of text on screen (the Stock list's props are circular, so not toJSON). */
const text = (r: ReactTestRenderer) => r.root.findAll(n => (n.type as unknown) === 'Text')
  .map(n => ([] as unknown[]).concat(n.props.children).filter(c => typeof c === 'string' || typeof c === 'number').join(''))
  .join(' | ');
const press = async (r: ReactTestRenderer, match: (p: Record<string, unknown>) => boolean) => {
  await act(async () => { (r.root.findAll(n => match(n.props) && n.props.onPress)[0].props.onPress as () => void)(); });
};

test('the Stock screen shows "Van 1" in the van line, no phone number, same quantities', async () => {
  const r = await mount(<StockScreen navigation={{navigate: jest.fn()} as never} route={{} as never} />);
  expect(text(r)).toContain('🚚 Van 1: 20');
  expect(text(r)).not.toMatch(/\+91|98765/);
  act(() => r.unmount());
});

test('the owner adds "Van 1" driven by Sheeran; an accountant can’t drive', async () => {
  mockVans = [];
  mockAdd.mockReset().mockResolvedValue({});
  const r = await mount(<VansScreen />);
  expect(text(r)).toContain('No vans yet');
  await press(r, p => p.testID === 'van-add');
  expect(r.root.findAll(n => n.props.label === 'CA' && n.props.onPress)).toHaveLength(0);
  await act(async () => r.root.findAll(n => n.props.testID === 'van-name' && n.props.onChangeText)[0].props.onChangeText('Van 1'));
  await act(async () => r.root.findAll(n => n.props.testID === 'van-registration' && n.props.onChangeText)[0]
    .props.onChangeText('ka 01 ab 1234'));
  await press(r, p => p.label === 'Sheeran');
  await press(r, p => p.testID === 'van-save');
  expect(mockAdd).toHaveBeenCalledWith({name: 'Van 1', registration: 'ka 01 ab 1234', userId: 'sheeran'});
  act(() => r.unmount());
});

test('a van in the list opens to edit it', async () => {
  mockVans = [{vanId: 'v1', userId: 'sheeran', name: 'Van 1', registration: null, staffName: 'Sheeran'}];
  mockEdit.mockReset().mockResolvedValue({});
  const r = await mount(<VansScreen />);
  expect(text(r)).toContain('Driven by Sheeran');
  await press(r, p => p.testID === 'van-v1');
  await act(async () => r.root.findAll(n => n.props.testID === 'van-name' && n.props.onChangeText)[0].props.onChangeText('Van A'));
  await press(r, p => p.testID === 'van-save');
  expect(mockEdit).toHaveBeenCalledWith('v1', {name: 'Van A', registration: '', userId: 'sheeran'});
  act(() => r.unmount());
});
