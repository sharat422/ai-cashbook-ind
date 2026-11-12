import {Alert} from 'react-native';
import Share, {Social} from 'react-native-share';

import {ApiError, NetworkError} from '@api/client';
import {schemesRemote, type Bill} from '@features/schemes/data/schemes.remote';
import {tNow} from '@/i18n';

/** True when the user simply backed out of WhatsApp. */
const isCancel = (err: unknown): boolean =>
  /cancel|did not share|dismiss/i.test(err instanceof Error ? err.message : String(err));

/**
 * Send the bill's PDF to the retailer in the owner's own WhatsApp (until the
 * approved WhatsApp template exists). The PDF comes only from the server,
 * which checks the retailer's opt-in first (409 = no consent / opted out) and
 * logs the send or the refusal, so no share path skips the consent check.
 * Returns false when it was refused for lack of consent.
 */
export async function shareBillOnWhatsApp(
  bill: Pick<Bill, 'id' | 'billNumber'>,
  customer: {mobile?: string | null},
): Promise<boolean> {
  try {
    const path = await schemesRemote.billPdf(bill.id, bill.billNumber);
    const digits = (customer.mobile ?? '').replace(/\D/g, '');
    await Share.shareSingle({
      social: Social.Whatsapp,
      url: path.startsWith('file://') ? path : `file://${path}`,
      type: 'application/pdf',
      filename: `Bill_${bill.billNumber}`,
      ...(digits ? {whatsAppNumber: digits.length === 10 ? `91${digits}` : digits} : {}),
    });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return false;
    }
    if (isCancel(err)) {
      return true;
    }
    if (err instanceof ApiError || err instanceof NetworkError) {
      Alert.alert(tNow('statement.shareFailed'), err.message);
    } else {
      Alert.alert(tNow('statement.noWhatsapp'), tNow('bill.noWhatsappMsg'));
    }
    return true;
  }
}
