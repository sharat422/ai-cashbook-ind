import {NavigationContainer} from '@react-navigation/native';
import React, {useEffect, useState} from 'react';

import {APP_CONFIG} from '@config/constants';
import {useSyncBusiness} from '@features/auth/hooks';
import {SplashScreen} from '@features/auth/screens/SplashScreen';
import {WelcomeScreen} from '@features/onboarding/presentation/screens/WelcomeScreen';
import {useOnboardingStore} from '@features/onboarding/store/onboarding.store';
import {RestoreScreen} from '@features/restore/presentation/screens/RestoreScreen';
import {useRestoreStore} from '@features/restore/store/restore.store';
import {useAuthStatus, useAuthStore, useIsHydrated} from '@store/auth.store';
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
  const businessId = useAuthStore(s => s.business?.id ?? null);
  const restoreHydrated = useRestoreStore(s => s.hydrated);
  // Subscribe to this business's decision so completing restore re-renders us.
  const restoreDecision = useRestoreStore(s =>
    businessId ? s.decided[businessId] : 'skipped',
  );
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

  // Wait for all persisted stores so returning users don't flash the welcome
  // or miss the restore offer.
  if (!hydrated || !onboardingHydrated || !restoreHydrated || !minTimeElapsed) {
    return <SplashScreen />;
  }

  // First-time, signed-out users see the welcome carousel once, before Login.
  if (status === 'unauthenticated' && !seenOnboarding) {
    return <WelcomeScreen onDone={markOnboardingSeen} />;
  }

  // Returning user on a fresh device: offer an explicit restore once per account
  // before landing on the app. RestoreScreen records the decision (which flips
  // restoreDecision here), so this renders exactly once per business per device.
  if (
    status === 'authenticated' &&
    businessId &&
    restoreDecision === undefined
  ) {
    return <RestoreScreen onDone={() => undefined} />;
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
