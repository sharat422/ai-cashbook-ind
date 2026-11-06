import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {
  stockRemote,
  type CountInput,
  type MoveInput,
  type StockItem,
  type StockMove,
  type TransferInput,
  type Van,
  type VanItem,
} from '@features/stock/data/stock.remote';

export const STOCK_KEY = 'stock';

/** A retry-safe id: the server saves a request with the same id only once. */
export const makeStockClientId = (): string =>
  `stock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const useStockLevels = () => useQuery<{items: StockItem[]; vans: Van[]}>({queryKey: [STOCK_KEY, 'levels'], queryFn: stockRemote.levels});

export const useVanStock = (userId?: string) =>
  useQuery<VanItem[]>({queryKey: [STOCK_KEY, 'van', userId ?? 'me'], queryFn: () => stockRemote.van(userId)});

export const useStockMoves = (itemId?: string) =>
  useQuery<StockMove[]>({queryKey: [STOCK_KEY, 'moves', itemId ?? 'all'], queryFn: () => stockRemote.moves(itemId)});

export function useStockMutations() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({queryKey: [STOCK_KEY]});
    qc.invalidateQueries({queryKey: ['items']});
  };
  return {
    record: useMutation({mutationFn: (i: MoveInput) => stockRemote.record(i), onSuccess}),
    transfer: useMutation({mutationFn: (i: TransferInput) => stockRemote.transfer(i), onSuccess}),
    count: useMutation({mutationFn: (i: CountInput) => stockRemote.count(i), onSuccess}),
  };
}
