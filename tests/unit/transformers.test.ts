import { describe, it, expect } from 'vitest';
import { extractId, parseNumericString, computeDaysOverdue, computeFullName } from '../../src/transformers/common.js';
import { transformContact } from '../../src/transformers/contact-transformer.js';
import { transformInvoice } from '../../src/transformers/invoice-transformer.js';
import { transformBankTransactionExplanation } from '../../src/transformers/bank-transformer.js';
import type { FreeAgentContact, FreeAgentInvoice, FreeAgentBankTransactionExplanation } from '../../src/types/freeagent/index.js';

describe('Common Transformers', () => {
  describe('extractId', () => {
    it('extracts ID from FreeAgent URL', () => {
      expect(extractId('https://api.freeagent.com/v2/contacts/12345')).toBe('12345');
      expect(extractId('https://api.sandbox.freeagent.com/v2/invoices/67890')).toBe('67890');
    });

    it('returns input if not a URL', () => {
      expect(extractId('12345')).toBe('12345');
    });
  });

  describe('parseNumericString', () => {
    it('parses numeric strings', () => {
      expect(parseNumericString('100.50')).toBe(100.5);
      expect(parseNumericString('-50.00')).toBe(-50);
      expect(parseNumericString('0')).toBe(0);
    });

    it('returns 0 for invalid values', () => {
      expect(parseNumericString('')).toBe(0);
      expect(parseNumericString(undefined)).toBe(0);
      expect(parseNumericString(null)).toBe(0);
      expect(parseNumericString('invalid')).toBe(0);
    });
  });

  describe('computeDaysOverdue', () => {
    it('returns undefined for non-overdue status', () => {
      expect(computeDaysOverdue('2024-01-01', 'Open')).toBeUndefined();
      expect(computeDaysOverdue('2024-01-01', 'Paid')).toBeUndefined();
    });

    it('calculates days overdue for overdue status', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 5);
      const dueDate = yesterday.toISOString().split('T')[0];

      const result = computeDaysOverdue(dueDate!, 'Overdue');
      expect(result).toBe(5);
    });
  });

  describe('computeFullName', () => {
    it('combines first and last name', () => {
      expect(computeFullName('John', 'Doe', 'Acme Ltd')).toBe('John Doe');
    });

    it('falls back to organisation name', () => {
      expect(computeFullName(undefined, undefined, 'Acme Ltd')).toBe('Acme Ltd');
    });

    it('returns Unknown when nothing provided', () => {
      expect(computeFullName(undefined, undefined, undefined)).toBe('Unknown');
    });
  });
});

describe('Contact Transformer', () => {
  it('transforms FreeAgent contact to LLM format', () => {
    const freeAgentContact: FreeAgentContact = {
      url: 'https://api.freeagent.com/v2/contacts/12345',
      first_name: 'John',
      last_name: 'Doe',
      organisation_name: 'Acme Ltd',
      email: 'john@acme.com',
      phone_number: '123456789',
      account_balance: '-500.00',
      status: 'Active',
      active_projects_count: 3,
      contact_name_on_invoices: true,
      uses_contact_invoice_sequence: false,
      charge_sales_tax: 'Auto',
      default_payment_terms_in_days: 30,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
    };

    const result = transformContact(freeAgentContact);

    expect(result).toEqual({
      id: '12345',
      name: 'John Doe',
      organisationName: 'Acme Ltd',
      email: 'john@acme.com',
      phoneNumber: '123456789',
      accountBalance: -500,
      status: 'Active',
      activeProjectsCount: 3,
      paymentTermsDays: 30,
    });
  });
});

describe('Invoice Transformer', () => {
  it('transforms FreeAgent invoice to LLM format', () => {
    const freeAgentInvoice: FreeAgentInvoice = {
      url: 'https://api.freeagent.com/v2/invoices/67890',
      contact: 'https://api.freeagent.com/v2/contacts/12345',
      dated_on: '2024-01-15',
      due_on: '2024-02-14',
      reference: 'INV-001',
      currency: 'GBP',
      net_value: '1000.00',
      sales_tax_value: '200.00',
      total_value: '1200.00',
      paid_value: '0.00',
      due_value: '1200.00',
      status: 'Open',
      payment_terms_in_days: 30,
      invoice_items: [
        {
          description: 'Consulting',
          item_type: 'Hours',
          quantity: '10',
          price: '100.00',
        },
      ],
      created_at: '2024-01-15T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
      involves_sales_tax: true,
      always_show_bic_and_iban: false,
      send_thank_you_emails: false,
      send_reminder_emails: true,
      send_new_invoice_emails: true,
    };

    const contactLookup = new Map([
      ['https://api.freeagent.com/v2/contacts/12345', 'Acme Ltd'],
    ]);

    const result = transformInvoice(freeAgentInvoice, contactLookup);

    expect(result).toEqual({
      id: '67890',
      reference: 'INV-001',
      contactId: '12345',
      contactName: 'Acme Ltd',
      projectId: undefined,
      datedOn: '2024-01-15',
      dueOn: '2024-02-14',
      currency: 'GBP',
      netValue: 1000,
      taxValue: 200,
      totalValue: 1200,
      paidValue: 0,
      dueValue: 1200,
      status: 'Open',
      daysOverdue: undefined,
      items: [
        {
          description: 'Consulting',
          itemType: 'Hours',
          quantity: 10,
          price: 100,
          salesTaxRate: undefined,
          lineTotal: 1000,
        },
      ],
      comments: undefined,
      paymentTermsDays: 30,
    });
  });
});

describe('Bank Transformer', () => {
  describe('transformBankTransactionExplanation', () => {
    it('includes hasAttachment true when attachment present', () => {
      const explanation: FreeAgentBankTransactionExplanation = {
        url: 'https://api.freeagent.com/v2/bank_transaction_explanations/1',
        type: 'Payment',
        dated_on: '2024-01-15',
        gross_value: '50.00',
        ec_status: 'UK/Non-EC',
        marked_for_review: false,
        is_locked: false,
        attachment: { file_name: 'receipt.pdf', content_type: 'application/pdf' },
      };
      const result = transformBankTransactionExplanation(explanation);
      expect(result.hasAttachment).toBe(true);
      expect(result.markedForReview).toBe(false);
    });

    it('includes hasAttachment false when no attachment', () => {
      const explanation: FreeAgentBankTransactionExplanation = {
        url: 'https://api.freeagent.com/v2/bank_transaction_explanations/2',
        type: 'Payment',
        dated_on: '2024-01-15',
        gross_value: '25.00',
        ec_status: 'UK/Non-EC',
        marked_for_review: true,
        is_locked: false,
      };
      const result = transformBankTransactionExplanation(explanation);
      expect(result.hasAttachment).toBe(false);
      expect(result.markedForReview).toBe(true);
    });

    it('defaults markedForReview to false when field is absent', () => {
      const explanation: FreeAgentBankTransactionExplanation = {
        url: 'https://api.freeagent.com/v2/bank_transaction_explanations/3',
        type: 'Payment',
        dated_on: '2024-01-15',
        gross_value: '10.00',
        ec_status: 'UK/Non-EC',
        is_locked: false,
        // marked_for_review intentionally omitted
      };
      const result = transformBankTransactionExplanation(explanation);
      expect(result.markedForReview).toBe(false);
    });
  });
});
