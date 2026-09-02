import React, {useMemo, useState} from 'react';
import {Alert, Linking, Pressable, ScrollView, TextInput, View} from 'react-native';

import {Button, Screen, SegmentedControl, Text} from '@components/ui';
import {SUPPORT} from '@config/constants';
import {ApiError} from '@api/client';
import {useSendFeedback} from '@features/support/presentation/hooks';
import type {FeedbackKind} from '@features/support/data/feedback.remote';
import {
  collectDiagnostics,
  formatDiagnostics,
} from '@/services/diagnostics/collectDiagnostics';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {colors} from '@theme/colors';

export function FeedbackScreen({
  navigation,
  route,
}: AppScreenProps<'Feedback'>): React.JSX.Element {
  const t = useT();
  const send = useSendFeedback();
  const [kind, setKind] = useState<FeedbackKind>(route.params?.kind ?? 'bug');
  const [message, setMessage] = useState('');
  const [showDiag, setShowDiag] = useState(false);

  // Snapshot once on mount so the preview matches what we send.
  const diagnostics = useMemo(() => collectDiagnostics(), []);
  const diagText = useMemo(() => formatDiagnostics(diagnostics), [diagnostics]);

  const KIND_OPTIONS = [
    {label: t('feedback.bug'), value: 'bug' as FeedbackKind},
    {label: t('feedback.idea'), value: 'feedback' as FeedbackKind},
  ];

  /** If the API submit fails, offer to send the same content by email. */
  const emailFallback = () => {
    const subject = `${kind === 'bug' ? 'Bug' : 'Feedback'} — Smart CashBook`;
    const body = `${message}\n\n---\n${diagText}`;
    const url = `mailto:${SUPPORT.email}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {
      /* no mail app — nothing more we can do */
    });
  };

  const onSend = () => {
    if (!message.trim()) return;
    send.mutate(
      {kind, message: message.trim(), diagnostics},
      {
        onSuccess: () => {
          Alert.alert(t('feedback.thanksTitle'), t('feedback.thanksMsg'), [
            {text: t('common.ok'), onPress: () => navigation.goBack()},
          ]);
        },
        onError: err => {
          const offline = !(err instanceof ApiError); // network/timeout
          Alert.alert(
            t('feedback.failedTitle'),
            offline ? t('feedback.failedOffline') : t('feedback.failedMsg'),
            [
              {text: t('feedback.emailInstead'), onPress: emailFallback},
              {text: t('common.cancel'), style: 'cancel'},
            ],
          );
        },
      },
    );
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View className="py-6">
          <Text variant="title">{t('feedback.title')}</Text>
          <Text variant="subtitle" className="mt-1">
            {t('feedback.subtitle')}
          </Text>

          <View className="mt-6">
            <SegmentedControl value={kind} options={KIND_OPTIONS} onChange={setKind} />
          </View>

          <View className="mt-4 rounded-2xl border border-border bg-white px-4 py-3">
            <TextInput
              className="min-h-[120px] p-0 text-base text-slate-900"
              value={message}
              onChangeText={setMessage}
              placeholder={
                kind === 'bug'
                  ? t('feedback.bugPlaceholder')
                  : t('feedback.ideaPlaceholder')
              }
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              maxLength={2000}
            />
          </View>

          {/* Transparency: show exactly what diagnostics we attach. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowDiag(v => !v)}
            className="mt-3 flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-primary">
              {t('feedback.diagToggle')}
            </Text>
            <Text className="text-primary">{showDiag ? '▲' : '▼'}</Text>
          </Pressable>
          {showDiag ? (
            <View className="mt-2 rounded-xl bg-slate-50 p-3">
              <Text className="text-[11px] leading-4 text-muted">{diagText}</Text>
            </View>
          ) : null}
          <Text variant="caption" className="mt-2">
            {t('feedback.diagNote')}
          </Text>

          <Button
            title={t('feedback.send')}
            className="mt-6"
            loading={send.isPending}
            disabled={!message.trim()}
            onPress={onSend}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
