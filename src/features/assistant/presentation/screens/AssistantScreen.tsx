import React, {useRef, useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {Text} from '@components/ui';
import {useAsk} from '@features/assistant/presentation/hooks';
import {useT, type TKey} from '@/i18n';
import {colors} from '@theme/colors';

interface Msg {
  role: 'user' | 'ai';
  text: string;
}

const SUGGESTION_KEYS: TKey[] = [
  'assistant.s1',
  'assistant.s2',
  'assistant.s3',
  'assistant.s4',
  'assistant.s5',
  'assistant.s6',
];

export function AssistantScreen(): React.JSX.Element {
  const t = useT();
  const ask = useAsk();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const send = (question: string) => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    setMessages(prev => [...prev, {role: 'user', text: q}]);
    setInput('');
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({animated: true}));

    ask.mutate(q, {
      onSuccess: res =>
        setMessages(prev => [...prev, {role: 'ai', text: res.answer}]),
      onError: err =>
        setMessages(prev => [
          ...prev,
          {
            role: 'ai',
            text:
              err instanceof Error
                ? t('assistant.errorPrefix', {message: err.message})
                : t('assistant.errorGeneric'),
          },
        ]),
      onSettled: () =>
        requestAnimationFrame(() =>
          scrollRef.current?.scrollToEnd({animated: true}),
        ),
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="px-5 pb-2 pt-4">
          <Text variant="title">{t('assistant.title')}</Text>
          <Text variant="subtitle" className="mt-0.5">
            {t('assistant.subtitle')}
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 px-5"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{paddingVertical: 12, gap: 10}}>
          {messages.length === 0 ? (
            <View style={{gap: 10}}>
              <Text variant="caption">{t('assistant.tryAsking')}</Text>
              {SUGGESTION_KEYS.map(k => {
                const s = t(k);
                return (
                  <Pressable
                    key={k}
                    onPress={() => send(s)}
                    className="rounded-2xl border border-border bg-white px-4 py-3">
                    <Text className="text-sm text-slate-800">{s}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            messages.map((m, i) => <Bubble key={i} msg={m} />)
          )}
          {ask.isPending ? (
            <Bubble msg={{role: 'ai', text: t('assistant.thinking')}} />
          ) : null}
        </ScrollView>

        {/* Input bar */}
        <View className="flex-row items-center border-t border-border px-4 py-2.5" style={{gap: 8}}>
          <TextInput
            className="h-11 flex-1 rounded-full border border-border bg-white px-4 text-base text-slate-900"
            value={input}
            onChangeText={setInput}
            placeholder={t('assistant.placeholder')}
            placeholderTextColor={colors.muted}
            returnKeyType="send"
            onSubmitEditing={() => send(input)}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => send(input)}
            disabled={!input.trim() || ask.isPending}
            className={`h-11 w-11 items-center justify-center rounded-full ${
              !input.trim() || ask.isPending ? 'bg-slate-300' : 'bg-primary'
            }`}>
            <Text className="text-lg text-white">➤</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({msg}: {msg: Msg}): React.JSX.Element {
  const isUser = msg.role === 'user';
  return (
    <View className={isUser ? 'items-end' : 'items-start'}>
      <View
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser ? 'rounded-br-sm bg-primary' : 'rounded-bl-sm bg-white border border-border'
        }`}>
        <Text className={`text-sm ${isUser ? 'text-white' : 'text-slate-900'}`}>
          {msg.text}
        </Text>
      </View>
    </View>
  );
}
