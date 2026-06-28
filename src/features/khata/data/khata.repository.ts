import {NetworkError} from '@api/client';
import type {
  KhataFilters,
  KhataSummary,
} from '@features/khata/domain/entities';
import type {KhataRepository} from '@features/khata/domain/repository';
import {khataLocal} from './khata.local';
import {khataRemote} from './khata.remote';

/**
 * Concrete repository. Backend-first; on a network failure it computes the
 * trend + today's collections locally (the rest needs the full customer set,
 * so it's left empty). A server error is rethrown for the error state.
 */
export const khataRepository: KhataRepository = {
  async getSummary(filters: KhataFilters): Promise<KhataSummary> {
    try {
      return await khataRemote.getSummary(filters);
    } catch (err) {
      if (err instanceof NetworkError) return khataLocal.computeSummary(filters);
      throw err;
    }
  },
};
