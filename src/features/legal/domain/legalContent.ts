/**
 * Privacy Policy & Terms content, rendered by LegalDocScreen with a per-language
 * selector.
 *
 * ⚠️ TEMPLATE — starting point, NOT legal advice. Before launch: have counsel
 * review the English source, fill the COMPANY / EFFECTIVE_DATE placeholders, and
 * keep the grievance contact IDENTICAL to constants.ts GRIEVANCE and the store
 * listing.
 *
 * ── Adding professional translations ──────────────────────────────────────
 * English (EN below) is the source and the fallback. To add a language:
 *   1. Have a professional translate each section's `heading` and `body`
 *      strings for that locale.
 *   2. KEEP the {tokens} verbatim (e.g. {grievanceEmail}) — they're filled at
 *      runtime from constants, so contact/company details never drift.
 *   3. Register it in LEGAL_TRANSLATIONS below, e.g. `hi: {privacy: {...},
 *      terms: {...}}`.
 * The language selector appears automatically once >1 language is registered.
 */
import {GRIEVANCE, SUPPORT} from '@config/constants';
import type {AppLanguage} from '@features/auth/utils/languagePreference';

export type LegalKind = 'privacy' | 'terms';

export interface LegalSection {
  heading: string;
  body: string[];
}

export interface LegalDoc {
  title: string;
  sections: LegalSection[];
}

// Fill these with your real legal entity + address + go-live date.
export const COMPANY = {
  legalName: '[Your legal entity name]',
  address: '[Registered address, India]',
};
export const EFFECTIVE_DATE = '[Effective date]';

