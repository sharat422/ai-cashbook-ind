import {apiRequest} from '@api/client';

export interface BusinessSummary {
  yesterday: {sales: number; collections: number; expenses: number};
  outstanding: number;
  overdue: number;
  expectedCollectionToday: number;
  customersNeedAttention: number;
  month: {
    sales: number;
    expenses: number;
    collections: number;
    profit: number;
    margin: number;
  };
  trends: {
    salesPct: number | null;
    collectionsPct: number | null;
    expensesPct: number | null;
  };
  forecast: {
    expectedCollections: number;
    expectedExpenses: number;
    net: number;
  };
}

const n = (v: any): number => Number(v ?? 0);
const pctOrNull = (v: any): number | null =>
  v === null || v === undefined ? null : Number(v);

export const businessRemote = {
  async summary(): Promise<BusinessSummary> {
    const d = await apiRequest<any>('/business/summary', {method: 'GET'});
    return {
      yesterday: {
        sales: n(d.yesterday?.sales),
        collections: n(d.yesterday?.collections),
        expenses: n(d.yesterday?.expenses),
      },
      outstanding: n(d.outstanding),
      overdue: n(d.overdue),
      expectedCollectionToday: n(d.expected_collection_today),
      customersNeedAttention: n(d.customers_need_attention),
      month: {
        sales: n(d.month?.sales),
        expenses: n(d.month?.expenses),
        collections: n(d.month?.collections),
        profit: n(d.month?.profit),
        margin: n(d.month?.margin),
      },
      trends: {
        salesPct: pctOrNull(d.trends?.sales_pct),
        collectionsPct: pctOrNull(d.trends?.collections_pct),
        expensesPct: pctOrNull(d.trends?.expenses_pct),
      },
      forecast: {
        expectedCollections: n(d.forecast?.expected_collections),
        expectedExpenses: n(d.forecast?.expected_expenses),
        net: n(d.forecast?.net),
      },
    };
  },
};
