import {useMutation} from '@tanstack/react-query';

import {
  feedbackRemote,
  type FeedbackKind,
} from '@features/support/data/feedback.remote';
import type {Diagnostics} from '@/services/diagnostics/collectDiagnostics';

export function useSendFeedback() {
  return useMutation({
    mutationFn: ({
      kind,
      message,
      diagnostics,
    }: {
      kind: FeedbackKind;
      message: string;
      diagnostics: Diagnostics;
    }) => feedbackRemote.submit(kind, message, diagnostics),
  });
}
