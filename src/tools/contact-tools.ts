import { z } from 'zod';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentContact } from '../types/freeagent/index.js';
import { transformContact } from '../transformers/contact-transformer.js';
import { handleToolError } from '../utils/error-handler.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Create contact schema - requires first_name OR organisation_name
export const createContactSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  organisation_name: z.string().optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  address3: z.string().optional(),
  town: z.string().optional(),
  region: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  default_payment_terms_in_days: z.number().int().positive().optional(),
  charge_sales_tax: z.enum(['Auto', 'Always', 'Never']).optional(),
}).refine(
  (data) => data.first_name || data.organisation_name,
  { message: 'Either first_name or organisation_name is required' }
);

export type CreateContactInput = z.infer<typeof createContactSchema>;

export async function createContact(
  client: FreeAgentClient,
  input: CreateContactInput
) {
  try {
    const validated = createContactSchema.parse(input);

    const contactData: Record<string, unknown> = {};

    if (validated.first_name) contactData['first_name'] = sanitizeInput(validated.first_name);
    if (validated.last_name) contactData['last_name'] = sanitizeInput(validated.last_name);
    if (validated.organisation_name) contactData['organisation_name'] = sanitizeInput(validated.organisation_name);
    if (validated.email) contactData['email'] = validated.email;
    if (validated.phone_number) contactData['phone_number'] = sanitizeInput(validated.phone_number);
    if (validated.address1) contactData['address1'] = sanitizeInput(validated.address1);
    if (validated.address2) contactData['address2'] = sanitizeInput(validated.address2);
    if (validated.address3) contactData['address3'] = sanitizeInput(validated.address3);
    if (validated.town) contactData['town'] = sanitizeInput(validated.town);
    if (validated.region) contactData['region'] = sanitizeInput(validated.region);
    if (validated.postcode) contactData['postcode'] = sanitizeInput(validated.postcode);
    if (validated.country) contactData['country'] = sanitizeInput(validated.country);
    if (validated.default_payment_terms_in_days) {
      contactData['default_payment_terms_in_days'] = validated.default_payment_terms_in_days;
    }
    if (validated.charge_sales_tax) contactData['charge_sales_tax'] = validated.charge_sales_tax;

    const response = await client.post<{ contact: FreeAgentContact }>('/contacts', {
      contact: contactData,
    });

    return transformContact(response.contact);
  } catch (error) {
    handleToolError(error, 'create_contact');
  }
}

// Update contact schema
export const updateContactSchema = z.object({
  contact_id: z.string().min(1),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  organisation_name: z.string().optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  address1: z.string().optional(),
  address2: z.string().optional(),
  address3: z.string().optional(),
  town: z.string().optional(),
  region: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  default_payment_terms_in_days: z.number().int().positive().optional(),
  charge_sales_tax: z.enum(['Auto', 'Always', 'Never']).optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
});

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export async function updateContact(
  client: FreeAgentClient,
  input: UpdateContactInput
) {
  try {
    const validated = updateContactSchema.parse(input);
    const { contact_id, ...fields } = validated;

    const contactData: Record<string, unknown> = {};

    if (fields.first_name !== undefined) contactData['first_name'] = sanitizeInput(fields.first_name);
    if (fields.last_name !== undefined) contactData['last_name'] = sanitizeInput(fields.last_name);
    if (fields.organisation_name !== undefined) contactData['organisation_name'] = sanitizeInput(fields.organisation_name);
    if (fields.email !== undefined) contactData['email'] = fields.email;
    if (fields.phone_number !== undefined) contactData['phone_number'] = sanitizeInput(fields.phone_number);
    if (fields.address1 !== undefined) contactData['address1'] = sanitizeInput(fields.address1);
    if (fields.address2 !== undefined) contactData['address2'] = sanitizeInput(fields.address2);
    if (fields.address3 !== undefined) contactData['address3'] = sanitizeInput(fields.address3);
    if (fields.town !== undefined) contactData['town'] = sanitizeInput(fields.town);
    if (fields.region !== undefined) contactData['region'] = sanitizeInput(fields.region);
    if (fields.postcode !== undefined) contactData['postcode'] = sanitizeInput(fields.postcode);
    if (fields.country !== undefined) contactData['country'] = sanitizeInput(fields.country);
    if (fields.default_payment_terms_in_days !== undefined) {
      contactData['default_payment_terms_in_days'] = fields.default_payment_terms_in_days;
    }
    if (fields.charge_sales_tax !== undefined) contactData['charge_sales_tax'] = fields.charge_sales_tax;
    if (fields.status !== undefined) contactData['status'] = fields.status;

    const response = await client.put<{ contact: FreeAgentContact }>(
      `/contacts/${contact_id}`,
      { contact: contactData }
    );

    return transformContact(response.contact);
  } catch (error) {
    handleToolError(error, 'update_contact');
  }
}

// Delete contact schema
export const deleteContactSchema = z.object({
  contact_id: z.string().min(1),
});

export type DeleteContactInput = z.infer<typeof deleteContactSchema>;

export async function deleteContact(
  client: FreeAgentClient,
  input: DeleteContactInput
) {
  try {
    const validated = deleteContactSchema.parse(input);

    await client.delete(`/contacts/${validated.contact_id}`);

    return { success: true, message: 'Contact deleted' };
  } catch (error) {
    handleToolError(error, 'delete_contact');
  }
}

// ========== LIST CONTACTS ==========

export const listContactsSchema = z.object({
  view: z.enum(['all', 'active', 'clients', 'suppliers', 'hidden']).optional(),
  sort: z.string().optional(),
  updated_since: z.string().optional(),
});

export async function listContacts(client: FreeAgentClient, input: unknown) {
  try {
    const validated = listContactsSchema.parse(input);
    const params: Record<string, string> = {};
    if (validated.view) params['view'] = validated.view;
    if (validated.sort) params['sort'] = validated.sort;
    if (validated.updated_since) params['updated_since'] = validated.updated_since;
    const contacts = await client.fetchAllPages<FreeAgentContact>('/contacts', 'contacts', params);
    return contacts.map(transformContact);
  } catch (error) {
    handleToolError(error, 'list_contacts');
  }
}

// ========== GET CONTACT ==========

export const getContactSchema = z.object({
  contact_id: z.string().min(1),
});

export async function getContact(client: FreeAgentClient, input: unknown) {
  try {
    const validated = getContactSchema.parse(input);
    const response = await client.get<{ contact: FreeAgentContact }>(`/contacts/${validated.contact_id}`);
    return transformContact(response.contact);
  } catch (error) {
    handleToolError(error, 'get_contact');
  }
}
