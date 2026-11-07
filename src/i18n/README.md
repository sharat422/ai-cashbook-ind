# Internationalization (i18n)

The app resolves UI strings at build time from static JSON — there is **no
runtime translation API call**. Screens read strings via the `useT()` hook,
which re-renders when the user changes language.

## Layout

```
src/i18n/
  locales/
    en.json         ← SOURCE OF TRUTH (hand-edited)
    te.json         ← generated (Telugu — the default language for new installs)
    hinglish.json   ← generated (Hindi in Latin letters)
    hi.json …       ← generated (the other Indian languages)
    .hashes.json    ← manifest: which English source each translation was made from
  translations.ts   ← imports the JSON, exports `en`, `translations`, `TKey`
  useT.ts           ← `useT()` / `translate()` — lookup + `{placeholder}` fill
```

## Adding or changing a string

1. Add/edit the key in **`locales/en.json`** only.
2. Use it in a screen: `const t = useT(); … t('my.key')` (with vars:
   `t('customers.count', {count})`). Placeholders are `{name}` style.
3. Generate the other locales:

   ```bash
   npm run i18n:translate        # translates only new/changed keys
   ```

Never hand-edit the generated files — they're regenerated.

Outside React (validation, API errors, share helpers) use `tNow(key)`; for
values stored in English (payment methods, categories) use `src/i18n/labels.ts`.
`src/i18n/screens.i18n.test.ts` fails if a Telugu-first screen hard-codes English.

## How "only changed keys" works

`.hashes.json` records a hash of the English text each translation was produced
from. A key is re-translated only when it's **missing** in a target locale or
its English source **changed** (hash mismatch). Removed keys are pruned.

## Commands

| Command | What it does | Needs API key |
| --- | --- | --- |
| `npm run i18n:check` | Fail if any locale is stale (CI gate) | no |
| `npm run i18n:dry` | List what would be translated | no |
| `npm run i18n:translate` | Translate stale keys via the Anthropic Batch API, write back | **yes** |

Set `ANTHROPIC_API_KEY` for translation. Override the model with `I18N_MODEL`
(default `claude-haiku-4-5-20251001`).

## CI

`.github/workflows/i18n.yml`:

- **check** — every PR touching `src/i18n/**`; fails if translations are stale so
  untranslated strings can't merge.
- **translate** — on push to `main` that changes `en.json` (or manual dispatch);
  translates the changed keys and commits the updated locales back. Requires the
  `ANTHROPIC_API_KEY` repo secret; skips gracefully if it's absent.
