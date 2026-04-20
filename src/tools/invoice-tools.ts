import { z } from 'zod';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentInvoice } from '../types/freeagent/index.js';
import { transformInvoice } from '../transformers/invoice-transformer.js';
import { handleToolError } from '../utils/error-handler.js';
import { normalizeContactId, normalizeProjectId } from '../utils/validators.js';
import { FREEAGENT_API_BASE } from '../config.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Invoice item schema
const invoiceItemSchema = z.object({
  description: z.string().min(1),
  item_type: z.enum([
    'Hours', 'Days', 'Weeks', 'Months', 'Years',
    'Products', 'Services', 'Training', 'Expenses', 'Comment'
  ]),
  quantity: z.number().positive(),
  price: z.number(),
  sales_tax_rate: z.number().optional(),
});

// Create invoice schema
export const createInvoiceSchema = z.object({
  contact_id: z.string().min(1),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_terms_in_days: z.number().int().positive().default(30),
  currency: z.string().length(3).default('GBP'),
  invoice_items: z.array(invoiceItemSchema).min(1),
  project_id: z.string().optional(),
  comments: z.string().optional(),
  ec_status: z.enum(['UK/Non-EC', 'EC w/ VAT', 'EC VAT Exempt', 'EC Reverse Charge']).optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export async function createInvoice(
  client: FreeAgentClient,
  input: CreateInvoiceInput,
  contactNameLookup?: Map<string, string>
) {
  try {
    const validated = createInvoiceSchema.parse(input);

    const invoiceData: Record<string, unknown> = {
      contact: normalizeContactId(validated.contact_id, FREEAGENT_API_BASE),
      dated_on: validated.dated_on,
      payment_terms_in_days: validated.payment_terms_in_days,
      currency: validated.currency.toUpperCase(),
      invoice_items: validated.invoice_items.map((item) => ({
        description: sanitizeInput(item.description),
        item_type: item.item_type,
        quantity: item.quantity.toString(),
        price: item.price.toString(),
        ...(item.sales_tax_rate !== undefined && { sales_tax_rate: item.sales_tax_rate.toString() }),
      })),
    };

    if (validated.project_id) {
      invoiceData['project'] = normalizeProjectId(validated.project_id, FREEAGENT_API_BASE);
    }
    if (validated.comments) {
      invoiceData['comments'] = sanitizeInput(validated.comments);
    }
    if (validated.ec_status) {
      invoiceData['ec_status'] = validated.ec_status;
    }

    const response = await client.post<{ invoice: FreeAgentInvoice }>('/invoices', {
      invoice: invoiceData,
    });

    return transformInvoice(response.invoice, contactNameLookup);
  } catch (error) {
    handleToolError(error, 'create_invoice');
  }
}

// Update invoice schema
export const updateInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment_terms_in_days: z.number().int().positive().optional(),
  comments: z.string().optional(),
  invoice_items: z.array(invoiceItemSchema).min(1).optional(),
});

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export async function updateInvoice(
  client: FreeAgentClient,
  input: UpdateInvoiceInput,
  contactNameLookup?: Map<string, string>
) {
  try {
    const validated = updateInvoiceSchema.parse(input);

    const updateData: Record<string, unknown> = {};
    if (validated.dated_on) updateData['dated_on'] = validated.dated_on;
    if (validated.payment_terms_in_days) updateData['payment_terms_in_days'] = validated.payment_terms_in_days;
    if (validated.comments !== undefined) updateData['comments'] = sanitizeInput(validated.comments);
    if (validated.invoice_items) {
      updateData['invoice_items'] = validated.invoice_items.map((item) => ({
        description: sanitizeInput(item.description),
        item_type: item.item_type,
        quantity: item.quantity.toString(),
        price: item.price.toString(),
        ...(item.sales_tax_rate !== undefined && { sales_tax_rate: item.sales_tax_rate.toString() }),
      }));
    }

    const response = await client.put<{ invoice: FreeAgentInvoice }>(
      `/invoices/${validated.invoice_id}`,
      { invoice: updateData }
    );

    return transformInvoice(response.invoice, contactNameLookup);
  } catch (error) {
    handleToolError(error, 'update_invoice');
  }
}

// Send invoice schema
export const sendInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
  email_to: z.string().email().optional(),
});

export type SendInvoiceInput = z.infer<typeof sendInvoiceSchema>;

