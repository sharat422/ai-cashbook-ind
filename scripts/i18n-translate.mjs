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
// Target locales the app ships. Everything except English is generated from
// en.json by this script (run `npm run i18n:translate` after editing en.json).
const TARGET_LOCALES = ['hi', 'te', 'ta', 'kn', 'mr', 'gu', 'bn', 'ml', 'pa'];
const LOCALE_NAMES = {
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
  kn: 'Kannada',
  mr: 'Marathi',
  gu: 'Gujarati',
  bn: 'Bengali',
  ml: 'Malayalam',
  pa: 'Punjabi',
};

const MODEL = process.env.I18N_MODEL || 'claude-haiku-4-5-20251001';
const CHUNK_SIZE = 35; // keys per request — smaller = less blast radius if one response is malformed
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
    `- Return ONLY a strictly valid, minified JSON object (RFC 8259) mapping each ` +
    `input key to its translated string. Escape every double-quote (\\") and ` +
    `backslash inside values; no trailing commas, no comments, no text outside ` +
    `the JSON object.`
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** GET with retries — Anthropic occasionally returns transient 429/5xx (incl. a
 * 503 "credential validation failed") while a batch is processing; those must
 * not abort a long-running poll. Only 4xx (except 429) fail fast. */
async function anthropicGet(path, tries = 6) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await anthropic(path);
    } catch (err) {
      const m = /→ (\d+):/.exec(err.message);
      const code = m ? Number(m[1]) : 0;
      const transient = code === 0 || code === 429 || code >= 500;
      if (!transient || attempt >= tries - 1) throw err;
      await sleep(Math.min(2000 * 2 ** attempt, 30_000));
    }
  }
}

/** Submit a batch of translation requests; returns the batch id. */
async function submitBatch(requests) {
  const created = await (await anthropic('/v1/messages/batches', {
    method: 'POST',
    body: JSON.stringify({requests}),
  })).json();
  process.stdout.write(`  batch ${created.id} submitted (${requests.length} requests)`);
  return created.id;
}

/** Poll a batch to completion (resilient), then return custom_id → parsed JSON. */
async function pollAndCollect(id) {
  let status;
  do {
    await sleep(5000);
    process.stdout.write('.');
    status = await (await anthropicGet(`/v1/messages/batches/${id}`)).json();
  } while (status.processing_status !== 'ended');
  process.stdout.write(' done\n');

  const jsonl = await (await anthropicGet(`/v1/messages/batches/${id}/results`)).text();
  const out = {};
  for (const line of jsonl.split('\n').filter(Boolean)) {
    const row = JSON.parse(line); // the batch envelope is always well-formed
    if (row.result?.type !== 'succeeded') {
      console.warn(`  ! ${row.custom_id}: request failed (${row.result?.type}) — skipping`);
      continue;
    }
    const text = row.result.message.content.map(b => b.text || '').join('');
    const parsed = extractJson(text);
    if (parsed) out[row.custom_id] = parsed;
    else console.warn(`  ! ${row.custom_id}: unparseable model JSON — skipping (will re-run)`);
  }
  return out;
}

/** Parse the model's translation object, tolerating code fences or surrounding
 * prose. Returns null if it still can't be parsed (that chunk is left for a
 * re-run rather than aborting the whole batch). */
function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the outermost {...} span in case of leading/trailing prose.
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function check(en, allHashes, locales) {
  let bad = false;
  let pending = false;
  for (const l of locales) {
    const target = readJSON(localeFile(l));
    const {missing, outdated, orphans} = analyze(en, target, allHashes[l] || {});
    // A locale that's entirely empty hasn't been generated yet — that's a TODO
    // (run i18n:translate), not a regression, so it never fails the gate. Once
    // it has any translations it's "live" and drift IS enforced.
    if (Object.keys(target).length === 0) {
      pending = true;
      console.log(`• ${l}: not generated yet (${missing.length} keys) — run i18n:translate`);
      continue;
    }
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
    console.error('\nLive translations are stale. Run:  npm run i18n:translate');
    process.exit(1);
  }
  console.log(
    pending
      ? '\nLive locales are in sync. Some locales are not generated yet — run npm run i18n:translate.'
      : '\nAll target locales are in sync with en.json.',
  );
}

/** Pure: compute the batch requests + custom_id → {locale, keys} plan from the
 * current stale keys. Deterministic (same order/chunking), so a resume rebuilds
 * the identical plan without resubmitting. */
function buildPlan(en, allHashes, locales) {
  const requests = [];
  const plan = {};
  for (const l of locales) {
    const {stale, orphans} = analyze(en, readJSON(localeFile(l)), allHashes[l] || {});
    if (orphans.length) console.log(`  ${l}: pruning ${orphans.length} orphaned key(s)`);
    if (!stale.length) {
      console.log(`  ${l}: nothing to translate`);
      continue;
    }
    console.log(`  ${l}: ${stale.length} key(s) to translate`);
    chunk(stale, CHUNK_SIZE).forEach((keys, i) => {
      // custom_id must match ^[a-zA-Z0-9_-]{1,64}$ — use '-' (e.g. "hi-0").
      const id = `${l}-${i}`;
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
  return {requests, plan};
}

/** Merge batch results into the locale files (placeholder-safe) + update hashes. */
function applyResults(results, plan, en, allHashes, locales) {
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

async function translate(en, allHashes, locales, dryRun) {
  const {requests, plan} = buildPlan(en, allHashes, locales);
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
  const id = await submitBatch(requests);
  console.log(`\n  polling… (if interrupted, resume with: node scripts/i18n-translate.mjs --resume ${id})`);
  const results = await pollAndCollect(id);
  applyResults(results, plan, en, allHashes, locales);
}

/** Recover an already-submitted batch by id (rebuilds the identical plan from
 * the current stale keys — no resubmit, so no double cost). */
async function resume(en, allHashes, locales, batchId) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nANTHROPIC_API_KEY is not set — required to resume.');
    process.exit(1);
  }
  const {plan} = buildPlan(en, allHashes, locales);
  console.log(`  resuming batch ${batchId}…`);
  const results = await pollAndCollect(batchId);
  applyResults(results, plan, en, allHashes, locales);
}

/**
 * Load ANTHROPIC_API_KEY from a gitignored .env at the repo root if it isn't
 * already in the environment — so `npm run i18n:translate` works without pasting
 * the key on the command line (keeps it out of shell history). Tiny hand-rolled
 * parser; the script stays dependency-free.
 */
function loadDotEnvKey() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) {
      process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, '');
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  loadDotEnvKey();
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isDry = args.includes('--dry-run');
  const resumeId = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
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
  else if (resumeId) await resume(en, allHashes, locales, resumeId);
  else await translate(en, allHashes, locales, isDry);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
