import {buildUpiUri, isValidUpiId, makePaymentRef} from './upi';

describe('buildUpiUri', () => {
  it('builds a upi:// link with amount and ref', () => {
    const uri = buildUpiUri({
      payeeVpa: 'shop@okhdfcbank',
      payeeName: 'Sharma Traders',
      amount: 2500,
      note: 'Bill payment',
      ref: 'SCB123',
    });
    expect(uri).toContain('upi://pay?');
    expect(uri).toContain('pa=shop%40okhdfcbank');
    expect(uri).toContain('pn=Sharma%20Traders');
    expect(uri).toContain('am=2500');
    expect(uri).toContain('tr=SCB123');
    expect(uri).toContain('cu=INR');
  });

  it('omits amount for an open request', () => {
    const uri = buildUpiUri({payeeVpa: 'a@b', payeeName: 'X'});
    expect(uri).not.toContain('am=');
  });
});

describe('isValidUpiId', () => {
  it('accepts valid VPAs', () => {
    expect(isValidUpiId('shop@okhdfcbank')).toBe(true);
    expect(isValidUpiId('ravi.kumar@ybl')).toBe(true);
  });
  it('rejects invalid VPAs', () => {
    expect(isValidUpiId('shop')).toBe(false);
    expect(isValidUpiId('@ybl')).toBe(false);
    expect(isValidUpiId('shop@')).toBe(false);
  });
});

describe('makePaymentRef', () => {
  it('starts with SCB and is short', () => {
    const ref = makePaymentRef();
    expect(ref.startsWith('SCB')).toBe(true);
    expect(ref.length).toBeLessThanOrEqual(10);
  });
});
