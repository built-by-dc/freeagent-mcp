import { z } from 'zod';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentBankTransactionExplanation, FreeAgentAttachment } from '../types/freeagent/index.js';
import { handleToolError } from '../utils/error-handler.js';
import {
  normalizeBankAccountId,
  normalizeCategoryUrl,
  normalizeInvoiceId,
  normalizeBillId,
  normalizeProjectId,
  extractId,
} from '../utils/validators.js';
import { FREEAGENT_API_BASE } from '../config.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Supported attachment content types
const SUPPORTED_CONTENT_TYPES = [
  'image/png',
  'image/x-png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'application/x-pdf',
  'application/pdf',
] as const;

// Transform explanation for LLM consumption
function transformExplanation(explanation: FreeAgentBankTransactionExplanation) {
  return {
    id: extractId(explanation.url),
    url: explanation.url,
    type: explanation.type,
    category: explanation.category ? extractId(explanation.category) : undefined,
    dated_on: explanation.dated_on,
    gross_value: parseFloat(explanation.gross_value),
    sales_tax_rate: explanation.sales_tax_rate ? parseFloat(explanation.sales_tax_rate) : undefined,
    sales_tax_value: explanation.sales_tax_value ? parseFloat(explanation.sales_tax_value) : undefined,
    description: explanation.description,
    paid_invoice: explanation.paid_invoice ? extractId(explanation.paid_invoice) : undefined,
    paid_bill: explanation.paid_bill ? extractId(explanation.paid_bill) : undefined,
    paid_user: explanation.paid_user ? extractId(explanation.paid_user) : undefined,
    rebill_type: explanation.rebill_type,
    rebill_factor: explanation.rebill_factor ? parseFloat(explanation.rebill_factor) : undefined,
    rebill_to_project: explanation.rebill_to_project ? extractId(explanation.rebill_to_project) : undefined,
    transfer_bank_account: explanation.transfer_bank_account ? extractId(explanation.transfer_bank_account) : undefined,
    linked_transfer_explanation: explanation.linked_transfer_explanation ? extractId(explanation.linked_transfer_explanation) : undefined,
    foreign_currency_value: explanation.foreign_currency_value ? parseFloat(explanation.foreign_currency_value) : undefined,
    ec_status: explanation.ec_status,
    marked_for_review: explanation.marked_for_review,
    is_locked: explanation.is_locked,
    has_attachment: !!explanation.attachment,
    attachment: explanation.attachment ? {
      file_name: explanation.attachment.file_name,
      content_type: explanation.attachment.content_type,
      file_size: explanation.attachment.file_size,
      description: explanation.attachment.description,
      content_src: explanation.attachment.content_src,
    } : undefined,
  };
}

// ========== LIST BANK TRANSACTION EXPLANATIONS ==========
export const listBankTransactionExplanationsSchema = z.object({
  bank_account_id: z.string().min(1).describe('Bank account ID'),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date (YYYY-MM-DD)'),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (YYYY-MM-DD)'),
  updated_since: z.string().optional().describe('ISO 8601 timestamp to filter by update time'),
  marked_for_review: z.boolean().optional().describe('Filter by marked-for-review status'),
});

export type ListBankTransactionExplanationsInput = z.infer<typeof listBankTransactionExplanationsSchema>;

export async function listBankTransactionExplanations(
  client: FreeAgentClient,
  input: ListBankTransactionExplanationsInput
) {
  try {
    const validated = listBankTransactionExplanationsSchema.parse(input);

    const params: Record<string, string> = {
      bank_account: normalizeBankAccountId(validated.bank_account_id, FREEAGENT_API_BASE),
    };

    if (validated.from_date) {
      params['from_date'] = validated.from_date;
    }
    if (validated.to_date) {
      params['to_date'] = validated.to_date;
    }
    if (validated.updated_since) {
      params['updated_since'] = validated.updated_since;
    }
    if (validated.marked_for_review !== undefined) {
      params['marked_for_review'] = validated.marked_for_review.toString();
    }

    const explanations = await client.fetchAllPages<FreeAgentBankTransactionExplanation>(
      '/bank_transaction_explanations',
      'bank_transaction_explanations',
      params
    );

    return explanations.map(transformExplanation);
  } catch (error) {
    handleToolError(error, 'list_bank_transaction_explanations');
  }
}

// ========== GET BANK TRANSACTION EXPLANATION ==========
export const getBankTransactionExplanationSchema = z.object({
  explanation_id: z.string().min(1).describe('Bank transaction explanation ID'),
});

