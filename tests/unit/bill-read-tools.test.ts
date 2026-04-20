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

import { listBills, listBillsSchema, getBill, getBillSchema } from '../../src/tools/bill-tools.js';

describe('listBills', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { fetchAllPages: vi.fn(), get: vi.fn() };
  });

  it('fetches bills with no filters', async () => {
    mockClient.fetchAllPages.mockResolvedValue([
      { url: 'https://api.freeagent.com/v2/bills/10', reference: 'BILL-001', status: 'Open', total_value: '500.00', currency: 'GBP', contact: 'https://api.freeagent.com/v2/contacts/1', dated_on: '2026-01-15', due_on: '2026-02-15' },
    ]);
    const result = await listBills(mockClient, {});
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/bills', 'bills', {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('10');
  });

  it('passes contact_id filter', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listBills(mockClient, { contact_id: '5' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/bills', 'bills', expect.objectContaining({ contact: expect.stringContaining('5') }));
  });

  it('passes updated_since filter', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listBills(mockClient, { updated_since: '2026-01-01T00:00:00Z' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/bills', 'bills', { updated_since: '2026-01-01T00:00:00Z' });
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listBills(mockClient, {})).rejects.toThrow();
  });
});

describe('getBill', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { get: vi.fn() };
  });

  it('fetches single bill by id', async () => {
    mockClient.get.mockResolvedValue({
      bill: { url: 'https://api.freeagent.com/v2/bills/10', reference: 'BILL-001', status: 'Open', total_value: '500.00', currency: 'GBP', contact: 'https://api.freeagent.com/v2/contacts/1', dated_on: '2026-01-15', due_on: '2026-02-15' },
    });
    const result = await getBill(mockClient, { bill_id: '10' });
    expect(mockClient.get).toHaveBeenCalledWith('/bills/10');
    expect(result.id).toBe('10');
  });

  it('propagates errors', async () => {
    mockClient.get.mockRejectedValue(new Error('API error'));
    await expect(getBill(mockClient, { bill_id: '10' })).rejects.toThrow();
  });
});
