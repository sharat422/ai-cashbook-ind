import React from 'react';
import {View} from 'react-native';

import {Skeleton, SkeletonGroup} from '@components/ui';

/** Card-shaped placeholder matching SummaryCard's footprint. */
function CardSkeleton(): React.JSX.Element {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-white p-4">
      <Skeleton className="h-9 w-9 rounded-full" />
      <Skeleton className="mt-3 h-3 w-16" />
      <Skeleton className="mt-2 h-6 w-24" />
    </View>
  );
}

/**
 * Loading placeholder for the whole widget area — a hero block plus two rows of
 * two cards, mirroring the real layout so there's no jump when data arrives.
 */
export function SummarySkeleton(): React.JSX.Element {
  return (
    <SkeletonGroup>
      <Skeleton className="h-28 rounded-3xl" />
      <View className="mt-3 flex-row" style={{gap: 12}}>
        <CardSkeleton />
        <CardSkeleton />
      </View>
      <View className="mt-3 flex-row" style={{gap: 12}}>
        <CardSkeleton />
        <CardSkeleton />
      </View>
    </SkeletonGroup>
  );
}
