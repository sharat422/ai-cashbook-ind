import {useEffect, useState} from 'react';

import {connectivity} from '@/services/network/connectivity';

/** Reactive online/offline flag for badges and disabled states. */
export function useConnectivity(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    connectivity.isOnline().then(value => mounted && setOnline(value));
    const unsubscribe = connectivity.subscribe(setOnline);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return online;
}