export type GetBankTransactionExplanationInput = z.infer<typeof getBankTransactionExplanationSchema>;

export async function getBankTransactionExplanation(
  client: FreeAgentClient,
  input: GetBankTransactionExplanationInput
) {
  try {
    const validated = getBankTransactionExplanationSchema.parse(input);

    const response = await client.get<{ bank_transaction_explanation: FreeAgentBankTransactionExplanation }>(
      `/bank_transaction_explanations/${validated.explanation_id}`
    );

    return transformExplanation(response.bank_transaction_explanation);
  } catch (error) {
    handleToolError(error, 'get_bank_transaction_explanation');
  }
}

// ========== UPDATE BANK TRANSACTION EXPLANATION ==========
export const updateBankTransactionExplanationSchema = z.object({
  explanation_id: z.string().min(1).describe('Bank transaction explanation ID'),
  category: z.string().optional().describe('Category ID or URL'),
  description: z.string().optional().describe('Description text'),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date (YYYY-MM-DD)'),
  gross_value: z.number().optional().describe('Gross value'),
  sales_tax_rate: z.number().optional().describe('Sales tax rate (e.g., 20 for 20%)'),
  ec_status: z.enum(['UK/Non-EC', 'EC Goods', 'EC Services', 'Reverse Charge', 'EC VAT MOSS']).optional(),
  project_id: z.string().optional().describe('Project ID for rebilling'),
  rebill_type: z.enum(['cost', 'markup', 'price']).optional().describe('Rebill type'),
  rebill_factor: z.number().optional().describe('Rebill factor (required for markup/price)'),
  receipt_reference: z.string().optional().describe('Receipt reference number'),
  marked_for_review: z.boolean().optional().describe('Mark for review'),
});

export type UpdateBankTransactionExplanationInput = z.infer<typeof updateBankTransactionExplanationSchema>;

export async function updateBankTransactionExplanation(
  client: FreeAgentClient,
  input: UpdateBankTransactionExplanationInput
) {
  try {
    const validated = updateBankTransactionExplanationSchema.parse(input);

    const explanationData: Record<string, unknown> = {};

    if (validated.category) {
      explanationData['category'] = normalizeCategoryUrl(validated.category, FREEAGENT_API_BASE);
    }
    if (validated.description !== undefined) {
      explanationData['description'] = sanitizeInput(validated.description);
    }
    if (validated.dated_on) {
      explanationData['dated_on'] = validated.dated_on;
    }
    if (validated.gross_value !== undefined) {
      explanationData['gross_value'] = validated.gross_value.toString();
    }
    if (validated.sales_tax_rate !== undefined) {
      explanationData['sales_tax_rate'] = validated.sales_tax_rate.toString();
    }
    if (validated.ec_status) {
      explanationData['ec_status'] = validated.ec_status;
    }
    if (validated.project_id) {
      explanationData['rebill_to_project'] = normalizeProjectId(validated.project_id, FREEAGENT_API_BASE);
    }
    if (validated.rebill_type) {
      explanationData['rebill_type'] = validated.rebill_type;
    }
    if (validated.rebill_factor !== undefined) {
      explanationData['rebill_factor'] = validated.rebill_factor.toString();
    }
    if (validated.receipt_reference) {
      explanationData['receipt_reference'] = sanitizeInput(validated.receipt_reference);
    }
    if (validated.marked_for_review !== undefined) {
      explanationData['marked_for_review'] = validated.marked_for_review;
    }

    const response = await client.put<{ bank_transaction_explanation: FreeAgentBankTransactionExplanation }>(
      `/bank_transaction_explanations/${validated.explanation_id}`,
      { bank_transaction_explanation: explanationData }
    );

    return transformExplanation(response.bank_transaction_explanation);
  } catch (error) {
    handleToolError(error, 'update_bank_transaction_explanation');
  }
}

// ========== DELETE BANK TRANSACTION EXPLANATION ==========
export const deleteBankTransactionExplanationSchema = z.object({
  explanation_id: z.string().min(1).describe('Bank transaction explanation ID'),
});

export type DeleteBankTransactionExplanationInput = z.infer<typeof deleteBankTransactionExplanationSchema>;

