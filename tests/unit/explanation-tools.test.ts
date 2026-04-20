import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config before importing modules that depend on it
vi.mock('../../src/config.js', () => ({
  config: {
    freeagent: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      environment: 'sandbox',
    },
    tokenEncryptionKey: undefined,
    logLevel: 'info',
  },
  FREEAGENT_API_BASE: 'https://api.sandbox.freeagent.com/v2',
  FREEAGENT_AUTH_URL: 'https://api.sandbox.freeagent.com/v2/approve_app',
  FREEAGENT_TOKEN_URL: 'https://api.sandbox.freeagent.com/v2/token_endpoint',
}));

import {
  listBankTransactionExplanations,
  getBankTransactionExplanation,
  updateBankTransactionExplanation,
  deleteBankTransactionExplanation,
  createBankTransactionExplanation,
  listBankTransactionExplanationsSchema,
  getBankTransactionExplanationSchema,
  updateBankTransactionExplanationSchema,
  deleteBankTransactionExplanationSchema,
  createBankTransactionExplanationSchema,
} from '../../src/tools/explanation-tools.js';
import type { FreeAgentClient } from '../../src/api/freeagent-client.js';
import type { FreeAgentBankTransactionExplanation } from '../../src/types/freeagent/index.js';

// Mock client factory
function createMockClient(overrides: Partial<FreeAgentClient> = {}): FreeAgentClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    fetchAllPages: vi.fn(),
    getRateLimitStatus: vi.fn(),
    ...overrides,
  };
}

// Sample explanation from API
const sampleExplanation: FreeAgentBankTransactionExplanation = {
  url: 'https://api.freeagent.com/v2/bank_transaction_explanations/123',
  type: 'Payment',
  category: 'https://api.freeagent.com/v2/categories/285',
  dated_on: '2024-01-15',
  gross_value: '99.99',
  sales_tax_rate: '20.0',
  sales_tax_value: '16.67',
  description: 'Office supplies',
  ec_status: 'UK/Non-EC',
  marked_for_review: false,
  is_locked: false,
  attachment: {
    file_name: 'receipt.pdf',
    content_type: 'application/pdf',
    file_size: 12345,
    content_src: 'https://files.freeagent.com/...',
    description: 'Receipt',
  },
};

