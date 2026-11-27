import {lineItemsNote, toEditableLineItem} from './entities';

it('formats edited line items for the expense notes', () => {
  const items = [
    toEditableLineItem({description: 'Tea', quantity: 2, unit: 'cup', rate: 12.5, amount: 25}),
    toEditableLineItem({description: 'Rice', quantity: null, unit: null, rate: null, amount: 60.75}),
    {description: '  ', quantity: '1', unit: '', rate: '', amount: '1'},
  ];
  expect(lineItemsNote(items)).toBe(
    'Items:\n- Tea · 2 cup × 12.5 = 25\n- Rice = 60.75',
  );
});

it('adds nothing when there are no items', () => {
  expect(lineItemsNote([])).toBe('');
});