export async function deleteBankTransactionExplanation(
  client: FreeAgentClient,
  input: DeleteBankTransactionExplanationInput
) {
  try {
    const validated = deleteBankTransactionExplanationSchema.parse(input);

    await client.delete(`/bank_transaction_explanations/${validated.explanation_id}`);

    return { success: true, message: 'Bank transaction explanation deleted' };
  } catch (error) {
    handleToolError(error, 'delete_bank_transaction_explanation');
  }
}

// ========== UPLOAD RECEIPT ==========
export const uploadReceiptSchema = z.object({
  explanation_id: z.string().min(1).describe('Bank transaction explanation ID'),
  file_data: z.string().min(1).describe('Base64-encoded file data'),
  file_name: z.string().min(1).describe('File name with extension (e.g., receipt.pdf)'),
  content_type: z.enum(SUPPORTED_CONTENT_TYPES).describe('MIME type: image/png, image/jpeg, image/gif, application/pdf'),
  description: z.string().optional().describe('Description of the attachment'),
});

export type UploadReceiptInput = z.infer<typeof uploadReceiptSchema>;

export async function uploadReceipt(
  client: FreeAgentClient,
  input: UploadReceiptInput
) {
  try {
    const validated = uploadReceiptSchema.parse(input);

    // Validate file size (max 5MB)
    const fileSize = Buffer.from(validated.file_data, 'base64').length;
    if (fileSize > 5 * 1024 * 1024) {
      throw new Error('File size exceeds 5MB limit');
    }

    const attachmentData: Record<string, unknown> = {
      data: validated.file_data,
      file_name: validated.file_name,
      content_type: validated.content_type,
    };

    if (validated.description) {
      attachmentData['description'] = sanitizeInput(validated.description);
    }

    const response = await client.put<{ bank_transaction_explanation: FreeAgentBankTransactionExplanation }>(
      `/bank_transaction_explanations/${validated.explanation_id}`,
      {
        bank_transaction_explanation: {
          attachment: attachmentData,
        },
      }
    );

    return transformExplanation(response.bank_transaction_explanation);
  } catch (error) {
    handleToolError(error, 'upload_receipt');
  }
}

// ========== CREATE BANK TRANSACTION EXPLANATION (Enhanced) ==========
const explanationTypeSchema = z.enum([
  'payment',
  'refund',
  'invoice_receipt',
  'credit_note_refund',
  'bill_payment',
  'bill_refund',
  'transfer',
  'money_to_user',
  'money_from_user',
  'stock_purchase',
  'stock_sale',
  'capital_asset_purchase',
  'capital_asset_disposal',
]);

const attachmentInputSchema = z.object({
  file_data: z.string().min(1).describe('Base64-encoded file data'),
  file_name: z.string().min(1).describe('File name with extension'),
  content_type: z.enum(SUPPORTED_CONTENT_TYPES),
  description: z.string().optional(),
});

export const createBankTransactionExplanationSchema = z.object({
  bank_account_id: z.string().optional().describe('Bank account ID (required if bank_transaction_id not provided)'),
  bank_transaction_id: z.string().optional().describe('Bank transaction ID'),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date (YYYY-MM-DD)'),
  gross_value: z.number().describe('Gross value'),
  category: z.string().optional().describe('Category ID (required except for transfers, invoice/bill payments)'),
  description: z.string().optional().describe('Description'),
  sales_tax_rate: z.number().optional().describe('Sales tax rate'),
  ec_status: z.enum(['UK/Non-EC', 'EC Goods', 'EC Services', 'Reverse Charge', 'EC VAT MOSS']).optional(),

  // Type-specific fields
  paid_invoice_id: z.string().optional().describe('Invoice ID for invoice receipt'),
  paid_bill_id: z.string().optional().describe('Bill ID for bill payment'),
  paid_user_id: z.string().optional().describe('User ID for money to/from user'),
  transfer_bank_account_id: z.string().optional().describe('Target bank account for transfers'),

  // Project rebilling
  project_id: z.string().optional().describe('Project ID for rebilling'),
  rebill_type: z.enum(['cost', 'markup', 'price']).optional(),
  rebill_factor: z.number().optional().describe('Rebill factor (for markup/price)'),

  // Stock
  stock_item_id: z.string().optional().describe('Stock item ID'),
  stock_quantity: z.number().int().optional().describe('Stock quantity'),

  // Capital asset
  capital_asset_id: z.string().optional().describe('Capital asset ID for disposal'),

  // Receipt
  receipt_reference: z.string().optional(),

  // Foreign currency
  foreign_currency_value: z.number().optional(),

  // Attachment
  attachment: attachmentInputSchema.optional().describe('Receipt attachment'),
});

