import {useMutation} from '@tanstack/react-query';

import {aiEntryRemote} from '@features/ai-entry/data/aiEntry.remote';

/** Parse a spoken/typed sentence into a structured transaction. */
export function useParseTransaction() {
  return useMutation({
    mutationFn: ({text, today}: {text: string; today: string}) =>
      aiEntryRemote.parse(text, today),
  });
}
