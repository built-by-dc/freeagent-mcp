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

import { listBankTransactions, listBankTransactionsSchema } from '../../src/tools/query-tools.js';
import { listBankTransactionExplanations, listBankTransactionExplanationsSchema } from '../../src/tools/explanation-tools.js';

const mockTransaction = {
  url: 'https://api.freeagent.com/v2/bank_transactions/1',
  bank_account: 'https://api.freeagent.com/v2/bank_accounts/10',
  dated_on: '2026-04-15',
  description: 'Amazon AWS',
  amount: '-120.00',
  is_manual: false,
};

describe('listBankTransactions', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { fetchAllPages: vi.fn() }; });

  it('fetches transactions for an account', async () => {
    // First call: bank accounts lookup; second call: transactions
    mockClient.fetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce([mockTransaction]);
    const result = await listBankTransactions(mockClient, { bank_account_id: '10' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/bank_transactions', 'bank_transactions', expect.objectContaining({ bank_account: expect.stringContaining('10') }));
    expect(result[0].id).toBe('1');
  });

  it('passes view=marked_for_review filter', async () => {
    mockClient.fetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await listBankTransactions(mockClient, { bank_account_id: '10', view: 'marked_for_review' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/bank_transactions', 'bank_transactions', expect.objectContaining({ view: 'marked_for_review' }));
  });

  it('passes date range filters', async () => {
    mockClient.fetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await listBankTransactions(mockClient, { bank_account_id: '10', from_date: '2026-04-01', to_date: '2026-04-30' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/bank_transactions', 'bank_transactions', expect.objectContaining({ from_date: '2026-04-01', to_date: '2026-04-30' }));
  });

  it('does not include view param when not set', async () => {
    mockClient.fetchAllPages.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await listBankTransactions(mockClient, { bank_account_id: '10' });
    const callArgs = mockClient.fetchAllPages.mock.calls[1][2];
    expect(callArgs).not.toHaveProperty('view');
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listBankTransactions(mockClient, { bank_account_id: '10' })).rejects.toThrow();
  });
});

describe('listBankTransactionExplanations — marked_for_review filter', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { fetchAllPages: vi.fn() }; });

  it('passes marked_for_review=true', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listBankTransactionExplanations(mockClient, { bank_account_id: '10', marked_for_review: true });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith(
      '/bank_transaction_explanations',
      'bank_transaction_explanations',
      expect.objectContaining({ marked_for_review: 'true' })
    );
  });

  it('does not pass marked_for_review when not set', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listBankTransactionExplanations(mockClient, { bank_account_id: '10' });
    const callArgs = mockClient.fetchAllPages.mock.calls[0][2];
    expect(callArgs).not.toHaveProperty('marked_for_review');
  });
});
