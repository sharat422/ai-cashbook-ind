import JailMonkey from 'jail-monkey';

import {isDeviceCompromised} from './deviceIntegrity';

const mockIsJailBroken = JailMonkey.isJailBroken as jest.Mock;

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
