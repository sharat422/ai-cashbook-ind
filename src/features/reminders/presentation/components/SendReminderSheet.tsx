import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, View} from 'react-native';

import {FilterChip} from '@components/filters';
import {BottomSheet, Button, Text} from '@components/ui';
import type {Customer} from '@features/customers/domain/entities';
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  type ReminderChannel,
  type ReminderStatus,
  type ReminderTemplateKey,
} from '@features/reminders/domain/entities';
import {renderTemplate} from '@features/reminders/domain/templates';
import {
  useReminderHistory,
  useReminderTemplates,
  useSendReminder,
} from '@features/reminders/presentation/hooks';
import {formatINR} from '@utils/currency';
import {ReminderHistoryList} from './ReminderHistoryList';
import {TemplateEditorSheet} from './TemplateEditorSheet';

export interface SendReminderSheetProps {
  visible: boolean;
  customer: Customer;
  outstanding: number;
  businessName?: string;
  onClose: () => void;
}

const CHANNELS: ReminderChannel[] = ['whatsapp', 'sms', 'push'];

/** Modern bottom sheet: pick a template + channel, preview, send, see history. */
export function SendReminderSheet({
  visible,
  customer,
  outstanding,
  businessName,
  onClose,
}: SendReminderSheetProps): React.JSX.Element {
  const {templates, setBody, resetBody, isCustomized} = useReminderTemplates();
  const history = useReminderHistory(customer.id);
  const send = useSendReminder();

  const [templateKey, setTemplateKey] =
    useState<ReminderTemplateKey>('friendly');
  const [channel, setChannel] = useState<ReminderChannel>('whatsapp');
  const [editorOpen, setEditorOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    channel: ReminderChannel;
    status: ReminderStatus;
  } | null>(null);

  const selected = useMemo(
    () => templates.find(t => t.key === templateKey) ?? templates[0],
    [templates, templateKey],
  );

  const message = useMemo(
    () =>
      renderTemplate(selected.body, {
        name: customer.fullName.split(' ')[0],
        amount: formatINR(Math.max(outstanding, 0)),
        business: businessName || 'us',
      }),
    [selected, customer.fullName, outstanding, businessName],
  );

  const onSend = async () => {
    setSending(true);
    setResult(null);
    const status = await send({
      customerId: customer.id,
      customerName: customer.fullName,
      mobile: customer.mobile,
      channel,
      templateKey,
      message,
    });
    setSending(false);
    setResult({channel, status});
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Send reminder"
      maxHeightClassName="max-h-[92%]">
      <ScrollView
        className="px-5"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: 20}}>
        <Text variant="caption" className="mt-1">
          To {customer.fullName} · {formatINR(Math.max(outstanding, 0))} due
        </Text>

        {/* Template */}
        <View className="mt-4 flex-row items-center justify-between">
          <Text variant="label">Template</Text>
          <Pressable onPress={() => setEditorOpen(true)}>
            <Text className="text-sm font-semibold text-primary">
              ✏️ Customize
            </Text>
          </Pressable>
        </View>
        <View className="mt-2 flex-row flex-wrap" style={{gap: 8}}>
          {templates.map(t => (
            <FilterChip
              key={t.key}
              label={t.name}
              selected={templateKey === t.key}
              onPress={() => setTemplateKey(t.key)}
            />
          ))}
        </View>

        {/* Channel */}
        <Text variant="label" className="mt-5 mb-2">
          Channel
        </Text>
        <View className="flex-row" style={{gap: 8}}>
          {CHANNELS.map(c => (
            <FilterChip
              key={c}
              label={`${CHANNEL_ICON[c]} ${CHANNEL_LABEL[c]}`}
              selected={channel === c}
              onPress={() => setChannel(c)}
            />
          ))}
        </View>

        {/* Preview */}
        <Text variant="label" className="mt-5 mb-2">
          Preview
        </Text>
        <View className="rounded-2xl border border-border bg-slate-50 p-4">
          <Text className="text-sm text-slate-800">{message}</Text>
        </View>

        {result ? (
          <Text
            className={`mt-3 text-sm font-semibold ${
              result.status === 'sent' ? 'text-success' : 'text-danger'
            }`}>
            {result.status === 'sent'
              ? `✓ Sent via ${CHANNEL_LABEL[result.channel]}`
              : `✗ Could not send via ${CHANNEL_LABEL[result.channel]}`}
          </Text>
        ) : null}

        {/* History */}
        <Text variant="label" className="mt-6 mb-2">
          Reminder history
        </Text>
        <ReminderHistoryList reminders={history} />
      </ScrollView>

      <View className="border-t border-border px-5 py-3">
        <Button
          title={`Send ${CHANNEL_LABEL[channel]} reminder`}
          loading={sending}
          onPress={onSend}
        />
      </View>

      <TemplateEditorSheet
        visible={editorOpen}
        template={selected}
        customized={isCustomized(templateKey)}
        onClose={() => setEditorOpen(false)}
        onSave={body => {
          setBody(templateKey, body);
          setEditorOpen(false);
        }}
        onReset={() => {
          resetBody(templateKey);
          setEditorOpen(false);
        }}
      />
    </BottomSheet>
  );
}
