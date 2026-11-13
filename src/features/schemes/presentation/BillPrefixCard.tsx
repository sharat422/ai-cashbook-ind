import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import React, {useState} from 'react';
import {Alert, View} from 'react-native';

import {TextField} from '@components/form';
import {Button, Text} from '@components/ui';
import {schemesRemote} from '@features/schemes/data/schemes.remote';
import {useT} from '@/i18n';

const KEY = ['bill-series'];

/** Owner (Settings): the prefix on new bill numbers, with the next number as
 *  the example ("SB-26-27-1"). Bills already made keep their numbers. */
export function BillPrefixCard(): React.JSX.Element {
  const t = useT();
  const qc = useQueryClient();
  const series = useQuery({queryKey: KEY, queryFn: schemesRemote.billSeries});
  const [typed, setTyped] = useState<string | null>(null);
  const prefix = typed ?? series.data?.prefix ?? '';
  const save = useMutation({
    mutationFn: () => schemesRemote.setBillPrefix(prefix),
    onSuccess: data => {
      qc.setQueryData(KEY, data);
      setTyped(null);
      Alert.alert(t('settings.billPrefixSaved'), t('settings.billPrefixNext', {number: data.nextNumber}));
    },
    onError: e => Alert.alert(t('form.couldNotSave'), e.message),
  });
  const s = series.data;
  const serial = s?.nextNumber.split('-').pop() ?? '1';
  const example = s ? `${prefix || s.prefix}-${s.financialYear}-${serial}` : '';

  return (
    <View className="rounded-2xl border border-border bg-white p-4" style={{gap: 10}}>
      <Text className="text-sm font-semibold text-slate-700">{t('settings.billPrefix')}</Text>
      <TextField testID="bill-prefix" value={prefix} autoCapitalize="characters" maxLength={6}
        onChangeText={v => setTyped(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        accessibilityLabel={t('settings.billPrefix')} />
      {example ? (
        <Text testID="bill-prefix-example" variant="caption">{t('settings.billPrefixNext', {number: example})}</Text>
      ) : null}
      <Text variant="caption">{t('settings.billPrefixHint')}</Text>
      <Button testID="bill-prefix-save" title={t('settings.billPrefixSave')} variant="secondary"
        disabled={!prefix || prefix === s?.prefix} loading={save.isPending} onPress={() => save.mutate()} />
    </View>
  );
}
