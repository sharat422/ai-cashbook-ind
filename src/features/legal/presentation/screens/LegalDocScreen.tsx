import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useState} from 'react';
import {View} from 'react-native';

import {Button, Screen, Select, Text} from '@components/ui';
import {
  availableLegalLanguages,
  getLegalDoc,
  type LegalKind,
} from '@features/legal/domain/legalContent';
import {
  APP_LANGUAGE_LABEL,
  appLanguageByLabel,
  type AppLanguage,
} from '@features/auth/utils/languagePreference';
import {useAuthStore} from '@store/auth.store';
import {useT} from '@/i18n';

/**
 * Renders the Privacy Policy or Terms (route param `doc`). Uses navigation
 * hooks so the same screen works in the auth stack (from Login) and the app
 * stack (from Settings). Shows a language selector once professional
 * translations are registered (see legalContent.ts); defaults to the user's
 * app language when a translation exists, else English.
 */
export function LegalDocScreen(): React.JSX.Element {
  const t = useT();
  const navigation = useNavigation();
  const route = useRoute();
  const kind = ((route.params as {doc?: LegalKind} | undefined)?.doc ??
    'privacy') as LegalKind;

  const preferred = useAuthStore(s => s.preferredLanguage);
  const languages = availableLegalLanguages();
  const [lang, setLang] = useState<AppLanguage>(
    languages.includes(preferred) ? preferred : 'en',
  );
  const doc = getLegalDoc(kind, lang);

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{doc.title}</Text>

        {/* Language selector — appears once >1 language is available. */}
        {languages.length > 1 ? (
          <View className="mt-4">
            <Select<string>
              label={t('legal.language')}
              options={languages.map(l => APP_LANGUAGE_LABEL[l])}
              value={APP_LANGUAGE_LABEL[lang]}
              onSelect={label => setLang(appLanguageByLabel(label))}
            />
          </View>
        ) : null}

        <View className="mt-6" style={{gap: 20}}>
          {doc.sections.map(section => (
            <View key={section.heading}>
              <Text className="text-base font-semibold text-slate-900">
                {section.heading}
              </Text>
              <View className="mt-1.5" style={{gap: 8}}>
                {section.body.map((para, i) => (
                  <Text key={i} className="text-sm leading-6 text-slate-700">
                    {para}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>

        <Button
          title={t('common.done')}
          variant="ghost"
          className="mt-8"
          onPress={() => navigation.goBack()}
        />
      </View>
    </Screen>
  );
}
