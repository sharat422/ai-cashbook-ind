import {useQuery} from '@tanstack/react-query';
import React, {useEffect, useMemo, useState} from 'react';
import {Alert, Linking, Platform, Pressable, Share, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import {getMyBusiness} from '@api/auth.api';
import {AmountInput, FormField} from '@components/form';
import {Button, ErrorBoundary, Screen, Skeleton, Text} from '@components/ui';
import {
  buildUpiUri,
  isValidUpiId,
  makePaymentRef,
} from '@features/collections/domain/upi';
import {usePermissions} from '@features/auth/hooks';
import {PERMISSIONS} from '@features/auth/rbac';
import {useCollectionSettingsStore} from '@features/collections/store/collectionSettings.store';
import {useLedgerMutations} from '@features/customers/presentation/hooks';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';
import {useAuthStore} from '@store/auth.store';
import {formatINR} from '@utils/currency';
import {todayIST} from '@utils/date';

export function RequestPaymentScreen({
  navigation,
  route,
}: AppScreenProps<'RequestPayment'>): React.JSX.Element {
  const t = useT();
  const {customer} = route.params;
  // The business as the server has it now: a phone that signed in before the owner set
  // the UPI ID only has an older copy. Offline, the copy on the phone is used.
  const cached = useAuthStore(s => s.business);
  const fresh = useQuery({queryKey: ['business-me'], queryFn: getMyBusiness, staleTime: 0});
  useEffect(() => {
    const now = useAuthStore.getState().business;
    if (fresh.data && now) useAuthStore.getState().setBusiness({...now, ...fresh.data, role: fresh.data.role ?? now.role});
  }, [fresh.data]);
  const business = fresh.data ?? cached;
  const businessName = business?.businessName ?? t('dashboard.yourBusiness');
  const canSetUpi = usePermissions().can(PERMISSIONS.SETTINGS_MANAGE);
  // The business's UPI ID (the owner sets it once, for every phone). Only if it has none,
  // a UPI ID this phone kept from before is used, with a warning.
  const phoneUpi = useCollectionSettingsStore(s => s.upiId);
  const phonePayee = useCollectionSettingsStore(s => s.payeeName);
  const fromPhone = !isValidUpiId(business?.upiId ?? '') && isValidUpiId(phoneUpi);
  const upiId = fromPhone ? phoneUpi : business?.upiId ?? '';
  const payeeName = (fromPhone ? phonePayee : business?.upiPayeeName) || businessName;
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
        date: todayIST(),
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

        {!configured && fresh.isLoading ? (
          <Skeleton className="mt-5 h-24 w-full" />
        ) : !configured ? (
          <View testID="request-no-upi" className="mt-5 rounded-2xl bg-amber-50 p-4">
            <Text className="text-sm font-medium text-amber-800">
              {canSetUpi ? t('request.noUpi') : t('request.noUpiStaff')}
            </Text>
            {canSetUpi ? (
              <Button
                title={t('request.setUpi')}
                variant="secondary"
                className="mt-3"
                onPress={() => navigation.navigate('Settings')}
              />
            ) : null}
          </View>
        ) : (
          <>
            {fromPhone ? (
              <View testID="request-phone-upi" className="mt-5 rounded-2xl bg-amber-50 p-4">
                <Text className="text-sm font-medium text-amber-800">
                  {t(canSetUpi ? 'request.phoneUpi' : 'request.phoneUpiStaff', {upi: upiId})}
                </Text>
              </View>
            ) : null}
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
