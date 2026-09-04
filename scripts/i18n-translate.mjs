#!/usr/bin/env node
/**
 * Static, build-time translation of the app's UI strings.
 *
 * `src/i18n/locales/en.json` is the source of truth. This script keeps the other
 * locales in sync by translating ONLY the keys that are new or whose English
 * source changed (tracked via a hash manifest), using the Anthropic Message
 * Batches API. Nothing is translated at runtime — the app just imports the
 * generated JSON.
 *
 * Usage:
 *   node scripts/i18n-translate.mjs --check      # CI gate: fail if any locale
 *                                                # is stale (no API key needed)
 *   node scripts/i18n-translate.mjs              # translate stale keys (needs
 *                                                # ANTHROPIC_API_KEY) + write back
 *   node scripts/i18n-translate.mjs --dry-run    # list what would be translated
 *   node scripts/i18n-translate.mjs --locales hi # limit to some target locales
 *
 * Env:
 *   ANTHROPIC_API_KEY   required for translation (not for --check)
 *   I18N_MODEL          model id (default: claude-haiku-4-5-20251001)
 */

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = join(ROOT, 'src/i18n/locales');
const HASHES_FILE = join(LOCALES_DIR, '.hashes.json');

const SOURCE = 'en';
// Target locales the app actually ships translated. Kannada/Tamil currently
// fall back to English; add 'kn'/'ta' here (and run a full translate) to enable.
const TARGET_LOCALES = ['hi', 'te'];
const LOCALE_NAMES = {hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ta: 'Tamil'};

const MODEL = process.env.I18N_MODEL || 'claude-haiku-4-5-20251001';
const CHUNK_SIZE = 60; // keys per batch request — keeps each response small/reliable
const API = 'https://api.anthropic.com/v1/messages/batches';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const readJSON = f => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const writeJSON = (f, o) => writeFileSync(f, JSON.stringify(sortObj(o), null, 2) + '\n');
const sortObj = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const hash = s => createHash('sha1').update(String(s), 'utf8').digest('hex').slice(0, 12);
const localeFile = l => join(LOCALES_DIR, `${l}.json`);
/** The set of `{placeholder}` tokens in a string, so we can verify they survive. */
const placeholders = s => (String(s).match(/\{[^}]+\}/g) || []).sort().join(',');
const chunk = (arr, n) => arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);

/** Per-locale diff of en → target: which keys need (re)translation and which are stale orphans. */
function analyze(en, target, hashes) {
  const enKeys = Object.keys(en);
  const missing = []; // key absent in target
  const outdated = []; // English source changed since last translation
  for (const k of enKeys) {
    if (!(k in target)) missing.push(k);
    else if (hashes[k] !== hash(en[k])) outdated.push(k);
  }
  const orphans = Object.keys(target).filter(k => !(k in en)); // key removed from en
  return {missing, outdated, orphans, stale: [...missing, ...outdated]};
}

// ---------------------------------------------------------------------------
// Anthropic Message Batches API
// ---------------------------------------------------------------------------
function systemPrompt(localeName) {
  return (
    `You are a professional software localizer for "Smart CashBook", an Indian ` +
    `shopkeeper's cashbook / khata mobile app. Translate UI strings from English ` +
    `to ${localeName}.\n\n` +
    `Rules:\n` +
    `- Natural, concise wording a small shopkeeper would understand; this is a ` +
    `finance app, keep it clear over literal.\n` +
    `- PRESERVE EXACTLY every placeholder token in curly braces (e.g. {count}, ` +
    `{n}, {name}, {amount}) — never translate, rename, or reorder them.\n` +
    `- Keep leading emoji, the ₹ symbol, %, · and other punctuation as-is.\n` +
    `- Common finance loanwords may stay as shopkeepers actually say them ` +
    `(e.g. "udhaar", "GST").\n` +
    `- Return ONLY a JSON object mapping each input key to its translated string. ` +
    `No markdown, no commentary.`
  );
}

