import JailMonkey from 'jail-monkey';

import {logError} from '@/services/diagnostics/errorLog.store';
import {
  __resetDeviceIntegrityLogForTests,
  isDeviceCompromised,
  reportDeviceIntegrity,
} from './deviceIntegrity';

jest.mock('@/services/diagnostics/errorLog.store', () => ({
  logError: jest.fn(),
}));

const mockIsJailBroken = JailMonkey.isJailBroken as jest.Mock;
const mockLogError = logError as jest.Mock;

describe('isDeviceCompromised', () => {
  afterEach(() => mockIsJailBroken.mockReset());

  it('is false on a clean device', () => {
    mockIsJailBroken.mockReturnValue(false);
    expect(isDeviceCompromised()).toBe(false);
  });

  it('is true on a rooted/jailbroken device', () => {
    mockIsJailBroken.mockReturnValue(true);
    expect(isDeviceCompromised()).toBe(true);
  });

  it('fails safe (false) if the native check throws', () => {
    mockIsJailBroken.mockImplementation(() => {
      throw new Error('native error');
    });
    expect(isDeviceCompromised()).toBe(false);
  });
});

describe('reportDeviceIntegrity', () => {
  beforeEach(() => {
    mockLogError.mockReset();
    __resetDeviceIntegrityLogForTests();
  });
  afterEach(() => mockIsJailBroken.mockReset());

  it('logs the occurrence once when compromised, and returns true', () => {
    mockIsJailBroken.mockReturnValue(true);
    expect(reportDeviceIntegrity()).toBe(true);
    // Called again (e.g. banner re-render) — must NOT log twice per session.
    expect(reportDeviceIntegrity()).toBe(true);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    expect(mockLogError.mock.calls[0][0]).toBe('security/device-integrity');
  });

  it('does not log on a clean device', () => {
    mockIsJailBroken.mockReturnValue(false);
    expect(reportDeviceIntegrity()).toBe(false);
    expect(mockLogError).not.toHaveBeenCalled();
  });
});
