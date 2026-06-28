import React, {useEffect, useState} from 'react';
import {Pressable, TextInput, View} from 'react-native';

import {BottomSheet, Button, Text} from '@components/ui';
import type {ReminderTemplate} from '@features/reminders/domain/entities';
import {TEMPLATE_PLACEHOLDERS} from '@features/reminders/domain/templates';
import {colors} from '@theme/colors';

export interface TemplateEditorSheetProps {
  visible: boolean;
  template: ReminderTemplate | null;
  customized: boolean;
  onClose: () => void;
  onSave: (body: string) => void;
  onReset: () => void;
}

/** Bottom-sheet editor for customizing a reminder template body. */
export function TemplateEditorSheet({
  visible,
  template,
  customized,
  onClose,
  onSave,
  onReset,
}: TemplateEditorSheetProps): React.JSX.Element {
  const [body, setBody] = useState('');

  useEffect(() => {
    if (visible && template) setBody(template.body);
  }, [visible, template]);

  const insert = (token: string) => setBody(prev => `${prev}${token}`);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={template ? `Edit · ${template.name}` : 'Edit template'}
      maxHeightClassName="max-h-[80%]">
      <View className="px-5 pb-4 pt-1" style={{gap: 12}}>
        <Text variant="caption">
          Use placeholders below — they're filled in per customer when sending.
        </Text>

        <View className="rounded-xl border border-border bg-white px-4 py-3">
          <TextInput
            className="min-h-[120px] p-0 text-base text-slate-900"
            value={body}
            onChangeText={setBody}
            placeholder="Reminder message…"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View className="flex-row flex-wrap" style={{gap: 8}}>
          {TEMPLATE_PLACEHOLDERS.map(token => (
            <Pressable
              key={token}
              onPress={() => insert(token)}
              className="rounded-full border border-border bg-white px-3 py-1.5">
              <Text className="text-xs font-semibold text-primary">{token}</Text>
            </Pressable>
          ))}
        </View>

        <Button
          title="Save template"
          className="mt-1"
          onPress={() => onSave(body.trim())}
        />
        {customized ? (
          <Button title="Reset to default" variant="ghost" onPress={onReset} />
        ) : null}
      </View>
    </BottomSheet>
  );
}
