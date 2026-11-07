import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {
  APP_LANGUAGE_LABEL,
  PRIMARY_APP_LANGUAGES,
} from '@features/auth/utils/languagePreference';
import {useT} from '@/i18n';
import {useAuthStore} from '@store/auth.store';

/**
 * Telugu / Hinglish / English, one tap each — on the login screen so the very
 * first screen a new user sees can be switched. Other languages are in Settings.
 */
export function LanguageToggle(): React.JSX.Element {
  const t = useT();
  const language = useAuthStore(s => s.preferredLanguage);
  const setLanguage = useAuthStore(s => s.setPreferredLanguage);
  return (
    <View className="mb-5">
      <Text variant="caption" className="mb-2">
        {t('auth.languagePick')}
      </Text>
      <View className="flex-row" style={{gap: 8}}>
        {PRIMARY_APP_LANGUAGES.map(l => {
          const selected = l === language;
          return (
            <Pressable
              key={l}
              testID={`lang-${l}`}
              accessibilityRole="button"
              accessibilityState={{selected}}
              onPress={() => setLanguage(l)}
              className={`h-11 flex-1 items-center justify-center rounded-xl border ${
                selected ? 'border-primary bg-primary' : 'border-border bg-white'
              }`}>
              <Text className={`text-sm font-semibold ${selected ? 'text-white' : 'text-slate-800'}`}>
                {APP_LANGUAGE_LABEL[l]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
