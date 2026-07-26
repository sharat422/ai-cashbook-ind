/**
 * Auth status state machine — the derived `status()` that RootNavigator uses to
 * choose the Auth / Onboarding / App stack.
 *
 * We force `bypassAuth: false` here to exercise the real token/business logic
 * (the live build may toggle the temporary bypass on).
 */

jest.mock('@config/constants', () => ({
  APP_CONFIG: {bypassAuth: false},
}));

import {useAuthStore} from '@store/auth.store';

const user = {id: 'u1', mobile: '9999999999'} as any;
const business = {
  id: 'b1',
  businessName: 'Test Traders',
  ownerName: 'Owner',
  businessType: 'Retail',
  state: 'Karnataka',
  gstRegistered: false,
} as any;

beforeEach(() => {
  useAuthStore.setState({token: null, user: null, business: null});
});

describe('auth status()', () => {
  it('is unauthenticated with no token', () => {
    expect(useAuthStore.getState().status()).toBe('unauthenticated');
  });

  it('is pending-business after login but before onboarding', () => {
    useAuthStore.getState().setSession({token: 't', user});
    expect(useAuthStore.getState().status()).toBe('pending-business');
  });

  it('is authenticated once a business exists', () => {
    useAuthStore.getState().setSession({token: 't', user});
    useAuthStore.getState().setBusiness(business);
    expect(useAuthStore.getState().status()).toBe('authenticated');
  });

  it('returns to unauthenticated after logout', () => {
    useAuthStore.getState().setSession({token: 't', user});
    useAuthStore.getState().setBusiness(business);
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().status()).toBe('unauthenticated');
  });
});
