import React from 'react';
import {ActionSheetIOS, Alert, Image, Platform, Pressable, View} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type ImagePickerResponse,
} from 'react-native-image-picker';

import {Text} from '@components/ui';
import type {Attachment} from '@/shared/types/attachment';

export interface AttachmentPickerProps {
  value: Attachment | null;
  onChange: (attachment: Attachment | null) => void;
}

function assetToAttachment(asset: Asset): Attachment | null {
  if (!asset.uri) return null;
  return {
    uri: asset.uri,
    fileName: asset.fileName ?? `attachment_${Date.now()}.jpg`,
    type: asset.type ?? 'image/jpeg',
  };
}

/**
 * Image attachment control: pick from camera or gallery, preview the thumbnail,
 * and remove. Emits a domain `Attachment` ready for multipart upload.
 */
export function AttachmentPicker({
  value,
  onChange,
}: AttachmentPickerProps): React.JSX.Element {
  const handleResponse = (res: ImagePickerResponse) => {
    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert('Could not add image', res.errorMessage ?? res.errorCode);
      return;
    }
    const asset = res.assets?.[0];
    const attachment = asset ? assetToAttachment(asset) : null;
    if (attachment) onChange(attachment);
  };

  const pickFromGallery = () =>
    launchImageLibrary(
      {mediaType: 'photo', quality: 0.7, selectionLimit: 1},
      handleResponse,
    );

  const takePhoto = () =>
    launchCamera({mediaType: 'photo', quality: 0.7, saveToPhotos: false}, handleResponse);

  const openOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Gallery'],
          cancelButtonIndex: 0,
        },
        index => {
          if (index === 1) takePhoto();
          if (index === 2) pickFromGallery();
        },
      );
    } else {
      Alert.alert('Add attachment', undefined, [
        {text: 'Take Photo', onPress: takePhoto},
        {text: 'Choose from Gallery', onPress: pickFromGallery},
        {text: 'Cancel', style: 'cancel'},
      ]);
    }
  };

  if (value) {
    return (
      <View className="flex-row items-center rounded-xl border border-border bg-white p-3">
        <Image
          source={{uri: value.uri}}
          className="h-14 w-14 rounded-lg"
          resizeMode="cover"
        />
        <Text className="ml-3 flex-1 text-sm text-slate-700" numberOfLines={1}>
          {value.fileName}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(null)}
          className="ml-2 px-2 py-1">
          <Text className="text-sm font-semibold text-danger">Remove</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openOptions}
      className="h-14 flex-row items-center justify-center rounded-xl border border-dashed border-border bg-white">
      <Text className="text-base font-medium text-primary">
        + Add receipt / image
      </Text>
    </Pressable>
  );
}
