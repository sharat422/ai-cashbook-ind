import {NetworkError} from '@api/client';
import type {DashboardSummary} from '@features/dashboard/domain/entities';
import type {DashboardRepository} from '@features/dashboard/domain/repository';
import {dashboardLocal} from './dashboard.local';
import {dashboardRemote} from './dashboard.remote';

/**
 * Concrete dashboard repository.
 *
 * Tries the backend first, adding the entries still waiting to sync (the
 * server hasn't got them yet, but they're in Recent activity). If the device
 * is offline / the request times out (NetworkError), it falls back to figures
 * computed locally from stored entries so the dashboard stays useful offline.
 * A genuine server/HTTP error (ApiError) is rethrown so the UI can show its
 * error state.
 */
export const dashboardRepository: DashboardRepository = {
  async getSummary(): Promise<DashboardSummary> {
    try {
      const remote = await dashboardRemote.getSummary();
      const p = dashboardLocal.computeSummary(e => e.syncStatus === 'pending');
      return {
        ...remote,
        todayIncome: remote.todayIncome + p.todayIncome,
        todayExpense: remote.todayExpense + p.todayExpense,
        cashBalance: remote.cashBalance + p.cashBalance,
        monthRevenue: remote.monthRevenue + p.monthRevenue,
        monthExpense: remote.monthExpense + p.monthExpense,
      };
    } catch (err) {
      if (err instanceof NetworkError) {
        return dashboardLocal.computeSummary();
      }
      throw err;
    }
  },
};
