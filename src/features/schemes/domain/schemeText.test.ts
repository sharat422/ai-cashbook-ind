import type {Scheme} from '@features/schemes/data/schemes.remote';
import {describeScheme, schemeStatus} from './schemeText';

const base: Scheme = {
  id: 's', name: 'S', type: 'buy_get', itemIds: ['a'], validFrom: '2026-11-01', validTo: '2026-11-30',
  priority: 1, active: true, buyQty: '10.000', freeQty: '1.000', freeItemId: null, minQty: null,
  percent: null, slabs: null,
};
const name = (id: string) => ({g: 'Sachet'})[id] ?? id;

test('schemes read the way the owner set them up', () => {
  expect(describeScheme(base, name)).toBe('Buy 10, get 1 free');
  expect(describeScheme({...base, type: 'free_goods', minQty: '24.000', freeItemId: 'g'}, name)).toBe(
    'Every 24 bought: 1 Sachet free',
  );
  expect(describeScheme({...base, type: 'percent', percent: '5.50', minQty: '12.000'}, name)).toBe(
    '5.5% off from 12 units',
  );
  expect(describeScheme({...base, type: 'slab', slabs: [['10', '2'], ['50', '4.5']]}, name)).toBe(
    '10+ → 2% off, 50+ → 4.5% off',
  );
});

test('a scheme is running only inside its dates, both inclusive', () => {
  expect(schemeStatus(base, '2026-11-30')).toBe('live');
  expect(schemeStatus(base, '2026-12-01')).toBe('expired');
  expect(schemeStatus(base, '2026-10-31')).toBe('upcoming');
  expect(schemeStatus({...base, active: false}, '2026-11-15')).toBe('off');
});
