import React from 'react';

import {BackContext} from '@components/ui';

/** Every screen gets its navigation in BackContext, for the "<" back button. */
export function screenLayout({children, navigation}: {
  children: React.ReactElement;
  navigation: {canGoBack: () => boolean; goBack: () => void};
}): React.JSX.Element {
  return <BackContext.Provider value={navigation}>{children}</BackContext.Provider>;
}
