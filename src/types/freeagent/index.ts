// FreeAgent API response types (raw from API)

export interface FreeAgentCompany {
  url: string;
  name: string;
  subdomain: string;
  type: string;
  currency: string;
  mileage_units: string;
  company_start_date: string;
  freeagent_start_date: string;
  first_accounting_year_end: string;
  company_registration_number?: string;
  sales_tax_registration_status: string;
  sales_tax_registration_number?: string;
  sales_tax_effective_date?: string;
  sales_tax_rates?: string[];
  supports_auto_sales_tax_on_purchases: boolean;
}

export interface FreeAgentContact {
  url: string;
  first_name?: string;
  last_name?: string;
  organisation_name?: string;
  email?: string;
  billing_email?: string;
  phone_number?: string;
  mobile?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  town?: string;
  region?: string;
  postcode?: string;
  country?: string;
  contact_name_on_invoices: boolean;
  locale?: string;
  default_payment_terms_in_days?: number;
  account_balance: string;
  uses_contact_invoice_sequence: boolean;
  charge_sales_tax: string;
  sales_tax_registration_number?: string;
  active_projects_count: number;
  direct_debit_mandate_state?: string;
  status: 'Active' | 'Inactive';
  created_at: string;
  updated_at: string;
}

export interface FreeAgentInvoiceItem {
  item_type: string;
  quantity: string;
  price: string;
  description?: string;
  category?: string;
  sales_tax_rate?: string;
  second_sales_tax_rate?: string;
}

export interface FreeAgentInvoice {
  url: string;
  contact: string;
  project?: string;
  dated_on: string;
  due_on: string;
  reference?: string;
  currency: string;
  exchange_rate?: string;
  net_value: string;
  sales_tax_value: string;
  total_value: string;
  paid_value: string;
  due_value: string;
  status: 'Draft' | 'Open' | 'Overdue' | 'Paid' | 'Cancelled' | 'Scheduled' | 'Thank You' | 'Reminded';
  comments?: string;
  payment_terms_in_days: number;
  ec_status?: string;
  invoice_items: FreeAgentInvoiceItem[];
  created_at: string;
  updated_at: string;
  paid_on?: string;
  involves_sales_tax: boolean;
  always_show_bic_and_iban: boolean;
  send_thank_you_emails: boolean;
  send_reminder_emails: boolean;
  send_new_invoice_emails: boolean;
  bank_account?: string;
}

export interface FreeAgentBillItem {
  category: string;
  description?: string;
  total_value: string;
  sales_tax_rate?: string;
  project?: string;
}

export interface FreeAgentBill {
  url: string;
  contact: string;
  dated_on: string;
  due_on: string;
  reference?: string;
  currency: string;
  total_value: string;
  sales_tax_value: string;
  paid_value: string;
  due_value: string;
  status: 'Draft' | 'Open' | 'Overdue' | 'Paid';
  comments?: string;
  bill_items?: FreeAgentBillItem[];
  created_at: string;
  updated_at: string;
}

export interface FreeAgentBankAccount {
  url: string;
  name: string;
  opening_balance: string;
  type: string;
  currency: string;
  current_balance: string;
  latest_activity_date?: string;
  status: 'Active' | 'Hidden';
  is_personal: boolean;
  is_primary: boolean;
  bank_name?: string;
  account_number?: string;
  sort_code?: string;
  secondary_sort_code?: string;
  iban?: string;
  bic?: string;
}

export interface FreeAgentAttachment {
  url?: string;
  content_src?: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  description?: string;
}

