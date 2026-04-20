import { z } from 'zod';
import type { FreeAgentClient } from '../api/freeagent-client.js';
import type { FreeAgentProject, FreeAgentTask, FreeAgentTimeslip } from '../types/freeagent/index.js';
import { transformProject, transformTask, transformTimeslip } from '../transformers/project-transformer.js';
import { handleToolError } from '../utils/error-handler.js';
import { normalizeContactId, normalizeProjectId } from '../utils/validators.js';
import { FREEAGENT_API_BASE } from '../config.js';
import { sanitizeInput } from '../utils/sanitizer.js';

// Create project schema
export const createProjectSchema = z.object({
  contact_id: z.string().min(1),
  name: z.string().min(1),
  budget_units: z.enum(['Hours', 'Days', 'Monetary']),
  status: z.enum(['Active', 'Completed', 'Cancelled', 'Hidden']).default('Active'),
  budget: z.number().optional(),
  currency: z.string().length(3).default('GBP'),
  normal_billing_rate: z.number().optional(),
  hours_per_day: z.number().optional(),
  is_ir35: z.boolean().default(false),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export async function createProject(
  client: FreeAgentClient,
  input: CreateProjectInput,
  contactNameLookup?: Map<string, string>
) {
  try {
    const validated = createProjectSchema.parse(input);

    const projectData: Record<string, unknown> = {
      contact: normalizeContactId(validated.contact_id, FREEAGENT_API_BASE),
      name: sanitizeInput(validated.name),
      budget_units: validated.budget_units,
      status: validated.status,
      currency: validated.currency.toUpperCase(),
      is_ir35: validated.is_ir35,
    };

    if (validated.budget !== undefined) projectData['budget'] = validated.budget.toString();
    if (validated.normal_billing_rate !== undefined) {
      projectData['normal_billing_rate'] = validated.normal_billing_rate.toString();
    }
    if (validated.hours_per_day !== undefined) {
      projectData['hours_per_day'] = validated.hours_per_day.toString();
    }
    if (validated.starts_on) projectData['starts_on'] = validated.starts_on;
    if (validated.ends_on) projectData['ends_on'] = validated.ends_on;

    const response = await client.post<{ project: FreeAgentProject }>('/projects', {
      project: projectData,
    });

    return transformProject(response.project, contactNameLookup);
  } catch (error) {
    handleToolError(error, 'create_project');
  }
}

// Update project schema
export const updateProjectSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().optional(),
  budget: z.number().optional(),
  normal_billing_rate: z.number().optional(),
  hours_per_day: z.number().optional(),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['Active', 'Completed', 'Cancelled', 'Hidden']).optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export async function updateProject(
  client: FreeAgentClient,
  input: UpdateProjectInput,
  contactNameLookup?: Map<string, string>
) {
  try {
    const validated = updateProjectSchema.parse(input);
    const { project_id, ...fields } = validated;

    const projectData: Record<string, unknown> = {};

    if (fields.name !== undefined) projectData['name'] = sanitizeInput(fields.name);
    if (fields.budget !== undefined) projectData['budget'] = fields.budget.toString();
    if (fields.normal_billing_rate !== undefined) {
      projectData['normal_billing_rate'] = fields.normal_billing_rate.toString();
    }
    if (fields.hours_per_day !== undefined) {
      projectData['hours_per_day'] = fields.hours_per_day.toString();
    }
    if (fields.starts_on !== undefined) projectData['starts_on'] = fields.starts_on;
    if (fields.ends_on !== undefined) projectData['ends_on'] = fields.ends_on;
    if (fields.status !== undefined) projectData['status'] = fields.status;

    const response = await client.put<{ project: FreeAgentProject }>(
      `/projects/${project_id}`,
      { project: projectData }
    );

    return transformProject(response.project, contactNameLookup);
  } catch (error) {
    handleToolError(error, 'update_project');
  }
}

// Create task schema
export const createTaskSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1),
  is_billable: z.boolean().default(true),
  billing_rate: z.number().optional(),
  billing_period: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
  budget: z.number().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export async function createTask(
  client: FreeAgentClient,
  input: CreateTaskInput
) {
  try {
    const validated = createTaskSchema.parse(input);

    const taskData: Record<string, unknown> = {
      project: normalizeProjectId(validated.project_id, FREEAGENT_API_BASE),
      name: sanitizeInput(validated.name),
      is_billable: validated.is_billable,
    };

    if (validated.billing_rate !== undefined) {
      taskData['billing_rate'] = validated.billing_rate.toString();
    }
    if (validated.billing_period) taskData['billing_period'] = validated.billing_period;
    if (validated.budget !== undefined) taskData['budget'] = validated.budget.toString();

    const response = await client.post<{ task: FreeAgentTask }>('/tasks', {
      task: taskData,
    });

    return transformTask(response.task);
  } catch (error) {
    handleToolError(error, 'create_task');
  }
}

// Create timeslip schema
export const createTimeslipSchema = z.object({
  project_id: z.string().min(1),
  task_id: z.string().min(1),
  user_id: z.string().min(1),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive(),
  comment: z.string().optional(),
});

