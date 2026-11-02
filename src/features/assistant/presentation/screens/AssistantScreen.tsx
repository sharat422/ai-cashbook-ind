import React, {useEffect, useRef, useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {ApiError} from '@api/client';
import {Text} from '@components/ui';
import {isLiveVoiceAvailable} from '@features/ai-entry/data/liveVoice';
import {useLiveVoice} from '@features/ai-entry/presentation/hooks/useLiveVoice';
import type {
  AnswerPeriod,
  ChatbotAnswer,
  CustomerChoice,
  ViewDetails,
} from '@features/assistant/data/assistant.remote';
import {
  chatLanguageHint,
  formatRecordingTime,
  highlightKeyFacts,
  isUnclearTranscript,
} from '@features/assistant/domain/transcript';
import {
  useAnswerFeedback,
  useAsk,
} from '@features/assistant/presentation/hooks';
import {customerRepository} from '@features/customers/data/customer.repository';
import {useVoiceSettingsStore} from '@features/settings/store/voiceSettings.store';
import {useAuthStore} from '@store/auth.store';
import {useT, type TKey} from '@/i18n';
import type {AppScreenProps, AppStackParamList} from '@navigation/types';
import {colors} from '@theme/colors';
import {formatDisplayDate} from '@utils/date';

/** Ask AI recordings: 60 s on the server; stop a little early on the phone. */
export const MAX_RECORDING_MS = 60_000;
const AUTO_STOP_MS = 59_500;

/** Screens an answer may offer to open (all take no required params). */
const OPENABLE_SCREENS = new Set<keyof AppStackParamList>([
  'Customers',
  'Dashboard',
  'Reports',
  'Team',
  'Settings',
  'Help',
]);

const SUGGESTION_KEYS: TKey[] = [
  'assistant.s1',
  'assistant.s2',
  'assistant.s3',
  'assistant.s4',
  'assistant.s5',
  'assistant.s6',
];

type Msg =
  | {role: 'user'; text: string}
  | {role: 'ai'; text: string; answer?: ChatbotAnswer; question?: string};

/**
 * Ask AI: read-only questions about the merchant's account and the app.
 * Push-to-talk (hold the mic, release to stop) transcribes with Muse via the
 * backend relay; the transcript is shown for review/edit before it is sent.
 * Answers are text only (no speech in v1).
 */
export function AssistantScreen({
  navigation,
}: AppScreenProps<'Assistant'>): React.JSX.Element {
  const t = useT();
  const ask = useAsk();
  const voiceLanguage = useVoiceSettingsStore(s => s.language);
  const languageHint = chatLanguageHint(useAuthStore(s => s.preferredLanguage));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // True while the text box holds a spoken question (for logs: input_mode).
  const fromVoice = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const voiceAvailable = isLiveVoiceAvailable();

  // Tap to speak (like AI Entry), via the shared hook: mic permission, and
  // cancel on blur or app background. The words go into the text box as they
  // are heard, so the user can edit them and tap ➤; nothing is sent by itself.
  const voice = useLiveVoice({
    language: voiceLanguage,
    purpose: 'chatbot',
    maxMs: AUTO_STOP_MS,
    onText: setInput,
    // The final transcript (usually a bit more accurate) replaces the live text.
    onComplete: text => {
      if (isUnclearTranscript(text)) {
        setInput('');
        didntCatch();
      } else {
        setInput(text);
      }
    },
    onError: error => {
      // Whatever was heard stays in the box and can still be sent.
      if (error instanceof ApiError && error.status === 422) {
        didntCatch(); // "No speech detected."
      } else if (error instanceof ApiError && error.status === 429) {
        setVoiceNotice(error.message); // daily voice limit: polite, typing still works
        inputRef.current?.focus();
      } else {
        setVoiceNotice(t('assistant.voiceError', {message: error.message}));
      }
    },
  });
  const voiceState = voice.state;

  // Recording timer for the indicator.
  useEffect(() => {
    if (voiceState !== 'recording') return;
    const started = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - started), 250);
    return () => clearInterval(id);
  }, [voiceState]);

  const scrollToEnd = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({animated: true}));

  const send = (
    question: string,
    inputMode: 'voice' | 'text',
    choice?: CustomerChoice,
  ) => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    if (voice.state !== 'idle') voice.stop(); // drop a late transcript update
    setMessages(prev => [...prev, {role: 'user', text: choice ? `→ ${choice.name}` : q}]);
    setInput('');
    fromVoice.current = false;
    setVoiceNotice(null);
    scrollToEnd();
    ask.mutate(
      {text: q, inputMode, selectedCustomerId: choice?.customerId, languageHint},
      {
        onSuccess: answer =>
          setMessages(prev => [...prev, {role: 'ai', text: answer.answer, answer, question: q}]),
        onError: err =>
          setMessages(prev => [
            ...prev,
            {
              role: 'ai',
              // A rate limit is a polite server message, shown as-is.
              text:
                err instanceof ApiError && err.status === 429
                  ? err.message
                  : err instanceof Error
                    ? t('assistant.errorPrefix', {message: err.message})
                    : t('assistant.errorGeneric'),
            },
          ]),
        onSettled: scrollToEnd,
      },
    );
  };

  // --- Tap to speak ------------------------------------------------------------
  const onMic = () => {
    if (voiceState === 'recording') {
      voice.finish(); // stop; the final transcript arrives in the text box
      return;
    }
    if (voiceState !== 'idle' || ask.isPending) return; // connecting / finishing
    setVoiceNotice(null);
    setInput('');
    fromVoice.current = true;
    voice.start();
  };

  function didntCatch() {
    setVoiceNotice(t('assistant.didntCatch'));
    inputRef.current?.focus(); // text fallback
  }

  const newChat = () => {
    voice.stop();
    setMessages([]);
    setVoiceNotice(null);
    setInput('');
    fromVoice.current = false;
  };

  const openDetails = async (view: ViewDetails) => {
    if (view.screen === 'CustomerProfile') {
      try {
        const customer = await customerRepository.getById(view.customerId);
        navigation.navigate('CustomerProfile', {customer});
      } catch (err) {
        setVoiceNotice(err instanceof Error ? err.message : t('assistant.errorGeneric'));
      }
    } else {
      navigation.navigate(view.screen);
    }
  };

  const openScreen = (screen: string) => {
    if (OPENABLE_SCREENS.has(screen as keyof AppStackParamList)) {
      navigation.navigate(screen as 'Dashboard');
    }
  };

  const recording = voiceState === 'recording';

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-row items-start justify-between px-5 pb-2 pt-4">
          <View className="flex-1">
            <Text variant="title">{t('assistant.title')}</Text>
            <Text variant="subtitle" className="mt-0.5">
              {t('assistant.subtitle')}
            </Text>
          </View>
          {messages.length > 0 ? (
            <Pressable
              testID="new-chat"
              accessibilityRole="button"
              onPress={newChat}
              className="rounded-full border border-border px-3 py-1.5">
              <Text className="text-sm font-semibold text-primary">
                {t('assistant.newChat')}
              </Text>
            </Pressable>
          ) : null}
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
                    onPress={() => send(s, 'text')}
                    className="rounded-2xl border border-border bg-white px-4 py-3">
                    <Text className="text-sm text-slate-800">{s}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            messages.map((m, i) => (
              <Bubble
                key={i}
                msg={m}
                onChoose={choice =>
                  m.role === 'ai' && m.question ? send(m.question, 'text', choice) : undefined
                }
                onOpenScreen={openScreen}
                onViewDetails={openDetails}
              />
            ))
          )}
          {ask.isPending ? (
            <Bubble msg={{role: 'ai', text: t('assistant.thinking')}} />
          ) : null}
        </ScrollView>

        {/* Recording indicator (the words appear in the text box below) */}
        {voiceState !== 'idle' ? (
          <View testID="recording-indicator" className="mx-4 mb-2 rounded-2xl bg-red-50 px-4 py-3">
            <View className="flex-row items-center" style={{gap: 8}}>
              <View className="h-2.5 w-2.5 rounded-full bg-red-600" />
              <Text className="text-sm font-semibold text-red-700">
                {voiceState === 'connecting'
                  ? t('assistant.connecting')
                  : voiceState === 'finishing'
                    ? t('assistant.transcribing')
                    : t('assistant.listening', {
                        time: formatRecordingTime(elapsedMs, MAX_RECORDING_MS),
                      })}
              </Text>
            </View>
          </View>
        ) : null}

        {voiceNotice ? (
          <Text testID="voice-notice" className="mx-5 mb-2 text-sm text-amber-700">
            {voiceNotice}
          </Text>
        ) : null}

        {/* Input bar: text box (typed or spoken) + mic + send */}
        <View className="flex-row items-center border-t border-border px-4 py-2.5" style={{gap: 8}}>
          <TextInput
            testID="question-input"
            ref={inputRef}
            className="min-h-11 flex-1 rounded-3xl border border-border bg-white px-4 py-2 text-base text-slate-900"
            value={input}
            onChangeText={setInput}
            placeholder={t('assistant.placeholder')}
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => send(input, fromVoice.current ? 'voice' : 'text')}
          />
          {voiceAvailable ? (
            <Pressable
              testID="mic-button"
              accessibilityRole="button"
              accessibilityLabel={t(recording ? 'assistant.stopSpeaking' : 'assistant.startSpeaking')}
              onPress={onMic}
              disabled={ask.isPending || voiceState === 'connecting' || voiceState === 'finishing'}
              className={`h-11 w-11 items-center justify-center rounded-full ${
                recording ? 'bg-red-600' : voiceState === 'idle' ? 'bg-primary' : 'bg-slate-300'
              }`}>
              <Text className="text-lg text-white">{recording ? '⏹' : '🎤'}</Text>
            </Pressable>
          ) : null}
          {input.trim() ? (
            <Pressable
              testID="send-button"
              accessibilityRole="button"
              accessibilityLabel={t('assistant.send')}
              onPress={() => send(input, fromVoice.current ? 'voice' : 'text')}
              disabled={ask.isPending}
              className={`h-11 w-11 items-center justify-center rounded-full ${
                ask.isPending ? 'bg-slate-300' : 'bg-primary'
              }`}>
              <Text className="text-lg text-white">➤</Text>
            </Pressable>
          ) : null}
        </View>
        {voiceAvailable && voiceState === 'idle' && !input && messages.length === 0 ? (
          <Text variant="caption" className="pb-2 text-center">
            {t('assistant.tapToSpeak')}
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function periodLabel(p: AnswerPeriod, t: ReturnType<typeof useT>): string {
  return 'asOf' in p
    ? t('assistant.asOf', {date: formatDisplayDate(p.asOf)})
    : t('assistant.range', {from: formatDisplayDate(p.from), to: formatDisplayDate(p.to)});
}

function Bubble({
  msg,
  onChoose,
  onOpenScreen,
  onViewDetails,
}: {
  msg: Msg;
  onChoose?: (choice: CustomerChoice) => void;
  onOpenScreen?: (screen: string) => void;
  onViewDetails?: (view: ViewDetails) => void;
}): React.JSX.Element {
  const t = useT();
  const isUser = msg.role === 'user';
  const answer = msg.role === 'ai' ? msg.answer : undefined;
  return (
    <View className={isUser ? 'items-end' : 'items-start'}>
      <View
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'rounded-br-sm bg-primary'
            : answer && !answer.verified
              ? 'rounded-bl-sm border border-amber-300 bg-amber-50'
              : 'rounded-bl-sm border border-border bg-white'
        }`}>
        {answer && !answer.verified ? (
          <Text className="mb-1 text-xs font-semibold text-amber-700">
            {t('assistant.unverified')}
          </Text>
        ) : null}
        <Text className={`text-sm ${isUser ? 'text-white' : 'text-slate-900'}`}>
          {isUser
            ? msg.text
            : highlightKeyFacts(msg.text).map((seg, i) =>
                seg.strong ? (
                  <Text key={i} className="text-sm font-bold text-slate-900">
                    {seg.text}
                  </Text>
                ) : (
                  seg.text
                ),
              )}
        </Text>
      </View>

      {answer?.period || answer?.viewDetails ? (
        <View className="mt-1.5 flex-row flex-wrap items-center" style={{gap: 8}}>
          {answer.period ? (
            <Text
              testID="answer-period"
              className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {periodLabel(answer.period, t)}
            </Text>
          ) : null}
          {answer.viewDetails ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onViewDetails?.(answer.viewDetails!)}>
              <Text className="text-xs font-semibold text-primary">
                {t('assistant.viewDetails')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {answer?.candidates.length ? (
        <View className="mt-2" style={{gap: 6}}>
          <Text variant="caption">{t('assistant.whichOne')}</Text>
          {answer.candidates.map(c => (
            <Pressable
              key={c.customerId}
              accessibilityRole="button"
              onPress={() => onChoose?.(c)}
              className="rounded-xl border border-border bg-white px-3 py-2">
              <Text className="text-sm font-semibold text-slate-900">{c.name}</Text>
              {c.businessName || c.mobileMasked ? (
                <Text className="text-xs text-slate-500">
                  {[c.businessName, c.mobileMasked].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {answer?.suggestedScreen ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenScreen?.(answer.suggestedScreen!.screen)}
          className="mt-2 rounded-full border border-primary px-4 py-1.5">
          <Text className="text-sm font-semibold text-primary">
            {t('assistant.openScreen', {screen: answer.suggestedScreen.label})}
          </Text>
        </Pressable>
      ) : null}

      {answer ? <AnswerFeedback questionId={answer.questionId} /> : null}
    </View>
  );
}

/** Thumbs up / down on an answer, then an optional note. Stored with the question id. */
function AnswerFeedback({questionId}: {questionId: string}): React.JSX.Element {
  const t = useT();
  const feedback = useAnswerFeedback();
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  const rate = (r: 'up' | 'down') => {
    setRating(r);
    feedback.mutate({questionId, rating: r});
  };
  const sendNote = () => {
    if (!rating || !note.trim()) {
      return;
    }
    feedback.mutate({questionId, rating, note}, {onSuccess: () => setDone(true)});
  };

  if (done) {
    return <Text className="mt-1 text-xs text-slate-500">{t('assistant.feedbackThanks')}</Text>;
  }
  return (
    <View className="mt-1" style={{gap: 6}}>
      <View className="flex-row" style={{gap: 4}}>
        {(['up', 'down'] as const).map(r => (
          <Pressable
            key={r}
            testID={'feedback-' + r}
            accessibilityRole="button"
            accessibilityLabel={t(r === 'up' ? 'assistant.helpful' : 'assistant.notHelpful')}
            accessibilityState={{selected: rating === r}}
            onPress={() => rate(r)}
            className={rating === r ? 'rounded-full bg-slate-200 px-2 py-1' : 'rounded-full px-2 py-1'}>
            <Text className="text-sm">{r === 'up' ? '👍' : '👎'}</Text>
          </Pressable>
        ))}
      </View>
      {rating ? (
        <View className="flex-row items-center" style={{gap: 6}}>
          <TextInput
            testID="feedback-note"
            className="h-9 flex-1 rounded-full border border-border bg-white px-3 text-sm text-slate-900"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            placeholder={t('assistant.feedbackNote')}
            placeholderTextColor={colors.muted}
          />
          <Pressable
            testID="feedback-send"
            accessibilityRole="button"
            disabled={!note.trim()}
            onPress={sendNote}
            className={note.trim() ? 'rounded-full bg-primary px-3 py-1.5' : 'rounded-full bg-slate-300 px-3 py-1.5'}>
            <Text className="text-xs font-semibold text-white">{t('assistant.send')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
