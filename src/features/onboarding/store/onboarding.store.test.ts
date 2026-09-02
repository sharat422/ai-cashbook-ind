import {useOnboardingStore} from './onboarding.store';

beforeEach(() => useOnboardingStore.setState({seen: false, hydrated: true}));

describe('onboarding store', () => {
  it('starts unseen so the welcome shows for a first-time user', () => {
    expect(useOnboardingStore.getState().seen).toBe(false);
  });

  it('markSeen() flips the flag so the welcome never shows again', () => {
    useOnboardingStore.getState().markSeen();
    expect(useOnboardingStore.getState().seen).toBe(true);
  });
});
