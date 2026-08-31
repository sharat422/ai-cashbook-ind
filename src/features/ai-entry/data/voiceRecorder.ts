import {PermissionsAndroid, Platform} from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

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
  await AudioRecorderPlayer.startRecorder();
}

/** Stop and return the clip as an uploadable file part. */
export async function stopRecording(): Promise<RecordedAudio> {
  const path = await AudioRecorderPlayer.stopRecorder();
  const uri = path.startsWith('file://') ? path : `file://${path}`;
  // Whisper infers the format from the filename extension, so keep it accurate.
  const ext = (path.split('.').pop() || 'm4a').toLowerCase();
  const type = ext === 'mp4' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : 'audio/m4a';
  return {uri, name: `voice.${ext}`, type};
}
