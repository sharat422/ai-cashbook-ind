import {Alert, Linking} from 'react-native';

import {ApiError} from '@api/client';
import {statementsRemote} from '@features/customers/data/statements.remote';
import type {Customer} from '@features/customers/domain/entities';
import {shareStatementOnWhatsApp} from './exportStatement';

jest.mock('react-native-html-to-pdf', () => ({default: {convert: jest.fn()}}));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', writeFile: jest.fn(), downloadFile: jest.fn()}));
jest.mock('react-native-share', () => ({default: {open: jest.fn()}}));

const customer = {id: 'c1', fullName: 'Ganesh Traders', mobile: '9876543210'} as Customer;

afterEach(() => jest.restoreAllMocks());

test('no WhatsApp opens when the server refuses for lack of opt-in', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(statementsRemote, 'whatsapp').mockRejectedValue(new ApiError(409, 'no consent'));
  await expect(shareStatementOnWhatsApp(customer)).resolves.toBe(false);
  expect(open).not.toHaveBeenCalled();
});

test('with opt-in, WhatsApp opens with the server’s message and link', async () => {
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(statementsRemote, 'whatsapp').mockResolvedValue({
    status: 'ready', url: 'https://x/s/tok', message: 'Statement: https://x/s/tok', mobile: '9876543210',
  });
  await expect(shareStatementOnWhatsApp(customer, '2026-11-01')).resolves.toBe(true);
  expect(statementsRemote.whatsapp).toHaveBeenCalledWith('c1', '2026-11-01', 'phone', false);
  expect(open).toHaveBeenCalledWith(
    `whatsapp://send?phone=919876543210&text=${encodeURIComponent('Statement: https://x/s/tok')}`,
  );
});
