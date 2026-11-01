import React from 'react';
import {readFileSync} from 'fs';
import {join} from 'path';
import {act, create} from 'react-test-renderer';

import {RootNavigator} from './RootNavigator';

/** Ask AI (and every account screen) must be unreachable without a login. */

let mockStatus = 'unauthenticated';
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('@config/constants', () => ({APP_CONFIG: {splashDurationMs: 0}}));
jest.mock('@features/auth/hooks', () => ({useSyncBusiness: () => undefined}));
jest.mock('@store/sessionReset', () => ({useSessionDataReset: () => undefined}));
jest.mock('@store/auth.store', () => ({
  useIsHydrated: () => true,
  useAuthStatus: () => mockStatus,
  useAuthStore: (select: (s: unknown) => unknown) => select({business: {id: 'b1'}}),
}));
jest.mock('@features/onboarding/store/onboarding.store', () => ({
  useOnboardingStore: (select: (s: unknown) => unknown) =>
    select({hydrated: true, seen: true, markSeen: () => undefined}),
}));
jest.mock('@features/restore/store/restore.store', () => ({
  useRestoreStore: (select: (s: unknown) => unknown) =>
    select({hydrated: true, decided: {b1: 'done'}}),
}));
jest.mock('@features/auth/screens/SplashScreen', () => ({SplashScreen: () => 'Splash'}));
jest.mock('@features/onboarding/presentation/screens/WelcomeScreen', () => ({WelcomeScreen: () => 'Welcome'}));
jest.mock('@features/restore/presentation/screens/RestoreScreen', () => ({RestoreScreen: () => 'Restore'}));
jest.mock('./AppNavigator', () => ({AppNavigator: () => 'AppNavigator'}));
jest.mock('./AuthNavigator', () => ({AuthNavigator: () => 'AuthNavigator'}));
jest.mock('./OnboardingNavigator', () => ({OnboardingNavigator: () => 'OnboardingNavigator'}));

const rendered = (status: string) => {
  mockStatus = status;
  jest.useFakeTimers();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<RootNavigator />);
  });
  act(() => {
    jest.runAllTimers(); // splash delay
  });
  jest.useRealTimers();
  return tree.toJSON();
};

it.each([
  ['unauthenticated', 'AuthNavigator'],
  ['pending-business', 'OnboardingNavigator'],
  ['authenticated', 'AppNavigator'],
])('%s -> %s', (status, stack) => {
  expect(rendered(status)).toBe(stack);
});

it('registers Ask AI only in the logged-in stack', () => {
  const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');
  expect(src('AppNavigator.tsx')).toMatch(/name="Assistant"/);
  expect(src('AuthNavigator.tsx')).not.toMatch(/Assistant/);
  expect(src('OnboardingNavigator.tsx')).not.toMatch(/Assistant/);
});
