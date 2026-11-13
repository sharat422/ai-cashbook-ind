import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Alert} from 'react-native';

import {NetworkError} from '@api/client';
import {saveStock, useStockQueue} from '@features/stock/data/stockQueue';
import {tNow} from '@/i18n';
import {connectivity} from '@/services/network/connectivity';

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

/** A count is the stock at one moment: never queued (yesterday's count would
 *  overwrite today's stock). Offline, it's refused with a plain message. */
export async function saveCount(i: CountInput) {
  if (!(await connectivity.isOnline())) throw new Error(tNow('stock.countNeedsConnection'));
  return stockRemote.count(i);
}

/** A retry-safe id: the server saves a request with the same id only once. */
export const makeStockClientId = (): string =>
  `stock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const useStockLevels = () => useQuery<{items: StockItem[]; vans: Van[]}>({queryKey: [STOCK_KEY, 'levels'], queryFn: stockRemote.levels});

/** A van's stock. Your own van is kept on the phone, so it can be billed from
 *  with no signal (the server re-checks the stock when the bill syncs). */
export const useVanStock = (userId?: string) =>
  useQuery<VanItem[]>({
    queryKey: [STOCK_KEY, 'van', userId ?? 'me'],
    queryFn: async () => {
      try {
        const v = await stockRemote.van(userId);
        if (!userId) useStockQueue.setState({van: v});
        return v;
      } catch (err) {
        const kept = useStockQueue.getState().van;
        if (err instanceof NetworkError && !userId && kept) return kept;
        throw err;
      }
    },
  });

export const useStockMoves = (itemId?: string) =>
  useQuery<StockMove[]>({queryKey: [STOCK_KEY, 'moves', itemId ?? 'all'], queryFn: () => stockRemote.moves(itemId)});

export function useStockMutations() {
  const qc = useQueryClient();
  const onSuccess = () => {
    qc.invalidateQueries({queryKey: [STOCK_KEY]});
    qc.invalidateQueries({queryKey: ['items']});
  };
  const queuedOrSaved = (result: 'saved' | 'queued') => {
    if (result === 'queued') Alert.alert(tNow('stock.queuedTitle'), tNow('stock.queuedMsg'));
    else onSuccess();
  };
  return {
    // Moves and transfers: saved now, or queued offline with the other entries.
    record: useMutation({
      mutationFn: ({itemName, ...input}: MoveInput & {itemName?: string}) =>
        saveStock({op: 'move', input, itemName: itemName ?? ''}),
      onSuccess: queuedOrSaved,
    }),
    transfer: useMutation({
      mutationFn: ({itemName, ...input}: TransferInput & {itemName?: string}) =>
        saveStock({op: 'transfer', input, itemName: itemName ?? ''}),
      onSuccess: queuedOrSaved,
    }),
    // A count is the stock at one moment: never queued (yesterday's count
    // would overwrite today's stock), refused offline.
    count: useMutation({mutationFn: saveCount, onSuccess}),
    reverse: useMutation({mutationFn: (moveId: string) => stockRemote.reverse(moveId), onSuccess}),
  };
}
