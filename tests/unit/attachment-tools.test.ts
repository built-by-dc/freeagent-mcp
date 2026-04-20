import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('fs');

import { existsSync, readFileSync } from 'fs';
import {
  uploadAttachment,
  uploadAttachmentSchema,
  getAttachment,
  getAttachmentSchema,
  deleteAttachment,
  deleteAttachmentSchema,
} from '../../src/tools/attachment-tools.js';
import type { FreeAgentClient } from '../../src/api/freeagent-client.js';

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

describe('Attachment Tools Schemas', () => {
  describe('uploadAttachmentSchema', () => {
    it('validates required fields', () => {
      const result = uploadAttachmentSchema.safeParse({
        file_path: '/tmp/receipt.pdf',
        parent_type: 'bill',
        parent_id: '123',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid parent_type', () => {
      const result = uploadAttachmentSchema.safeParse({
        file_path: '/tmp/receipt.pdf',
        parent_type: 'contact',
        parent_id: '123',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid parent types', () => {
      const types = ['bill', 'expense', 'bank_transaction_explanation'];
      types.forEach((parent_type) => {
        const result = uploadAttachmentSchema.safeParse({
          file_path: '/tmp/file.pdf',
          parent_type,
          parent_id: '123',
        });
        expect(result.success).toBe(true);
      });
    });

    it('accepts optional description', () => {
      const result = uploadAttachmentSchema.safeParse({
        file_path: '/tmp/receipt.pdf',
        parent_type: 'expense',
        parent_id: '456',
        description: 'Office supplies receipt',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getAttachmentSchema', () => {
    it('validates attachment_id', () => {
      expect(getAttachmentSchema.safeParse({ attachment_id: '789' }).success).toBe(true);
    });
    it('rejects empty attachment_id', () => {
      expect(getAttachmentSchema.safeParse({ attachment_id: '' }).success).toBe(false);
    });
  });

  describe('deleteAttachmentSchema', () => {
    it('validates attachment_id', () => {
      expect(deleteAttachmentSchema.safeParse({ attachment_id: '789' }).success).toBe(true);
    });
    it('rejects empty attachment_id', () => {
      expect(deleteAttachmentSchema.safeParse({ attachment_id: '' }).success).toBe(false);
    });
  });
});

describe('Attachment Tools Functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('uploadAttachment', () => {
    it('reads file and PUTs to bill endpoint', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake pdf content'));

      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ bill: {} }),
      });

      const result = await uploadAttachment(mockClient, {
        file_path: '/tmp/invoice.pdf',
        parent_type: 'bill',
        parent_id: '42',
      });

      expect(mockClient.put).toHaveBeenCalledWith(
        '/bills/42',
        {
          bill: {
            attachment: expect.objectContaining({
              file_name: 'invoice.pdf',
              content_type: 'application/pdf',
              data: expect.any(String),
            }),
          },
        }
      );
      expect(result).toMatchObject({
        success: true,
        parent_type: 'bill',
        parent_id: '42',
        file_name: 'invoice.pdf',
        content_type: 'application/pdf',
      });
    });

    it('PUTs to expense endpoint', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake content'));

      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ expense: {} }),
      });

      await uploadAttachment(mockClient, {
        file_path: '/tmp/receipt.png',
        parent_type: 'expense',
        parent_id: '99',
      });

      expect(mockClient.put).toHaveBeenCalledWith(
        '/expenses/99',
        expect.objectContaining({ expense: expect.anything() })
      );
    });

    it('PUTs to bank_transaction_explanation endpoint', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('fake content'));

      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ bank_transaction_explanation: {} }),
      });

      await uploadAttachment(mockClient, {
        file_path: '/tmp/receipt.jpg',
        parent_type: 'bank_transaction_explanation',
        parent_id: '7',
      });

      expect(mockClient.put).toHaveBeenCalledWith(
        '/bank_transaction_explanations/7',
        expect.objectContaining({ bank_transaction_explanation: expect.anything() })
      );
    });

    it('normalises full URL parent_id to bare ID', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('content'));

      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ bill: {} }),
      });

      await uploadAttachment(mockClient, {
        file_path: '/tmp/doc.pdf',
        parent_type: 'bill',
        parent_id: 'https://api.freeagent.com/v2/bills/55',
      });

      expect(mockClient.put).toHaveBeenCalledWith('/bills/55', expect.anything());
    });

    it('uses application/octet-stream for unknown extension', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.from('content'));

      const mockClient = createMockClient({
        put: vi.fn().mockResolvedValue({ bill: {} }),
      });

      await uploadAttachment(mockClient, {
        file_path: '/tmp/document.docx',
        parent_type: 'bill',
        parent_id: '1',
      });

      expect(mockClient.put).toHaveBeenCalledWith(
        '/bills/1',
        {
          bill: {
            attachment: expect.objectContaining({
              content_type: 'application/octet-stream',
            }),
          },
        }
      );
    });

    it('throws before API call when file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const mockClient = createMockClient();

      await expect(
        uploadAttachment(mockClient, {
          file_path: '/tmp/missing.pdf',
          parent_type: 'bill',
          parent_id: '1',
        })
      ).rejects.toThrow('File not found: /tmp/missing.pdf');

      expect(mockClient.put).not.toHaveBeenCalled();
    });

    it('throws when file exceeds 5MB', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(Buffer.alloc(6 * 1024 * 1024));
      const mockClient = createMockClient();

      await expect(
        uploadAttachment(mockClient, {
          file_path: '/tmp/big.pdf',
          parent_type: 'bill',
          parent_id: '1',
        })
      ).rejects.toThrow('File size exceeds 5MB limit');
    });
  });

  describe('getAttachment', () => {
    it('fetches attachment metadata by bare ID', async () => {
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({
          attachment: {
            url: 'https://api.freeagent.com/v2/attachments/321',
            file_name: 'receipt.pdf',
            content_type: 'application/pdf',
            file_size: 12345,
            content_src: 'https://files.freeagent.com/receipt.pdf?token=abc',
          },
        }),
      });

      const result = await getAttachment(mockClient, { attachment_id: '321' });

      expect(mockClient.get).toHaveBeenCalledWith('/attachments/321');
      expect(result).toMatchObject({
        id: '321',
        file_name: 'receipt.pdf',
        content_type: 'application/pdf',
        file_size: 12345,
        content_src: 'https://files.freeagent.com/receipt.pdf?token=abc',
      });
    });

    it('normalises full URL attachment_id', async () => {
      const mockClient = createMockClient({
        get: vi.fn().mockResolvedValue({
          attachment: { url: 'https://api.freeagent.com/v2/attachments/321' },
        }),
      });

      await getAttachment(mockClient, {
        attachment_id: 'https://api.freeagent.com/v2/attachments/321',
      });

      expect(mockClient.get).toHaveBeenCalledWith('/attachments/321');
    });
  });

  describe('deleteAttachment', () => {
    it('deletes attachment and returns success', async () => {
      const mockClient = createMockClient({
        delete: vi.fn().mockResolvedValue(undefined),
      });

      const result = await deleteAttachment(mockClient, { attachment_id: '321' });

      expect(mockClient.delete).toHaveBeenCalledWith('/attachments/321');
      expect(result).toEqual({ success: true, message: 'Attachment deleted' });
    });

    it('normalises full URL attachment_id', async () => {
      const mockClient = createMockClient({
        delete: vi.fn().mockResolvedValue(undefined),
      });

      await deleteAttachment(mockClient, {
        attachment_id: 'https://api.freeagent.com/v2/attachments/99',
      });

      expect(mockClient.delete).toHaveBeenCalledWith('/attachments/99');
    });
  });
});
