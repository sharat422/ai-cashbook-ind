/**
 * No English on a Telugu screen. Every screen is in a group below. A group
 * passes only when nothing a Telugu user reads on it is English:
 *  - no hard-coded text (JSX text, text props, label tables, alerts, thrown
 *    errors), in the screen OR in anything it imports (components, styles,
 *    stores, data layer), and
 *  - every i18n key those files use has a Telugu translation with no English
 *    words in it (brands, units and tax names excepted; see hardcodedText.ts).
 * A new screen (any *Screen.tsx) that isn't in a group fails the build: add it
 * to its group, fix what this finds, and translate it through the review
 * workflow (scripts/i18n-translate.mjs, then review/te.xlsx).
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'fs';
import {dirname, join, relative} from 'path';

import {findHardcodedText, hasWords} from './hardcodedText';

const SRC = join(__dirname, '..');

const GROUPS: Record<string, string[]> = {
  'first launch + onboarding': [
    'features/auth/screens/SplashScreen.tsx',
    'features/auth/screens/LoginScreen.tsx',
    'features/auth/screens/OtpScreen.tsx',
    'features/auth/screens/CreateBusinessScreen.tsx',
    'features/auth/screens/BusinessPickerScreen.tsx', // AC3: a CA with several businesses picks one
    'features/auth/components/LanguageToggle.tsx',
    'features/onboarding/presentation/screens/WelcomeScreen.tsx',
    'features/dashboard/presentation/screens/DashboardScreen.tsx',
  ],
  entry: [
    'features/transactions/presentation/screens/QuickAddScreen.tsx',
    'features/income/presentation/screens/AddIncomeScreen.tsx',
    'features/expense/presentation/screens/AddExpenseScreen.tsx',
    'features/customers/presentation/screens/AddCreditScreen.tsx',
    'features/customers/presentation/screens/CustomerFormScreen.tsx',
    'features/customers/presentation/screens/CustomerListScreen.tsx',
    'features/customers/presentation/screens/CustomerProfileScreen.tsx',
    'features/schemes/presentation/screens/BillScreen.tsx',
  ],
  statement: [
    'features/customers/presentation/screens/CustomerStatementScreen.tsx',
    'features/customers/presentation/screens/BulkStatementsScreen.tsx',
    'features/customers/presentation/exportStatement.ts',
  ],
  'collection / reminders': [
    'features/collections/presentation/screens/RequestPaymentScreen.tsx',
    'features/collection/presentation/screens/CollectionAssistantScreen.tsx',
  ],
  'daily close': [
    'features/reconciliation/presentation/screens/DailyCloseScreen.tsx',
    'features/reconciliation/presentation/screens/ReconciliationScreen.tsx',
    'features/reconciliation/presentation/screens/BankImportScreen.tsx',
    'features/reconciliation/presentation/screens/BankMatchScreen.tsx',
  ],
  'settings + offline sync + import': [
    'features/settings/presentation/screens/SettingsScreen.tsx',
    'features/account/presentation/screens/YourDataScreen.tsx',
    'features/sync/presentation/SyncStatusScreen.tsx',
    'features/sync/presentation/SyncConflictScreen.tsx',
    'features/import/presentation/KhataImportScreen.tsx',
    'components/ui/ErrorBoundary.tsx',
  ],
  // TE4, in the order they were audited.
  beats: [
    'features/beats/presentation/screens/BeatDayListScreen.tsx',
    'features/beats/presentation/screens/BeatPlanScreen.tsx',
    'features/beats/presentation/screens/VisitHistoryScreen.tsx',
  ],
  team: [
    'features/team/presentation/screens/TeamScreen.tsx',
    'features/team/presentation/screens/AccountantActivityScreen.tsx',
    'features/auth/components/BusinessSwitcher.tsx',
    'navigation/withPermission.tsx',
  ],
  reports: [
    'features/reports/presentation/screens/ReportsScreen.tsx',
    'features/daily-summary/presentation/screens/DailySummaryScreen.tsx',
    'features/khata/presentation/screens/KhataDashboardScreen.tsx',
    'features/insights/presentation/screens/KhataInsightsScreen.tsx',
    'features/customer-intel/presentation/screens/CustomerInsightsScreen.tsx',
  ],
  GST: [
    'features/gst/presentation/GstReportsScreen.tsx',
    'features/gst/presentation/GstInvoiceSection.tsx',
  ],
  stock: [
    'features/stock/presentation/screens/StockScreen.tsx',
    'features/stock/presentation/screens/StockCountScreen.tsx',
    'features/stock/presentation/screens/StockHistoryScreen.tsx',
    'features/stock/presentation/screens/VanStockScreen.tsx',
    'features/sync/presentation/StockConflictScreen.tsx',
    'features/items/presentation/screens/ItemListScreen.tsx',
    'features/items/presentation/screens/ItemFormScreen.tsx',
  ],
  'schemes setup': [
    'features/schemes/presentation/screens/SchemesScreen.tsx',
    'features/schemes/presentation/screens/SchemeFormScreen.tsx',
    'features/schemes/presentation/screens/SchemeReportScreen.tsx',
    'features/schemes/presentation/screens/BillDetailScreen.tsx',
    'features/schemes/presentation/BillPrefixCard.tsx',
  ],
  'AI scan / voice': [
    'features/ai-entry/presentation/screens/AITransactionScreen.tsx',
    'features/receipt-scanner/presentation/screens/ReceiptCaptureScreen.tsx',
    'features/receipt-scanner/presentation/screens/ReceiptReviewScreen.tsx',
    'features/categorization/presentation/screens/CategorizationScreen.tsx',
    'features/assistant/presentation/screens/AssistantScreen.tsx',
  ],
  'everything else': [
    'features/transactions/presentation/screens/TransactionHistoryScreen.tsx',
    'features/account/presentation/screens/BusinessEditScreen.tsx',
    'features/account/presentation/screens/DeleteAccountScreen.tsx',
    'features/business/presentation/screens/BusinessScreen.tsx',
    'features/cash-counter/presentation/screens/CashCounterScreen.tsx',
    'features/consent/presentation/screens/ConsentScreen.tsx',
    'features/consent/presentation/screens/ConsentSettingsScreen.tsx',
    'features/diagnostics/presentation/screens/DiagnosticsScreen.tsx',
    'features/legal/presentation/screens/LegalDocScreen.tsx',
    'features/notifications/presentation/screens/NotificationsScreen.tsx',
    'features/recurring/presentation/screens/RecurringFormScreen.tsx',
    'features/recurring/presentation/screens/RecurringListScreen.tsx',
    'features/restore/presentation/screens/RestoreScreen.tsx',
    'features/security/presentation/UnlockScreen.tsx',
    'features/support/presentation/screens/FeedbackScreen.tsx',
    'features/support/presentation/screens/HelpScreen.tsx',
    'navigation/RootNavigator.tsx',
  ],
};

/** Files allowed to stay English, and why. */
const EXCEPTIONS: Record<string, string> = {
  'features/legal/domain/legalContent.ts':
    'Privacy Policy and Terms are legal text: a lawyer-checked translation, not the translation tool. English is the fallback by design.',
};

