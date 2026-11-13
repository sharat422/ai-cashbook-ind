import React, {useEffect, useState} from 'react';
import {View} from 'react-native';

import {AmountInput, FormField} from '@components/form';
import {BottomSheet, Button, Text} from '@components/ui';
import {useT} from '@/i18n';

export interface CreditLimitSheetProps {
  visible: boolean;
  current?: number;
  customerName: string;
  onClose: () => void;
  onSave: (amount: number) => void;
  onRemove: () => void;
}

/** Set / update / remove a customer's credit limit. */
export function CreditLimitSheet({
  visible,
  current,
  customerName,
  onClose,
  onSave,
  onRemove,
}: CreditLimitSheetProps): React.JSX.Element {
  const t = useT();
  const [amount, setAmount] = useState<number>(current ?? NaN);

  useEffect(() => {
    if (visible) setAmount(current ?? NaN);
  }, [visible, current]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('creditLimit.title')}>
      <View className="px-5 pb-5 pt-1">
        <Text variant="caption" className="mb-4">
          {t('creditLimit.hint', {name: customerName})}
        </Text>
        <FormField label={t('creditLimit.field')}>
          <AmountInput value={amount} onChange={setAmount} autoFocus />
        </FormField>
        <Button
          title={t('creditLimit.save')}
          className="mt-5"
          disabled={Number.isNaN(amount) || amount <= 0}
          onPress={() => onSave(amount)}
        />
        {current ? (
          <Button
            title={t('creditLimit.remove')}
            variant="ghost"
            className="mt-2"
            onPress={onRemove}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}
