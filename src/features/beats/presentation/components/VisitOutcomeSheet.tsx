import React, {useEffect, useState} from 'react';
import {View} from 'react-native';

import {FilterChip} from '@components/filters';
import {DateField, FormField, TextField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import type {VisitOutcome} from '@features/beats/data/beats.remote';
import {useT, type TKey} from '@/i18n';
import {toISODate} from '@utils/date';

export const OUTCOMES: VisitOutcome[] = ['visited_ordered', 'visited_no_order', 'not_visited'];

/** Preset reasons per outcome, saved as stable codes so reports read the same
 *  in every language; "other" saves the typed text instead. */
const REASONS: Record<VisitOutcome, string[]> = {
  visited_ordered: [],
  visited_no_order: ['stock_enough', 'price_issue', 'owner_away', 'order_later', 'other'],
  not_visited: ['shop_closed', 'no_time', 'owner_away', 'other'],
};

export interface VisitOutcomeResult {
  outcome: VisitOutcome;
  reason?: string;
  promiseDate?: string;
}

export interface VisitOutcomeSheetProps {
  visible: boolean;
  retailerName: string;
  /** Ask for a promise-to-pay date only when the retailer owes money. */
  hasDues: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (result: VisitOutcomeResult) => void;
}

/** A preset reason code → its label; free text (an "other" reason) as is. */
export function reasonLabel(t: ReturnType<typeof useT>, reason: string): string {
  const all = new Set(Object.values(REASONS).flat());
  return all.has(reason) ? t(`beats.reason.${reason}` as TKey) : reason;
}

export function VisitOutcomeSheet({
  visible,
  retailerName,
  hasDues,
  saving,
  onClose,
  onSave,
}: VisitOutcomeSheetProps): React.JSX.Element {
  const t = useT();
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [promiseDate, setPromiseDate] = useState('');

  useEffect(() => {
    if (visible) {
      setOutcome(null);
      setReason(null);
      setOtherText('');
      setPromiseDate('');
    }
  }, [visible]);

  const reasonText = reason === 'other' ? otherText.trim() : reason;
  const needsReason = outcome !== null && REASONS[outcome].length > 0;
  const canSave = outcome !== null && (!needsReason || !!reasonText);
  const inAYear = new Date(Date.now() + 365 * 86_400_000);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={retailerName}>
      <View className="px-5 pb-5 pt-1" style={{gap: 16}}>
        <FormField label={t('beats.outcome')} required>
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {OUTCOMES.map(o => (
              <FilterChip
                key={o}
                label={t(`beats.outcome.${o}` as TKey)}
                selected={outcome === o}
                onPress={() => {
                  setOutcome(o);
                  setReason(null);
                }}
              />
            ))}
          </View>
        </FormField>

        {needsReason ? (
          <FormField label={t('beats.reasonLabel')} required>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {REASONS[outcome].map(r => (
                <FilterChip
                  key={r}
                  label={t(`beats.reason.${r}` as TKey)}
                  selected={reason === r}
                  onPress={() => setReason(r)}
                />
              ))}
            </View>
            {reason === 'other' ? (
              <TextField
                className="mt-2"
                value={otherText}
                onChangeText={setOtherText}
                maxLength={280}
                placeholder={t('beats.reasonPlaceholder')}
              />
            ) : null}
          </FormField>
        ) : null}

        {hasDues && outcome !== 'not_visited' ? (
          <FormField label={t('beats.promiseDate')} hint={t('beats.promiseHint')}>
            {promiseDate ? (
              <View style={{gap: 8}}>
                <DateField value={promiseDate} onChange={setPromiseDate} maximumDate={inAYear} />
                <FilterChip label={t('beats.noPromise')} removable onPress={() => setPromiseDate('')} />
              </View>
            ) : (
              <FilterChip
                label={t('beats.addPromise')}
                onPress={() => setPromiseDate(toISODate(new Date(Date.now() + 86_400_000)))}
              />
            )}
          </FormField>
        ) : null}

        {!canSave && outcome !== null ? (
          <Text variant="caption">{t('beats.pickReason')}</Text>
        ) : null}
        <Button
          title={t('beats.saveVisit')}
          loading={saving}
          disabled={!canSave}
          onPress={() =>
            outcome &&
            onSave({
              outcome,
              reason: reasonText || undefined,
              promiseDate: promiseDate || undefined,
            })
          }
        />
      </View>
    </BottomSheet>
  );
}
