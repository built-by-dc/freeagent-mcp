import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from './utils/zod-to-json-schema.js';

import { config } from './config.js';
import {
  createTokenStore,
  createTokenManager,
  generateAuthorizationUrl,
  exchangeCodeForTokens,
  type TokenManager,
  type TokenStore,
} from './auth/index.js';
import { createFreeAgentClient, type FreeAgentClient } from './api/index.js';
import { toMcpError } from './utils/error-handler.js';

// Resources
import * as resources from './resources/index.js';

// Tools
import * as tools from './tools/index.js';

// Prompts
import * as prompts from './prompts/index.js';

export interface FreeAgentMcpServer {
  server: Server;
  tokenStore: TokenStore;
  getAuthorizationUrl: (state?: string) => string;
  handleAuthorizationCode: (code: string) => Promise<void>;
  isAuthenticated: () => boolean;
}

export function createFreeAgentMcpServer(): FreeAgentMcpServer {
  const server = new Server(
    {
      name: 'freeagent-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    }
  );

  // Initialize auth
  const tokenStore = createTokenStore(config.tokenEncryptionKey);
  const tokenManager = createTokenManager(tokenStore);
  let freeAgentClient: FreeAgentClient | null = null;

  // Helper to get authenticated client
  function getClient(): FreeAgentClient {
    if (!freeAgentClient) {
      freeAgentClient = createFreeAgentClient(tokenManager);
    }
    return freeAgentClient;
  }

  // Contact name lookup cache
  let contactNameLookup: Map<string, string> | null = null;
  let bankAccountNameLookup: Map<string, string> | null = null;

  async function getContactNameLookup(): Promise<Map<string, string>> {
    if (!contactNameLookup) {
      contactNameLookup = await resources.buildContactNameLookup(getClient());
    }
    return contactNameLookup;
  }

  async function getBankAccountNameLookup(): Promise<Map<string, string>> {
    if (!bankAccountNameLookup) {
      bankAccountNameLookup = await resources.buildBankAccountNameLookup(getClient());
    }
    return bankAccountNameLookup;
  }

  // ========== RESOURCES ==========
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'freeagent://company',
        name: 'Company',
        description: 'Company profile and settings',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://contacts',
        name: 'Contacts',
        description: 'List all contacts (clients/suppliers)',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://invoices',
        name: 'Invoices',
        description: 'List invoices with optional filters',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://bills',
        name: 'Bills',
        description: 'Outstanding bills and expenses',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://bank_accounts',
        name: 'Bank Accounts',
        description: 'Bank account list',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://bank_transactions',
        name: 'Bank Transactions',
        description: 'Bank transaction feed (requires bank_account parameter)',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://projects',
        name: 'Projects',
        description: 'Active projects list',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://timeslips',
        name: 'Timeslips',
        description: 'Time tracking entries',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://expenses',
        name: 'Expenses',
        description: 'Expense claims',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://categories',
        name: 'Categories',
        description: 'Account categories',
        mimeType: 'application/json',
      },
      {
        uri: 'freeagent://users',
        name: 'Users',
        description: 'Team members',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const url = new URL(uri);
    const path = url.pathname.replace('//', '');
    const params = Object.fromEntries(url.searchParams);

    try {
      const client = getClient();
      let content: unknown;

      // Parse resource path
      const segments = path.split('/').filter(Boolean);
      const resourceType = segments[0];
      const resourceId = segments[1];

      switch (resourceType) {
        case 'company':
          content = await resources.getCompany(client);
          break;

        case 'contacts':
          if (resourceId) {
            content = await resources.getContact(client, resourceId);
          } else {
            content = await resources.getContacts(client, {
              view: params['view'] as 'active' | 'all' | undefined,
              sort: params['sort'],
            });
          }
          break;

        case 'invoices':
          if (resourceId) {
            content = await resources.getInvoice(
              client,
              resourceId,
              await getContactNameLookup()
            );
          } else {
            content = await resources.getInvoices(
              client,
              {
                contact: params['contact'],
                project: params['project'],
                status: params['status'] as resources.InvoiceFilters['status'],
                fromDate: params['from_date'],
                toDate: params['to_date'],
                view: params['view'] as resources.InvoiceFilters['view'],
              },
              await getContactNameLookup()
            );
          }
          break;

        case 'bills':
          if (resourceId) {
            content = await resources.getBill(
              client,
              resourceId,
              await getContactNameLookup()
            );
          } else {
            content = await resources.getBills(
              client,
              {
                contact: params['contact'],
                project: params['project'],
                fromDate: params['from_date'],
                toDate: params['to_date'],
                view: params['view'] as resources.BillFilters['view'],
              },
              await getContactNameLookup()
            );
          }
          break;

        case 'bank_accounts':
          if (resourceId) {
            content = await resources.getBankAccount(client, resourceId);
          } else {
            content = await resources.getBankAccounts(client, {
              view: params['view'] as resources.BankAccountFilters['view'],
            });
          }
          break;

        case 'bank_transactions':
          if (!params['bank_account'] && !resourceId) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'bank_account parameter is required for bank_transactions'
            );
          }
          if (resourceId) {
            content = await resources.getBankTransaction(
              client,
              resourceId,
              await getBankAccountNameLookup()
            );
          } else {
            content = await resources.getBankTransactions(
              client,
              {
                bankAccount: params['bank_account']!,
                fromDate: params['from_date'],
                toDate: params['to_date'],
                view: params['view'] as resources.BankTransactionFilters['view'],
              },
              await getBankAccountNameLookup()
            );
          }
          break;

        case 'projects':
          if (resourceId) {
            content = await resources.getProject(
              client,
              resourceId,
              await getContactNameLookup()
            );
          } else {
            content = await resources.getProjects(
              client,
              {
                contact: params['contact'],
                view: params['view'] as resources.ProjectFilters['view'],
              },
              await getContactNameLookup()
            );
          }
          break;

        case 'timeslips':
          if (resourceId) {
            content = await resources.getTimeslip(client, resourceId);
          } else {
            content = await resources.getTimeslips(client, {
              project: params['project'],
              user: params['user'],
              task: params['task'],
              fromDate: params['from_date'],
              toDate: params['to_date'],
            });
          }
          break;

        case 'expenses':
          if (resourceId) {
            content = await resources.getExpense(client, resourceId);
          } else {
            content = await resources.getExpenses(client, {
              user: params['user'],
              project: params['project'],
              fromDate: params['from_date'],
              toDate: params['to_date'],
              view: params['view'] as resources.ExpenseFilters['view'],
            });
          }
          break;

        case 'categories':
          if (resourceId) {
            content = await resources.getCategory(client, resourceId);
          } else {
            content = await resources.getCategories(client);
          }
          break;

        case 'users':
          if (resourceId === 'me') {
            content = await resources.getCurrentUser(client);
          } else if (resourceId) {
            content = await resources.getUser(client, resourceId);
          } else {
            content = await resources.getUsers(client);
          }
          break;

        default:
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource type: ${resourceType}`
          );
      }

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(content, null, 2),
          },
        ],
      };
    } catch (error) {
      throw toMcpError(error);
    }
  });

  // ========== TOOLS ==========
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // Invoice tools
      {
        name: 'create_invoice',
        description: 'Create a new invoice with line items',
        inputSchema: zodToJsonSchema(tools.createInvoiceSchema),
      },
      {
        name: 'update_invoice',
        description: 'Update an existing draft invoice',
        inputSchema: zodToJsonSchema(tools.updateInvoiceSchema),
      },
      {
        name: 'send_invoice',
        description: 'Send invoice via email',
        inputSchema: zodToJsonSchema(tools.sendInvoiceSchema),
      },
      {
        name: 'mark_invoice_sent',
        description: 'Mark invoice as sent without emailing',
        inputSchema: zodToJsonSchema(tools.markInvoiceSentSchema),
      },
      {
        name: 'mark_invoice_paid',
        description: 'Record a payment on an invoice',
        inputSchema: zodToJsonSchema(tools.markInvoicePaidSchema),
      },
      {
        name: 'delete_invoice',
        description: 'Delete a draft invoice',
        inputSchema: zodToJsonSchema(tools.deleteInvoiceSchema),
      },
      // Contact tools
      {
        name: 'create_contact',
        description: 'Create a new contact (client/supplier)',
        inputSchema: zodToJsonSchema(tools.createContactSchema),
      },
      {
        name: 'update_contact',
        description: 'Update contact details',
        inputSchema: zodToJsonSchema(tools.updateContactSchema),
      },
      {
        name: 'delete_contact',
        description: 'Delete a contact',
        inputSchema: zodToJsonSchema(tools.deleteContactSchema),
      },
      {
        name: 'list_contacts',
        description: 'List contacts with optional filters',
        inputSchema: zodToJsonSchema(tools.listContactsSchema),
      },
      {
        name: 'get_contact',
        description: 'Get a single contact by ID',
        inputSchema: zodToJsonSchema(tools.getContactSchema),
      },
      // Bank tools
      {
        name: 'explain_transaction',
        description: 'Categorize a bank transaction',
        inputSchema: zodToJsonSchema(tools.explainTransactionSchema),
      },
      {
        name: 'match_transaction_to_invoice',
        description: 'Match a bank transaction to an invoice payment',
        inputSchema: zodToJsonSchema(tools.matchTransactionToInvoiceSchema),
      },
      {
        name: 'match_transaction_to_bill',
        description: 'Match a bank transaction to a bill payment',
        inputSchema: zodToJsonSchema(tools.matchTransactionToBillSchema),
      },
      {
        name: 'split_transaction',
        description: 'Split a transaction across multiple categories',
        inputSchema: zodToJsonSchema(tools.splitTransactionSchema),
      },
      {
        name: 'unexplain_transaction',
        description: 'Remove an explanation from a transaction',
        inputSchema: zodToJsonSchema(tools.unexplainTransactionSchema),
      },
      // Bill tools
      {
        name: 'create_bill',
        description: 'Create a new bill from a supplier',
        inputSchema: zodToJsonSchema(tools.createBillSchema),
      },
      {
        name: 'update_bill',
        description: 'Update an existing bill',
        inputSchema: zodToJsonSchema(tools.updateBillSchema),
      },
      {
        name: 'delete_bill',
        description: 'Delete a bill',
        inputSchema: zodToJsonSchema(tools.deleteBillSchema),
      },
      // Project tools
      {
        name: 'create_project',
        description: 'Create a new project',
        inputSchema: zodToJsonSchema(tools.createProjectSchema),
      },
      {
        name: 'update_project',
        description: 'Update project details',
        inputSchema: zodToJsonSchema(tools.updateProjectSchema),
      },
      {
        name: 'create_task',
        description: 'Create a task within a project',
        inputSchema: zodToJsonSchema(tools.createTaskSchema),
      },
      {
        name: 'create_timeslip',
        description: 'Log time against a project task',
        inputSchema: zodToJsonSchema(tools.createTimeslipSchema),
      },
      // Query tools
      {
        name: 'list_unpaid_invoices',
        description: 'Get summary of unpaid/overdue invoices',
        inputSchema: zodToJsonSchema(tools.listUnpaidInvoicesSchema),
      },
      {
        name: 'get_bank_summary',
        description: 'Get aggregate bank account balances',
        inputSchema: zodToJsonSchema(tools.getBankSummarySchema),
      },
      {
        name: 'search_transactions',
        description: 'Search bank transactions by description',
        inputSchema: zodToJsonSchema(tools.searchTransactionsSchema),
      },
      {
        name: 'get_unexplained_transactions',
        description: 'List unexplained bank transactions',
        inputSchema: zodToJsonSchema(tools.getUnexplainedTransactionsSchema),
      },
      // Bank transaction explanation tools
      {
        name: 'list_bank_transaction_explanations',
        description: 'List all explanations for a bank account',
        inputSchema: zodToJsonSchema(tools.listBankTransactionExplanationsSchema),
      },
      {
        name: 'get_bank_transaction_explanation',
        description: 'Get details of a specific bank transaction explanation including attachment info',
        inputSchema: zodToJsonSchema(tools.getBankTransactionExplanationSchema),
      },
      {
        name: 'create_bank_transaction_explanation',
        description: 'Create a new bank transaction explanation with full type support (payment, invoice receipt, bill payment, transfer, etc.)',
        inputSchema: zodToJsonSchema(tools.createBankTransactionExplanationSchema),
      },
      {
        name: 'update_bank_transaction_explanation',
        description: 'Update an existing bank transaction explanation',
        inputSchema: zodToJsonSchema(tools.updateBankTransactionExplanationSchema),
      },
      {
        name: 'delete_bank_transaction_explanation',
        description: 'Delete a bank transaction explanation',
        inputSchema: zodToJsonSchema(tools.deleteBankTransactionExplanationSchema),
      },
      {
        name: 'upload_receipt',
        description: 'Upload a receipt/attachment to a bank transaction explanation (PNG, JPEG, GIF, PDF, max 5MB)',
        inputSchema: zodToJsonSchema(tools.uploadReceiptSchema),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const client = getClient();
      let result: unknown;

      switch (name) {
        // Invoice tools
        case 'create_invoice':
          result = await tools.createInvoice(
            client,
            args as tools.CreateInvoiceInput,
            await getContactNameLookup()
          );
          break;
        case 'update_invoice':
          result = await tools.updateInvoice(
            client,
            args as tools.UpdateInvoiceInput,
            await getContactNameLookup()
          );
          break;
        case 'send_invoice':
          result = await tools.sendInvoice(client, args as tools.SendInvoiceInput);
          break;
        case 'mark_invoice_sent':
          result = await tools.markInvoiceSent(client, args as tools.MarkInvoiceSentInput);
          break;
        case 'mark_invoice_paid':
          result = await tools.markInvoicePaid(client, args as tools.MarkInvoicePaidInput);
          break;
        case 'delete_invoice':
          result = await tools.deleteInvoice(client, args as tools.DeleteInvoiceInput);
          break;

        // Contact tools
        case 'create_contact':
          result = await tools.createContact(client, args as tools.CreateContactInput);
          break;
        case 'update_contact':
          result = await tools.updateContact(client, args as tools.UpdateContactInput);
          break;
        case 'delete_contact':
          result = await tools.deleteContact(client, args as tools.DeleteContactInput);
          break;
        case 'list_contacts':
          result = await tools.listContacts(getClient(), args as tools.ListContactsInput);
          break;
        case 'get_contact':
          result = await tools.getContact(getClient(), args as tools.GetContactInput);
          break;

        // Bank tools
        case 'explain_transaction':
          result = await tools.explainTransaction(
            client,
            args as tools.ExplainTransactionInput,
            await getBankAccountNameLookup()
          );
          break;
        case 'match_transaction_to_invoice':
          result = await tools.matchTransactionToInvoice(
            client,
            args as tools.MatchTransactionToInvoiceInput,
            await getBankAccountNameLookup()
          );
          break;
        case 'match_transaction_to_bill':
          result = await tools.matchTransactionToBill(
            client,
            args as tools.MatchTransactionToBillInput,
            await getBankAccountNameLookup()
          );
          break;
        case 'split_transaction':
          result = await tools.splitTransaction(
            client,
            args as tools.SplitTransactionInput,
            await getBankAccountNameLookup()
          );
          break;
        case 'unexplain_transaction':
          result = await tools.unexplainTransaction(
            client,
            args as tools.UnexplainTransactionInput
          );
          break;

        // Bill tools
        case 'create_bill':
          result = await tools.createBill(
            client,
            args as tools.CreateBillInput,
            await getContactNameLookup()
          );
          break;
        case 'update_bill':
          result = await tools.updateBill(
            client,
            args as tools.UpdateBillInput,
            await getContactNameLookup()
          );
          break;
        case 'delete_bill':
          result = await tools.deleteBill(client, args as tools.DeleteBillInput);
          break;

        // Project tools
        case 'create_project':
          result = await tools.createProject(
            client,
            args as tools.CreateProjectInput,
            await getContactNameLookup()
          );
          break;
        case 'update_project':
          result = await tools.updateProject(
            client,
            args as tools.UpdateProjectInput,
            await getContactNameLookup()
          );
          break;
        case 'create_task':
          result = await tools.createTask(client, args as tools.CreateTaskInput);
          break;
        case 'create_timeslip':
          result = await tools.createTimeslip(client, args as tools.CreateTimeslipInput);
          break;

        // Query tools
        case 'list_unpaid_invoices':
          result = await tools.listUnpaidInvoices(
            client,
            args as tools.ListUnpaidInvoicesInput,
            await getContactNameLookup()
          );
          break;
        case 'get_bank_summary':
          result = await tools.getBankSummary(client, args as tools.GetBankSummaryInput);
          break;
        case 'search_transactions':
          result = await tools.searchTransactions(
            client,
            args as tools.SearchTransactionsInput
          );
          break;
        case 'get_unexplained_transactions':
          result = await tools.getUnexplainedTransactions(
            client,
            args as tools.GetUnexplainedTransactionsInput
          );
          break;

        // Bank transaction explanation tools
        case 'list_bank_transaction_explanations':
          result = await tools.listBankTransactionExplanations(
            client,
            args as tools.ListBankTransactionExplanationsInput
          );
          break;
        case 'get_bank_transaction_explanation':
          result = await tools.getBankTransactionExplanation(
            client,
            args as tools.GetBankTransactionExplanationInput
          );
          break;
        case 'create_bank_transaction_explanation':
          result = await tools.createBankTransactionExplanation(
            client,
            args as tools.CreateBankTransactionExplanationInput
          );
          break;
        case 'update_bank_transaction_explanation':
          result = await tools.updateBankTransactionExplanation(
            client,
            args as tools.UpdateBankTransactionExplanationInput
          );
          break;
        case 'delete_bank_transaction_explanation':
          result = await tools.deleteBankTransactionExplanation(
            client,
            args as tools.DeleteBankTransactionExplanationInput
          );
          break;
        case 'upload_receipt':
          result = await tools.uploadReceipt(
            client,
            args as tools.UploadReceiptInput
          );
          break;

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      // Invalidate lookup caches after write operations
      if (name.startsWith('create_contact') || name.startsWith('update_contact') || name.startsWith('delete_contact')) {
        contactNameLookup = null;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw toMcpError(error);
    }
  });

  // ========== PROMPTS ==========
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      prompts.monthlyExpenseSummaryPrompt,
      prompts.invoiceFromDescriptionPrompt,
      prompts.cashFlowForecastPrompt,
      prompts.overdueInvoiceFollowupPrompt,
      prompts.transactionCategorizationPrompt,
      prompts.projectProfitabilityPrompt,
      prompts.quarterlyTaxEstimatePrompt,
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'monthly_expense_summary':
        return prompts.getMonthlyExpenseSummaryMessages(
          args?.['month'] ?? '',
          args?.['year'] ?? ''
        );

      case 'invoice_from_description':
        return prompts.getInvoiceFromDescriptionMessages(
          args?.['description'] ?? ''
        );

      case 'cash_flow_forecast':
        return prompts.getCashFlowForecastMessages(args?.['days'] ?? '30');

      case 'overdue_invoice_followup':
        return prompts.getOverdueInvoiceFollowupMessages(args?.['contact_id']);

      case 'transaction_categorization':
        return prompts.getTransactionCategorizationMessages(
          args?.['bank_account_id'] ?? '',
          args?.['from_date']
        );

      case 'project_profitability':
        return prompts.getProjectProfitabilityMessages(
          args?.['project_id'] ?? ''
        );

      case 'quarterly_tax_estimate':
        return prompts.getQuarterlyTaxEstimateMessages(
          args?.['quarter'] ?? '',
          args?.['year'] ?? ''
        );

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
    }
  });

  return {
    server,
    tokenStore,
    getAuthorizationUrl: (state?: string) => generateAuthorizationUrl(state),
    handleAuthorizationCode: async (code: string) => {
      const tokens = await exchangeCodeForTokens(code);
      await tokenManager.setTokens(tokens);
      // Clear lookup caches on new auth
      contactNameLookup = null;
      bankAccountNameLookup = null;
    },
    isAuthenticated: () => tokenManager.isAuthenticated(),
  };
}
