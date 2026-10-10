import {buildLedger} from './ledger';
import {deriveRiskFeatures} from './risk';
import type {Customer} from './entities';

test('partial payments do not settle every prior credit', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-11T12:00:00Z'));
  const ledger = buildLedger([
    {id: 'a', type: 'credit', amount: 1000, date: '2026-09-01', createdAt: '1'},
    {id: 'b', type: 'credit', amount: 1000, date: '2026-09-01', createdAt: '2'},
    {id: 'c', type: 'payment', amount: 100, date: '2026-09-02', createdAt: '3'},
  ]);
  const features = deriveRiskFeatures(ledger, {isOverdue: false} as Customer);
  expect(features.avgPaymentDelayDays).toBeCloseTo(9.55);
  expect(features.paymentRatio).toBe(0.05);
  jest.useRealTimers();
});
