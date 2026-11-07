import {Alert, Linking} from 'react-native';
import RNFS from 'react-native-fs';
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import Share from 'react-native-share';

import {ApiError, NetworkError} from '@api/client';
import {statementsRemote} from '@features/customers/data/statements.remote';
import {
  statementToCsv,
  type CustomerStatement,
} from '@features/customers/domain/customerStatement';
import type {Customer} from '@features/customers/domain/entities';
import {buildStatementHtml} from '@features/customers/domain/statementHtml';
import {tNow} from '@/i18n';

export type ExportFormat = 'pdf' | 'excel';

const safeName = (s: string): string =>
  s.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'customer';

const fileUri = (path: string): string =>
  path.startsWith('file://') ? path : `file://${path}`;

/** Render the statement HTML to a real PDF file and return its path. */
async function makePdf(
  customer: Customer,
  statement: CustomerStatement,
  businessName?: string,
): Promise<string> {
  const html = buildStatementHtml(customer, statement, businessName);
  const {filePath} = await RNHTMLtoPDF.convert({
    html,
    fileName: `Statement_${safeName(customer.fullName)}`,
    directory: 'Documents',
  });
  if (!filePath) throw new Error(tNow('statement.pdfFailed'));
  return filePath;
}

/** Write a CSV file (opens in Excel / Google Sheets) and return its path. */
async function makeCsv(
  customer: Customer,
  statement: CustomerStatement,
): Promise<string> {
  const csv = statementToCsv(statement);
  const path = `${RNFS.DocumentDirectoryPath}/Statement_${safeName(
    customer.fullName,
  )}.csv`;
  await RNFS.writeFile(path, csv, 'utf8');
  return path;
}

/** True when the user simply dismissed the share sheet. */
function isCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /cancel|did not share|dismiss/i.test(msg);
}

/** Export a statement as a PDF or CSV file through the OS share sheet. */
export async function exportStatement(
  format: ExportFormat,
  customer: Customer,
  statement: CustomerStatement,
  businessName?: string,
): Promise<void> {
  try {
    if (format === 'excel') {
      const path = await makeCsv(customer, statement);
      await Share.open({
        url: fileUri(path),
        type: 'text/csv',
        filename: `Statement_${safeName(customer.fullName)}`,
        title: tNow('statement.shareTitle'),
        failOnCancel: false,
      });
      return;
    }

    // WhatsApp to the retailer goes through shareStatementOnWhatsApp, which the
    // server refuses without the retailer's opt-in.
    const pdfPath = await makePdf(customer, statement, businessName);
    await Share.open({
      url: fileUri(pdfPath),
      type: 'application/pdf',
      title: tNow('statement.shareTitle'),
      failOnCancel: false,
    });
  } catch (err) {
    if (isCancel(err)) return;
    Alert.alert(tNow('statement.exportFailed'), errorText(err));
  }
}

/**
 * Send the retailer a link to their statement on WhatsApp. The server checks
 * their opt-in first (409 = no consent / opted out) and logs every attempt.
 * Returns false when it was refused for lack of consent.
 */
export async function shareStatementOnWhatsApp(customer: Customer, from?: string): Promise<boolean> {
  try {
    const share = await statementsRemote.whatsapp(customer.id, from, 'phone');
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
export async function shareStatementLinkBySms(customer: Customer, from?: string): Promise<void> {
  try {
    const {url} = await statementsRemote.link(customer.id, from);
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
