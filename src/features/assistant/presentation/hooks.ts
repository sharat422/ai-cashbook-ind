import {useMutation} from '@tanstack/react-query';

import {
  assistantRemote,
  type AskInput,
} from '@features/assistant/data/assistant.remote';

export function useAsk() {
  return useMutation({
    mutationFn: (input: AskInput) => assistantRemote.ask(input),
  });
}

export function useDeleteAskAiHistory() {
  return useMutation({mutationFn: () => assistantRemote.deleteHistory()});
}
