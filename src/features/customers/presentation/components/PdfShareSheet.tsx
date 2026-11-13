import React from 'react';
import {View} from 'react-native';

import {BottomSheet, Button, Text} from '@components/ui';
import {useT} from '@/i18n';
import {type PdfChannel} from '../sharePdf';

/** Where a statement / ledger / bill file goes. WhatsApp and "Other apps" need
 *  the retailer's opt-in (the server checks again); email and save always work. */
export function PdfShareSheet({visible, onClose, onPick, optedIn}: {
  visible: boolean;
  onClose: () => void;
  onPick: (channel: PdfChannel) => void;
  /** Unknown (still loading) leaves the choice to the server's check. */
  optedIn?: boolean;
}): React.JSX.Element {
  const t = useT();
  const off = optedIn === false;
  const pick = (c: PdfChannel) => {
    onClose();
    onPick(c);
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('pdfShare.title')}>
      <View className="p-5" style={{gap: 10}}>
        <Button testID="pdf-whatsapp" title={t('pdfShare.whatsapp')} disabled={off} onPress={() => pick('whatsapp')} />
        <Button testID="pdf-email" title={t('pdfShare.email')} variant="secondary" onPress={() => pick('email')} />
        <Button testID="pdf-save" title={t('pdfShare.save')} variant="secondary" onPress={() => pick('save')} />
        <Button testID="pdf-share-sheet" title={t('pdfShare.otherApps')} variant="secondary" disabled={off}
          onPress={() => pick('share_sheet')} />
        <Text variant="caption">{off ? t('pdfShare.noConsentHint') : t('pdfShare.hint')}</Text>
      </View>
    </BottomSheet>
  );
}
