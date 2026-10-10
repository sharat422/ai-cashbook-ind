import {apiRequest} from '@api/client';
import type {
  ConsentChoice,
  ConsentPurpose,
  ConsentSnapshot,
  ConsentState,
} from '@features/consent/domain/entities';

/** Wire shape from the FastAPI backend (snake_case). */
interface ConsentStateDto {
  purpose: ConsentPurpose;
  granted: boolean;
  required: boolean;
  policy_version: string | null;
  updated_at: string | null;
}
interface ConsentSnapshotDto {
  policy_version: string;
  required: ConsentPurpose[];
  optional: ConsentPurpose[];
  consents: ConsentStateDto[];
}

const toState = (d: ConsentStateDto): ConsentState => ({
  purpose: d.purpose,
  granted: d.granted,
  required: d.required,
  policyVersion: d.policy_version,
  updatedAt: d.updated_at,
});

const toSnapshot = (d: ConsentSnapshotDto): ConsentSnapshot => ({
  policyVersion: d.policy_version,
  required: d.required,
  optional: d.optional,
  consents: d.consents.map(toState),
});

/**
 * Remote data source — FastAPI per-purpose consent.
 *   GET /api/v1/consents            → current choices + policy version
 *   PUT /api/v1/consents {choices}  → set one or more purposes
 */
export const consentRemote = {
  async get(): Promise<ConsentSnapshot> {
    return toSnapshot(
      await apiRequest<ConsentSnapshotDto>('/consents', {method: 'GET'}),
    );
  },

  async update(choices: ConsentChoice[]): Promise<ConsentSnapshot> {
    return toSnapshot(
      await apiRequest<ConsentSnapshotDto>('/consents', {
        method: 'PUT',
        body: {
          choices: choices.map(c => ({purpose: c.purpose, granted: c.granted})),
        },
      }),
    );
  },
};
