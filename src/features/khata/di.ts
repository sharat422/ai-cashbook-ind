/**
 * Composition root for the Khata dashboard feature.
 */
import {khataRepository} from './data/khata.repository';
import {getKhataSummaryUseCase} from './domain/usecases/getKhataSummary';

export const khataUseCases = {
  getSummary: getKhataSummaryUseCase(khataRepository),
};