export type CreateTimeslipInput = z.infer<typeof createTimeslipSchema>;

export async function createTimeslip(
  client: FreeAgentClient,
  input: CreateTimeslipInput
) {
  try {
    const validated = createTimeslipSchema.parse(input);

    const timeslipData: Record<string, unknown> = {
      project: normalizeProjectId(validated.project_id, FREEAGENT_API_BASE),
      task: `${FREEAGENT_API_BASE}/tasks/${validated.task_id}`,
      user: `${FREEAGENT_API_BASE}/users/${validated.user_id}`,
      dated_on: validated.dated_on,
      hours: validated.hours.toString(),
    };

    if (validated.comment) timeslipData['comment'] = sanitizeInput(validated.comment);

    const response = await client.post<{ timeslip: FreeAgentTimeslip }>('/timeslips', {
      timeslip: timeslipData,
    });

    return transformTimeslip(response.timeslip);
  } catch (error) {
    handleToolError(error, 'create_timeslip');
  }
}

// ========== LIST PROJECTS ==========

export const listProjectsSchema = z.object({
  view: z.enum(['active', 'completed', 'cancelled', 'hidden']).optional(),
  contact_id: z.string().optional(),
  sort: z.string().optional(),
});

export type ListProjectsInput = z.infer<typeof listProjectsSchema>;

export async function listProjects(client: FreeAgentClient, input: ListProjectsInput) {
  try {
    const validated = listProjectsSchema.parse(input);
    const params: Record<string, string> = {};
    if (validated.view) params['view'] = validated.view;
    if (validated.contact_id) params['contact'] = normalizeContactId(validated.contact_id, FREEAGENT_API_BASE);
    if (validated.sort) params['sort'] = validated.sort;
    const projects = await client.fetchAllPages<FreeAgentProject>('/projects', 'projects', params);
    return projects.map((p) => transformProject(p));
  } catch (error) {
    handleToolError(error, 'list_projects');
  }
}

// ========== GET PROJECT ==========

export const getProjectSchema = z.object({
  project_id: z.string().min(1),
});

export type GetProjectInput = z.infer<typeof getProjectSchema>;

export async function getProject(client: FreeAgentClient, input: GetProjectInput) {
  try {
    const validated = getProjectSchema.parse(input);
    const response = await client.get<{ project: FreeAgentProject }>(`/projects/${validated.project_id}`);
    return transformProject(response.project);
  } catch (error) {
    handleToolError(error, 'get_project');
  }
}

// ========== DELETE PROJECT ==========

export const deleteProjectSchema = z.object({
  project_id: z.string().min(1),
});

export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>;

export async function deleteProject(client: FreeAgentClient, input: DeleteProjectInput) {
  try {
    const validated = deleteProjectSchema.parse(input);
    await client.delete(`/projects/${validated.project_id}`);
    return { success: true, message: 'Project deleted' };
  } catch (error) {
    handleToolError(error, 'delete_project');
  }
}

// ========== LIST TASKS ==========

export const listTasksSchema = z.object({
  project_id: z.string().optional(),
  view: z.enum(['all', 'active', 'completed', 'hidden']).optional(),
  sort: z.string().optional(),
  updated_since: z.string().optional(),
});

export type ListTasksInput = z.infer<typeof listTasksSchema>;

export async function listTasks(client: FreeAgentClient, input: ListTasksInput) {
  try {
    const validated = listTasksSchema.parse(input);
    const params: Record<string, string> = {};
    if (validated.project_id) params['project'] = normalizeProjectId(validated.project_id, FREEAGENT_API_BASE);
    if (validated.view) params['view'] = validated.view;
    if (validated.sort) params['sort'] = validated.sort;
    if (validated.updated_since) params['updated_since'] = validated.updated_since;
    const tasks = await client.fetchAllPages<FreeAgentTask>('/tasks', 'tasks', params);
    return tasks.map((t) => transformTask(t));
  } catch (error) {
    handleToolError(error, 'list_tasks');
  }
}

// ========== GET TASK ==========

export const getTaskSchema = z.object({
  task_id: z.string().min(1),
});

export type GetTaskInput = z.infer<typeof getTaskSchema>;

export async function getTask(client: FreeAgentClient, input: GetTaskInput) {
  try {
    const validated = getTaskSchema.parse(input);
    const response = await client.get<{ task: FreeAgentTask }>(`/tasks/${validated.task_id}`);
    return transformTask(response.task);
  } catch (error) {
    handleToolError(error, 'get_task');
  }
}

// ========== UPDATE TASK ==========

