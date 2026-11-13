import React from 'react';
import {ActivityIndicator, View} from 'react-native';

import {Text} from '@components/ui';
import {useT, type TKey} from '@/i18n';
import type {ScanStage} from '@features/receipt-scanner/domain/entities';
import {colors} from '@theme/colors';

interface Step {
  key: Exclude<ScanStage, 'idle' | 'done' | 'error'>;
  label: TKey;
  icon: string;
}

const STEPS: Step[] = [
  {key: 'uploading', label: 'receipt.uploading', icon: '⬆️'},
  {key: 'processing', label: 'receipt.reading', icon: '🔎'},
  {key: 'categorizing', label: 'receipt.categorizing', icon: '🧠'},
];

const ORDER: ScanStage[] = [
  'idle',
  'uploading',
  'processing',
  'categorizing',
  'done',
];

type StepState = 'done' | 'active' | 'pending';

function stateFor(step: Step, stage: ScanStage): StepState {
  if (stage === 'done') return 'done';
  const current = ORDER.indexOf(stage);
  const at = ORDER.indexOf(step.key);
  if (current > at) return 'done';
  if (current === at) return 'active';
  return 'pending';
}

/** Vertical stepper visualising the Upload → OCR → AI Categorize pipeline. */
export function ScanProgress({
  stage,
}: {
  stage: ScanStage;
}): React.JSX.Element {
  const t = useT();
  return (
    <View style={{gap: 14}}>
      {STEPS.map(step => {
        const state = stateFor(step, stage);
        return (
          <View key={step.key} className="flex-row items-center">
            <View
              className={`h-10 w-10 items-center justify-center rounded-full ${
                state === 'done'
                  ? 'bg-success'
                  : state === 'active'
                  ? 'bg-primary/10'
                  : 'bg-slate-100'
              }`}>
              {state === 'active' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : state === 'done' ? (
                <Text className="text-base text-white">✓</Text>
              ) : (
                <Text className="text-base">{step.icon}</Text>
              )}
            </View>
            <Text
              className={`ml-3 text-base ${
                state === 'pending'
                  ? 'text-muted'
                  : 'font-semibold text-slate-900'
              }`}>
              {t(step.label)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
