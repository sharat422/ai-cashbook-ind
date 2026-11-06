import RNFS from 'react-native-fs';
import Share from 'react-native-share';

import {apiRequest} from '@api/client';
import {API_ROOT} from '@config/env';
import {useAuthStore} from '@store/auth.store';

/** Exact decimal string from the server, e.g. "1180.00". */
export type Money = string;

export interface GstPreviewInput {
  amount: number;
  rate: string;
  priceIncludesGst: boolean;
  customerGstin?: string;
  placeOfSupply?: string;
}

/** The tax split the server will save. The app never computes tax itself. */
export interface GstPreview {
  placeOfSupply: string;
  interState: boolean;
  taxableValue: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  total: Money;
}

export interface GstSummary {
  from: string;
  to: string;
  invoices: number;
  rateChanges: number;
  taxableValue: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  total: Money;
}

/** The four CA files. Working files for the CA — not a GST return filing. */
export type GstReport = 'gstr1.xlsx' | 'gstr3b-summary.xlsx' | 'tally-export.xlsx' | 'tally-export.csv';

const MIME: Record<GstReport, string> = {
  'gstr1.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'gstr3b-summary.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'tally-export.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'tally-export.csv': 'text/csv',
};

const FILE_STEM: Record<GstReport, string> = {
  'gstr1.xlsx': 'GSTR1_ready',
  'gstr3b-summary.xlsx': 'GSTR3B_summary',
  'tally-export.xlsx': 'Tally_sales',
  'tally-export.csv': 'Tally_sales',
};

export const gstRemote = {
  async preview(input: GstPreviewInput): Promise<GstPreview> {
    const r = await apiRequest<{
      place_of_supply: string;
      inter_state: boolean;
      taxable_value: Money;
      cgst: Money;
      sgst: Money;
      igst: Money;
      total: Money;
    }>('/gst/preview', {
      method: 'POST',
      body: {
        amount: input.amount,
        rate: input.rate,
        price_includes_gst: input.priceIncludesGst,
        customer_gstin: input.customerGstin || null,
        place_of_supply: input.placeOfSupply || null,
      },
    });
    return {
      placeOfSupply: r.place_of_supply,
      interState: r.inter_state,
      taxableValue: r.taxable_value,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      total: r.total,
    };
  },

  async summary(from: string, to: string): Promise<GstSummary> {
    const r = await apiRequest<Record<string, string | number>>(
      `/reports/gst-summary?from=${from}&to=${to}`,
      {method: 'GET'},
    );
    return {
      from: String(r.from),
      to: String(r.to),
      invoices: Number(r.invoices),
      rateChanges: Number(r.rate_changes),
      taxableValue: String(r.taxable_value),
      cgst: String(r.cgst),
      sgst: String(r.sgst),
      igst: String(r.igst),
      total: String(r.total),
    };
  },

  /** Download one CA file to the device and open the share sheet. */
  async download(report: GstReport, from: string, to: string): Promise<void> {
    const ext = report.endsWith('.csv') ? 'csv' : 'xlsx';
    const path = `${RNFS.DocumentDirectoryPath}/${FILE_STEM[report]}_${from}_${to}.${ext}`;
    const token = useAuthStore.getState().token;
    const {statusCode} = await RNFS.downloadFile({
      fromUrl: `${API_ROOT}/reports/${report}?from=${from}&to=${to}`,
      toFile: path,
      headers: token ? {Authorization: `Bearer ${token}`} : {},
    }).promise;
    if (statusCode !== 200) {
      await RNFS.unlink(path).catch(() => undefined);
      throw new Error(`Download failed (${statusCode}).`);
    }
    await Share.open({url: `file://${path}`, type: MIME[report], failOnCancel: false});
  },
};
