import React, {useMemo, useState} from 'react';
import {Alert, Linking, Platform, Pressable, Share, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {AmountInput, FormField} from '@components/form';
import {Button, ErrorBoundary, Screen, Text} from '@components/ui';
import {
  buildUpiUri,
  isValidUpiId,
  makePaymentRef,
} from '@features/collections/domain/upi';
import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {useLedgerMutations} from '@features/customers/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {formatINR} from '@utils/currency';
import {toISODate} from '@utils/date';

export function RequestPaymentScreen({
  navigation,
  route,
}: AppScreenProps<'RequestPayment'>): React.JSX.Element {
  const t = useT();
  const {customer} = route.params;
  const businessName =
    useAuthStore(s => s.business?.businessName) ?? t('dashboard.yourBusiness');
  const upiId = useCollectionSettingsStore(s => s.upiId);
  const storedPayee = useCollectionSettingsStore(s => s.payeeName);
  const payeeName = storedPayee || businessName;
  const {receivePayment} = useLedgerMutations(customer.id);

  const [amount, setAmount] = useState<number>(
    customer.outstandingAmount > 0 ? customer.outstandingAmount : NaN,
  );
  const [ref] = useState(makePaymentRef());

  const configured = isValidUpiId(upiId);
  const amt = Number.isNaN(amount) ? 0 : amount;

  const upiUri = useMemo(
    () =>
      buildUpiUri({
        payeeVpa: upiId,
        payeeName,
        amount: amt,
        note: `Payment to ${payeeName}`,
        ref,
      }),
    [upiId, payeeName, amt, ref],
  );

  const message = useMemo(
    () =>
      t('request.msg', {
        name: customer.fullName,
        amount: formatINR(amt),
        payee: payeeName,
        upi: upiId,
        uri: upiUri,
        ref,
        business: businessName,
      }),
    [t, customer.fullName, amt, payeeName, upiId, upiUri, ref, businessName],
  );

  const onWhatsApp = async () => {
    const enc = encodeURIComponent(message);
    const wa = `whatsapp://send?phone=91${customer.mobile}&text=${enc}`;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    const sms = `sms:${customer.mobile}${sep}body=${enc}`;
    try {
      const canWa = await Linking.canOpenURL(wa);
      await Linking.openURL(canWa ? wa : sms);
    } catch {
      Alert.alert(t('request.couldNotWhatsApp'), t('request.noMessagingApp'));
    }
  };

  const onShare = async () => {
    try {
      await Share.share({message});
    } catch {
      /* dismissed */
    }
  };

  const onMarkReceived = () => {
    if (Number.isNaN(amount) || amount <= 0) {
      return Alert.alert(t('request.enterAmountFirst'));
    }
    receivePayment.mutate(
      {
        amount,
        date: toISODate(new Date()),
        paymentMethod: 'upi',
        referenceNumber: ref,
        notes: 'UPI collection request',
      },
      {
        onSuccess: () => {
          Alert.alert(
            t('request.recordedTitle'),
            t('request.recordedMsg', {
              amount: formatINR(amount),
              name: customer.fullName,
            }),
          );
          navigation.goBack();
        },
        onError: err =>
          Alert.alert(
            t('form.couldNotSave'),
            err instanceof Error ? err.message : t('ai.tryAgain'),
          ),
      },
    );
  };

  return (
    <Screen>
      <View className="py-6">
        <Text variant="title">{t('request.title')}</Text>
        <Text variant="subtitle" className="mt-1">
          {t('request.from', {name: customer.fullName})}
          {customer.outstandingAmount > 0
            ? t('request.dueSuffix', {
                amount: formatINR(customer.outstandingAmount),
              })
            : ''}
        </Text>

        {!configured ? (
          <View className="mt-5 rounded-2xl bg-amber-50 p-4">
            <Text className="text-sm font-medium text-amber-800">
              {t('request.noUpi')}
            </Text>
            <Button
              title={t('request.setUpi')}
              variant="secondary"
              className="mt-3"
              onPress={() => navigation.navigate('Settings')}
            />
          </View>
        ) : (
          <>
            {/* Amount */}
            <View className="mt-5 rounded-3xl bg-slate-900 px-5 pb-6 pt-5">
              <Text className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {t('request.amountToCollect')}
              </Text>
              <View className="mt-2">
                <AmountInput value={amount} onChange={setAmount} />
              </View>
            </View>

            {/* QR */}
            <View className="mt-5 items-center rounded-2xl border border-border bg-white p-5">
              <ErrorBoundary>
                <QRCode value={upiUri} size={200} />
              </ErrorBoundary>
              <Text variant="caption" className="mt-3 text-center">
                {t('request.scanToPay', {payee: payeeName})}
              </Text>
            </View>

            {/* Details */}
            <View className="mt-4 rounded-2xl border border-border bg-white px-4">
              <Detail label={t('request.upiId')} value={upiId} />
              <Detail label={t('form.amount')} value={formatINR(amt)} />
              <Detail label={t('ai.customer')} value={customer.fullName} />
              <Detail label={t('request.reference')} value={ref} />
              <Detail label={t('request.status')} value={t('request.pending')} />
            </View>

            {/* Actions */}
            <Button
              title={t('request.sendWhatsApp')}
              className="mt-6"
              onPress={onWhatsApp}
            />
            <Button
              title={t('request.share')}
              variant="secondary"
              className="mt-2"
              onPress={onShare}
            />
            <Button
              title={t('request.markReceived')}
              variant="secondary"
              className="mt-2"
              loading={receivePayment.isPending}
              onPress={onMarkReceived}
            />
            <Text variant="caption" className="mt-3 text-center">
              {t('request.footer')}
            </Text>
          </>
        )}
      </View>
    </Screen>
  );
}

function Detail({label, value}: {label: string; value: string}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between border-b border-border py-3 last:border-b-0">
      <Text variant="caption">{label}</Text>
      <Text className="text-sm font-semibold text-slate-900">{value}</Text>
    </View>
  );
}
