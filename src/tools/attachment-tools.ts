import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { basename, extname } from 'path';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentAttachment } from '../types/freeagent/index.js';
import { handleToolError } from '../utils/error-handler.js';
import { sanitizeInput } from '../utils/sanitizer.js';
import { extractId } from '../utils/validators.js';

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.csv': 'text/csv',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

const PARENT_ENDPOINTS: Record<string, string> = {
  bill: 'bills',
  expense: 'expenses',
  bank_transaction_explanation: 'bank_transaction_explanations',
};

// ========== UPLOAD ATTACHMENT ==========
export const uploadAttachmentSchema = z.object({
  file_path: z.string().min(1).describe('Absolute path to the file on disk'),
  parent_type: z
    .enum(['bill', 'expense', 'bank_transaction_explanation'])
    .describe('Resource type to attach the file to'),
  parent_id: z.string().min(1).describe('Resource URL or bare ID'),
  description: z.string().optional().describe('Optional description for the attachment'),
});

export type UploadAttachmentInput = z.infer<typeof uploadAttachmentSchema>;

export async function uploadAttachment(client: FreeAgentClient, input: UploadAttachmentInput) {
  try {
    const validated = uploadAttachmentSchema.parse(input);

    // The server runs as a local process with the same filesystem access as the user.
    // Callers can pass any path readable by the process — this is intentional for convenience.
    if (!existsSync(validated.file_path)) {
      throw new Error(`File not found: ${validated.file_path}`);
    }

    const fileBuffer = readFileSync(validated.file_path);

    if (fileBuffer.length > 5 * 1024 * 1024) {
      throw new Error('File size exceeds 5MB limit');
    }

    const fileName = basename(validated.file_path);
    const ext = extname(validated.file_path).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const base64Data = fileBuffer.toString('base64');
    const parentId = extractId(validated.parent_id);
    const endpoint = PARENT_ENDPOINTS[validated.parent_type];

    const attachmentData: Record<string, unknown> = {
      data: base64Data,
      file_name: fileName,
      content_type: contentType,
    };

    if (validated.description !== undefined) {
      attachmentData['description'] = sanitizeInput(validated.description);
    }

    await client.put(`/${endpoint}/${parentId}`, {
      [validated.parent_type]: { attachment: attachmentData },
    });

    return {
      success: true,
      parent_type: validated.parent_type,
      parent_id: parentId,
      file_name: fileName,
      content_type: contentType,
      message: `Attachment uploaded to ${validated.parent_type} successfully`,
    };
  } catch (error) {
    handleToolError(error, 'upload_attachment');
  }
}

// ========== GET ATTACHMENT ==========
export const getAttachmentSchema = z.object({
  attachment_id: z.string().min(1).describe('Attachment URL or bare ID'),
});

export type GetAttachmentInput = z.infer<typeof getAttachmentSchema>;

export async function getAttachment(client: FreeAgentClient, input: GetAttachmentInput) {
  try {
    const validated = getAttachmentSchema.parse(input);
    const attachmentId = extractId(validated.attachment_id);

    const response = await client.get<{ attachment: FreeAgentAttachment }>(
      `/attachments/${attachmentId}`
    );

    const att = response.attachment;

    return {
      id: attachmentId,
      file_name: att.file_name,
      content_type: att.content_type,
      file_size: att.file_size,
      content_src: att.content_src,
    };
  } catch (error) {
    handleToolError(error, 'get_attachment');
  }
}

// ========== DELETE ATTACHMENT ==========
export const deleteAttachmentSchema = z.object({
  attachment_id: z.string().min(1).describe('Attachment URL or bare ID'),
});

export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentSchema>;

export async function deleteAttachment(client: FreeAgentClient, input: DeleteAttachmentInput) {
  try {
    const validated = deleteAttachmentSchema.parse(input);
    const attachmentId = extractId(validated.attachment_id);

    await client.delete(`/attachments/${attachmentId}`);

    return { success: true, message: 'Attachment deleted' };
  } catch (error) {
    handleToolError(error, 'delete_attachment');
  }
}
