import {useQuery} from '@tanstack/react-query';

import {customerIntelRemote} from '@features/customer-intel/data/customerIntel.remote';

export function useCustomerAging() {
  return useQuery({queryKey: ['customer-aging'], queryFn: customerIntelRemote.aging});
}

export function useCustomerInsights() {
  return useQuery({
    queryKey: ['customer-insights'],
    queryFn: customerIntelRemote.insights,
  });
}
