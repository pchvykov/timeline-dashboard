const BASE = '/api';

export interface Project {
  id: number;
  name: string;
  color: string;
  description: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: number;
  name: string;
  color: string;
  avatar_initials: string | null;
  created_at: string;
}

export interface TaskDependency {
  id: number;
  task_id: number;
  depends_on_id: number;
  type: string;
}

export interface Task {
  id: number;
  yaml_id: string | null;
  title: string;
  description: string | null;
  type: 'task' | 'milestone';
  project_id: number | null;
  assignee_id: number | null;
  start_date: string | null;
  end_date: string | null;
  density: number;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: number;
  progress: number;
  parent_task_id: number | null;
  tags: string;
  notes: string | null;
  deadline: string | null;
  hard_deadline: number;
  lane_y: number;
  created_at: string;
  updated_at: string;
  dependencies: TaskDependency[];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getTasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<Task[]>(`/tasks${qs}`);
  },
  getTask: (id: number) => request<Task>(`/tasks/${id}`),
  createTask: (data: Partial<Task>) =>
    request<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: number, data: Partial<Task>) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  moveTask: (id: number, start_date: string, end_date: string) =>
    request<Task>(`/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ start_date, end_date }),
    }),
  reassignTask: (id: number, assignee_id: number | null) =>
    request<Task>(`/tasks/${id}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ assignee_id }),
    }),
  deleteTask: (id: number) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  addDependency: (taskId: number, dependsOnId: number) =>
    request<TaskDependency>(`/tasks/${taskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ depends_on_id: dependsOnId, type: 'finish_to_start' }),
    }),
  deleteDependency: (depId: number) =>
    request<void>(`/tasks/dependencies/${depId}`, { method: 'DELETE' }),

  getProjects: () => request<Project[]>('/projects'),
  updateProject: (id: number, data: Partial<Project>) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  createProject: (data: Partial<Project>) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  getPeople: () => request<Person[]>('/people'),
  createPerson: (data: Partial<Person>) =>
    request<Person>('/people', { method: 'POST', body: JSON.stringify(data) }),
  updatePerson: (id: number, data: Partial<Person>) =>
    request<Person>(`/people/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePerson: (id: number) =>
    request<void>(`/people/${id}`, { method: 'DELETE' }),
};
