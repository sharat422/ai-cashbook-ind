import {categorizeByRules} from './ruleEngine';

describe('categorizeByRules', () => {
  it('matches a single keyword with modest confidence', () => {
    const r = categorizeByRules('Petrol at HP pump');
    expect(r.category).toBe('Fuel');
    expect(r.source).toBe('rule');
    expect(r.confidence).toBeCloseTo(0.55);
  });

  it('is case-insensitive', () => {
    expect(categorizeByRules('SWIGGY LUNCH').category).toBe('Food');
  });

  it('scores more keywords with higher confidence', () => {
    // "fuel" + "diesel" => 2 hits => 0.65
    const r = categorizeByRules('fuel and diesel for the truck');
    expect(r.category).toBe('Fuel');
    expect(r.confidence).toBeCloseTo(0.65);
  });

  it('caps confidence at 0.8 for the rule engine', () => {
    const r = categorizeByRules('marketing ads advertising google ads campaign seo');
    expect(r.category).toBe('Marketing');
    expect(r.confidence).toBeLessThanOrEqual(0.8);
  });

  it('falls back to Miscellaneous with low confidence when nothing matches', () => {
    const r = categorizeByRules('qwerty zxcvb');
    expect(r.category).toBe('Miscellaneous');
    expect(r.confidence).toBe(0.2);
  });
});
