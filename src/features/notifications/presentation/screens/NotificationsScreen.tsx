import React, {useEffect} from 'react';
import {FlatList, Pressable, View} from 'react-native';

import {EmptyState, Screen, Text} from '@components/ui';
import {useInboxStore, type AppNotification} from '@/services/notifications';
import {formatDisplayDate} from '@utils/date';

function NotificationRow({item}: {item: AppNotification}): React.JSX.Element {
  return (
    <View className="rounded-xl border border-border bg-white px-4 py-3">
      <View className="flex-row items-center">
        {!item.read ? (
          <View className="mr-2 h-2 w-2 rounded-full bg-primary" />
        ) : null}
        <Text className="flex-1 font-semibold text-slate-900" numberOfLines={1}>
          {item.title}
        </Text>
      </View>
      <Text className="mt-1 text-sm text-slate-700">{item.body}</Text>
      <Text variant="caption" className="mt-1">
        {formatDisplayDate(item.createdAt.slice(0, 10))}
      </Text>
    </View>
  );
}

/** In-app notification inbox (the default delivery channel). */
export function NotificationsScreen(): React.JSX.Element {
  const notifications = useInboxStore(state => state.notifications);
  const markAllRead = useInboxStore(state => state.markAllRead);
  const clear = useInboxStore(state => state.clear);

  // Mark everything read once the inbox is opened.
  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  return (
    <Screen scroll={false}>
      <View className="flex-1 py-8">
        <View className="mb-4 flex-row items-center justify-between">
          <Text variant="title">Notifications</Text>
          {notifications.length > 0 ? (
            <Pressable onPress={clear}>
              <Text className="text-sm font-semibold text-danger">
                Clear all
              </Text>
            </Pressable>
          ) : null}
        </View>

        <FlatList
          className="flex-1"
          data={notifications}
          keyExtractor={item => item.id}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <View className="mt-16">
              <EmptyState
                icon="🔔"
                title="No notifications yet"
                message="Your daily summaries and alerts will show up here."
              />
            </View>
          }
          renderItem={({item}) => <NotificationRow item={item} />}
        />
      </View>
    </Screen>
  );
}
