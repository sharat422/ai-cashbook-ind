import {useNavigation, useRoute} from '@react-navigation/native';
import React from 'react';
import {View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {getLegalDoc, type LegalKind} from '@features/legal/domain/legalContent';
import {useT} from '@/i18n';

/**
 * Renders the Privacy Policy or Terms (route param `doc`). Uses navigation
 * hooks so the same screen works in both the auth stack (from Login) and the
 * app stack (from Settings).
 */
export function LegalDocScreen(): React.JSX.Element {
  const t = useT();
  const navigation = useNavigation();
  const route = useRoute();
  const kind = ((route.params as {doc?: LegalKind} | undefined)?.doc ??
    'privacy') as LegalKind;
  const doc = getLegalDoc(kind);

  return (
    <Screen>
      <View className="py-8">
        <Text variant="title">{doc.title}</Text>

        <View className="mt-6" style={{gap: 20}}>
          {doc.sections.map(section => (
            <View key={section.heading}>
              <Text className="text-base font-semibold text-slate-900">
                {section.heading}
              </Text>
              <View className="mt-1.5" style={{gap: 8}}>
                {section.body.map((para, i) => (
                  <Text
                    key={i}
                    className="text-sm leading-6 text-slate-700">
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
