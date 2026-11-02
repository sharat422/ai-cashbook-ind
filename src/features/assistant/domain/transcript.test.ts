import {
  chatLanguageHint,
  formatRecordingTime,
  highlightKeyFacts,
  isUnclearTranscript,
} from './transcript';

describe('isUnclearTranscript', () => {
  it.each([
    ['', true],
    ['   ', true],
    ['...', true],
    ['500', true], // a number alone isn't a question
    ['haan', true], // one word
    ['Ramesh ka balance', false],
    ['रमेश का बैलेंस', false],
    ['who owes', false],
  ])('%p -> %p', (text, unclear) => {
    expect(isUnclearTranscript(text)).toBe(unclear);
  });
});

describe('highlightKeyFacts', () => {
  it('marks amounts and dates strong and keeps all the text', () => {
    const answer =
      'As of 31 Oct 2026, Ramesh owes ₹1,999.90 since 2026-10-21 (Rs 500 paid).';
    const segments = highlightKeyFacts(answer);
    expect(segments.map(s => s.text).join('')).toBe(answer);
    expect(segments.filter(s => s.strong).map(s => s.text)).toEqual([
      '31 Oct 2026',
      '₹1,999.90',
      '2026-10-21',
      'Rs 500',
    ]);
  });

  it('returns one plain segment when there is nothing to highlight', () => {
    expect(highlightKeyFacts('Kaun sa Ramesh?')).toEqual([
      {text: 'Kaun sa Ramesh?', strong: false},
    ]);
  });
});

it('formats the recording timer against the cap', () => {
  expect(formatRecordingTime(7_400, 60_000)).toBe('0:07 / 1:00');
  expect(formatRecordingTime(65_000, 60_000)).toBe('1:00 / 1:00');
});

describe('chatLanguageHint', () => {
  it.each([
    ['te', 'te'],
    ['ta', 'ta'],
    ['ml', 'ml'],
    ['hi', 'hi'],
    ['en', 'en'],
    ['kn', undefined], // no fixed replies yet: let the model match the question
    ['bn', undefined],
  ])('%p -> %p', (app, hint) => {
    expect(chatLanguageHint(app)).toBe(hint);
  });
});
