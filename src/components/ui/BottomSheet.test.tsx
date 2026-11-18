/**
 * Customer → Limit opened a dimmed blank screen on iPhone: the sheet opens with
 * the keyboard up and sat behind it. Sheets now move up with the keyboard.
 */
import React from 'react';
import {KeyboardAvoidingView, TextInput} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {CreditLimitSheet} from '@features/customer-intel/presentation/components/CreditLimitSheet';

jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

test('the credit-limit sheet sits inside a keyboard-avoiding view (iOS)', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<CreditLimitSheet visible customerName="Bharath" onClose={jest.fn()} onSave={jest.fn()} onRemove={jest.fn()} />);
  });
  const lift = r.root.findByType(KeyboardAvoidingView);
  expect(lift.props.behavior).toBe('padding');
  expect(lift.findAllByType(TextInput)).toHaveLength(1); // the limit amount, autofocused
  act(() => r.unmount());
});
