// LLM-optimized types (reduced, computed fields)

export interface LLMCompany {
  name: string;
  currency: string;
  type: string;
  startDate: string;
  salesTaxRegistered: boolean;
}

export interface LLMContact {
  id: string;
  name: string;
  organisationName?: string;
  email?: string;
  phoneNumber?: string;
  accountBalance: number;
  status: 'Active' | 'Inactive';
  activeProjectsCount: number;
  paymentTermsDays?: number;
}

export interface LLMInvoiceItem {
  description: string;
  itemType: string;
  quantity: number;
  price: number;
  salesTaxRate?: number;
  lineTotal: number;
}

export interface LLMInvoice {
  id: string;
  reference?: string;
  contactId: string;
  contactName: string;
  projectId?: string;
  datedOn: string;
  dueOn: string;
  currency: string;
  netValue: number;
  taxValue: number;
  totalValue: number;
  paidValue: number;
  dueValue: number;
  status: 'Draft' | 'Open' | 'Overdue' | 'Paid' | 'Cancelled' | 'Scheduled' | 'Thank You' | 'Reminded';
  daysOverdue?: number;
  items: LLMInvoiceItem[];
  comments?: string;
  paymentTermsDays: number;
}

export interface LLMBillItem {
  category: string;
  description?: string;
  totalValue: number;
  salesTaxRate?: number;
  projectId?: string;
}

export interface LLMBill {
  id: string;
  contactId: string;
  contactName: string;
  reference?: string;
  datedOn: string;
  dueOn: string;
  currency: string;
  totalValue: number;
  salesTaxValue: number;
  paidValue: number;
  dueValue: number;
  status: 'Draft' | 'Open' | 'Overdue' | 'Paid';
  items?: LLMBillItem[];
  comments?: string;
}

export interface LLMBankAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  currentBalance: number;
  openingBalance: number;
  status: 'Active' | 'Hidden';
  isPrimary: boolean;
  latestActivityDate?: string;
}

export interface LLMBankTransactionExplanation {
  category?: string;
  description?: string;
  matchedInvoiceId?: string;
  matchedBillId?: string;
  value: number;
  hasAttachment: boolean;
  markedForReview: boolean;
}

export interface LLMBankTransaction {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  datedOn: string;
  amount: number;
  description?: string;
  isExplained: boolean;
  unexplainedAmount: number;
  explanations?: LLMBankTransactionExplanation[];
}

export interface LLMProject {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  status: 'Active' | 'Completed' | 'Cancelled' | 'Hidden';
  currency: string;
  budget: number;
  budgetUnits: 'Hours' | 'Days' | 'Monetary';
  billingRate?: number;
  isIR35: boolean;
  startsOn?: string;
  endsOn?: string;
}

export interface LLMTask {
  id: string;
  projectId: string;
  name: string;
  status: 'Active' | 'Completed' | 'Billable' | 'Hidden';
  isBillable: boolean;
  billingRate?: number;
  budget?: number;
}

export interface LLMTimeslip {
  id: string;
  userId: string;
  projectId: string;
  taskId: string;
  datedOn: string;
  hours: number;
  comment?: string;
  status: 'Non-Billable' | 'Unbilled' | 'Billed';
  billedOnInvoiceId?: string;
}

export interface LLMExpense {
  id: string;
  userId: string;
  category: string;
  datedOn: string;
  currency: string;
  grossValue: number;
  salesTaxValue?: number;
  description?: string;
  projectId?: string;
  status: 'Non-Reimbursed' | 'Reimbursed' | 'Pending Approval' | 'Rejected';
}

export interface LLMCategory {
  id: string;
  description: string;
  nominalCode: string;
  groupDescription?: string;
  allowableForTax: boolean;
}

export interface LLMUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissionLevel: number;
}