const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const json = (name: string): Record<string, string> => JSON.parse(read(`i18n/locales/${name}.json`));
const en = json('en');
const te = json('te');
const ALIAS: Record<string, string> = {'@/': '', '@components/': 'components/', '@features/': 'features/', '@navigation/': 'navigation/'};

/** The app file an import points at (only screens' own code: features, components, navigation). */
function resolveImport(from: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) base = join(dirname(join(SRC, from)), spec);
  else {
    const alias = Object.keys(ALIAS).find(a => spec.startsWith(a));
    if (alias) base = join(SRC, ALIAS[alias] + spec.slice(alias.length));
  }
  if (!base) return null;
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) {
      const rel = relative(SRC, c).replace(/\\/g, '/');
      return /^(features|components|navigation)\//.test(rel) ? rel : null;
    }
  }
  return null;
}

/** The screens plus everything they import, transitively. */
function withImports(entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/(?:import|export)(\s+type\b)?[^'";]*?from\s+['"]([^'"]+)['"]/g)) {
      const target = m[1] ? null : resolveImport(file, m[2]);
      if (target) stack.push(target);
    }
  }
  return [...seen].sort();
}

/** A letter that is neither Telugu nor Latin (the tool once put Georgian and Bengali letters in Telugu words). */
const otherScript = (text: string) => [...text].some(ch => /\p{L}/u.test(ch) && !/[\u0000-ɏఀ-౿]/.test(ch));

