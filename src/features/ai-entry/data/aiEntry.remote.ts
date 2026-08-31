import {apiRequest} from '@api/client';
import type {ParsedTransaction} from '@features/ai-entry/domain/entities';
import type {RecordedAudio} from './voiceRecorder';

interface ParsedDto {
  customer_name: string | null;
  type: string;
  amount: number | null;
  category: string | null;
  date: string;
  confidence: number;
  raw_text: string;
  source: string;
  /** Present on the /voice/parse response: what Whisper heard. */
  transcript?: string;
}

/** A voice parse also carries the transcript so the UI can show what was heard. */
export interface VoiceParsed extends ParsedTransaction {
  transcript: string;
}

function toParsed(dto: ParsedDto): ParsedTransaction {
  return {
    customerName: dto.customer_name ?? null,
    type: dto.type === 'payment' ? 'payment' : 'credit',
    amount: dto.amount ?? null,
    category: dto.category ?? null,
    date: dto.date,
    confidence: Number(dto.confidence ?? 0),
    rawText: dto.raw_text ?? '',
    source: dto.source === 'ai' ? 'ai' : 'rule',
  };
}

/**
 * Remote data source.
 *   POST /api/v1/parse-transaction { text, today } -> ParsedDto
 */
export const aiEntryRemote = {
  async parse(text: string, today: string): Promise<ParsedTransaction> {
    const dto = await apiRequest<ParsedDto>('/parse-transaction', {
      method: 'POST',
      body: {text, today},
    });
    return toParsed(dto);
  },

  /**
   * Voice 'agent': upload the recorded clip; the server transcribes it (Whisper
   * auto-detects Hindi/Telugu/…) and parses it into a transaction in one call.
   */
  async voiceParse(
    audio: RecordedAudio,
    today: string,
    language?: string,
  ): Promise<VoiceParsed> {
    const form = new FormData();
    form.append('audio', {
      uri: audio.uri,
      name: audio.name,
      type: audio.type,
    } as unknown as Blob);
    form.append('today', today);
    if (language) form.append('language', language);

    // Transcription + LLM parse can take a few seconds — give it room.
    const dto = await apiRequest<ParsedDto>('/voice/parse', {
      method: 'POST',
      body: form,
      timeoutMs: 60_000,
    });
    return {...toParsed(dto), transcript: dto.transcript ?? ''};
  },
};
