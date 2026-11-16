import { z } from 'zod';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentBankTransaction } from '../types/freeagent/index.js';
import { transformBankTransaction } from '../transformers/bank-transformer.js';
import { handleToolError } from '../utils/error-handler.js';
import { normalizeCategoryUrl, normalizeInvoiceId, normalizeBillId, normalizeProjectId } from '../utils/validators.js';
import { FREEAGENT_API_BASE } from '../config.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Explain transaction schema
export const explainTransactionSchema = z.object({
  transaction_id: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gross_value: z.number().optional(),
  sales_tax_rate: z.number().optional(),
  project_id: z.string().optional(),
});

export type ExplainTransactionInput = z.infer<typeof explainTransactionSchema>;

export async function explainTransaction(
  client: FreeAgentClient,
  input: ExplainTransactionInput,
  bankAccountNameLookup?: Map<string, string>
) {
  try {
    const validated = explainTransactionSchema.parse(input);

    const explanationData: Record<string, unknown> = {
      category: normalizeCategoryUrl(validated.category, FREEAGENT_API_BASE),
    };

    if (validated.description) {
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
    if (validated.project_id) {
      explanationData['project'] = normalizeProjectId(validated.project_id, FREEAGENT_API_BASE);
    }

    const response = await client.post<{ bank_transaction: FreeAgentBankTransaction }>(
      `/bank_transactions/${validated.transaction_id}/bank_transaction_explanations`,
      { bank_transaction_explanation: explanationData }
    );

    return transformBankTransaction(response.bank_transaction, bankAccountNameLookup);
  } catch (error) {
    handleToolError(error, 'explain_transaction');
  }
}

// Match transaction to invoice schema
export const matchTransactionToInvoiceSchema = z.object({
  transaction_id: z.string().min(1),
  invoice_id: z.string().min(1),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type MatchTransactionToInvoiceInput = z.infer<typeof matchTransactionToInvoiceSchema>;

export async function matchTransactionToInvoice(
  client: FreeAgentClient,
  input: MatchTransactionToInvoiceInput,
  bankAccountNameLookup?: Map<string, string>
) {
  try {
    const validated = matchTransactionToInvoiceSchema.parse(input);

    const explanationData: Record<string, unknown> = {
      paid_invoice: normalizeInvoiceId(validated.invoice_id, FREEAGENT_API_BASE),
    };

    if (validated.dated_on) {
      explanationData['dated_on'] = validated.dated_on;
    }

    const response = await client.post<{ bank_transaction: FreeAgentBankTransaction }>(
      `/bank_transactions/${validated.transaction_id}/bank_transaction_explanations`,
      { bank_transaction_explanation: explanationData }
    );

    return transformBankTransaction(response.bank_transaction, bankAccountNameLookup);
  } catch (error) {
    handleToolError(error, 'match_transaction_to_invoice');
  }
}

// Match transaction to bill schema
export const matchTransactionToBillSchema = z.object({
  transaction_id: z.string().min(1),
  bill_id: z.string().min(1),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type MatchTransactionToBillInput = z.infer<typeof matchTransactionToBillSchema>;

export async function matchTransactionToBill(
  client: FreeAgentClient,
  input: MatchTransactionToBillInput,
  bankAccountNameLookup?: Map<string, string>
) {
  try {
    const validated = matchTransactionToBillSchema.parse(input);

    const explanationData: Record<string, unknown> = {
      paid_bill: normalizeBillId(validated.bill_id, FREEAGENT_API_BASE),
    };

    if (validated.dated_on) {
      explanationData['dated_on'] = validated.dated_on;
    }

    const response = await client.post<{ bank_transaction: FreeAgentBankTransaction }>(
      `/bank_transactions/${validated.transaction_id}/bank_transaction_explanations`,
      { bank_transaction_explanation: explanationData }
    );

    return transformBankTransaction(response.bank_transaction, bankAccountNameLookup);
  } catch (error) {
    handleToolError(error, 'match_transaction_to_bill');
  }
}

// Split transaction schema
const splitItemSchema = z.object({
  category: z.string().min(1),
  gross_value: z.number(),
  description: z.string().optional(),
  sales_tax_rate: z.number().optional(),
});

export const splitTransactionSchema = z.object({
  transaction_id: z.string().min(1),
  splits: z.array(splitItemSchema).min(2),
});

export type SplitTransactionInput = z.infer<typeof splitTransactionSchema>;

export async function splitTransaction(
  client: FreeAgentClient,
  input: SplitTransactionInput,
  bankAccountNameLookup?: Map<string, string>
) {
  try {
    const validated = splitTransactionSchema.parse(input);

    // Create multiple explanations for the transaction
    let result: FreeAgentBankTransaction | null = null;

    for (const split of validated.splits) {
      const explanationData: Record<string, unknown> = {
        category: normalizeCategoryUrl(split.category, FREEAGENT_API_BASE),
        gross_value: split.gross_value.toString(),
      };

      if (split.description) {
        explanationData['description'] = sanitizeInput(split.description);
      }
      if (split.sales_tax_rate !== undefined) {
        explanationData['sales_tax_rate'] = split.sales_tax_rate.toString();
      }

      const response = await client.post<{ bank_transaction: FreeAgentBankTransaction }>(
        `/bank_transactions/${validated.transaction_id}/bank_transaction_explanations`,
        { bank_transaction_explanation: explanationData }
      );

      result = response.bank_transaction;
    }

    if (!result) {
      throw new Error('Failed to split transaction');
    }

    return transformBankTransaction(result, bankAccountNameLookup);
  } catch (error) {
    handleToolError(error, 'split_transaction');
  }
}

// Unexplain transaction schema
export const unexplainTransactionSchema = z.object({
  transaction_id: z.string().min(1),
  explanation_id: z.string().min(1),
});

export type UnexplainTransactionInput = z.infer<typeof unexplainTransactionSchema>;

export async function unexplainTransaction(
  client: FreeAgentClient,
  input: UnexplainTransactionInput
) {
  try {
    const validated = unexplainTransactionSchema.parse(input);

    await client.delete(
      `/bank_transactions/${validated.transaction_id}/bank_transaction_explanations/${validated.explanation_id}`
    );

    return { success: true, message: 'Transaction explanation removed' };
  } catch (error) {
    handleToolError(error, 'unexplain_transaction');
  }
}
