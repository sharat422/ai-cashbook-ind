import {useMutation} from '@tanstack/react-query';

import {aiEntryRemote} from '@features/ai-entry/data/aiEntry.remote';
import type {RecordedAudio} from '@features/ai-entry/data/voiceRecorder';

/** Parse a spoken/typed sentence into a structured transaction. */
export function useParseTransaction() {
  return useMutation({
    mutationFn: ({text, today}: {text: string; today: string}) =>
      aiEntryRemote.parse(text, today),
  });
}

/** Transcribe (any language) + parse a recorded voice clip in one call. */
export function useVoiceParse() {
  return useMutation({
    mutationFn: ({
      audio,
      today,
      language,
    }: {
      audio: RecordedAudio;
      today: string;
      language?: string;
    }) => aiEntryRemote.voiceParse(audio, today, language),
  });
}
