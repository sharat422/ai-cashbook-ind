import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import type {Customer} from '@features/customers/domain/entities';
import type {ExpenseCategory} from '@features/expense/domain/entities';
import type {Attachment} from '@/shared/types/attachment';

/** Prefill payload used to seed the Add Expense form (e.g. from a receipt scan). */
export interface ExpensePrefill {
  amount?: number;
  category?: ExpenseCategory | null;
  vendor?: string;
  date?: string;
  notes?: string;
}

/** Screens shown before the user has a verified session. */
export type AuthStackParamList = {
  Login: undefined;
  Otp: {verificationId: string; mobile: string};
};

/** Screens shown after login but before onboarding is complete. */
export type OnboardingStackParamList = {
  CreateBusiness: undefined;
};

/** Screens for a fully onboarded user. */
export type AppStackParamList = {
  Dashboard: undefined;
  AddIncome: undefined;
  AddExpense:
    | {initialValues?: ExpensePrefill; initialAttachment?: Attachment | null}
    | undefined;
  TransactionHistory: undefined;
  ReceiptCapture: undefined;
  ReceiptReview: {image: Attachment};
  Categorize: undefined;
  DailySummary: undefined;
  Notifications: undefined;
  KhataDashboard: undefined;
  KhataInsights: undefined;
  Customers: {search?: string} | undefined;
  CustomerProfile: {customer: Customer};
  CustomerForm: {customer?: Customer} | undefined;
  AddCredit: {customer: Customer};
  CustomerStatement: {customer: Customer};
  CollectionAssistant: {
    name: string;
    mobile: string;
    amount: number;
    daysOverdue: number;
    relationshipScore: number;
  };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type OnboardingScreenProps<T extends keyof OnboardingStackParamList> =
  NativeStackScreenProps<OnboardingStackParamList, T>;

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;
