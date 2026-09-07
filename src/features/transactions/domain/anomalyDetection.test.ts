import {
  detectAnomalies,
  isRoundAmount,
  type AnomalyCandidate,
} from './anomalyDetection';

const e = (
  amount: number,
  date = '2026-09-06',
  description = '',
  category = 'Food',
): AnomalyCandidate => ({amount, date, description, category});

/** A non-round history so round-outlier detection is active. */
const nonRoundHistory: AnomalyCandidate[] = [
  e(347),
  e(1290),
  e(88),
  e(2145),
  e(560, '2026-09-05'),
  e(1712, '2026-09-04'),
];

describe('isRoundAmount', () => {
  it('treats ≥₹500 multiples of 500 as round', () => {
    expect(isRoundAmount(500)).toBe(true);
    expect(isRoundAmount(2000)).toBe(true);
    expect(isRoundAmount(10000)).toBe(true);
  });
  it('treats specific / small amounts as not round', () => {
    expect(isRoundAmount(2347)).toBe(false);
    expect(isRoundAmount(300)).toBe(false); // below ₹500 floor
    expect(isRoundAmount(1290)).toBe(false);
  });
});

describe('duplicate detection', () => {
  it('flags same amount + same day + same description', () => {
    const recent = [e(500, '2026-09-06', 'Chai for staff')];
    const flags = detectAnomalies(e(500, '2026-09-06', 'chai for staff'), recent);
    expect(flags.map(f => f.type)).toContain('duplicate');
  });

  it('matches when one description contains the other', () => {
    const recent = [e(1200, '2026-09-06', 'Kirana store')];
    const flags = detectAnomalies(e(1200, '2026-09-06', 'Kirana'), recent);
    expect(flags.map(f => f.type)).toContain('duplicate');
  });

  it('falls back to category when a description is blank', () => {
    const recent = [e(750, '2026-09-06', '', 'Fuel')];
    const flags = detectAnomalies(e(750, '2026-09-06', '', 'Fuel'), recent);
    expect(flags.map(f => f.type)).toContain('duplicate');
  });

  it('does NOT flag a different day', () => {
    const recent = [e(500, '2026-09-05', 'Chai')];
    expect(detectAnomalies(e(500, '2026-09-06', 'Chai'), recent)).toEqual([]);
  });

  it('does NOT flag a different amount', () => {
    const recent = [e(500, '2026-09-06', 'Chai')];
    expect(detectAnomalies(e(600, '2026-09-06', 'Chai'), recent)).toEqual([]);
  });

  it('does NOT flag same amount+day but unrelated description & category', () => {
    const recent = [e(500, '2026-09-06', 'Chai', 'Food')];
    const flags = detectAnomalies(e(500, '2026-09-06', 'Petrol', 'Fuel'), recent);
    expect(flags).toEqual([]);
  });
});

describe('round-number outlier detection', () => {
  it('flags a round amount when the history is mostly non-round', () => {
    const flags = detectAnomalies(e(2000, '2026-09-06', 'Estimate'), nonRoundHistory);
    expect(flags.map(f => f.type)).toContain('round-outlier');
  });

  it('does NOT flag when the business usually enters round numbers', () => {
    const roundHistory = [e(500), e(1000), e(2000), e(500), e(1500), e(1000)];
    const flags = detectAnomalies(e(2000, '2026-09-06', 'X'), roundHistory);
    expect(flags.map(f => f.type)).not.toContain('round-outlier');
  });

  it('does NOT flag without enough history to judge', () => {
    const flags = detectAnomalies(e(2000), [e(347), e(88)]);
    expect(flags.map(f => f.type)).not.toContain('round-outlier');
  });

  it('does NOT flag a non-round amount', () => {
    const flags = detectAnomalies(e(1990, '2026-09-06', 'X'), nonRoundHistory);
    expect(flags.map(f => f.type)).not.toContain('round-outlier');
  });
});

describe('combined', () => {
  it('can return both flags at once', () => {
    const recent = [e(2000, '2026-09-06', 'Estimate'), ...nonRoundHistory];
    const flags = detectAnomalies(e(2000, '2026-09-06', 'estimate'), recent);
    const types = flags.map(f => f.type);
    expect(types).toContain('duplicate');
    expect(types).toContain('round-outlier');
  });

  it('clean entry returns no flags', () => {
    expect(detectAnomalies(e(1337, '2026-09-06', 'New thing'), nonRoundHistory)).toEqual([]);
  });
});
