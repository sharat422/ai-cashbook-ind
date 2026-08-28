import {
  isLikelyBankSms,
  parseBankMessages,
  parseBankSms,
} from './bankSms';

describe('parseBankSms — real-world Indian bank formats', () => {
  it('HDFC UPI debit', () => {
    const r = parseBankSms(
      'Rs.2500.00 debited from a/c XX1234 on 05-08-26 to VPA ramesh@okhdfc. Ref 123456. Not you? Call 18002586161. -HDFC Bank',
    );
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(2500);
    expect(r!.direction).toBe('debit');
    expect(r!.date).toBe('2026-08-05');
    expect(r!.bank).toBe('HDFC');
    expect(r!.accountTail).toBe('1234');
    expect(r!.merchant).toBe('ramesh@okhdfc');
  });

  it('HDFC card spend — ignores the available-balance amount', () => {
    const r = parseBankSms(
      'Rs.1,299.00 spent on HDFC Bank Card xx9012 at AMAZON on 2026-08-05. Avl bal Rs.45,000.00',
    );
    expect(r!.amount).toBe(1299); // NOT 45000 (that's the balance)
    expect(r!.direction).toBe('debit');
    expect(r!.date).toBe('2026-08-05');
    expect(r!.merchant).toBe('AMAZON');
  });

  it('HDFC NEFT credit', () => {
    const r = parseBankSms(
      'Rs 45000 credited to HDFC Bank A/c XX1234 on 01-08-26 by NEFT from ACME EXPORTS',
    );
    expect(r!.amount).toBe(45000);
    expect(r!.direction).toBe('credit');
    expect(r!.date).toBe('2026-08-01');
    expect(r!.merchant).toBe('ACME EXPORTS');
  });

  it('SBI debit (DDMonYY date, no separators)', () => {
    const r = parseBankSms(
      'Dear SBI User, your A/c X1234 debited by Rs.2000.0 on 05Aug26 transfer to SURESH KUMAR Ref No 987654. -SBI',
    );
    expect(r!.amount).toBe(2000);
    expect(r!.direction).toBe('debit');
    expect(r!.date).toBe('2026-08-05');
    expect(r!.bank).toBe('SBI');
    expect(r!.merchant).toBe('SURESH KUMAR');
  });

  it('SBI credit', () => {
    const r = parseBankSms(
      'Your a/c no. XXXXXXXX1234 is credited for Rs.5,000.00 on 05-08-2026 by a/c linked to VPA. -SBI',
    );
    expect(r!.amount).toBe(5000);
    expect(r!.direction).toBe('credit');
    expect(r!.date).toBe('2026-08-05');
  });

  it('ICICI transfer — debit wins over trailing "credited"', () => {
    const r = parseBankSms(
      'ICICI Bank Acct XX123 debited for Rs 2,000.00 on 05-Aug-26; RAJU STORES credited. UPI:401234. Call 18002662 if not you.',
    );
    expect(r!.amount).toBe(2000);
    expect(r!.direction).toBe('debit');
    expect(r!.bank).toBe('ICICI');
    expect(r!.date).toBe('2026-08-05');
    expect(r!.merchant).toBe('RAJU STORES');
  });

  it('ICICI card spend ignores Avl Lmt', () => {
    const r = parseBankSms(
      'INR 1,250.00 spent using ICICI Bank Card XX4321 on 05-Aug-26 at BIG BAZAAR. Avl Lmt: INR 80,000.00',
    );
    expect(r!.amount).toBe(1250);
    expect(r!.direction).toBe('debit');
    expect(r!.merchant).toBe('BIG BAZAAR');
  });

  it('Axis card spend (spaced date + time)', () => {
    const r = parseBankSms(
      'Spent Card no. XX1234 INR 899.00 05-08-2026 MERCHANT PETROL Avl Lmt INR 50000 Axis Bank',
    );
    expect(r!.amount).toBe(899);
    expect(r!.direction).toBe('debit');
    expect(r!.bank).toBe('Axis');
    expect(r!.date).toBe('2026-08-05');
  });

  it('Kotak UPI sent (debit)', () => {
    const r = parseBankSms(
      'Sent Rs.500.00 from Kotak Bank AC X5678 to merchant@ybl on 05-08-26. UPI Ref 112233. Not you? kotak.com/fraud',
    );
    expect(r!.amount).toBe(500);
    expect(r!.direction).toBe('debit');
    expect(r!.bank).toBe('Kotak');
    expect(r!.merchant).toBe('merchant@ybl');
  });

  it('Kotak received (credit)', () => {
    const r = parseBankSms(
      'Received Rs.1500.00 in your Kotak Bank AC X5678 from PRIYA TRADERS on 05-08-26',
    );
    expect(r!.amount).toBe(1500);
    expect(r!.direction).toBe('credit');
    expect(r!.merchant).toBe('PRIYA TRADERS');
  });

  it('handles Indian lakh grouping', () => {
    const r = parseBankSms(
      'Rs 1,50,000.00 credited to HDFC Bank A/c XX1234 on 05-08-26 by NEFT',
    );
    expect(r!.amount).toBe(150000);
  });

  it('parses amount + direction even when date/merchant are missing', () => {
    const r = parseBankSms('Rs 750 debited from your account');
    expect(r!.amount).toBe(750);
    expect(r!.direction).toBe('debit');
    expect(r!.date).toBeNull();
    expect(r!.merchant).toBeNull();
  });
});

describe('parseBankSms — rejects non-transactions', () => {
  it('returns null for an OTP message', () => {
    expect(
      parseBankSms('123456 is your OTP for login. Do not share it. -HDFC'),
    ).toBeNull();
  });

  it('returns null for a promo with no direction', () => {
    expect(
      parseBankSms('Get a personal loan up to Rs 5,00,000 at low interest!'),
    ).toBeNull();
  });

  it('returns null for empty / junk input', () => {
    expect(parseBankSms('')).toBeNull();
    expect(parseBankSms('hello there')).toBeNull();
    // @ts-expect-error runtime guard for non-string
    expect(parseBankSms(null)).toBeNull();
  });
});

describe('isLikelyBankSms', () => {
  it('accepts a debit/credit message with an amount', () => {
    expect(isLikelyBankSms('Rs 100 debited from a/c')).toBe(true);
    expect(isLikelyBankSms('INR 5000 credited to your account')).toBe(true);
  });
  it('rejects OTP / promos / non-amount text', () => {
    expect(isLikelyBankSms('123456 is your OTP')).toBe(false);
    expect(isLikelyBankSms('Hi, are we meeting today?')).toBe(false);
  });
});

describe('parseBankMessages', () => {
  it('keeps only recognisable transactions', () => {
    const out = parseBankMessages([
      'Rs.2500.00 debited from a/c XX1234 on 05-08-26 to VPA x@y. -HDFC Bank',
      '123456 is your OTP. -HDFC',
      'Received Rs.1500.00 in your Kotak Bank AC X5678 from PRIYA on 05-08-26',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].direction).toBe('debit');
    expect(out[1].direction).toBe('credit');
  });
});
