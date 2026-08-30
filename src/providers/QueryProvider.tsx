import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React, {useState} from 'react';

import {retryDelayMs, shouldRetryRequest} from '@api/client';

/**
 * Hosts a single QueryClient for the app. Created lazily inside state so it
 * survives Fast Refresh without being re-instantiated on every render.
 */
export function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Ride out free-tier cold-start connection resets/timeouts; never
            // retry deterministic API errors. See src/api/client.ts.
            retry: shouldRetryRequest,
            retryDelay: retryDelayMs,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
