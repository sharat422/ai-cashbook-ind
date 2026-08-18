import {useEffect, useRef} from 'react';

import {getMyBusiness} from '@api/auth.api';
import {useAuthStore} from '@store/auth.store';

/**
 * On launch, reconcile the business for a returning user who has a valid token
 * but no locally cached business — e.g. they reinstalled, switched devices, or
 * cleared storage. Without this they'd be pushed back through onboarding and
 * could create a duplicate business.
 *
 * Fetches GET /businesses/me once; on success the auth store gains the business
 * (moving the user from onboarding → Dashboard). A 400 (no business yet) is
 * expected for genuinely new users and is ignored, leaving them in onboarding.
 */
export function useSyncBusiness(): void {
  const token = useAuthStore(state => state.token);
  const business = useAuthStore(state => state.business);
  const setBusiness = useAuthStore(state => state.setBusiness);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || business || attempted.current) return;
    attempted.current = true;

    let active = true;
    getMyBusiness()
      .then(fetched => {
        if (active) setBusiness(fetched);
      })
      .catch(() => {
        // 400 = user hasn't created a business yet → stay in onboarding.
      });

    return () => {
      active = false;
    };
  }, [token, business, setBusiness]);
}
