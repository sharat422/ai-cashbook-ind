import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

import {APP_LANGUAGE_LABEL, type AppLanguage} from '@features/auth/utils/languagePreference';
import {tNow} from '@/i18n';

/** ISO-639-1 code passed to Whisper, or null to auto-detect. */
export type VoiceLanguage = string | null;

/**
 * Languages offered for voice entry. Passing the language the shopkeeper's
 * customers actually speak is more accurate than auto-detect (the shopkeeper
 * knows it). Codes are ISO-639-1 as Whisper expects. Each language is shown in
 * its own script, as in the app-language picker; null = auto-detect.
 */
export const VOICE_LANGUAGES: VoiceLanguage[] = [null, 'en', 'hi', 'te', 'ta', 'kn', 'mr', 'gu', 'bn', 'ml', 'pa'];

export function voiceLanguageLabel(code: VoiceLanguage): string {
  return code ? APP_LANGUAGE_LABEL[code as AppLanguage] ?? code : tNow('voice.autoDetect');
}

export function voiceLanguageByLabel(label: string): VoiceLanguage {
  return VOICE_LANGUAGES.find(c => voiceLanguageLabel(c) === label) ?? null;
}

interface VoiceSettingsState {
  hydrated: boolean;
  /** The chosen voice language; null = auto-detect. */
  language: VoiceLanguage;
  setLanguage: (code: VoiceLanguage) => void;
  _setHydrated: (v: boolean) => void;
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    set => ({
      hydrated: false,
      language: null, // auto-detect until the user picks one
      setLanguage: code => set({language: code}),
      _setHydrated: v => set({hydrated: v}),
    }),
    {
      name: 'voice-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({language}) => ({language}),
      onRehydrateStorage: () => state => state?._setHydrated(true),
    },
  ),
);
