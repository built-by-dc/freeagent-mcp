import { z } from 'zod';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentBill } from '../types/freeagent/index.js';
import { transformBill } from '../transformers/bill-transformer.js';
import { handleToolError } from '../utils/error-handler.js';
import { normalizeContactId, normalizeCategoryUrl, normalizeProjectId } from '../utils/validators.js';
import { FREEAGENT_API_BASE } from '../config.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Bill item schema
const billItemSchema = z.object({
  category: z.string().min(1),
  description: z.string().optional(),
  total_value: z.number(),
  sales_tax_rate: z.number().optional(),
  project_id: z.string().optional(),
});

// Create bill schema
export const createBillSchema = z.object({
  contact_id: z.string().min(1),
  reference: z.string().min(1),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().length(3).default('GBP'),
  bill_items: z.array(billItemSchema).min(1),
  comments: z.string().optional(),
  ec_status: z.enum(['UK/Non-EC', 'EC w/ VAT', 'EC VAT Exempt', 'EC Reverse Charge']).optional(),
});

export type CreateBillInput = z.infer<typeof createBillSchema>;

export async function createBill(
  client: FreeAgentClient,
  input: CreateBillInput,
  contactNameLookup?: Map<string, string>
) {
  try {
    const validated = createBillSchema.parse(input);

    const billData: Record<string, unknown> = {
      contact: normalizeContactId(validated.contact_id, FREEAGENT_API_BASE),
      reference: sanitizeInput(validated.reference),
      dated_on: validated.dated_on,
      currency: validated.currency.toUpperCase(),
      bill_items: validated.bill_items.map((item) => {
        const itemData: Record<string, unknown> = {
          category: normalizeCategoryUrl(item.category, FREEAGENT_API_BASE),
          total_value: item.total_value.toString(),
        };
        if (item.description) itemData['description'] = sanitizeInput(item.description);
        if (item.sales_tax_rate !== undefined) itemData['sales_tax_rate'] = item.sales_tax_rate.toString();
        if (item.project_id) itemData['project'] = normalizeProjectId(item.project_id, FREEAGENT_API_BASE);
        return itemData;
      }),
    };

    if (validated.due_on) billData['due_on'] = validated.due_on;
    if (validated.comments) billData['comments'] = sanitizeInput(validated.comments);
    if (validated.ec_status) billData['ec_status'] = validated.ec_status;

    const response = await client.post<{ bill: FreeAgentBill }>('/bills', {
      bill: billData,
    });

    return transformBill(response.bill, contactNameLookup);
  } catch (error) {
    handleToolError(error, 'create_bill');
  }
}

// Update bill schema
export const updateBillSchema = z.object({
  bill_id: z.string().min(1),
  reference: z.string().optional(),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  comments: z.string().optional(),
  bill_items: z.array(billItemSchema).min(1).optional(),
});

export type UpdateBillInput = z.infer<typeof updateBillSchema>;

export async function updateBill(
  client: FreeAgentClient,
  input: UpdateBillInput,
  contactNameLookup?: Map<string, string>
) {
  try {
    const validated = updateBillSchema.parse(input);
    const { bill_id, ...fields } = validated;

    const billData: Record<string, unknown> = {};

    if (fields.reference !== undefined) billData['reference'] = sanitizeInput(fields.reference);
    if (fields.dated_on !== undefined) billData['dated_on'] = fields.dated_on;
    if (fields.due_on !== undefined) billData['due_on'] = fields.due_on;
    if (fields.comments !== undefined) billData['comments'] = sanitizeInput(fields.comments);
    if (fields.bill_items) {
      billData['bill_items'] = fields.bill_items.map((item) => {
        const itemData: Record<string, unknown> = {
          category: normalizeCategoryUrl(item.category, FREEAGENT_API_BASE),
          total_value: item.total_value.toString(),
        };
        if (item.description) itemData['description'] = sanitizeInput(item.description);
        if (item.sales_tax_rate !== undefined) itemData['sales_tax_rate'] = item.sales_tax_rate.toString();
        if (item.project_id) itemData['project'] = normalizeProjectId(item.project_id, FREEAGENT_API_BASE);
        return itemData;
      });
    }

    const response = await client.put<{ bill: FreeAgentBill }>(
      `/bills/${bill_id}`,
      { bill: billData }
    );

    return transformBill(response.bill, contactNameLookup);
  } catch (error) {
    handleToolError(error, 'update_bill');
  }
}

// Delete bill schema
export const deleteBillSchema = z.object({
  bill_id: z.string().min(1),
});

export type DeleteBillInput = z.infer<typeof deleteBillSchema>;

export async function deleteBill(
  client: FreeAgentClient,
  input: DeleteBillInput
) {
  try {
    const validated = deleteBillSchema.parse(input);

    await client.delete(`/bills/${validated.bill_id}`);

    return { success: true, message: 'Bill deleted' };
  } catch (error) {
    handleToolError(error, 'delete_bill');
  }
}

// ========== LIST BILLS ==========

export const listBillsSchema = z.object({
  contact_id: z.string().optional(),
  updated_since: z.string().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ListBillsInput = z.infer<typeof listBillsSchema>;

export async function listBills(client: FreeAgentClient, input: ListBillsInput) {
  try {
    const validated = listBillsSchema.parse(input);
    const params: Record<string, string> = {};
    if (validated.contact_id) params['contact'] = normalizeContactId(validated.contact_id, FREEAGENT_API_BASE);
    if (validated.updated_since) params['updated_since'] = validated.updated_since;
    if (validated.from_date) params['from_date'] = validated.from_date;
    if (validated.to_date) params['to_date'] = validated.to_date;
    const bills = await client.fetchAllPages<FreeAgentBill>('/bills', 'bills', params);
    return bills.map((bill) => transformBill(bill));
  } catch (error) {
    handleToolError(error, 'list_bills');
  }
}

// ========== GET BILL ==========

export const getBillSchema = z.object({
  bill_id: z.string().min(1),
});

export type GetBillInput = z.infer<typeof getBillSchema>;

export async function getBill(client: FreeAgentClient, input: GetBillInput) {
  try {
    const validated = getBillSchema.parse(input);
    const response = await client.get<{ bill: FreeAgentBill }>(`/bills/${validated.bill_id}`);
    return transformBill(response.bill);
  } catch (error) {
    handleToolError(error, 'get_bill');
  }
}
