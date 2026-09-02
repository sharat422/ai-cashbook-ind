import {apiRequest} from '@api/client';
import type {Diagnostics} from '@/services/diagnostics/collectDiagnostics';

export type FeedbackKind = 'bug' | 'feedback';

/** Remote data source — POST /api/v1/feedback (stored centrally for support). */
export const feedbackRemote = {
  async submit(
    kind: FeedbackKind,
    message: string,
    diagnostics: Diagnostics,
  ): Promise<{ok: boolean; id: string}> {
    return apiRequest<{ok: boolean; id: string}>('/feedback', {
      method: 'POST',
      body: {kind, message, diagnostics},
    });
  },
};
