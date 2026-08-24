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
import {colors} from '@theme/colors';

interface Msg {
  role: 'user' | 'ai';
  text: string;
}

const SUGGESTIONS = [
  'Who owes me the most?',
  'How much did I collect this month?',
  'Which customers are late?',
  'What were my biggest expenses?',
  'How much did I sell last week?',
  'Compare this month with last month.',
];

export function AssistantScreen(): React.JSX.Element {
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
                ? `Sorry — ${err.message}`
                : "Sorry, I couldn't answer that.",
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
          <Text variant="title">🤖 Ask AI</Text>
          <Text variant="subtitle" className="mt-0.5">
            Ask anything about your business
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
              <Text variant="caption">Try asking:</Text>
              {SUGGESTIONS.map(s => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  className="rounded-2xl border border-border bg-white px-4 py-3">
                  <Text className="text-sm text-slate-800">{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            messages.map((m, i) => <Bubble key={i} msg={m} />)
          )}
          {ask.isPending ? (
            <Bubble msg={{role: 'ai', text: 'Thinking…'}} />
          ) : null}
        </ScrollView>

        {/* Input bar */}
        <View className="flex-row items-center border-t border-border px-4 py-2.5" style={{gap: 8}}>
          <TextInput
            className="h-11 flex-1 rounded-full border border-border bg-white px-4 text-base text-slate-900"
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything…"
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
