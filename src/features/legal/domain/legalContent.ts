/**
 * Privacy Policy & Terms content (English), rendered by LegalDocScreen.
 *
 * ⚠️ TEMPLATE — starting point, NOT legal advice. Before launch: have counsel
 * review it, fill the COMPANY / EFFECTIVE_DATE placeholders, and keep the
 * grievance contact IDENTICAL to constants.ts GRIEVANCE and the store listing.
 * Kept in English on purpose — don't machine-translate legal text.
 */
import {GRIEVANCE, SUPPORT} from '@config/constants';

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

function privacyPolicy(): LegalDoc {
  return {
    title: 'Privacy Policy',
    sections: [
      {
        heading: 'Who we are',
        body: [
          `${COMPANY.legalName} ("we", "us") operates the Smart CashBook app. ` +
            `This policy explains what personal data we handle and your rights ` +
            `under India's Digital Personal Data Protection Act, 2023 (DPDP Act).`,
          `Registered address: ${COMPANY.address}. Effective date: ${EFFECTIVE_DATE}.`,
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
          `${GRIEVANCE.officerName} — ${GRIEVANCE.email}. Contact this address for ` +
            `any privacy question or grievance about your personal data. This is ` +
            `separate from general support (${SUPPORT.email}).`,
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
  };
}

function terms(): LegalDoc {
  return {
    title: 'Terms of Service',
    sections: [
      {
        heading: 'Acceptance',
        body: [
          `By using Smart CashBook you agree to these Terms with ${COMPANY.legalName}. ` +
            `Effective date: ${EFFECTIVE_DATE}.`,
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
            `${GRIEVANCE.officerName}, ${GRIEVANCE.email}.`,
        ],
      },
    ],
  };
}

export function getLegalDoc(kind: LegalKind): LegalDoc {
  return kind === 'terms' ? terms() : privacyPolicy();
}
