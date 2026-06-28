import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React, {useState} from 'react';

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
            retry: 1,
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