export async function sendInvoice(
  client: FreeAgentClient,
  input: SendInvoiceInput
) {
  try {
    const validated = sendInvoiceSchema.parse(input);

    const emailData: Record<string, unknown> = {};
    if (validated.email_to) {
      emailData['email'] = { to: validated.email_to };
    }

    await client.put(`/invoices/${validated.invoice_id}/send_email`, emailData);

    return { success: true, message: 'Invoice sent successfully' };
  } catch (error) {
    handleToolError(error, 'send_invoice');
  }
}

// Mark invoice as sent schema
export const markInvoiceSentSchema = z.object({
  invoice_id: z.string().min(1),
});

export type MarkInvoiceSentInput = z.infer<typeof markInvoiceSentSchema>;

export async function markInvoiceSent(
  client: FreeAgentClient,
  input: MarkInvoiceSentInput
) {
  try {
    const validated = markInvoiceSentSchema.parse(input);

    await client.put(`/invoices/${validated.invoice_id}/mark_as_sent`, {});

    return { success: true, message: 'Invoice marked as sent' };
  } catch (error) {
    handleToolError(error, 'mark_invoice_sent');
  }
}

// Mark invoice as paid schema
export const markInvoicePaidSchema = z.object({
  invoice_id: z.string().min(1),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().optional(),
});

export type MarkInvoicePaidInput = z.infer<typeof markInvoicePaidSchema>;

export async function markInvoicePaid(
  client: FreeAgentClient,
  input: MarkInvoicePaidInput
) {
  try {
    const validated = markInvoicePaidSchema.parse(input);

    const paymentData: Record<string, unknown> = {
      paid_on: validated.paid_on,
    };
    if (validated.amount !== undefined) {
      paymentData['amount'] = validated.amount.toString();
    }

    await client.put(`/invoices/${validated.invoice_id}/mark_as_paid`, {
      invoice: paymentData,
    });

    return { success: true, message: 'Invoice marked as paid' };
  } catch (error) {
    handleToolError(error, 'mark_invoice_paid');
  }
}

// Delete invoice schema
export const deleteInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
});

export type DeleteInvoiceInput = z.infer<typeof deleteInvoiceSchema>;

export async function deleteInvoice(
  client: FreeAgentClient,
  input: DeleteInvoiceInput
) {
  try {
    const validated = deleteInvoiceSchema.parse(input);

    await client.delete(`/invoices/${validated.invoice_id}`);

    return { success: true, message: 'Invoice deleted' };
  } catch (error) {
    handleToolError(error, 'delete_invoice');
  }
}

// ========== LIST INVOICES ==========

export const listInvoicesSchema = z.object({
  view: z.enum(['all', 'open', 'overdue', 'open_or_overdue', 'recent_open_or_overdue', 'paid', 'draft', 'scheduled_to_email', 'thank_you_emails', 'reminder_emails']).optional(),
  contact_id: z.string().optional(),
  project_id: z.string().optional(),
  updated_since: z.string().optional(),
  sort: z.string().optional(),
});

export type ListInvoicesInput = z.infer<typeof listInvoicesSchema>;

export async function listInvoices(client: FreeAgentClient, input: ListInvoicesInput) {
  try {
    const validated = listInvoicesSchema.parse(input);
    const params: Record<string, string> = {};
    if (validated.view) params['view'] = validated.view;
    if (validated.contact_id) params['contact'] = `${FREEAGENT_API_BASE}/contacts/${validated.contact_id}`;
    if (validated.project_id) params['project'] = `${FREEAGENT_API_BASE}/projects/${validated.project_id}`;
    if (validated.updated_since) params['updated_since'] = validated.updated_since;
    if (validated.sort) params['sort'] = validated.sort;
    const invoices = await client.fetchAllPages<FreeAgentInvoice>('/invoices', 'invoices', params);
    return invoices.map((inv) => transformInvoice(inv));
  } catch (error) {
    handleToolError(error, 'list_invoices');
  }
}

// ========== GET INVOICE ==========

export const getInvoiceSchema = z.object({
  invoice_id: z.string().min(1),
});

export type GetInvoiceInput = z.infer<typeof getInvoiceSchema>;

export async function getInvoice(client: FreeAgentClient, input: GetInvoiceInput) {
  try {
    const validated = getInvoiceSchema.parse(input);
    const response = await client.get<{ invoice: FreeAgentInvoice }>(`/invoices/${validated.invoice_id}`);
    return transformInvoice(response.invoice);
  } catch (error) {
    handleToolError(error, 'get_invoice');
  }
}
