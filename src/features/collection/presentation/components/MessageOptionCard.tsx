import React from 'react';
import {Pressable, View} from 'react-native';

import {Text} from '@components/ui';
import {
  TONE_ICON,
  TONE_LABEL,
  type CollectionMessage,
} from '@features/collection/domain/entities';

export interface MessageOptionCardProps {
  message: CollectionMessage;
  onWhatsApp: (text: string) => void;
  onShare: (text: string) => void;
}

/**
 * A generated message shown as an assistant chat bubble, with one-tap WhatsApp
 * and a general share action.
 */
export function MessageOptionCard({
  message,
  onWhatsApp,
  onShare,
}: MessageOptionCardProps): React.JSX.Element {
  return (
    <View className="mb-3 mr-8 rounded-2xl rounded-tl-sm border border-border bg-white p-3.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-slate-900">
          {TONE_ICON[message.tone]} {TONE_LABEL[message.tone]}
        </Text>
        {message.recommended ? (
          <View className="rounded-full bg-primary/10 px-2 py-0.5">
            <Text className="text-[10px] font-bold text-primary">
              ★ Recommended
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="mt-2 text-sm leading-5 text-slate-800">
        {message.text}
      </Text>

      <View className="mt-3 flex-row" style={{gap: 8}}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onWhatsApp(message.text)}
          className="h-10 flex-1 flex-row items-center justify-center rounded-xl bg-success">
          <Text className="text-sm font-semibold text-white">
            🟢 Send on WhatsApp
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onShare(message.text)}
          className="h-10 w-12 items-center justify-center rounded-xl border border-border bg-white">
          <Text className="text-base">↗</Text>
        </Pressable>
      </View>
    </View>
  );
}
