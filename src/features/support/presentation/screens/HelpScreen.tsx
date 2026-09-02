import React, {useState} from 'react';
import {Linking, Pressable, ScrollView, View} from 'react-native';

import {Button, Screen, Text} from '@components/ui';
import {SUPPORT} from '@config/constants';
import {useT} from '@/i18n';
import type {TKey} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

interface Faq {
  q: TKey;
  a: TKey;
}

const FAQS: Faq[] = [
  {q: 'help.q1', a: 'help.a1'},
  {q: 'help.q2', a: 'help.a2'},
  {q: 'help.q3', a: 'help.a3'},
  {q: 'help.q4', a: 'help.a4'},
  {q: 'help.q5', a: 'help.a5'},
];

export function HelpScreen({
  navigation,
}: AppScreenProps<'Help'>): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState<number | null>(0);

  const onWhatsApp = () => {
    const text = encodeURIComponent(t('help.waPrefill'));
    const wa = `whatsapp://send?phone=${SUPPORT.whatsapp}&text=${text}`;
    Linking.openURL(wa).catch(() =>
      Linking.openURL(`https://wa.me/${SUPPORT.whatsapp}?text=${text}`).catch(
        () => {},
      ),
    );
  };

  return (
    <Screen scroll={false} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingVertical: 16, paddingBottom: 40}}>
        <Text variant="title">{t('help.title')}</Text>
        <Text variant="subtitle" className="mt-0.5">
          {t('help.subtitle')}
        </Text>

        {/* FAQ accordion */}
        <View className="mt-5" style={{gap: 10}}>
          {FAQS.map((faq, i) => {
            const expanded = open === i;
            return (
              <Pressable
                key={faq.q}
                accessibilityRole="button"
                onPress={() => setOpen(expanded ? null : i)}
                className="rounded-2xl border border-border bg-white p-4">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 pr-3 font-semibold text-slate-900">
                    {t(faq.q)}
                  </Text>
                  <Text className="text-muted">{expanded ? '−' : '+'}</Text>
                </View>
                {expanded ? (
                  <Text className="mt-2 text-sm leading-6 text-muted">
                    {t(faq.a)}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Contact */}
        <Text variant="label" className="mt-8 mb-3">
          {t('help.contact')}
        </Text>
        <Button title={t('help.chatWhatsApp')} onPress={onWhatsApp} />
        <Button
          title={t('help.reportProblem')}
          variant="secondary"
          className="mt-3"
          onPress={() => navigation.navigate('Feedback', {kind: 'bug'})}
        />
        <Button
          title={t('help.emailUs')}
          variant="secondary"
          className="mt-3"
          onPress={() =>
            Linking.openURL(
              `mailto:${SUPPORT.email}?subject=${encodeURIComponent(
                'Smart CashBook support',
              )}`,
            ).catch(() => {})
          }
        />
      </ScrollView>
    </Screen>
  );
}