export const updateTaskSchema = z.object({
  task_id: z.string().min(1),
  name: z.string().optional(),
  is_billable: z.boolean().optional(),
  billing_rate: z.number().optional(),
  billing_period: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
  budget: z.number().optional(),
  status: z.enum(['Active', 'Completed', 'Hidden']).optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export async function updateTask(client: FreeAgentClient, input: UpdateTaskInput) {
  try {
    const validated = updateTaskSchema.parse(input);
    const { task_id, ...fields } = validated;

    const taskData: Record<string, unknown> = {};
    if (fields.name !== undefined) taskData['name'] = sanitizeInput(fields.name);
    if (fields.is_billable !== undefined) taskData['is_billable'] = fields.is_billable;
    if (fields.billing_rate !== undefined) taskData['billing_rate'] = fields.billing_rate.toString();
    if (fields.billing_period !== undefined) taskData['billing_period'] = fields.billing_period;
    if (fields.budget !== undefined) taskData['budget'] = fields.budget.toString();
    if (fields.status !== undefined) taskData['status'] = fields.status;

    const response = await client.put<{ task: FreeAgentTask }>(
      `/tasks/${task_id}`,
      { task: taskData }
    );

    return transformTask(response.task);
  } catch (error) {
    handleToolError(error, 'update_task');
  }
}

// ========== DELETE TASK ==========

export const deleteTaskSchema = z.object({
  task_id: z.string().min(1),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

export async function deleteTask(client: FreeAgentClient, input: DeleteTaskInput) {
  try {
    const validated = deleteTaskSchema.parse(input);
    await client.delete(`/tasks/${validated.task_id}`);
    return { success: true, message: 'Task deleted' };
  } catch (error) {
    handleToolError(error, 'delete_task');
  }
}

// ========== LIST TIMESLIPS ==========

export const listTimeslipsSchema = z.object({
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  view: z.enum(['all', 'unbilled', 'running']).optional(),
  project_id: z.string().optional(),
  task_id: z.string().optional(),
  user_id: z.string().optional(),
  updated_since: z.string().optional(),
});

export type ListTimeslipsInput = z.infer<typeof listTimeslipsSchema>;

export async function listTimeslips(client: FreeAgentClient, input: ListTimeslipsInput) {
  try {
    const validated = listTimeslipsSchema.parse(input);
    const params: Record<string, string> = {};
    if (validated.from_date) params['from_date'] = validated.from_date;
    if (validated.to_date) params['to_date'] = validated.to_date;
    if (validated.view) params['view'] = validated.view;
    if (validated.project_id) params['project'] = normalizeProjectId(validated.project_id, FREEAGENT_API_BASE);
    if (validated.task_id) params['task'] = `${FREEAGENT_API_BASE}/tasks/${validated.task_id}`;
    if (validated.user_id) params['user'] = `${FREEAGENT_API_BASE}/users/${validated.user_id}`;
    if (validated.updated_since) params['updated_since'] = validated.updated_since;
    const timeslips = await client.fetchAllPages<FreeAgentTimeslip>('/timeslips', 'timeslips', params);
    return timeslips.map((t) => transformTimeslip(t));
  } catch (error) {
    handleToolError(error, 'list_timeslips');
  }
}

// ========== GET TIMESLIP ==========

export const getTimeslipSchema = z.object({
  timeslip_id: z.string().min(1),
});

export type GetTimeslipInput = z.infer<typeof getTimeslipSchema>;

export async function getTimeslip(client: FreeAgentClient, input: GetTimeslipInput) {
  try {
    const validated = getTimeslipSchema.parse(input);
    const response = await client.get<{ timeslip: FreeAgentTimeslip }>(`/timeslips/${validated.timeslip_id}`);
    return transformTimeslip(response.timeslip);
  } catch (error) {
    handleToolError(error, 'get_timeslip');
  }
}

// ========== UPDATE TIMESLIP ==========

export const updateTimeslipSchema = z.object({
  timeslip_id: z.string().min(1),
  hours: z.number().positive().optional(),
  comment: z.string().optional(),
  dated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type UpdateTimeslipInput = z.infer<typeof updateTimeslipSchema>;

export async function updateTimeslip(client: FreeAgentClient, input: UpdateTimeslipInput) {
  try {
    const validated = updateTimeslipSchema.parse(input);
    const { timeslip_id, ...fields } = validated;

    const timeslipData: Record<string, unknown> = {};
    if (fields.hours !== undefined) timeslipData['hours'] = fields.hours.toString();
    if (fields.comment !== undefined) timeslipData['comment'] = sanitizeInput(fields.comment);
    if (fields.dated_on !== undefined) timeslipData['dated_on'] = fields.dated_on;

    const response = await client.put<{ timeslip: FreeAgentTimeslip }>(
      `/timeslips/${timeslip_id}`,
      { timeslip: timeslipData }
    );

    return transformTimeslip(response.timeslip);
  } catch (error) {
    handleToolError(error, 'update_timeslip');
  }
}

// ========== DELETE TIMESLIP ==========

export const deleteTimeslipSchema = z.object({
  timeslip_id: z.string().min(1),
});

export type DeleteTimeslipInput = z.infer<typeof deleteTimeslipSchema>;

export async function deleteTimeslip(client: FreeAgentClient, input: DeleteTimeslipInput) {
  try {
    const validated = deleteTimeslipSchema.parse(input);
    await client.delete(`/timeslips/${validated.timeslip_id}`);
    return { success: true, message: 'Timeslip deleted' };
  } catch (error) {
    handleToolError(error, 'delete_timeslip');
  }
}
