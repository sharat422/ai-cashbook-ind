/**
 * Settings is one group per feature area, each listing only what the person
 * may open; a group with nothing to show has no heading. Every screen has a
 * "<" back button when there is a screen to go back to.
 */
import React from 'react';
import {Text} from 'react-native';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';

import {BackButton, BackContext} from '@components/ui';
import {useAuthStore} from '@store/auth.store';
import {SettingsScreen} from './SettingsScreen';

// A card stand-in: plain text, found like any other label.
const stub = (label: string) => require('react').createElement(require('react-native').Text, null, label);
jest.setTimeout(60_000); // the first test also loads the screen's modules
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('react-native-image-picker', () => ({launchCamera: jest.fn(), launchImageLibrary: jest.fn()}));
jest.mock('@features/auth/components/BusinessSwitcher', () => ({BusinessSwitcher: () => null}));
jest.mock('@features/team/presentation/JoinInviteCard', () => ({JoinInviteCard: () => null}));
jest.mock('@features/schemes/presentation/BillPrefixCard', () => ({BillPrefixCard: () => stub('bill-prefix-card')}));
jest.mock('@features/customers/presentation/components/StatementLanguageSetting', () => ({
  StatementLanguageSetting: () => stub('statement-language-card'),
}));
jest.mock('@features/security/store/appLock.store', () => ({
  PIN_LENGTH: 4,
  getSupportedBiometry: () => Promise.resolve(null),
  useAppLockStore: (pick: (s: object) => unknown) => pick({enabled: false, biometricEnabled: false}),
}));

const texts = (r: ReactTestRenderer) =>
  r.root.findAll(n => n.type === Text).map(n => [n.props.children].flat().join(''));

async function render(role: string): Promise<{r: ReactTestRenderer; navigate: jest.Mock}> {
  useAuthStore.setState({business: {id: 'b1', businessName: 'Shop', role} as any});
  const navigate = jest.fn();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<SettingsScreen navigation={{navigate} as any} route={{} as any} />);
  });
  return {r, navigate};
}

test('the owner sees every group; a row opens its screen', async () => {
  const {r, navigate} = await render('owner');
  const shown = texts(r);
  for (const heading of ['Team & beats', 'Collections, bank & cash', 'Stock, items & schemes',
    'Customers & statements', 'GST', 'Your data', 'Business & account', 'Help & support']) {
    expect(shown).toContain(heading);
  }
  expect(shown).toContain('bill-prefix-card'); // the setting cards sit in their group
  await act(async () => { r.root.findByProps({testID: 'settings-sync'}).props.onPress(); });
  expect(navigate).toHaveBeenCalledWith('SyncStatus');
  act(() => r.unmount());
});

test('staff see no owner-only group or row', async () => {
  const {r} = await render('staff');
  const shown = texts(r);
  expect(shown).not.toContain('Team & beats');
  expect(shown).not.toContain('Customers & statements');
  expect(shown).not.toContain('🏷️ Item catalog');
  expect(shown).not.toContain('bill-prefix-card');
  expect(shown).toContain('Your data'); // their own data and sync stay
  act(() => r.unmount());
});

test('"<" shows only when there is a screen to go back to, and goes back', async () => {
  const goBack = jest.fn();
  const at = (canGoBack: boolean) => create(
    <BackContext.Provider value={{canGoBack: () => canGoBack, goBack}}>
      <BackButton />
    </BackContext.Provider>,
  );
  let home!: ReactTestRenderer;
  let inner!: ReactTestRenderer;
  await act(async () => { home = at(false); inner = at(true); });
  expect(home.toJSON()).toBeNull();                 // the home screen: nothing to go back to
  const button = inner.root.findByProps({testID: 'back-button'});
  expect(button.props.accessibilityLabel).toBe('Back');
  await act(async () => { button.props.onPress(); });
  expect(goBack).toHaveBeenCalled();
  let outside!: ReactTestRenderer;
  await act(async () => { outside = create(<BackButton />); }); // outside navigation (tests, Welcome)
  expect(outside.toJSON()).toBeNull();
});
