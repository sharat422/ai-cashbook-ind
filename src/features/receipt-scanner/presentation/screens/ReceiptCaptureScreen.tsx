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
import type {AppScreenProps} from '@navigation/types';

function assetToAttachment(asset: Asset): Attachment | null {
  if (!asset.uri) return null;
  return {
    uri: asset.uri,
    fileName: asset.fileName ?? `receipt_${Date.now()}.jpg`,
    type: asset.type ?? 'image/jpeg',
  };
}

/**
 * Step 1 of the scanner: capture a receipt photo (camera) or pick one from the
 * gallery, then hand off to the review screen which runs the AI extraction.
 */
export function ReceiptCaptureScreen({
  navigation,
}: AppScreenProps<'ReceiptCapture'>): React.JSX.Element {
  const onResponse = (res: ImagePickerResponse) => {
    if (res.didCancel) return;
    if (res.errorCode) {
      Alert.alert('Could not get image', res.errorMessage ?? res.errorCode);
      return;
    }
    const asset = res.assets?.[0];
    const image = asset ? assetToAttachment(asset) : null;
    if (image) navigation.replace('ReceiptReview', {image});
  };

  const capture = () =>
    launchCamera(
      {mediaType: 'photo', quality: 0.8, saveToPhotos: false},
      onResponse,
    );

  const pickFromGallery = () =>
    launchImageLibrary(
      {mediaType: 'photo', quality: 0.8, selectionLimit: 1},
      onResponse,
    );

  return (
    <Screen>
      <View className="flex-1 py-8">
        <Text variant="title">Scan a receipt</Text>
        <Text variant="subtitle" className="mt-2">
          Take a clear photo of your bill or receipt. We'll read the details and
          fill in the expense for you.
        </Text>

        {/* Framing hint */}
        <View className="mt-8 flex-1 items-center justify-center">
          <View className="aspect-[3/4] w-3/4 items-center justify-center rounded-3xl border-2 border-dashed border-border bg-white">
            <Text className="text-5xl">🧾</Text>
            <Text variant="caption" className="mt-3 px-6 text-center">
              Place the receipt on a flat surface with good lighting and capture
              the whole bill.
            </Text>
          </View>
        </View>

        <Button title="📷 Take photo" className="mt-6" onPress={capture} />
        <Button
          title="Choose from gallery"
          variant="secondary"
          className="mt-2"
          onPress={pickFromGallery}
        />
      </View>
    </Screen>
  );
}
