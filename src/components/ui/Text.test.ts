import {textClass} from './Text';

// NativeWind settles clashing classes by CSS order, so a screen's own size, weight or colour
// must replace the variant's, not sit beside it.
test.each([
  ['body', undefined, 'text-base text-slate-900'],
  ['body', 'mt-1 text-green-300', 'text-base mt-1 text-green-300'], // the dark Reports card
  ['body', 'text-[11px] uppercase text-slate-400', 'text-[11px] uppercase text-slate-400'],
  ['title', 'text-4xl text-white/80', 'font-bold text-4xl text-white/80'],
  ['label', 'font-bold', 'text-sm text-slate-700 font-bold'],
  ['caption', 'mt-1 text-center', 'text-xs text-muted mt-1 text-center'], // alignment isn't colour
  ['caption', 'active:text-white', 'text-xs text-muted active:text-white'],
] as const)('%s + %s', (variant, className, expected) => {
  expect(textClass(variant, className)).toBe(expected);
});
