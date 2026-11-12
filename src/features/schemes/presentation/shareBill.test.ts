import Share from 'react-native-share';

import {ApiError} from '@api/client';
import {schemesRemote} from '@features/schemes/data/schemes.remote';
import {shareBillOnWhatsApp} from './shareBill';

jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp', downloadFile: jest.fn(), unlink: jest.fn()}));
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {open: jest.fn(), shareSingle: jest.fn()},
  Social: {Whatsapp: 'whatsapp'},
}));

const bill = {id: 'b1', billNumber: 'B-7'};

afterEach(() => jest.clearAllMocks());

test('no consent: the server refuses the PDF and nothing is shared, not even via the share sheet', async () => {
  jest.spyOn(schemesRemote, 'billPdf').mockRejectedValue(new ApiError(409, 'no consent'));
  await expect(shareBillOnWhatsApp(bill, {mobile: '9876543210'})).resolves.toBe(false);
  expect(Share.shareSingle).not.toHaveBeenCalled();
  expect(Share.open).not.toHaveBeenCalled();
});

test('with consent, the server PDF is attached in WhatsApp to the retailer', async () => {
  jest.spyOn(schemesRemote, 'billPdf').mockResolvedValue('/tmp/Bill_B-7.pdf');
  await expect(shareBillOnWhatsApp(bill, {mobile: '98765 43210'})).resolves.toBe(true);
  expect(schemesRemote.billPdf).toHaveBeenCalledWith('b1', 'B-7');
  expect(Share.shareSingle).toHaveBeenCalledWith(expect.objectContaining({
    social: 'whatsapp', url: 'file:///tmp/Bill_B-7.pdf', type: 'application/pdf', whatsAppNumber: '919876543210',
  }));
  expect(Share.open).not.toHaveBeenCalled();
});
