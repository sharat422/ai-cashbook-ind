import type {AppLanguage} from '@features/auth/utils/languagePreference';

/**
 * App UI strings. `en` is the source of truth (and the fallback for any key a
 * translation is missing). Add languages incrementally — `{count}` / `{n}`
 * placeholders are filled by `useT`.
 *
 * Localized screens so far: Dashboard, Settings. Other screens fall back to
 * English until their strings are added here.
 */
const en = {
  // Dashboard
  'dashboard.welcome': 'Welcome back',
  'dashboard.yourBusiness': 'Your business',
  'dashboard.offline': 'Offline',
  'dashboard.pendingSyncSuffix': ' · {count} pending sync',
  'dashboard.syncing': 'Syncing {count} items…',
  'dashboard.cashBalance': 'Cash Balance',
  'dashboard.cashBalanceCaption': 'Income received minus expenses paid',
  'dashboard.todayIncome': "Today's Income",
  'dashboard.todayExpense': "Today's Expense",
  'dashboard.monthlyRevenue': 'Monthly Revenue',
  'dashboard.monthlyExpense': 'Monthly Expense',
  'dashboard.aiEntry': '🎤 AI Entry (speak or type)',
  'dashboard.income': '+ Income',
  'dashboard.expense': '− Expense',
  'dashboard.scanReceipt': '📷 Scan receipt',
  'dashboard.categorize': '✨ Categorize',
  'dashboard.dailySummary': '📅 Daily summary',
  'dashboard.customers': '👥 Customers',
  'dashboard.khata': '📒 Khata',
  'dashboard.reports': '📊 Reports',
  'dashboard.recentActivity': 'Recent activity',
  'dashboard.viewAll': 'View all',
  'dashboard.noTransactions': 'No transactions recorded yet.',

  // Settings
  'settings.title': 'Settings',
  'settings.security': 'Security',
  'settings.appLock': 'App lock',
  'settings.appLockDesc': 'Require a {n}-digit PIN to open the app.',
  'settings.setPin': 'Set a PIN',
  'settings.confirmPin': 'Confirm your PIN',
  'settings.appLockEnabled': 'App lock enabled',
  'settings.appLockEnabledMsg': 'You’ll be asked for this PIN on launch.',
  'settings.pinMismatch': 'PINs did not match. Start again.',
  'settings.turnOffLock': 'Turn off app lock?',
  'settings.turnOffLockMsg': 'Your PIN will be removed.',
  'settings.turnOff': 'Turn off',
  'settings.preferences': 'Preferences',
  'settings.contentLanguage': 'Content language',
  'settings.business': 'Business',
  'settings.itemCatalog': '🏷️ Item catalog',
  'settings.notifications': '🔔 Notifications',

  // Common
  'common.cancel': 'Cancel',
  'common.logout': 'Log out',
  'common.logoutConfirmTitle': 'Log out',
  'common.logoutConfirmMsg': 'Are you sure you want to log out?',
} as const;

export type TKey = keyof typeof en;

const hi: Partial<Record<TKey, string>> = {
  'dashboard.welcome': 'वापसी पर स्वागत है',
  'dashboard.yourBusiness': 'आपका व्यवसाय',
  'dashboard.offline': 'ऑफ़लाइन',
  'dashboard.pendingSyncSuffix': ' · {count} सिंक बाकी',
  'dashboard.syncing': '{count} आइटम सिंक हो रहे हैं…',
  'dashboard.cashBalance': 'नकद शेष',
  'dashboard.cashBalanceCaption': 'प्राप्त आय घटा भुगतान किए गए व्यय',
  'dashboard.todayIncome': 'आज की आय',
  'dashboard.todayExpense': 'आज का व्यय',
  'dashboard.monthlyRevenue': 'मासिक आय',
  'dashboard.monthlyExpense': 'मासिक व्यय',
  'dashboard.aiEntry': '🎤 एआई एंट्री (बोलें या लिखें)',
  'dashboard.income': '+ आय',
  'dashboard.expense': '− व्यय',
  'dashboard.scanReceipt': '📷 रसीद स्कैन करें',
  'dashboard.categorize': '✨ श्रेणी दें',
  'dashboard.dailySummary': '📅 दैनिक सारांश',
  'dashboard.customers': '👥 ग्राहक',
  'dashboard.khata': '📒 खाता',
  'dashboard.reports': '📊 रिपोर्ट',
  'dashboard.recentActivity': 'हाल की गतिविधि',
  'dashboard.viewAll': 'सभी देखें',
  'dashboard.noTransactions': 'अभी तक कोई लेन-देन दर्ज नहीं हुआ।',

  'settings.title': 'सेटिंग्स',
  'settings.security': 'सुरक्षा',
  'settings.appLock': 'ऐप लॉक',
  'settings.appLockDesc': 'ऐप खोलने के लिए {n}-अंकों का पिन आवश्यक करें।',
  'settings.setPin': 'पिन सेट करें',
  'settings.confirmPin': 'अपना पिन पुष्टि करें',
  'settings.appLockEnabled': 'ऐप लॉक सक्षम',
  'settings.appLockEnabledMsg': 'लॉन्च पर आपसे यह पिन पूछा जाएगा।',
  'settings.pinMismatch': 'पिन मेल नहीं खाए। फिर से शुरू करें।',
  'settings.turnOffLock': 'ऐप लॉक बंद करें?',
  'settings.turnOffLockMsg': 'आपका पिन हटा दिया जाएगा।',
  'settings.turnOff': 'बंद करें',
  'settings.preferences': 'प्राथमिकताएँ',
  'settings.contentLanguage': 'सामग्री भाषा',
  'settings.business': 'व्यवसाय',
  'settings.itemCatalog': '🏷️ आइटम सूची',
  'settings.notifications': '🔔 सूचनाएँ',

  'common.cancel': 'रद्द करें',
  'common.logout': 'लॉग आउट',
  'common.logoutConfirmTitle': 'लॉग आउट करें',
  'common.logoutConfirmMsg': 'क्या आप वाकई लॉग आउट करना चाहते हैं?',
};

export const translations: Record<AppLanguage, Partial<Record<TKey, string>>> = {
  en,
  hi,
  // Kannada / Tamil / Telugu fall back to English until translated.
  kn: {},
  ta: {},
  te: {},
};

export {en};
