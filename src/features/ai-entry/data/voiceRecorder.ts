import {NativeModules, PermissionsAndroid, Platform} from 'react-native';
import AudioRecorderPlayer, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  AVEncoderAudioQualityIOSType,
  AVEncodingOption,
  OutputFormatAndroidType,
  type AudioSet,
} from 'react-native-audio-recorder-player';

/**
 * True only when the native audio module is actually linked into this build.
 * Guards against a build that predates the voice feature (or one where the
 * native module didn't link) — the app must still open AI Entry and let the
 * user TYPE, so voice degrades instead of crashing the screen.
 */
export function isVoiceAvailable(): boolean {
  return !!NativeModules.RNAudioRecorderPlayer;
}

// Lazily constructed — instantiating without the native module throws, so we
// never do it at import time (that would take down the whole AI Entry screen).
let recorderInstance: AudioRecorderPlayer | null = null;
function recorder(): AudioRecorderPlayer {
  if (!recorderInstance) {
    recorderInstance = new AudioRecorderPlayer();
  }
  return recorderInstance;
}

/**
 * Mono AAC. Android records at 16 kHz with the VOICE_RECOGNITION source (engages
 * the platform noise suppression + auto-gain). iOS records at its native 44.1 kHz
 * — forcing 16 kHz on the iOS AAC encoder is a known source of failed/silent
 * recordings on some devices; the server (Whisper) resamples anyway.
 */
const AUDIO_SET: AudioSet = {
  // Android
  AudioSourceAndroid: AudioSourceAndroidType.VOICE_RECOGNITION,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  AudioSamplingRateAndroid: 16000,
  AudioChannelsAndroid: 1,
  AudioEncodingBitRateAndroid: 32000,
  // iOS
  AVSampleRateKeyIOS: 44100,
  AVNumberOfChannelsKeyIOS: 1,
  AVFormatIDKeyIOS: AVEncodingOption.aac,
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
};

/** A recorded clip, shaped for a multipart upload. */
export interface RecordedAudio {
  uri: string;
  name: string;
  type: string;
  /** How long the clip ran (ms) — lets callers reject accidental short taps. */
  durationMs: number;
  /**
   * Loudest mic level seen during the clip, in dB (≈ -160 silence … 0 loud), or
   * null if the device didn't report metering. Lets the caller tell "the mic
   * heard nothing" (silent capture) from "heard speech but couldn't transcribe".
   */
  peakDb: number | null;
}

/** Below this, a tap is almost certainly accidental: too short for Whisper to
 * decode into speech, and it would just come back as a failed transcription. */
export const MIN_RECORDING_MS = 700;

/** Peak dB below this (when metering worked) means the mic captured ~silence. */
export const SILENCE_PEAK_DB = -45;

// Wall-clock start of the current recording, used to derive the clip duration.
let startedAtMs = 0;
// Loudest metering sample seen this recording; -160 = the "no sample yet" floor.
let peakDb = -160;

/**
 * Ask for the microphone at runtime (Android). iOS prompts automatically on the
 * first record via the Info.plist usage string, so it's a no-op here.
 */
export async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone access',
      message:
        'Smart CashBook uses the microphone to hear your transaction and turn ' +
        'it into an entry. Audio is processed for transcription, not stored.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function startRecording(): Promise<void> {
  if (!isVoiceAvailable()) {
    throw new Error('Voice recording is unavailable in this build.');
  }
  const rec = recorder();
  peakDb = -160;
  // Metering lets us detect a silent capture (mic muted / not actually recording).
  rec.addRecordBackListener(e => {
    const m = (e as {currentMetering?: number}).currentMetering;
    if (typeof m === 'number' && Number.isFinite(m) && m > peakDb) peakDb = m;
  });
  // 3rd arg enables metering; if a platform ignores it, peakDb just stays -160.
  await rec.startRecorder(undefined, AUDIO_SET, true);
  startedAtMs = Date.now();
}

/** Stop and return the clip as an uploadable file part. */
export async function stopRecording(): Promise<RecordedAudio> {
  const rec = recorder();
  const path = await rec.stopRecorder();
  try {
    rec.removeRecordBackListener();
  } catch {
    // listener may already be gone — ignore
  }
  const durationMs = startedAtMs ? Date.now() - startedAtMs : 0;
  startedAtMs = 0;
  // -160 means we never got a metering sample → report null (unknown) rather
  // than a false "silent".
  const reportedPeak = peakDb > -160 ? peakDb : null;
  const uri = path.startsWith('file://') ? path : `file://${path}`;
  // Whisper infers the format from the filename extension, so keep it accurate.
  const ext = (path.split('.').pop() || 'm4a').toLowerCase();
  const type = ext === 'mp4' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : 'audio/m4a';
  return {uri, name: `voice.${ext}`, type, durationMs, peakDb: reportedPeak};
}