describe('Explanation Tools Schemas', () => {
  describe('listBankTransactionExplanationsSchema', () => {
    it('validates required bank_account_id', () => {
      const result = listBankTransactionExplanationsSchema.safeParse({
        bank_account_id: '12345',
      });
      expect(result.success).toBe(true);
    });

    it('validates optional date filters', () => {
      const result = listBankTransactionExplanationsSchema.safeParse({
        bank_account_id: '12345',
        from_date: '2024-01-01',
        to_date: '2024-01-31',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid date format', () => {
      const result = listBankTransactionExplanationsSchema.safeParse({
        bank_account_id: '12345',
        from_date: '01-01-2024',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing bank_account_id', () => {
      const result = listBankTransactionExplanationsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('getBankTransactionExplanationSchema', () => {
    it('validates explanation_id', () => {
      const result = getBankTransactionExplanationSchema.safeParse({
        explanation_id: '123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty explanation_id', () => {
      const result = getBankTransactionExplanationSchema.safeParse({
        explanation_id: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateBankTransactionExplanationSchema', () => {
    it('validates with only explanation_id', () => {
      const result = updateBankTransactionExplanationSchema.safeParse({
        explanation_id: '123',
      });
      expect(result.success).toBe(true);
    });

    it('validates with all optional fields', () => {
      const result = updateBankTransactionExplanationSchema.safeParse({
        explanation_id: '123',
        category: '285',
        description: 'Updated description',
        dated_on: '2024-01-20',
        gross_value: 150.00,
        sales_tax_rate: 20,
        ec_status: 'UK/Non-EC',
        marked_for_review: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid ec_status', () => {
      const result = updateBankTransactionExplanationSchema.safeParse({
        explanation_id: '123',
        ec_status: 'Invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('deleteBankTransactionExplanationSchema', () => {
    it('validates explanation_id', () => {
      const result = deleteBankTransactionExplanationSchema.safeParse({
        explanation_id: '123',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createBankTransactionExplanationSchema', () => {
    it('validates basic explanation', () => {
      const result = createBankTransactionExplanationSchema.safeParse({
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 99.99,
        category: '285',
      });
      expect(result.success).toBe(true);
    });

    it('validates invoice receipt explanation', () => {
      const result = createBankTransactionExplanationSchema.safeParse({
        bank_transaction_id: '67890',
        dated_on: '2024-01-15',
        gross_value: 1200.00,
        paid_invoice_id: '111',
      });
      expect(result.success).toBe(true);
    });

    it('validates transfer explanation', () => {
      const result = createBankTransactionExplanationSchema.safeParse({
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 500.00,
        transfer_bank_account_id: '67890',
      });
      expect(result.success).toBe(true);
    });

    it('validates with attachment', () => {
      const result = createBankTransactionExplanationSchema.safeParse({
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 99.99,
        category: '285',
        attachment: {
          file_data: 'SGVsbG8=',
          file_name: 'receipt.pdf',
          content_type: 'application/pdf',
        },
      });
      expect(result.success).toBe(true);
    });

    it('validates with project rebilling', () => {
      const result = createBankTransactionExplanationSchema.safeParse({
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 99.99,
        category: '285',
        project_id: '333',
        rebill_type: 'markup',
        rebill_factor: 1.2,
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Explanation Tools Functions', () => {
  describe('listBankTransactionExplanations', () => {
    it('fetches explanations and transforms them', async () => {
      const mockClient = createMockClient({
        fetchAllPages: vi.fn().mockResolvedValue([sampleExplanation]),
      });

      const result = await listBankTransactionExplanations(mockClient, {
        bank_account_id: '12345',
      });

      expect(mockClient.fetchAllPages).toHaveBeenCalledWith(
        '/bank_transaction_explanations',
        'bank_transaction_explanations',
        expect.objectContaining({
          bank_account: expect.stringContaining('/bank_accounts/12345'),
        })
      );

      expect(result).toHaveLength(1);
      expect(result![0]).toMatchObject({
        id: '123',
        type: 'Payment',
        category: '285',
        gross_value: 99.99,
        has_attachment: true,
      });
    });

    it('passes date filters to API', async () => {
      const mockClient = createMockClient({
        fetchAllPages: vi.fn().mockResolvedValue([]),
      });

      await listBankTransactionExplanations(mockClient, {
        bank_account_id: '12345',
        from_date: '2024-01-01',
        to_date: '2024-01-31',
      });

      expect(mockClient.fetchAllPages).toHaveBeenCalledWith(
        '/bank_transaction_explanations',
        'bank_transaction_explanations',
        expect.objectContaining({
          from_date: '2024-01-01',
          to_date: '2024-01-31',
        })
      );
    });
  });

  describe('getBankTransactionExplanation', () => {
    it('fetches single explanation and transforms it', async () => {
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({ bank_transaction_explanation: sampleExplanation }),
      });

      const result = await getBankTransactionExplanation(mockClient, {
        explanation_id: '123',
      });

      expect(mockClient.get).toHaveBeenCalledWith('/bank_transaction_explanations/123');
      expect(result).toMatchObject({
        id: '123',
        type: 'Payment',
        has_attachment: true,
        attachment: {
          file_name: 'receipt.pdf',
          content_type: 'application/pdf',
        },
      });
    });
  });

  describe('updateBankTransactionExplanation', () => {
    it('updates explanation with provided fields', async () => {
      const updatedExplanation = { ...sampleExplanation, description: 'Updated' };
      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ bank_transaction_explanation: updatedExplanation }),
      });

      const result = await updateBankTransactionExplanation(mockClient, {
        explanation_id: '123',
        description: 'Updated',
        gross_value: 150.00,
      });

      expect(mockClient.put).toHaveBeenCalledWith(
        '/bank_transaction_explanations/123',
        {
          bank_transaction_explanation: expect.objectContaining({
            description: 'Updated',
            gross_value: '150',
          }),
        }
      );
    });

    it('normalizes category URL', async () => {
      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ bank_transaction_explanation: sampleExplanation }),
      });

      await updateBankTransactionExplanation(mockClient, {
        explanation_id: '123',
        category: '285',
      });

      expect(mockClient.put).toHaveBeenCalledWith(
        '/bank_transaction_explanations/123',
        {
          bank_transaction_explanation: expect.objectContaining({
            category: expect.stringContaining('/categories/285'),
          }),
        }
      );
    });
  });

  describe('deleteBankTransactionExplanation', () => {
    it('deletes explanation and returns success', async () => {
      const mockClient = createMockClient({
        delete: vi.fn().mockResolvedValue(undefined),
      });

      const result = await deleteBankTransactionExplanation(mockClient, {
        explanation_id: '123',
      });

      expect(mockClient.delete).toHaveBeenCalledWith('/bank_transaction_explanations/123');
      expect(result).toEqual({
        success: true,
        message: 'Bank transaction explanation deleted',
      });
    });
  });

  describe('createBankTransactionExplanation', () => {
    it('creates basic explanation', async () => {
      const mockClient = createMockClient({
        post: vi.fn().mockResolvedValue({ bank_transaction_explanation: sampleExplanation }),
      });

      const result = await createBankTransactionExplanation(mockClient, {
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 99.99,
        category: '285',
        description: 'Office supplies',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/bank_transaction_explanations',
        {
          bank_transaction_explanation: expect.objectContaining({
            bank_account: expect.stringContaining('/bank_accounts/12345'),
            dated_on: '2024-01-15',
            gross_value: '99.99',
            category: expect.stringContaining('/categories/285'),
            description: 'Office supplies',
          }),
        }
      );
    });

    it('creates invoice receipt explanation', async () => {
      const mockClient = createMockClient({
        post: vi.fn().mockResolvedValue({ bank_transaction_explanation: sampleExplanation }),
      });

      await createBankTransactionExplanation(mockClient, {
        bank_transaction_id: '67890',
        dated_on: '2024-01-15',
        gross_value: 1200.00,
        paid_invoice_id: '111',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/bank_transaction_explanations',
        {
          bank_transaction_explanation: expect.objectContaining({
            bank_transaction: expect.stringContaining('/bank_transactions/67890'),
            paid_invoice: expect.stringContaining('/invoices/111'),
          }),
        }
      );
    });

    it('creates transfer explanation', async () => {
      const mockClient = createMockClient({
        post: vi.fn().mockResolvedValue({ bank_transaction_explanation: sampleExplanation }),
      });

      await createBankTransactionExplanation(mockClient, {
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 500.00,
        transfer_bank_account_id: '67890',
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/bank_transaction_explanations',
        {
          bank_transaction_explanation: expect.objectContaining({
            transfer_bank_account: expect.stringContaining('/bank_accounts/67890'),
          }),
        }
      );
    });

    it('creates explanation with attachment', async () => {
      const mockClient = createMockClient({
        post: vi.fn().mockResolvedValue({ bank_transaction_explanation: sampleExplanation }),
      });

      await createBankTransactionExplanation(mockClient, {
        bank_account_id: '12345',
        dated_on: '2024-01-15',
        gross_value: 99.99,
        category: '285',
        attachment: {
          file_data: 'SGVsbG8=',
          file_name: 'receipt.pdf',
          content_type: 'application/pdf',
          description: 'Receipt',
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith(
        '/bank_transaction_explanations',
        {
          bank_transaction_explanation: expect.objectContaining({
            attachment: {
              data: 'SGVsbG8=',
              file_name: 'receipt.pdf',
              content_type: 'application/pdf',
              description: 'Receipt',
            },
          }),
        }
      );
    });

    it('rejects when neither bank_account_id nor bank_transaction_id provided', async () => {
      const mockClient = createMockClient();

      await expect(
        createBankTransactionExplanation(mockClient, {
          dated_on: '2024-01-15',
          gross_value: 99.99,
          category: '285',
        })
      ).rejects.toThrow('Either bank_account_id or bank_transaction_id is required');
    });

    it('rejects attachment over 5MB', async () => {
      const mockClient = createMockClient();
      const largeData = Buffer.alloc(6 * 1024 * 1024).toString('base64');

      await expect(
        createBankTransactionExplanation(mockClient, {
          bank_account_id: '12345',
          dated_on: '2024-01-15',
          gross_value: 99.99,
          category: '285',
          attachment: {
            file_data: largeData,
            file_name: 'large.pdf',
            content_type: 'application/pdf',
          },
        })
      ).rejects.toThrow('Attachment file size exceeds 5MB limit');
    });
  });
});