const cache = new Map<string, string[]>();
/** What a Telugu user would read in English because of this file. */
function englishIn(file: string): string[] {
  if (file in EXCEPTIONS) return [];
  if (!cache.has(file)) {
    const source = read(file);
    const hardCoded = findHardcodedText(source, file).map(f => `${file}:${f.line} "${f.text}"`);
    const keys = [...new Set([...source.matchAll(/['"]([a-z]\w*(?:\.\w+)+)['"]/g)].map(m => m[1]))].filter(k => k in en);
    const untranslated = keys
      .filter(k => !te[k] || hasWords(te[k].replace(/\{\w+\}/g, '')) || otherScript(te[k]))
      .map(k => `${file} te "${k}": ${te[k] ?? '(missing)'}`);
    cache.set(file, [...hardCoded, ...untranslated]);
  }
  return cache.get(file)!;
}

function screensIn(dir: string): string[] {
  return readdirSync(join(SRC, dir)).flatMap(name => {
    const rel = `${dir}/${name}`;
    if (statSync(join(SRC, rel)).isDirectory()) return screensIn(rel);
    return /\wScreen\.tsx$/.test(name) ? [rel] : [];
  });
}

describe('no English on a Telugu screen', () => {
  it.each(Object.keys(GROUPS))('%s', group => {
    expect(withImports(GROUPS[group]).flatMap(englishIn)).toEqual([]);
  });

  it('every screen is in a group (a new screen must be added, and pass)', () => {
    const covered = new Set(Object.values(GROUPS).flat());
    expect(screensIn('features').filter(s => !covered.has(s))).toEqual([]);
  });

  it('follows imports: a screen is only as Telugu as the components it uses', () => {
    const files = withImports(['features/customers/presentation/screens/CustomerListScreen.tsx']);
    expect(files).toContain('features/customers/presentation/components/StatusBadge.tsx');
    expect(files).toContain('features/customers/presentation/components/statusStyle.ts');
  });

  it('the checker catches English text, props, label tables, defaults and alerts', () => {
    const bad = `
      const SORT_LABEL = {'date-desc': 'Newest first'};
      function Bar({placeholder = 'Search…'}) { return null; }
      const X = () => <View><Text>Payment received</Text><Input placeholder="e.g. part payment" />
        <Empty actionLabel="Clear filters" /></View>;
      Alert.alert('Could not save', 'Please try again.');`;
    expect(findHardcodedText(bad).map(f => f.text)).toEqual(
      ['Newest first', 'Search…', 'Payment received', 'e.g. part payment', 'Clear filters',
        'Could not save', 'Please try again.']);
    expect(findHardcodedText(`<Text className="text-sm font-bold">{t('x')} ₹ UPI</Text>`)).toEqual([]);
    expect(findHardcodedText(`const STYLE = {low: {label: 'customers.riskLow', chipText: 'text-danger'}};`)).toEqual([]);
    expect(hasWords('ఉదాహరణ: shop@okhdfcbank')).toBe(false);
    expect(hasWords('కస్టమర్‌ను తెరవండి → Statement')).toBe(true);
    expect(otherScript('మీ డేటా & గోప్యత')).toBe(false);
    expect(otherScript('మీ డేటా & గోప్యతა')).toBe(true);
  });
});