export type CreateBankTransactionExplanationInput = z.infer<typeof createBankTransactionExplanationSchema>;

export async function createBankTransactionExplanation(
  client: FreeAgentClient,
  input: CreateBankTransactionExplanationInput
) {
  try {
    const validated = createBankTransactionExplanationSchema.parse(input);

    if (!validated.bank_account_id && !validated.bank_transaction_id) {
      throw new Error('Either bank_account_id or bank_transaction_id is required');
    }

    const explanationData: Record<string, unknown> = {
      dated_on: validated.dated_on,
      gross_value: validated.gross_value.toString(),
    };

    // Bank account or transaction
    if (validated.bank_account_id) {
      explanationData['bank_account'] = normalizeBankAccountId(validated.bank_account_id, FREEAGENT_API_BASE);
    }
    if (validated.bank_transaction_id) {
      explanationData['bank_transaction'] = `${FREEAGENT_API_BASE}/bank_transactions/${validated.bank_transaction_id}`;
    }

    // Category
    if (validated.category) {
      explanationData['category'] = normalizeCategoryUrl(validated.category, FREEAGENT_API_BASE);
    }

    // Description
    if (validated.description) {
      explanationData['description'] = sanitizeInput(validated.description);
    }

    // Tax
    if (validated.sales_tax_rate !== undefined) {
      explanationData['sales_tax_rate'] = validated.sales_tax_rate.toString();
    }
    if (validated.ec_status) {
      explanationData['ec_status'] = validated.ec_status;
    }

    // Type-specific fields
    if (validated.paid_invoice_id) {
      explanationData['paid_invoice'] = normalizeInvoiceId(validated.paid_invoice_id, FREEAGENT_API_BASE);
    }
    if (validated.paid_bill_id) {
      explanationData['paid_bill'] = normalizeBillId(validated.paid_bill_id, FREEAGENT_API_BASE);
    }
    if (validated.paid_user_id) {
      explanationData['paid_user'] = `${FREEAGENT_API_BASE}/users/${validated.paid_user_id}`;
    }
    if (validated.transfer_bank_account_id) {
      explanationData['transfer_bank_account'] = normalizeBankAccountId(validated.transfer_bank_account_id, FREEAGENT_API_BASE);
    }

    // Project rebilling
    if (validated.project_id) {
      explanationData['rebill_to_project'] = normalizeProjectId(validated.project_id, FREEAGENT_API_BASE);
    }
    if (validated.rebill_type) {
      explanationData['rebill_type'] = validated.rebill_type;
    }
    if (validated.rebill_factor !== undefined) {
      explanationData['rebill_factor'] = validated.rebill_factor.toString();
    }

    // Stock
    if (validated.stock_item_id) {
      explanationData['stock_item'] = `${FREEAGENT_API_BASE}/stock_items/${validated.stock_item_id}`;
    }
    if (validated.stock_quantity !== undefined) {
      explanationData['stock_altering_quantity'] = validated.stock_quantity;
    }

    // Capital asset
    if (validated.capital_asset_id) {
      explanationData['disposed_asset'] = `${FREEAGENT_API_BASE}/capital_assets/${validated.capital_asset_id}`;
    }

    // Receipt reference
    if (validated.receipt_reference) {
      explanationData['receipt_reference'] = sanitizeInput(validated.receipt_reference);
    }

    // Foreign currency
    if (validated.foreign_currency_value !== undefined) {
      explanationData['foreign_currency_value'] = validated.foreign_currency_value.toString();
    }

    // Attachment
    if (validated.attachment) {
      // Validate file size
      const fileSize = Buffer.from(validated.attachment.file_data, 'base64').length;
      if (fileSize > 5 * 1024 * 1024) {
        throw new Error('Attachment file size exceeds 5MB limit');
      }

      explanationData['attachment'] = {
        data: validated.attachment.file_data,
        file_name: validated.attachment.file_name,
        content_type: validated.attachment.content_type,
        description: validated.attachment.description ? sanitizeInput(validated.attachment.description) : undefined,
      };
    }

    const response = await client.post<{ bank_transaction_explanation: FreeAgentBankTransactionExplanation }>(
      '/bank_transaction_explanations',
      { bank_transaction_explanation: explanationData }
    );

    return transformExplanation(response.bank_transaction_explanation);
  } catch (error) {
    handleToolError(error, 'create_bank_transaction_explanation');
  }
}
