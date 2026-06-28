import {Alert, Linking} from 'react-native';
import RNFS from 'react-native-fs';
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import Share, {Social, type ShareSingleOptions} from 'react-native-share';

import {
  statementToCsv,
  statementToText,
  type CustomerStatement,
} from '@features/customers/domain/customerStatement';
import type {Customer} from '@features/customers/domain/entities';
import {buildStatementHtml} from '@features/customers/domain/statementHtml';

export type ExportFormat = 'pdf' | 'excel' | 'whatsapp';

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
  if (!filePath) throw new Error('Could not generate the PDF.');
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

/**
 * Export a statement as a real PDF or XLSX file (shared via the OS share sheet),
 * or send the PDF to the customer over WhatsApp (with a text-link fallback).
 */
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
        title: 'Customer statement',
        failOnCancel: false,
      });
      return;
    }

    const pdfPath = await makePdf(customer, statement, businessName);

    if (format === 'pdf') {
      await Share.open({
        url: fileUri(pdfPath),
        type: 'application/pdf',
        title: 'Customer statement',
        failOnCancel: false,
      });
      return;
    }

    // WhatsApp: share the PDF into WhatsApp (user picks the customer chat);
    // fall back to a text deep link straight to the customer's number.
    try {
      const options: ShareSingleOptions = {
        social: Social.Whatsapp,
        url: fileUri(pdfPath),
        type: 'application/pdf',
        message: statementToText(customer, statement),
      };
      await Share.shareSingle(options);
    } catch (waErr) {
      if (isCancel(waErr)) return;
      const text = statementToText(customer, statement);
      const wa = `whatsapp://send?phone=91${customer.mobile}&text=${encodeURIComponent(text)}`;
      const sms = `sms:${customer.mobile}?body=${encodeURIComponent(text)}`;
      const canWa = await Linking.canOpenURL(wa);
      await Linking.openURL(canWa ? wa : sms);
    }
  } catch (err) {
    if (isCancel(err)) return;
    Alert.alert(
      'Export failed',
      err instanceof Error ? err.message : 'Please try again.',
    );
  }
}
