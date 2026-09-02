import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';
import {createJSONStorage, persist} from 'zustand/middleware';

/** ISO-639-1 code passed to Whisper, or null to auto-detect. */
export type VoiceLanguage = string | null;

export interface VoiceLangOption {
  code: VoiceLanguage;
  label: string;
}

/**
 * Languages offered for voice entry. Passing the language the shopkeeper's
 * customers actually speak is more accurate than auto-detect (the shopkeeper
 * knows it). Codes are ISO-639-1 as Whisper expects.
 */
export const VOICE_LANGUAGES: VoiceLangOption[] = [
  {code: null, label: 'Auto-detect'},
  {code: 'en', label: 'English'},
  {code: 'hi', label: 'Hindi'},
  {code: 'te', label: 'Telugu'},
  {code: 'ta', label: 'Tamil'},
  {code: 'kn', label: 'Kannada'},
  {code: 'mr', label: 'Marathi'},
  {code: 'gu', label: 'Gujarati'},
  {code: 'bn', label: 'Bengali'},
  {code: 'ml', label: 'Malayalam'},
  {code: 'pa', label: 'Punjabi'},
];

export function voiceLanguageLabel(code: VoiceLanguage): string {
  return VOICE_LANGUAGES.find(l => l.code === code)?.label ?? 'Auto-detect';
}

export function voiceLanguageByLabel(label: string): VoiceLanguage {
  return VOICE_LANGUAGES.find(l => l.label === label)?.code ?? null;
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
