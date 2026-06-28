import {apiRequest} from '@api/client';
import type {
  KhataFilters,
  KhataSummary,
} from '@features/khata/domain/entities';
import {toKhataSummary, type KhataSummaryDto} from './khata.dto';

/**
 * Remote data source.
 *
 *   GET /api/v1/khata/summary?from&to&branch&business -> KhataSummaryDto
 */
export const khataRemote = {
  async getSummary(filters: KhataFilters): Promise<KhataSummary> {
    const params = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      branch: filters.branch,
      business: filters.business,
    });
    const dto = await apiRequest<KhataSummaryDto>(
      `/khata/summary?${params.toString()}`,
      {method: 'GET'},
    );
    return toKhataSummary(dto);
  },
};
