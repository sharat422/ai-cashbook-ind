import {NavigationContainer} from '@react-navigation/native';
import React, {useEffect, useState} from 'react';

import {APP_CONFIG} from '@config/constants';
import {useSyncBusiness} from '@features/auth/hooks';
import {SplashScreen} from '@features/auth/screens/SplashScreen';
import {WelcomeScreen} from '@features/onboarding/presentation/screens/WelcomeScreen';
import {useOnboardingStore} from '@features/onboarding/store/onboarding.store';
import {useAuthStatus, useIsHydrated} from '@store/auth.store';
import {useSessionDataReset} from '@store/sessionReset';
import {AppNavigator} from './AppNavigator';
import {AuthNavigator} from './AuthNavigator';
import {OnboardingNavigator} from './OnboardingNavigator';

/**
 * Top-level router. Chooses which stack to render from the persisted auth
 * status, and holds the Splash until the store has rehydrated AND a minimum
 * branding delay has elapsed.
 *
 *   Splash → (no token) Auth        : Login → OTP
 *          → (token, no biz) Onboard: Create Business
 *          → (token + biz) App      : Dashboard
 */
export function RootNavigator(): React.JSX.Element {
  const hydrated = useIsHydrated();
  const status = useAuthStatus();
  const onboardingHydrated = useOnboardingStore(s => s.hydrated);
  const seenOnboarding = useOnboardingStore(s => s.seen);
  const markOnboardingSeen = useOnboardingStore(s => s.markSeen);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  // Reconcile the business for a returning user (token but no cached business).
  useSyncBusiness();
  // Wipe the previous business's local data on logout / account switch.
  useSessionDataReset();

  useEffect(() => {
    const timer = setTimeout(
      () => setMinTimeElapsed(true),
      APP_CONFIG.splashDurationMs,
    );
    return () => clearTimeout(timer);
  }, []);

  // Wait for both persisted stores so returning users don't flash the welcome.
  if (!hydrated || !onboardingHydrated || !minTimeElapsed) {
    return <SplashScreen />;
  }

  // First-time, signed-out users see the welcome carousel once, before Login.
  if (status === 'unauthenticated' && !seenOnboarding) {
    return <WelcomeScreen onDone={markOnboardingSeen} />;
  }

  return (
    <NavigationContainer>
      {status === 'unauthenticated' ? (
        <AuthNavigator />
      ) : status === 'pending-business' ? (
        <OnboardingNavigator />
      ) : (
        <AppNavigator />
      )}
    </NavigationContainer>
  );
}
