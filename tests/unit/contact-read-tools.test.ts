import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listContacts, listContactsSchema, getContact, getContactSchema } from '../../src/tools/contact-tools.js';

describe('listContacts', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      fetchAllPages: vi.fn(),
      get: vi.fn(),
    };
  });

  it('fetches contacts with no filters', async () => {
    mockClient.fetchAllPages.mockResolvedValue([
      { url: 'https://api.freeagent.com/v2/contacts/123', first_name: 'Jane', last_name: 'Doe', organisation_name: null, email: 'jane@example.com', account_balance: '0.00', status: 'active' },
    ]);
    const result = await listContacts(mockClient, {});
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/contacts', 'contacts', {});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('123');
    expect(result[0].name).toBe('Jane Doe');
  });

  it('passes view and sort params', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listContacts(mockClient, { view: 'clients', sort: 'name' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/contacts', 'contacts', { view: 'clients', sort: 'name' });
  });

  it('passes updated_since param', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listContacts(mockClient, { updated_since: '2026-01-01T00:00:00Z' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/contacts', 'contacts', { updated_since: '2026-01-01T00:00:00Z' });
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listContacts(mockClient, {})).rejects.toThrow();
  });
});

describe('getContact', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = { get: vi.fn() };
  });

  it('fetches single contact by id', async () => {
    mockClient.get.mockResolvedValue({
      contact: { url: 'https://api.freeagent.com/v2/contacts/456', first_name: 'Bob', last_name: 'Smith', organisation_name: null, email: 'bob@example.com', account_balance: '500.00', status: 'active' },
    });
    const result = await getContact(mockClient, { contact_id: '456' });
    expect(mockClient.get).toHaveBeenCalledWith('/contacts/456');
    expect(result.id).toBe('456');
    expect(result.name).toBe('Bob Smith');
  });

  it('propagates errors', async () => {
    mockClient.get.mockRejectedValue(new Error('API error'));
    await expect(getContact(mockClient, { contact_id: '456' })).rejects.toThrow();
  });
});
