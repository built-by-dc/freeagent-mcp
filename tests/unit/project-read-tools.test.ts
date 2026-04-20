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

import {
  listProjects, listProjectsSchema,
  getProject, getProjectSchema,
  deleteProject, deleteProjectSchema,
  listTasks, listTasksSchema,
  getTask, getTaskSchema,
  updateTask, updateTaskSchema,
  deleteTask, deleteTaskSchema,
  listTimeslips, listTimeslipsSchema,
  getTimeslip, getTimeslipSchema,
  updateTimeslip, updateTimeslipSchema,
  deleteTimeslip, deleteTimeslipSchema,
} from '../../src/tools/project-tools.js';

const mockProject = {
  url: 'https://api.freeagent.com/v2/projects/1',
  name: 'Test Project',
  contact: 'https://api.freeagent.com/v2/contacts/1',
  status: 'Active' as const,
  budget_units: 'Hours' as const,
  currency: 'GBP',
  budget: '0',
  is_ir35: false,
  uses_project_invoice_sequence: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockTask = {
  url: 'https://api.freeagent.com/v2/tasks/1',
  name: 'Dev Work',
  project: 'https://api.freeagent.com/v2/projects/1',
  is_billable: true,
  billing_rate: '100.00',
  billing_period: 'hour',
  status: 'Active' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockTimeslip = {
  url: 'https://api.freeagent.com/v2/timeslips/1',
  project: 'https://api.freeagent.com/v2/projects/1',
  task: 'https://api.freeagent.com/v2/tasks/1',
  user: 'https://api.freeagent.com/v2/users/1',
  hours: '8.0',
  dated_on: '2026-04-20',
  comment: 'Work done',
  status: 'Unbilled' as const,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('listProjects', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { fetchAllPages: vi.fn() }; });

  it('fetches projects with no filters', async () => {
    mockClient.fetchAllPages.mockResolvedValue([mockProject]);
    const result = await listProjects(mockClient, {});
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/projects', 'projects', {});
    expect(result[0].id).toBe('1');
  });

  it('passes view and contact_id filters', async () => {
    mockClient.fetchAllPages.mockResolvedValue([]);
    await listProjects(mockClient, { view: 'active', contact_id: '5' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/projects', 'projects', expect.objectContaining({ view: 'active', contact: expect.stringContaining('5') }));
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listProjects(mockClient, {})).rejects.toThrow();
  });
});

describe('getProject', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { get: vi.fn() }; });

  it('fetches single project', async () => {
    mockClient.get.mockResolvedValue({ project: mockProject });
    const result = await getProject(mockClient, { project_id: '1' });
    expect(mockClient.get).toHaveBeenCalledWith('/projects/1');
    expect(result.id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.get.mockRejectedValue(new Error('API error'));
    await expect(getProject(mockClient, { project_id: '1' })).rejects.toThrow();
  });
});

describe('deleteProject', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { delete: vi.fn() }; });

  it('deletes a project', async () => {
    mockClient.delete.mockResolvedValue(undefined);
    const result = await deleteProject(mockClient, { project_id: '1' });
    expect(mockClient.delete).toHaveBeenCalledWith('/projects/1');
    expect(result.success).toBe(true);
  });

  it('propagates errors', async () => {
    mockClient.delete.mockRejectedValue(new Error('API error'));
    await expect(deleteProject(mockClient, { project_id: '1' })).rejects.toThrow();
  });
});

describe('listTasks', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { fetchAllPages: vi.fn() }; });

  it('fetches tasks for a project', async () => {
    mockClient.fetchAllPages.mockResolvedValue([mockTask]);
    const result = await listTasks(mockClient, { project_id: '1' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/tasks', 'tasks', expect.objectContaining({ project: expect.stringContaining('1') }));
    expect(result[0].id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listTasks(mockClient, {})).rejects.toThrow();
  });
});

