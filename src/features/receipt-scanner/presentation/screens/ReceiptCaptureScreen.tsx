import React from 'react';
import {Alert, View} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type ImagePickerResponse,
} from 'react-native-image-picker';

import {Button, Screen, Text} from '@components/ui';
import type {Attachment} from '@features/receipt-scanner/domain/entities';
import {useT} from '@/i18n';
import type {AppScreenProps} from '@navigation/types';

/** iOS often reports "image/jpg", which the OCR backend's vision API rejects. */
export function normalizeImageType(type: string | undefined): string {
  const t = (type ?? '').toLowerCase();
  if (!t || t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg';
  return t;
}

export function assetToAttachment(asset: Asset): Attachment | null {
  if (!asset.uri) return null;
  return {
    uri: asset.uri,
    fileName: asset.fileName ?? `receipt_${Date.now()}.jpg`,
    type: normalizeImageType(asset.type),
  };
}

/**
 * Receipts only need enough resolution to read the text. A full 12 MP camera
 * shot is several MB — slow to upload on mobile data and over the vision
 * model's size limit — so we downscale on device. "compatible" makes iOS hand
 * us a JPEG instead of a HEIC from the gallery.
 */
const PHOTO_OPTIONS = {
  mediaType: 'photo',
  quality: 0.8,
  maxWidth: 2000,
  maxHeight: 2000,
  assetRepresentationMode: 'compatible',
} as const;

/**
 * Step 1 of the scanner: capture a receipt photo (camera) or pick one from the
 * gallery, then hand off to the review screen which runs the AI extraction.
 */
export function ReceiptCaptureScreen({
  navigation,
}: AppScreenProps<'ReceiptCapture'>): React.JSX.Element {
  const t = useT();
  const onResponse = (res: ImagePickerResponse) => {
    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert(t('receipt.couldNotGetImage'), res.errorMessage ?? res.errorCode);
      return;
    }
    const asset = res.assets?.[0];
    const image = asset ? assetToAttachment(asset) : null;
    if (image) navigation.replace('ReceiptReview', {image});
  };

  const capture = () =>
    launchCamera(
      {...PHOTO_OPTIONS, saveToPhotos: false},
      onResponse,
    );

  const pickFromGallery = () =>
    launchImageLibrary(
      {...PHOTO_OPTIONS, selectionLimit: 1},
      onResponse,
    );

  return (
    <Screen>
      <View className="flex-1 py-8">
        <Text variant="title">{t('receipt.captureTitle')}</Text>
        <Text variant="subtitle" className="mt-2">
          {t('receipt.captureSubtitle')}
        </Text>

        {/* Framing hint */}
        <View className="mt-8 flex-1 items-center justify-center">
          <View className="aspect-[3/4] w-3/4 items-center justify-center rounded-3xl border-2 border-dashed border-border bg-white">
            <Text className="text-5xl">🧾</Text>
            <Text variant="caption" className="mt-3 px-6 text-center">
              {t('receipt.frameHint')}
            </Text>
          </View>
        </View>

        <Button title={t('receipt.takePhoto')} className="mt-6" onPress={capture} />
        <Button
          title={t('receipt.chooseGallery')}
          variant="secondary"
          className="mt-2"
          onPress={pickFromGallery}
        />
      </View>
    </Screen>
  );
}
