import React from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from './Text';

interface Props {
  children: React.ReactNode;
  /** Optional reset hook (e.g. navigate home) run when the user taps Try again. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in the subtree so a single screen's crash shows
 * a recoverable card (with the error message) instead of white-screening or
 * hard-crashing the whole app. Error boundaries must be class components.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: {componentStack: string}): void {
    // Surface in the dev console / crash logs.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => {
    this.setState({error: null});
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    const {error} = this.state;
    if (!error) return this.props.children;

    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center', padding: 24}}>
          <View className="rounded-3xl border border-border bg-white p-6">
            <Text className="text-center text-4xl">⚠️</Text>
            <Text className="mt-3 text-center text-xl font-bold text-slate-900">
              Something went wrong
            </Text>
            <Text className="mt-2 text-center text-sm text-muted">
              The screen hit an unexpected error. You can try again — if it keeps
              happening, please share the details below.
            </Text>

            {/* The actual error message — shown so it can be reported. */}
            <View className="mt-4 rounded-xl bg-slate-50 p-3">
              <Text className="text-xs font-semibold text-danger">
                {error.message || 'Unknown error'}
              </Text>
              {__DEV__ && error.stack ? (
                <Text className="mt-2 text-[10px] text-muted" numberOfLines={12}>
                  {error.stack}
                </Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={this.reset}
              className="mt-5 h-12 items-center justify-center rounded-xl bg-primary">
              <Text className="text-base font-semibold text-white">Try again</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
}
