import React from 'react';
import {Modal, Pressable, View} from 'react-native';

import {Text} from './Text';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Tailwind max-height class for the sheet body. */
  maxHeightClassName?: string;
}

/**
 * Reusable bottom-sheet modal: dimmed backdrop, rounded top, tap-outside to
 * close. The inner Pressable swallows touches so taps inside don't dismiss it.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeightClassName = 'max-h-[85%]',
}: BottomSheetProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <Pressable
          className={`rounded-t-3xl bg-white ${maxHeightClassName}`}
          onPress={() => {}}>
          {/* Grab handle */}
          <View className="items-center pt-3">
            <View className="h-1 w-10 rounded-full bg-slate-300" />
          </View>

          {title ? (
            <View className="px-5 pb-2 pt-3">
              <Text variant="title" className="text-lg">
                {title}
              </Text>
            </View>
          ) : null}

          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