export interface FreeAgentBankTransactionExplanation {
  url: string;
  type?: string;
  category?: string;
  dated_on: string;
  gross_value: string;
  sales_tax_rate?: string;
  sales_tax_value?: string;
  description?: string;
  paid_invoice?: string;
  paid_bill?: string;
  paid_user?: string;
  rebill_type?: 'cost' | 'markup' | 'price';
  rebill_factor?: string;
  project?: string;
  transfer_bank_account?: string;
  linked_transfer_explanation?: string;
  linked_transfer_account?: string;
  foreign_currency_value?: string;
  stock_item?: string;
  stock_altering_quantity?: number;
  capital_asset?: string;
  disposed_asset?: string;
  property?: string;
  direct_contact?: string;
  receipt_reference?: string;
  ec_status?: 'UK/Non-EC' | 'EC Goods' | 'EC Services' | 'Reverse Charge' | 'EC VAT MOSS';
  marked_for_review?: boolean;
  is_locked?: boolean;
  locked_attributes?: string[];
  attachment?: FreeAgentAttachment;
  bank_account?: string;
  bank_transaction?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FreeAgentBankTransaction {
  url: string;
  bank_account: string;
  dated_on: string;
  amount: string;
  description?: string;
  unexplained_amount: string;
  is_manual: boolean;
  uploaded_at?: string;
  bank_transaction_explanations?: FreeAgentBankTransactionExplanation[];
  created_at: string;
  updated_at: string;
}

export interface FreeAgentProject {
  url: string;
  contact: string;
  name: string;
  currency: string;
  status: 'Active' | 'Completed' | 'Cancelled' | 'Hidden';
  budget: string;
  budget_units: 'Hours' | 'Days' | 'Monetary';
  is_ir35: boolean;
  normal_billing_rate?: string;
  hours_per_day?: string;
  uses_project_invoice_sequence: boolean;
  billing_period?: string;
  starts_on?: string;
  ends_on?: string;
  created_at: string;
  updated_at: string;
}

export interface FreeAgentTask {
  url: string;
  project: string;
  name: string;
  status: 'Active' | 'Completed' | 'Billable' | 'Hidden';
  is_billable: boolean;
  billing_rate?: string;
  billing_period?: string;
  budget?: string;
  created_at: string;
  updated_at: string;
}

export interface FreeAgentTimeslip {
  url: string;
  user: string;
  project: string;
  task: string;
  dated_on: string;
  hours: string;
  comment?: string;
  status: 'Non-Billable' | 'Unbilled' | 'Billed';
  billed_on_invoice?: string;
  created_at: string;
  updated_at: string;
}

export interface FreeAgentExpense {
  url: string;
  user: string;
  category: string;
  dated_on: string;
  currency: string;
  gross_value: string;
  native_gross_value?: string;
  sales_tax_rate?: string;
  sales_tax_value?: string;
  description?: string;
  attachment?: string;
  project?: string;
  rebill_to_project?: string;
  status: 'Non-Reimbursed' | 'Reimbursed' | 'Pending Approval' | 'Rejected';
  manual_sales_tax_amount?: string;
  ec_status?: string;
  receipt_reference?: string;
  created_at: string;
  updated_at: string;
}

export interface FreeAgentCategory {
  url: string;
  description: string;
  nominal_code: string;
  group_description?: string;
  allowable_for_tax: boolean;
  tax_reporting_name?: string;
  auto_sales_tax_rate?: string;
}

export interface FreeAgentUser {
  url: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'Director' | 'Employee' | 'Partner' | 'Sole Trader' | 'Owner' | 'Company Secretary' | 'Accountant' | 'Limited Partner';
  permission_level: number;
  opening_mileage?: string;
  ni_number?: string;
  unique_tax_reference?: string;
  default_billing_rate?: string;
  created_at: string;
  updated_at: string;
}

// API Response wrappers
export interface FreeAgentResponse<T> {
  [key: string]: T | T[];
}

export interface FreeAgentListResponse<T> {
  [key: string]: T[];
}

// Pagination headers
export interface FreeAgentPaginationHeaders {
  'X-Total-Count'?: string;
  'X-Pages'?: string;
  'X-Page'?: string;
  'X-Per-Page'?: string;
}