async function anthropic(path, init) {
  const res = await fetch(`https://api.anthropic.com${path}`, {
    ...init,
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${path} → ${res.status}: ${await res.text()}`);
  }
  return res;
}

/** Submit a batch of translation requests, poll to completion, return custom_id → parsed object. */
async function runBatch(requests) {
  const created = await (await anthropic('/v1/messages/batches', {
    method: 'POST',
    body: JSON.stringify({requests}),
  })).json();
  const id = created.id;
  process.stdout.write(`  batch ${id} submitted (${requests.length} requests)`);

  let status = created;
  while (status.processing_status !== 'ended') {
    await new Promise(r => setTimeout(r, 5000));
    process.stdout.write('.');
    status = await (await anthropic(`/v1/messages/batches/${id}`)).json();
  }
  process.stdout.write(' done\n');

  const jsonl = await (await anthropic(`/v1/messages/batches/${id}/results`)).text();
  const out = {};
  for (const line of jsonl.split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.result?.type !== 'succeeded') {
      throw new Error(`Request ${row.custom_id} failed: ${JSON.stringify(row.result)}`);
    }
    const text = row.result.message.content.map(b => b.text || '').join('');
    out[row.custom_id] = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function check(en, allHashes, locales) {
  let bad = false;
  for (const l of locales) {
    const {missing, outdated, orphans} = analyze(en, readJSON(localeFile(l)), allHashes[l] || {});
    if (missing.length || outdated.length || orphans.length) {
      bad = true;
      console.error(`✗ ${l}: ${missing.length} missing, ${outdated.length} outdated, ${orphans.length} orphaned`);
      const sample = [...missing, ...outdated].slice(0, 8);
      if (sample.length) console.error(`    e.g. ${sample.join(', ')}`);
      if (orphans.length) console.error(`    orphans: ${orphans.slice(0, 8).join(', ')}`);
    } else {
      console.log(`✓ ${l}: up to date`);
    }
  }
  if (bad) {
    console.error('\nTranslations are stale. Run:  npm run i18n:translate');
    process.exit(1);
  }
  console.log('\nAll target locales are in sync with en.json.');
}

async function translate(en, allHashes, locales, dryRun) {
  const requests = [];
  const plan = {}; // custom_id -> {locale, keys}
  for (const l of locales) {
    const {stale, orphans} = analyze(en, readJSON(localeFile(l)), allHashes[l] || {});
    if (orphans.length) console.log(`  ${l}: pruning ${orphans.length} orphaned key(s)`);
    if (!stale.length) {
      console.log(`  ${l}: nothing to translate`);
      continue;
    }
    console.log(`  ${l}: ${stale.length} key(s) to translate`);
    chunk(stale, CHUNK_SIZE).forEach((keys, i) => {
      const id = `${l}#${i}`;
      plan[id] = {locale: l, keys};
      requests.push({
        custom_id: id,
        params: {
          model: MODEL,
          max_tokens: 8000,
          system: systemPrompt(LOCALE_NAMES[l]),
          messages: [
            {
              role: 'user',
              content: JSON.stringify(Object.fromEntries(keys.map(k => [k, en[k]]))),
            },
          ],
        },
      });
    });
  }

  if (dryRun) {
    console.log(`\n[dry-run] would submit ${requests.length} request(s) via the Batch API.`);
    return;
  }
  if (!requests.length) {
    console.log('\nNothing stale — all target locales already in sync.');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nANTHROPIC_API_KEY is not set — required to translate.');
    process.exit(1);
  }

  const results = await runBatch(requests);

  // Merge results back per locale, prune orphans, verify placeholders, rewrite files.
  const updates = {}; // locale -> merged object
  for (const [id, {locale, keys}] of Object.entries(plan)) {
    const translated = results[id] || {};
    updates[locale] = updates[locale] || {...readJSON(localeFile(locale))};
    allHashes[locale] = allHashes[locale] || {};
    for (const k of keys) {
      const value = translated[k];
      if (typeof value !== 'string') {
        console.warn(`  ! ${locale}/${k}: no translation returned, leaving English fallback`);
        continue;
      }
      if (placeholders(value) !== placeholders(en[k])) {
        console.warn(`  ! ${locale}/${k}: placeholder mismatch, skipping (keeps English)`);
        continue;
      }
      updates[locale][k] = value;
      allHashes[locale][k] = hash(en[k]);
    }
  }

  for (const l of locales) {
    const merged = updates[l] || readJSON(localeFile(l));
    // Prune keys no longer in en from both the locale and its hashes.
    for (const k of Object.keys(merged)) if (!(k in en)) delete merged[k];
    allHashes[l] = allHashes[l] || {};
    for (const k of Object.keys(allHashes[l])) if (!(k in en)) delete allHashes[l][k];
    writeJSON(localeFile(l), merged);
  }
  writeJSON(HASHES_FILE, allHashes);
  console.log('\nWrote updated locale files + hash manifest.');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isDry = args.includes('--dry-run');
  const localesArg = args[args.indexOf('--locales') + 1];
  const locales =
    args.includes('--locales') && localesArg
      ? localesArg.split(',').filter(l => TARGET_LOCALES.includes(l))
      : TARGET_LOCALES;

  const en = readJSON(localeFile(SOURCE));
  if (!Object.keys(en).length) {
    console.error(`Source ${localeFile(SOURCE)} is empty or missing.`);
    process.exit(1);
  }
  const allHashes = readJSON(HASHES_FILE);

  if (isCheck) check(en, allHashes, locales);
  else await translate(en, allHashes, locales, isDry);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
