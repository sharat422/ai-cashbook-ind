/** A transaction parsed from a natural-language / voice sentence. */
export type ParsedType = 'credit' | 'payment';

export interface ParsedTransaction {
  /** Party name as spoken, or null if none detected. */
  customerName: string | null;
  /** 'credit' = you gave goods / lent (they owe); 'payment' = you received money. */
  type: ParsedType;
  /** Amount in INR, or null if none detected. */
  amount: number | null;
  category: string | null;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Model confidence 0..1. */
  confidence: number;
  rawText: string;
  /** 'ai' (LLM) or 'rule' (offline heuristic fallback). */
  source: 'ai' | 'rule';
}