// English SOURCE. Tokens in {braces} are filled at runtime (see `fill`).
const EN: Record<LegalKind, LegalDoc> = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        heading: 'Who we are',
        body: [
          '{legalName} ("we", "us") operates the Smart CashBook app. This policy ' +
            "explains what personal data we handle and your rights under India's " +
            'Digital Personal Data Protection Act, 2023 (DPDP Act).',
          'Registered address: {address}. Effective date: {effectiveDate}.',
        ],
      },
      {
        heading: 'Data we collect',
        body: [
          '• Account: your mobile number (used for OTP sign-in).',
          '• Business profile: business name, owner name, type, state, GST status.',
          '• Financial records you enter: income, expenses, recurring entries.',
          '• Customers & khata: customer names, mobile numbers, GST, addresses, ' +
            'notes and their credit/payment (ledger) history.',
          '• Content you provide: receipt images and voice recordings for entry.',
          '• Diagnostics: basic device/app info and crash reports to keep the app working.',
        ],
      },
      {
        heading: 'How we use it',
        body: [
          'To provide the cashbook: create your account, store and show your ' +
            'entries, compute balances, reports and reminders.',
          'To power AI features (voice entry, receipt scanning, insights) — only ' +
            'if you turn on AI processing consent. You can withdraw it anytime.',
        ],
      },
      {
        heading: 'AI processing & who we share data with',
        body: [
          'With your AI consent, transaction text, voice audio and receipt images ' +
            'are sent to our AI providers (OpenAI and Anthropic) to extract the ' +
            'details. We minimise this — for example, customer names are replaced ' +
            'with opaque labels before insights are generated.',
          'Processors who handle data on our behalf: OpenAI and Anthropic (AI), ' +
            'Render (cloud hosting & database), and — if enabled — Meta/WhatsApp ' +
            '(notifications you request) and Sentry (crash reporting). We do not ' +
            'sell your data or use it for advertising.',
        ],
      },
      {
        heading: 'Security',
        body: [
          'Traffic uses HTTPS/TLS 1.2+. Data is encrypted at rest, and sensitive ' +
            'fields (e.g. GST number, addresses, notes, payment references) are ' +
            'additionally encrypted at the application level.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'You can, from Settings → Your data & privacy: download all your data, ' +
            'correct your business/account details, change or withdraw consent, and ' +
            'delete your account and its data.',
          'To exercise any right or raise a concern, contact our Grievance Officer ' +
            'below. We aim to acknowledge and respond as soon as possible.',
        ],
      },
      {
        heading: 'Data retention',
        body: [
          'We keep your data while your account is active. When you delete your ' +
            'account, we erase or anonymise it; we keep only a minimal, PII-free ' +
            'record that a deletion occurred, for compliance.',
        ],
      },
      {
        heading: 'Children',
        body: ['The app is for business use and not intended for anyone under 18.'],
      },
      {
        heading: 'Grievance / Data Protection Officer',
        body: [
          '{officerName} — {grievanceEmail}. Contact this address for any privacy ' +
            'question or grievance about your personal data. This is separate from ' +
            'general support ({supportEmail}).',
        ],
      },
      {
        heading: 'Changes & governing law',
        body: [
          'We may update this policy; we will note the new effective date here. ' +
            'This policy is governed by the laws of India.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Service',
    sections: [
      {
        heading: 'Acceptance',
        body: [
          'By using Smart CashBook you agree to these Terms with {legalName}. ' +
            'Effective date: {effectiveDate}.',
        ],
      },
      {
        heading: 'The service',
        body: [
          'Smart CashBook helps small businesses in India record income, expenses ' +
            'and customer credit (khata), with optional AI-assisted entry.',
        ],
      },
      {
        heading: 'Your account',
        body: [
          'You sign in with your mobile number via OTP. Keep your device secure. ' +
            'You are responsible for the accuracy of the data you enter.',
        ],
      },
      {
        heading: 'Acceptable use',
        body: [
          'Use the app lawfully and only for your own business records. Do not ' +
            'misuse it, attempt to break its security, or upload others’ data ' +
            'without a lawful basis.',
        ],
      },
      {
        heading: 'Your data & content',
        body: [
          'Your records are yours. You can export or delete them anytime from ' +
            'Settings. Our handling of personal data is described in the Privacy Policy.',
        ],
      },
      {
        heading: 'AI features & no professional advice',
        body: [
          'AI features are best-effort and may be wrong — review results before ' +
            'relying on them. The app does not provide accounting, tax, legal or ' +
            'financial advice; consult a professional for those.',
        ],
      },
      {
        heading: 'Availability, liability & termination',
        body: [
          'The service is provided "as is"; we may change or suspend features. To ' +
            'the extent permitted by law, our liability is limited. [Insert your ' +
            'reviewed liability and warranty terms here.]',
          'You may stop using the app and delete your account at any time.',
        ],
      },
      {
        heading: 'Governing law & contact',
        body: [
          'These Terms are governed by the laws of India. Questions or grievances: ' +
            '{officerName}, {grievanceEmail}.',
        ],
      },
    ],
  },
};

/**
 * Professional translations. Same structure as EN, same {tokens}. Empty until
 * translations are delivered. Example:
 *   hi: { privacy: {title: '…', sections: [...] }, terms: {…} }
 */
const LEGAL_TRANSLATIONS: Partial<Record<AppLanguage, Record<LegalKind, LegalDoc>>> = {};

function tokenValues(): Record<string, string> {
  return {
    legalName: COMPANY.legalName,
    address: COMPANY.address,
    effectiveDate: EFFECTIVE_DATE,
    officerName: GRIEVANCE.officerName,
    grievanceEmail: GRIEVANCE.email,
    supportEmail: SUPPORT.email,
  };
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

/** Languages a legal doc is available in — English always, plus any registered
 * professional translations. Drives the on-screen language selector. */
export function availableLegalLanguages(): AppLanguage[] {
  return ['en', ...(Object.keys(LEGAL_TRANSLATIONS) as AppLanguage[])];
}

/** The doc for `kind` in `lang`, falling back to English, with tokens filled. */
export function getLegalDoc(kind: LegalKind, lang: AppLanguage = 'en'): LegalDoc {
  const raw = LEGAL_TRANSLATIONS[lang]?.[kind] ?? EN[kind];
  const values = tokenValues();
  return {
    title: fill(raw.title, values),
    sections: raw.sections.map(section => ({
      heading: fill(section.heading, values),
      body: section.body.map(paragraph => fill(paragraph, values)),
    })),
  };
}
