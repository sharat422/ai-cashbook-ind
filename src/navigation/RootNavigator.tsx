import {NavigationContainer} from '@react-navigation/native';
import React, {useEffect, useState} from 'react';

import {APP_CONFIG} from '@config/constants';
import {SplashScreen} from '@features/auth/screens/SplashScreen';
import {useAuthStatus, useIsHydrated} from '@store/auth.store';
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
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setMinTimeElapsed(true),
      APP_CONFIG.splashDurationMs,
    );
    return () => clearTimeout(timer);
  }, []);

  if (!hydrated || !minTimeElapsed) {
    return <SplashScreen />;
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
