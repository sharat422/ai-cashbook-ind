import {useMutation} from '@tanstack/react-query';

import type {RecordedAudio} from '@features/ai-entry/data/voiceRecorder';
import {
  expenseParseRemote,
  type ParsedExpense,
} from '@features/expense/data/expenseParse.remote';

/** Transcribe + extract an expense from a recorded clip (any language). */
export function useVoiceExpense() {
  return useMutation<
    ParsedExpense,
    Error,
    {audio: RecordedAudio; today: string; language?: string}
  >({
    mutationFn: ({audio, today, language}) =>
      expenseParseRemote.voiceParse(audio, today, language),
  });
}
