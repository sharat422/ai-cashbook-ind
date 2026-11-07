import React from 'react';
import {View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import type {Permission} from '@features/auth/rbac';
import {useT} from '@/i18n';

/**
 * Wrap a screen that writes (adds, edits, settings, team) so a role without
 * the permission — e.g. the read-only accountant — gets a "read-only" page
 * however they reach it. The server refuses the write anyway; this keeps the
 * UI honest.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wraps screens of every param shape
type AnyScreen = React.ComponentType<any>;

export function withPermission(Component: AnyScreen, permission: Permission): AnyScreen {
  function Guarded(props: {navigation: {goBack: () => void}}): React.JSX.Element {
    const t = useT();
    const {can} = usePermissions();
    if (can(permission)) return <Component {...props} />;
    return (
      <Screen>
        <View testID="read-only-screen" className="py-10">
          <Text variant="title">{t('access.readOnlyTitle')}</Text>
          <Text variant="subtitle" className="mt-2">{t('access.readOnlyMsg')}</Text>
          <Button title={t('common.back')} variant="secondary" className="mt-6" onPress={() => props.navigation.goBack()} />
        </View>
      </Screen>
    );
  }
  Guarded.displayName = `withPermission(${Component.displayName ?? Component.name})`;
  return Guarded;
}
