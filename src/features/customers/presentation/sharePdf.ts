import {Alert, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import RNHTMLtoPDF from 'react-native-html-to-pdf';
import Share from 'react-native-share';

import {ApiError} from '@api/client';
import {downloadFile} from '@api/download';
import {statementsRemote} from '@features/customers/data/statements.remote';
import {statementToCsv, type CustomerStatement} from '@features/customers/domain/customerStatement';
import type {Customer} from '@features/customers/domain/entities';
import {buildStatementHtml} from '@features/customers/domain/statementHtml';
import {schemesRemote, type Bill} from '@features/schemes/data/schemes.remote';
import {tNow} from '@/i18n';

/** whatsapp / share_sheet need the retailer's opt-in (the open share sheet
 *  reaches WhatsApp too); email and save are logged, never gated. */
export type PdfChannel = 'whatsapp' | 'email' | 'save' | 'share_sheet';
export const GATED_CHANNELS: PdfChannel[] = ['whatsapp', 'share_sheet'];

export type PdfDoc =
  | {kind: 'statement'; format: 'pdf' | 'csv'; customer: Customer; statement: CustomerStatement;
      businessName?: string; from?: string; to?: string}
  | {kind: 'ledger'; customer: Customer; from: string; to: string; detailed?: boolean}
  | {kind: 'bill'; bill: Bill};

interface File {
  path: string;
  mime: string;
  name: string;
}

const safeName = (s: string): string => s.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'customer';
const fileUri = (path: string): string => (path.startsWith('file://') ? path : `file://${path}`);

/**
 * The ONE way a statement, ledger or bill file leaves the phone (ST3). The
 * server's check comes first — share_statement_pdf: WhatsApp and the open share
 * sheet need the retailer's opt-in, everything is logged — and only then is the
 * file made, and it goes out on the chosen channel alone. Refused: the owner
 * is told "No consent — ask the retailer to opt in", and nothing is shared.
 */
export async function sharePdf(doc: PdfDoc, channel: PdfChannel): Promise<'shared' | 'refused'> {
  let check: {mobile?: string | null; pdfUrl?: string | null};
  try {
    check = doc.kind === 'bill'
      ? await schemesRemote.shareBill(doc.bill.id, channel)
      : await statementsRemote.pdfShare(doc.customer.id,
        doc.kind === 'ledger' ? 'ledger' : doc.format === 'csv' ? 'statement_csv' : 'statement',
        channel, doc.from, doc.to, doc.kind === 'ledger' && !!doc.detailed);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      Alert.alert(tNow('pdfShare.noConsentTitle'), tNow('pdfShare.noConsent'));
      return 'refused';
    }
    throw err;
  }
  const file = await makeFile(doc, check.pdfUrl ?? null);
  await deliver(file, channel, check.mobile ?? '');
  return 'shared';
}

async function makeFile(doc: PdfDoc, pdfUrl: string | null): Promise<File> {
  if (doc.kind === 'bill') {
    const name = `Bill_${doc.bill.billNumber}.pdf`;
    return {path: await downloadFile(pdfUrl!, name), mime: 'application/pdf', name};
  }
  const who = safeName(doc.customer.fullName);
  if (doc.kind === 'ledger') {
    const name = `Ledger_${who}_${doc.from}_${doc.to}.pdf`;
    return {path: await downloadFile(pdfUrl!, name), mime: 'application/pdf', name};
  }
  if (doc.format === 'csv') {
    const name = `Statement_${who}.csv`;
    const path = `${RNFS.DocumentDirectoryPath}/${name}`;
    await RNFS.writeFile(path, statementToCsv(doc.statement), 'utf8');
    return {path, mime: 'text/csv', name};
  }
  const {filePath} = await RNHTMLtoPDF.convert({
    html: buildStatementHtml(doc.customer, doc.statement, doc.businessName),
    fileName: `Statement_${who}`,
    directory: 'Documents',
  });
  if (!filePath) throw new Error(tNow('statement.pdfFailed'));
  return {path: filePath, mime: 'application/pdf', name: `Statement_${who}.pdf`};
}

async function deliver(file: File, channel: PdfChannel, mobile: string): Promise<void> {
  const url = fileUri(file.path);
  if (channel === 'whatsapp') {
    const digits = mobile.replace(/\D/g, '');
    await Share.shareSingle({
      social: Share.Social.WHATSAPP, url, type: file.mime, filename: file.name,
      whatsAppNumber: digits.length === 10 ? `91${digits}` : digits, failOnCancel: false,
    } as never);
  } else if (channel === 'email') {
    await Share.shareSingle({
      social: Share.Social.EMAIL, url, type: file.mime, filename: file.name, subject: file.name, failOnCancel: false,
    } as never);
  } else if (channel === 'save') {
    if (Platform.OS === 'ios') {
      await Share.open({url, type: file.mime, filename: file.name, saveToFiles: true, failOnCancel: false});
    } else {
      const dest = `${RNFS.DownloadDirectoryPath}/${file.name}`;
      await RNFS.copyFile(file.path, dest);
      Alert.alert(tNow('pdfShare.savedTitle'), tNow('pdfShare.savedMsg', {name: file.name}));
    }
  } else {
    await Share.open({url, type: file.mime, filename: file.name, failOnCancel: false});
  }
}
