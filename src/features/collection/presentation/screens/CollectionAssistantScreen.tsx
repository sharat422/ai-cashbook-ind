import React, {useMemo, useState} from 'react';
import {Linking, Platform, Share, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {AmountInput, FormField, TextField} from '@components/form';
import {Screen, Text} from '@components/ui';
import {
  generateMessages,
} from '@features/collection/domain/generate';
import {
  LANGUAGE_LABEL,
  LANGUAGE_ORDER,
  relationshipLevel,
  scoreForLevel,
  type CollectionInput,
  type Language,
  type RelationshipLevel,
} from '@features/collection/domain/entities';
import {MessageOptionCard} from '@features/collection/presentation/components';
import type {AppScreenProps} from '@navigation/types';
import {formatINR} from '@utils/currency';
import {onlyDigits} from '@utils/validation';

const REL_LEVELS: Array<{label: string; value: RelationshipLevel}> = [
  {label: 'Strong', value: 'strong'},
  {label: 'Neutral', value: 'neutral'},
  {label: 'New', value: 'weak'},
];

/** Conversational AI collection assistant: tweak context, pick a language, send. */
export function CollectionAssistantScreen({
  route,
}: AppScreenProps<'CollectionAssistant'>): React.JSX.Element {
  const params = route.params;

  const [name, setName] = useState(params.name);
  const [amount, setAmount] = useState<number>(params.amount);
  const [daysOverdue, setDaysOverdue] = useState<number>(params.daysOverdue);
  const [relationshipScore, setRelationshipScore] = useState<number>(
    params.relationshipScore,
  );
  const [language, setLanguage] = useState<Language>('en');

  const input: CollectionInput = useMemo(
    () => ({name, outstandingAmount: amount, daysOverdue, relationshipScore}),
    [name, amount, daysOverdue, relationshipScore],
  );

  const messages = useMemo(
    () => generateMessages(input, language),
    [input, language],
  );

  const sendWhatsApp = async (text: string) => {
    const enc = encodeURIComponent(text);
    const wa = `whatsapp://send?phone=91${params.mobile}&text=${enc}`;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const sms = `sms:${params.mobile}${sep}body=${enc}`;
    try {
      const canWa = await Linking.canOpenURL(wa);
      await Linking.openURL(canWa ? wa : sms);
    } catch {
      // no messaging app
    }
  };

  const shareText = async (text: string) => {
    try {
      await Share.share({message: text});
    } catch {
      // dismissed
    }
  };

  const currentLevel = relationshipLevel(relationshipScore);

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">Collection Assistant</Text>

        {/* Assistant intro bubble */}
        <View className="mt-4 flex-row">
          <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Text className="text-base">🤖</Text>
          </View>
          <View className="flex-1 rounded-2xl rounded-tl-sm bg-slate-100 p-3">
            <Text className="text-sm text-slate-800">
              Hi! I'll help you write a collection message for{' '}
              <Text className="font-semibold">{name || 'your customer'}</Text>.
              They owe {formatINR(Math.max(amount, 0))}
              {daysOverdue > 0 ? `, ${daysOverdue} days overdue` : ''}. Pick a
              language and pick the tone that fits 👇
            </Text>
          </View>
        </View>

        {/* Editable context */}
        <View className="mt-5 rounded-2xl border border-border bg-white p-4" style={{gap: 14}}>
          <FormField label="Customer name">
            <TextField value={name} onChangeText={setName} placeholder="Name" />
          </FormField>
          <View className="flex-row" style={{gap: 12}}>
            <View className="flex-1">
              <FormField label="Outstanding">
                <AmountInput value={amount} onChange={setAmount} />
              </FormField>
            </View>
            <View className="w-28">
              <FormField label="Days overdue">
                <TextField
                  value={String(daysOverdue)}
                  onChangeText={v => setDaysOverdue(Number(onlyDigits(v) || 0))}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </FormField>
            </View>
          </View>
          <FormField label="Relationship">
            <View className="flex-row" style={{gap: 8}}>
              {REL_LEVELS.map(l => (
                <FilterChip
                  key={l.value}
                  label={l.label}
                  selected={currentLevel === l.value}
                  onPress={() => setRelationshipScore(scoreForLevel(l.value))}
                />
              ))}
            </View>
          </FormField>
        </View>

        {/* Language selector */}
        <Text variant="label" className="mt-5 mb-2">
          Language
        </Text>
        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {LANGUAGE_ORDER.map(lng => (
            <FilterChip
              key={lng}
              label={LANGUAGE_LABEL[lng]}
              selected={language === lng}
              onPress={() => setLanguage(lng)}
            />
          ))}
        </View>

        {/* Generated messages */}
        <View className="mt-5 flex-row">
          <View className="mr-2 h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Text className="text-base">🤖</Text>
          </View>
          <Text variant="caption" className="mt-2">
            Here are 3 ways to ask — tap to send.
          </Text>
        </View>
        <View className="mt-3 pl-10">
          {messages.map(m => (
            <MessageOptionCard
              key={m.tone}
              message={m}
              onWhatsApp={sendWhatsApp}
              onShare={shareText}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}
