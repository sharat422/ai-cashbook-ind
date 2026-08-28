import {Platform} from 'react-native';
import SmsAndroid from 'react-native-get-sms-android';

import {
  isSmsScanSupported,
  requestSmsPermission,
  scanBankSms,
} from './smsReader';

const mockList = SmsAndroid.list as jest.Mock;

describe('smsReader on iOS (default jest platform)', () => {
  it('reports scanning unsupported', () => {
    expect(Platform.OS).toBe('ios');
    expect(isSmsScanSupported()).toBe(false);
  });

  it('requestSmsPermission resolves "unsupported"', async () => {
    await expect(requestSmsPermission()).resolves.toBe('unsupported');
  });

  it('scanBankSms returns an empty result without touching the native module', async () => {
    const res = await scanBankSms();
    expect(res).toEqual({parsed: [], scanned: 0});
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe('smsReader on Android', () => {
  const original = Platform.OS;
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', {value: original, configurable: true});
  });
  beforeEach(() => mockList.mockReset());

  it('reads the inbox and keeps only recognisable bank transactions', async () => {
    const inbox = [
      {address: 'HDFCBK', body: 'Rs.2500.00 debited from a/c XX1234 on 05-08-26 to VPA x@y. -HDFC Bank', date: 1},
      {address: 'FRIEND', body: 'are we meeting today?', date: 2},
      {address: 'KOTAK', body: 'Received Rs.1500.00 in your Kotak Bank AC X5 from PRIYA on 05-08-26', date: 3},
    ];
    mockList.mockImplementation((_filter, _fail, success) =>
      success(inbox.length, JSON.stringify(inbox)),
    );

    const res = await scanBankSms({maxCount: 50});
    expect(res.scanned).toBe(3);
    expect(res.parsed).toHaveLength(2); // the chatty SMS is dropped
    expect(res.parsed[0].direction).toBe('debit');
    expect(res.parsed[1].direction).toBe('credit');
  });

  it('rejects when the native module reports a failure', async () => {
    mockList.mockImplementation((_filter, fail) => fail('permission denied'));
    await expect(scanBankSms()).rejects.toThrow('permission denied');
  });
});
