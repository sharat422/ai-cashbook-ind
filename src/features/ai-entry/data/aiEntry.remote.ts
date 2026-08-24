import {apiRequest} from '@api/client';
import type {ParsedTransaction} from '@features/ai-entry/domain/entities';

interface ParsedDto {
  customer_name: string | null;
  type: string;
  amount: number | null;
  category: string | null;
  date: string;
  confidence: number;
  raw_text: string;
  source: string;
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
};
