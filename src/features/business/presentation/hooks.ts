import {useQuery} from '@tanstack/react-query';

import {businessRemote} from '@features/business/data/business.remote';

export function useBusinessSummary() {
  return useQuery({queryKey: ['business-summary'], queryFn: businessRemote.summary});
}
