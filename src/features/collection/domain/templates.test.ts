/** TE6: collection-assistant messages in Hinglish come only from reviewed lines
 *  (src/i18n/reviewed/hinglish.json, written by the review sheet's `apply`).
 *  A tone with none goes out in English and is logged once. */
import {en, translations} from '@/i18n/translations';
import type {CollectionInput} from './entities';

const input: CollectionInput = {name: 'Ramesh', outstandingAmount: 1200, daysOverdue: 12, relationshipScore: 70};
const load = () => {
  // A fresh module each time (its once-only log memory), with its own error-log store.
  let mod!: {gen: typeof import('./generate'); tpl: typeof import('./templates'); logged: () => string[]};
  jest.isolateModules(() => {
    const {useErrorLogStore} = require('@/services/diagnostics/errorLog.store');
    useErrorLogStore.setState({entries: []});
    mod = {gen: require('./generate'), tpl: require('./templates'), logged: () => useErrorLogStore.getState()
      .entries.map((e: {message: string}) => e.message).filter((m: string) => m.includes('collection message'))};
  });
  return mod;
};

test('a Hinglish message uses the reviewed Hinglish template', () => {
  const {gen, tpl, logged} = load();
  tpl.REVIEWED.hinglish = {
    'collect.tpl.friendly': {en: en['collect.tpl.friendly'], text: 'Namaste {name} ji! {amount} {days} din se baaki hai.'},
  };
  const friendly = gen.generateMessages(input, 'hinglish').find(m => m.tone === 'friendly')!;
  expect(friendly.text).toBe('Namaste Ramesh ji! ₹1,200 12 din se baaki hai.');
  expect(logged().filter(m => m.includes('friendly'))).toEqual([]);
});

test('a tone with no reviewed Hinglish goes out in English and is logged once', () => {
  const {gen, tpl, logged} = load();
  tpl.REVIEWED.hinglish = {
    // reviewed against older English: not used
    'collect.tpl.urgent': {en: 'Pay now, {name}.', text: 'Abhi pay karo, {name}.'},
  };
  const first = gen.generateMessages(input, 'hinglish');
  gen.generateMessages(input, 'hinglish');
  expect(first.find(m => m.tone === 'professional')!.text)
    .toBe(gen.generateMessages(input, 'en').find(m => m.tone === 'professional')!.text);
  expect(first.find(m => m.tone === 'urgent')!.text).not.toContain('Abhi pay karo');
  const msgs = logged();
  expect(msgs.filter(m => m.includes('collect.tpl.professional'))).toHaveLength(1);
  expect(msgs.some(m => m.includes('collect.tpl.urgent (the English changed since review)'))).toBe(true);
});

test('the other languages keep their own templates, now in the locale files', () => {
  const {gen, logged} = load();
  const te = gen.generateMessages(input, 'te').find(m => m.tone === 'friendly')!.text;
  expect(te).toBe((translations.te['collect.tpl.friendly'] ?? '')
    .replace('{name}', 'Ramesh').replace('{amount}', '₹1,200').replace('{days}', '12'));
  expect(te).toContain('నమస్కారం Ramesh');
  expect(logged()).toEqual([]);
});