describe('getTask', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { get: vi.fn() }; });

  it('fetches single task', async () => {
    mockClient.get.mockResolvedValue({ task: mockTask });
    const result = await getTask(mockClient, { task_id: '1' });
    expect(mockClient.get).toHaveBeenCalledWith('/tasks/1');
    expect(result.id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.get.mockRejectedValue(new Error('API error'));
    await expect(getTask(mockClient, { task_id: '1' })).rejects.toThrow();
  });
});

describe('updateTask', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { put: vi.fn() }; });

  it('updates task name', async () => {
    mockClient.put.mockResolvedValue({ task: mockTask });
    const result = await updateTask(mockClient, { task_id: '1', name: 'New Name' });
    expect(mockClient.put).toHaveBeenCalledWith('/tasks/1', expect.objectContaining({ task: expect.objectContaining({ name: 'New Name' }) }));
    expect(result.id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.put.mockRejectedValue(new Error('API error'));
    await expect(updateTask(mockClient, { task_id: '1' })).rejects.toThrow();
  });
});

describe('deleteTask', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { delete: vi.fn() }; });

  it('deletes a task', async () => {
    mockClient.delete.mockResolvedValue(undefined);
    const result = await deleteTask(mockClient, { task_id: '1' });
    expect(mockClient.delete).toHaveBeenCalledWith('/tasks/1');
    expect(result.success).toBe(true);
  });

  it('propagates errors', async () => {
    mockClient.delete.mockRejectedValue(new Error('API error'));
    await expect(deleteTask(mockClient, { task_id: '1' })).rejects.toThrow();
  });
});

describe('listTimeslips', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { fetchAllPages: vi.fn() }; });

  it('fetches timeslips with date range', async () => {
    mockClient.fetchAllPages.mockResolvedValue([mockTimeslip]);
    const result = await listTimeslips(mockClient, { from_date: '2026-04-01', to_date: '2026-04-30' });
    expect(mockClient.fetchAllPages).toHaveBeenCalledWith('/timeslips', 'timeslips', expect.objectContaining({ from_date: '2026-04-01', to_date: '2026-04-30' }));
    expect(result[0].id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.fetchAllPages.mockRejectedValue(new Error('API error'));
    await expect(listTimeslips(mockClient, {})).rejects.toThrow();
  });
});

describe('getTimeslip', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { get: vi.fn() }; });

  it('fetches single timeslip', async () => {
    mockClient.get.mockResolvedValue({ timeslip: mockTimeslip });
    const result = await getTimeslip(mockClient, { timeslip_id: '1' });
    expect(mockClient.get).toHaveBeenCalledWith('/timeslips/1');
    expect(result.id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.get.mockRejectedValue(new Error('API error'));
    await expect(getTimeslip(mockClient, { timeslip_id: '1' })).rejects.toThrow();
  });
});

describe('updateTimeslip', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { put: vi.fn() }; });

  it('updates timeslip hours', async () => {
    mockClient.put.mockResolvedValue({ timeslip: mockTimeslip });
    const result = await updateTimeslip(mockClient, { timeslip_id: '1', hours: 4.5 });
    expect(mockClient.put).toHaveBeenCalledWith('/timeslips/1', expect.objectContaining({ timeslip: expect.objectContaining({ hours: '4.5' }) }));
    expect(result.id).toBe('1');
  });

  it('propagates errors', async () => {
    mockClient.put.mockRejectedValue(new Error('API error'));
    await expect(updateTimeslip(mockClient, { timeslip_id: '1' })).rejects.toThrow();
  });
});

describe('deleteTimeslip', () => {
  let mockClient: any;
  beforeEach(() => { mockClient = { delete: vi.fn() }; });

  it('deletes a timeslip', async () => {
    mockClient.delete.mockResolvedValue(undefined);
    const result = await deleteTimeslip(mockClient, { timeslip_id: '1' });
    expect(mockClient.delete).toHaveBeenCalledWith('/timeslips/1');
    expect(result.success).toBe(true);
  });

  it('propagates errors', async () => {
    mockClient.delete.mockRejectedValue(new Error('API error'));
    await expect(deleteTimeslip(mockClient, { timeslip_id: '1' })).rejects.toThrow();
  });
});
