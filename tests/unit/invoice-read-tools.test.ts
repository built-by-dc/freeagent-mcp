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

import { listInvoices, listInvoicesSchema, getInvoice, getInvoiceSchema } from '../../src/tools/invoice-tools.js';

describe('listInvoices', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { fetchAllPages: vi.fn(), get: vi.fn() };
  });

  it('fetches invoices with no filters', async () => {
    mockClient.fetchAllPages.mockResolvedValue([
      { url: 'https://api.freeagent.com/v2/invoices/1', reference: 'INV-001', status: 'Open', due_value: '1000.00', currency: 'GBP', contact: 'https://api.freeagent.com/v2/contacts/123', dated_on: '2026-01-01', payment_terms_in_days: 30, invoice_items: [] },
    ]);
    const result = await listInvoices(mockClient, {});
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/invoices', 'invoices', {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('passes view filter', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listInvoices(mockClient, { view: 'overdue' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/invoices', 'invoices', { view: 'overdue' });
  });

  it('passes contact_id filter', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listInvoices(mockClient, { contact_id: '123' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/invoices', 'invoices', expect.objectContaining({ contact: expect.stringContaining('123') }));
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listInvoices(mockClient, {})).rejects.toThrow();
  });
});

describe('getInvoice', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { get: vi.fn() };
  });

  it('fetches single invoice by id', async () => {
    mockClient.get.mockResolvedValue({
      invoice: { url: 'https://api.freeagent.com/v2/invoices/99', reference: 'INV-099', status: 'Paid', due_value: '0.00', currency: 'GBP', contact: 'https://api.freeagent.com/v2/contacts/1', dated_on: '2026-02-01', payment_terms_in_days: 14, invoice_items: [] },
    });
    const result = await getInvoice(mockClient, { invoice_id: '99' });
    expect(mockClient.get).toHaveBeenCalledWith('/invoices/99');
    expect(result.id).toBe('99');
  });

  it('propagates errors', async () => {
    mockClient.get.mockRejectedValue(new Error('API error'));
    await expect(getInvoice(mockClient, { invoice_id: '1' })).rejects.toThrow();
  });
});
