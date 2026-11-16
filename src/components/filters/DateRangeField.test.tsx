/**
 * From / To (Reports, Khata, statements, history filter, accountant activity):
 * a To date before the From date is refused with an error.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {DateField} from '@components/form/DateField';
import {DateRangeField} from './DateRangeField';

test('a To date before the From date shows an error and keeps the range', async () => {
  const onChange = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<DateRangeField from="2026-11-10" to={null} onChange={onChange} />);
  });
  const [fromField, toField] = r.root.findAllByType(DateField);

  await act(async () => toField.props.onChange('2026-10-05'));
  expect(onChange).not.toHaveBeenCalled();
  expect(r.root.findByProps({testID: 'date-range-error'}).props.children).toBe(
    "The end date can't be before the start date.");
  expect(r.root.findAllByType(DateField)[1].props.error).toBeTruthy();

  await act(async () => toField.props.onChange('2026-11-10')); // same day is fine
  expect(onChange).toHaveBeenLastCalledWith({from: '2026-11-10', to: '2026-11-10'});
  expect(r.root.findAllByProps({testID: 'date-range-error'})).toHaveLength(0);

  // From moved after an existing To is refused too.
  await act(async () => r.update(<DateRangeField from="2026-10-01" to="2026-10-31" onChange={onChange} />));
  onChange.mockClear();
  await act(async () => fromField.props.onChange('2026-11-01'));
  expect(onChange).not.toHaveBeenCalled();
  expect(r.root.findAllByProps({testID: 'date-range-error'}).length).toBeGreaterThan(0);
  act(() => r.unmount());
});
