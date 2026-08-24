import {useMutation} from '@tanstack/react-query';

import {assistantRemote} from '@features/assistant/data/assistant.remote';

export function useAsk() {
  return useMutation({
    mutationFn: (question: string) => assistantRemote.ask(question),
  });
}
