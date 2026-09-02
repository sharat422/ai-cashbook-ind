import {PermissionsAndroid, Platform} from 'react-native';
import AudioRecorderPlayer, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  AVEncoderAudioQualityIOSType,
  AVEncodingOption,
  OutputFormatAndroidType,
  type AudioSet,
} from 'react-native-audio-recorder-player';

/** Single shared recorder instance (v3 exports a class). */
const recorder = new AudioRecorderPlayer();

/**
 * 16 kHz mono AAC — the sweet spot for Whisper (it resamples to 16 kHz anyway),
 * and small to upload. On Android the VOICE_RECOGNITION source engages the
 * platform's noise suppression + auto-gain, our on-device "cleanup" for speech.
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
  AVSampleRateKeyIOS: 16000,
  AVNumberOfChannelsKeyIOS: 1,
  AVFormatIDKeyIOS: AVEncodingOption.aac,
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
};

/** A recorded clip, shaped for a multipart upload. */
export interface RecordedAudio {
  uri: string;
  name: string;
  type: string;
}

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
  await recorder.startRecorder(undefined, AUDIO_SET);
}

/** Stop and return the clip as an uploadable file part. */
export async function stopRecording(): Promise<RecordedAudio> {
  const path = await recorder.stopRecorder();
  const uri = path.startsWith('file://') ? path : `file://${path}`;
  // Whisper infers the format from the filename extension, so keep it accurate.
  const ext = (path.split('.').pop() || 'm4a').toLowerCase();
  const type = ext === 'mp4' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : 'audio/m4a';
  return {uri, name: `voice.${ext}`, type};
}
