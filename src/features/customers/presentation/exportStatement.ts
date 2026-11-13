import {Alert, Linking} from 'react-native';

import {ApiError, NetworkError} from '@api/client';
import {statementsRemote} from '@features/customers/data/statements.remote';
import type {Customer} from '@features/customers/domain/entities';
import {tNow} from '@/i18n';

// Statement links (WhatsApp, SMS). Statement, ledger and bill FILES go through
// sharePdf.ts, which checks the retailer's consent before anything is shared.

/**
 * Send the retailer a link to their statement on WhatsApp. The server checks
 * their opt-in first (409 = no consent / opted out) and logs every attempt.
 * Returns false when it was refused for lack of consent.
 */
export async function shareStatementOnWhatsApp(customer: Customer, from?: string, detailed = false): Promise<boolean> {
  try {
    const share = await statementsRemote.whatsapp(customer.id, from, 'phone', detailed);
    const wa = `whatsapp://send?phone=91${share.mobile}&text=${encodeURIComponent(share.message)}`;
    if (!(await Linking.canOpenURL(wa))) {
      Alert.alert(tNow('statement.noWhatsapp'), tNow('statement.noWhatsappMsg'));
      return true;
    }
    await Linking.openURL(wa);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return false;
    Alert.alert(tNow('statement.shareFailed'), errorText(err));
    return true;
  }
}

/** Text the retailer a link to their statement (opens in any browser). */
export async function shareStatementLinkBySms(customer: Customer, from?: string, detailed = false): Promise<void> {
  try {
    const {url} = await statementsRemote.link(customer.id, from, detailed);
    const body = tNow('statement.smsBody', {url});
    await Linking.openURL(`sms:${customer.mobile}?body=${encodeURIComponent(body)}`);
  } catch (err) {
    Alert.alert(tNow('statement.shareFailed'), errorText(err));
  }
}

/** API errors are already in the user's language; anything else gets a generic line. */
function errorText(err: unknown): string {
  return err instanceof ApiError || err instanceof NetworkError ? err.message : tNow('common.tryAgainMsg');
}
