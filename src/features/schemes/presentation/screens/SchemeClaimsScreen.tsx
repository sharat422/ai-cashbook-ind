import {useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useEffect, useState} from 'react';
import {Alert, Pressable, RefreshControl, ScrollView, View} from 'react-native';

import {downloadAndShare} from '@api/download';
import {FilterChip} from '@components/filters';
import {FormField, TextField} from '@components/form';
import {BottomSheet, Button, EmptyState, ErrorState, Screen, Skeleton, Text} from '@components/ui';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {formatMoney} from '@features/reconciliation/domain/money';
import {CLAIM_STATUSES, schemesRemote, type ClaimStatus, type SchemeClaim} from '@features/schemes/data/schemes.remote';
import {SCHEMES_KEY} from '@features/schemes/presentation/hooks';
import {formatQty} from '@features/stock/domain/qty';
import {useT, type TKey} from '@/i18n';
import {formatDisplayDate} from '@utils/date';

const STATUS_STYLE: Record<ClaimStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  filed: 'bg-sky-100 text-sky-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  paid: 'bg-emerald-200 text-emerald-900',
};

/**
 * Scheme claims to the supplier: each made from the scheme log for one scheme
 * and period (the Scheme Report's figures). The owner moves it through draft →
 * filed → approved / rejected → paid, notes the supplier's answer, and sends the
 * PDF or Excel. The figures never change after it's made.
 */
export function SchemeClaimsScreen(): React.JSX.Element {
  const t = useT();
  const claims = useQuery({queryKey: [SCHEMES_KEY, 'claims'], queryFn: schemesRemote.claims});
  const [open, setOpen] = useState<SchemeClaim | null>(null);
  const list: SchemeClaim[] = claims.data ?? [];

  return (
    <Screen scroll={false}>
      <ScrollView contentContainerStyle={{paddingVertical: 24, paddingBottom: 40, gap: 12}}
        refreshControl={<RefreshControl refreshing={claims.isRefetching} onRefresh={() => claims.refetch()} />}>
        <Text variant="title">{t('claims.title')}</Text>
        <Text variant="subtitle">{t('claims.subtitle')}</Text>
        {claims.isLoading ? <Skeleton className="h-24 w-full" /> : claims.isError ? (
          <ErrorState onRetry={() => claims.refetch()} retrying={claims.isFetching} />
        ) : list.length === 0 ? (
          <EmptyState icon="📨" title={t('claims.emptyTitle')} message={t('claims.emptyMsg')} />
        ) : list.map(c => (
          <Pressable key={c.id} testID={`claim-${c.id}`} accessibilityRole="button" onPress={() => setOpen(c)}
            className="rounded-2xl border border-border bg-white p-4" style={{gap: 4}}>
            <View className="flex-row items-center justify-between" style={{gap: 8}}>
              <Text className="flex-1 text-base font-semibold">{c.schemeName}</Text>
              <Text className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>
                {t(`claims.status.${c.status}` as TKey)}
              </Text>
            </View>
            <Text variant="caption">{formatDisplayDate(c.from)} – {formatDisplayDate(c.to)}</Text>
            <Text className="text-sm font-bold">{formatMoney(c.value)}</Text>
            <Text variant="caption">
              {t('claims.figures', {bills: c.bills, free: formatQty(c.freeQty), discount: formatMoney(c.discount)})}
            </Text>
            {c.note ? <Text variant="caption">💬 {c.note}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
      <ClaimSheet claim={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}

function ClaimSheet({claim, onClose}: {claim: SchemeClaim | null; onClose: () => void}): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = usePermissions().can(PERMISSIONS.SETTINGS_MANAGE);
  const [status, setStatus] = useState<ClaimStatus>('draft');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setStatus(claim?.status ?? 'draft');
    setNote(claim?.note ?? '');
  }, [claim]);

  const save = async () => {
    if (!claim) return;
    setSaving(true);
    try {
      await schemesRemote.updateClaim(claim.id, {status, note: note.trim()});
      await qc.invalidateQueries({queryKey: [SCHEMES_KEY, 'claims']});
      onClose();
    } catch (e) {
      Alert.alert(t('form.couldNotSave'), e instanceof Error ? e.message : t('common.tryAgainMsg'));
    } finally {
      setSaving(false);
    }
  };
  const share = (kind: 'pdf' | 'xlsx') => {
    if (!claim) return;
    const name = `Claim_${claim.schemeName.replace(/[^A-Za-z0-9]+/g, '_')}_${claim.from}_${claim.to}.${kind}`;
    downloadAndShare(`/schemes/claims/${claim.id}.${kind}`, name, kind === 'pdf' ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .catch(e => Alert.alert(t('reports.couldNotExport'), e instanceof Error ? e.message : t('common.tryAgainMsg')));
  };

  return (
    <BottomSheet visible={claim !== null} onClose={onClose} title={claim?.schemeName ?? ''}>
      <View className="px-5 pb-5 pt-1" style={{gap: 14}}>
        {claim ? (
          <View style={{gap: 4}}>
            {claim.lines.map(l => (
              <View key={l.itemId} className="flex-row justify-between">
                <Text className="flex-1 text-sm">{l.itemName}</Text>
                <Text className="text-sm font-semibold">{formatMoney(l.value)}</Text>
              </View>
            ))}
            <View className="flex-row justify-between border-t border-border pt-1">
              <Text className="text-sm font-bold">{t('claims.total')}</Text>
              <Text testID="claim-total" className="text-sm font-bold">{formatMoney(claim.value)}</Text>
            </View>
          </View>
        ) : null}
        <View className="flex-row" style={{gap: 8}}>
          <Button testID="claim-pdf" title="⬇ PDF" variant="secondary" className="flex-1" fullWidth={false}
            onPress={() => share('pdf')} />
          <Button testID="claim-xlsx" title="⬇ Excel" variant="secondary" className="flex-1" fullWidth={false}
            onPress={() => share('xlsx')} />
        </View>
        {canEdit ? (
          <>
            <FormField label={t('claims.statusLabel')}>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {CLAIM_STATUSES.map(s => (
                  <FilterChip key={s} label={t(`claims.status.${s}` as TKey)} selected={status === s}
                    onPress={() => setStatus(s)} />
                ))}
              </View>
            </FormField>
            <FormField label={t('claims.note')} hint={t('claims.noteHint')}>
              <TextField testID="claim-note" value={note} onChangeText={setNote} maxLength={1000} multiline />
            </FormField>
            <Button testID="claim-save" title={t('common.save')} loading={saving} disabled={saving}
              onPress={() => void save()} />
          </>
        ) : null}
      </View>
    </BottomSheet>
  );
}
