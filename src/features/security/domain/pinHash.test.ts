import {generateSalt, hashPin, sha256Hex} from './pinHash';

describe('sha256Hex (known-answer vectors)', () => {
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a longer message', () => {
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('hashPin', () => {
  it('is deterministic for the same pin + salt', () => {
    const salt = 'abc123';
    expect(hashPin('1234', salt)).toBe(hashPin('1234', salt));
  });

  it('differs for a different pin', () => {
    const salt = 'abc123';
    expect(hashPin('1234', salt)).not.toBe(hashPin('4321', salt));
  });

  it('differs for the same pin under a different salt', () => {
    expect(hashPin('1234', 'saltA')).not.toBe(hashPin('1234', 'saltB'));
  });

  it('never stores the raw pin in the hash', () => {
    expect(hashPin('1234', 'abc123')).not.toContain('1234');
  });
});

describe('generateSalt', () => {
  it('returns 16 hex chars and varies', () => {
    const a = generateSalt();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(generateSalt());
  });
});
