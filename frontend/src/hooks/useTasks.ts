import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Task, Project, Person, TaskDependency } from '../lib/api';
import { useUndoStore } from '../store/undoStore';

// Helper: collect all tasks from any cached variant of the ['tasks'] query
function getCachedTasks(qc: ReturnType<typeof useQueryClient>): Task[] {
  return qc
    .getQueriesData<Task[]>({ queryKey: ['tasks'] })
    .flatMap(([, data]) => data ?? []);
}

export function useTasks(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.getTasks(params),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });
}

export function usePeople() {
  return useQuery({
    queryKey: ['people'],
    queryFn: api.getPeople,
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Task> }) =>
      api.updateTask(id, data),
    onMutate: ({ id, data }) => {
      const prev = getCachedTasks(qc).find((t) => t.id === id);
      if (!prev) return;
      const prevData = Object.fromEntries(
        Object.keys(data).map((k) => [k, prev[k as keyof Task]])
      ) as Partial<Task>;
      const dataSnap = { ...data } as Partial<Task>;
      const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
      useUndoStore.getState().push({
        label: `Edit "${prev.title}"`,
        undo: () => api.updateTask(id, prevData).then(invalidate),
        redo: () => api.updateTask(id, dataSnap).then(invalidate),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, start_date, end_date }: { id: number; start_date: string; end_date: string }) =>
      api.moveTask(id, start_date, end_date),
    onMutate: ({ id, start_date, end_date }) => {
      const prev = getCachedTasks(qc).find((t) => t.id === id);
      if (!prev) return;
      const origStart = prev.start_date ?? '';
      const origEnd = prev.end_date ?? '';
      const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
      useUndoStore.getState().push({
        label: `Move "${prev.title}"`,
        undo: () => api.moveTask(id, origStart, origEnd).then(invalidate),
        redo: () => api.moveTask(id, start_date, end_date).then(invalidate),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Task>) => api.createTask(data),
    onSuccess: (newTask, data) => {
      const dataSnap = { ...data } as Partial<Task>;
      const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
      let liveId = newTask.id;
      useUndoStore.getState().push({
        label: `Create "${newTask.title}"`,
        undo: () => api.deleteTask(liveId).then(invalidate),
        redo: async () => {
          const t = await api.createTask(dataSnap);
          liveId = t.id;
          invalidate();
        },
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTask(id),
    onMutate: (id) => {
      const prev = getCachedTasks(qc).find((t) => t.id === id);
      if (!prev) return;
      // Snapshot only the fields that createTask accepts (exclude server-generated ones)
      const { id: _id, created_at: _ca, updated_at: _ua, dependencies: _deps, ...createSnap } = prev;
      const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
      let liveId = id;
      useUndoStore.getState().push({
        label: `Delete "${prev.title}"`,
        undo: async () => {
          const t = await api.createTask(createSnap as Partial<Task>);
          liveId = t.id;
          invalidate();
        },
        redo: () => api.deleteTask(liveId).then(invalidate),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Project> }) =>
      api.updateProject(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Project>) => api.createProject(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Person>) => api.createPerson(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Person> }) =>
      api.updatePerson(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deletePerson(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  });
}

export function useAddDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, dependsOnId }: { taskId: number; dependsOnId: number }) =>
      api.addDependency(taskId, dependsOnId),
    onSuccess: (dep, { taskId, dependsOnId }) => {
      const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
      let liveDepId = dep.id;
      useUndoStore.getState().push({
        label: 'Add dependency',
        undo: () => api.deleteDependency(liveDepId).then(invalidate),
        redo: async () => {
          const d = await api.addDependency(taskId, dependsOnId);
          liveDepId = d.id;
          invalidate();
        },
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (depId: number) => api.deleteDependency(depId),
    onMutate: (depId) => {
      const tasks = getCachedTasks(qc);
      let foundDep: TaskDependency | undefined;
      for (const t of tasks) {
        foundDep = t.dependencies?.find((d) => d.id === depId);
        if (foundDep) break;
      }
      if (!foundDep) return;
      const { task_id, depends_on_id } = foundDep;
      const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
      let liveDepId = depId;
      useUndoStore.getState().push({
        label: 'Remove dependency',
        undo: async () => {
          const d = await api.addDependency(task_id, depends_on_id);
          liveDepId = d.id;
          invalidate();
        },
        redo: () => api.deleteDependency(liveDepId).then(invalidate),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
