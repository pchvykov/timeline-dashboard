import { useMemo, useCallback } from 'react';
import { Gantt, Willow, WillowDark } from 'wx-react-gantt';
import 'wx-react-gantt/dist/gantt.css';
import type { Task, Project, Person } from '../../lib/api';
import { useMoveTask, useUpdateTask } from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';
import { format, addDays, subDays } from 'date-fns';

interface Props {
  tasks: Task[];
  projects: Project[];
  people: Person[];
}

// Synthetic swim-lane header IDs (high numbers, well above any DB task ID)
const LANE_MILESTONE = 999901;
const LANE_UNASSIGNED = 999900;
const personLaneId = (personId: number) => 999910 + personId;

function projectColor(projectId: number | null, projects: Project[]): string {
  if (!projectId) return '#6b7280';
  return projects.find((pr) => pr.id === projectId)?.color ?? '#6b7280';
}

interface DateRange { start: Date; end: Date }

// Derive display start/end from task data. Returns null if task has no usable dates.
function getDisplayDates(task: Task): DateRange | null {
  if (task.start_date && task.end_date) {
    const s = new Date(task.start_date);
    const e = new Date(task.end_date);
    return { start: s, end: e <= s ? addDays(s, 1) : e };
  }
  const fallback = task.deadline ?? task.end_date;
  if (fallback) {
    const e = new Date(fallback);
    return { start: subDays(e, 7), end: e };
  }
  return null;
}

function spanRange(items: DateRange[]): DateRange {
  return {
    start: new Date(Math.min(...items.map(d => d.start.getTime()))),
    end: new Date(Math.max(...items.map(d => d.end.getTime()))),
  };
}

type ZoomLevel = 'week' | 'month' | 'quarter' | 'year';

const ZOOM_SCALES: Record<ZoomLevel, any[]> = {
  week:    [{ unit: 'month', step: 1, format: 'MMM yyyy' }, { unit: 'day', step: 1, format: 'd' }],
  month:   [{ unit: 'month', step: 1, format: 'MMMM yyyy' }, { unit: 'week', step: 1, format: 'wo' }],
  quarter: [{ unit: 'month', step: 3, format: 'MMM yyyy' }, { unit: 'month', step: 1, format: 'MMM' }],
  year:    [{ unit: 'year', step: 1, format: 'yyyy' }, { unit: 'month', step: 1, format: 'MMM' }],
};
const ZOOM_CELL_WIDTH: Record<ZoomLevel, number> = { week: 30, month: 40, quarter: 60, year: 40 };
const ZOOM_LABELS: Record<ZoomLevel, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

export function GanttWrapper({ tasks, projects, people }: Props) {
  const moveTask = useMoveTask();
  const updateTask = useUpdateTask();
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);
  const darkMode = useUIStore((s) => s.darkMode);
  const zoomLevel = useUIStore((s) => s.zoomLevel) as ZoomLevel;
  const zoomIn = useUIStore((s) => s.zoomIn);
  const zoomOut = useUIStore((s) => s.zoomOut);

  const scales = useMemo(() => ZOOM_SCALES[zoomLevel] ?? ZOOM_SCALES.month, [zoomLevel]);
  const cellWidth = ZOOM_CELL_WIDTH[zoomLevel] ?? 40;

  const { ganttTasks, ganttLinks } = useMemo(() => {
    const milestones = tasks.filter(t => t.type === 'milestone');
    const regularTasks = tasks.filter(t => t.type !== 'milestone');

    const ganttTasks: any[] = [];

    // Helper: pair task with its computed dates (filter out tasks with no dates)
    function withDates<T extends Task>(items: T[]) {
      return items.map(t => ({ task: t, dates: getDisplayDates(t) }))
                  .filter((x): x is { task: T; dates: DateRange } => x.dates !== null);
    }

    // ── Milestones swim lane ──────────────────────────────────────────────────
    const milestonesWD = withDates(milestones);
    if (milestonesWD.length > 0) {
      const { start, end } = spanRange(milestonesWD.map(x => x.dates));
      ganttTasks.push({ id: LANE_MILESTONE, text: '📍 Milestones', parent: 0, type: 'summary', open: true, start, end });
      milestonesWD.forEach(({ task: t, dates: d }) => {
        // type:"milestone" does not render bars in wx-react-gantt v1.3.1 — use narrow task bar instead
        ganttTasks.push({
          id: t.id, text: t.title, parent: LANE_MILESTONE,
          start: d.start, end: addDays(d.start, 1),
          progress: t.progress, type: 'task',
          projectColor: projectColor(t.project_id, projects),
        });
      });
    }

    // ── Person swim lanes ─────────────────────────────────────────────────────
    people.forEach(person => {
      const personWD = withDates(regularTasks.filter(t => t.assignee_id === person.id));
      if (personWD.length === 0) return;
      const { start, end } = spanRange(personWD.map(x => x.dates));
      ganttTasks.push({ id: personLaneId(person.id), text: person.name, parent: 0, type: 'summary', open: true, start, end });
      personWD.forEach(({ task: t, dates: d }) => {
        ganttTasks.push({
          id: t.id, text: t.title, parent: personLaneId(person.id),
          start: d.start, end: d.end, progress: t.progress, type: 'task',
          projectColor: projectColor(t.project_id, projects),
        });
      });
    });

    // ── Unassigned swim lane ──────────────────────────────────────────────────
    const unassignedWD = withDates(regularTasks.filter(t => !t.assignee_id));
    if (unassignedWD.length > 0) {
      const { start, end } = spanRange(unassignedWD.map(x => x.dates));
      ganttTasks.push({ id: LANE_UNASSIGNED, text: 'Unassigned', parent: 0, type: 'summary', open: false, start, end });
      unassignedWD.forEach(({ task: t, dates: d }) => {
        ganttTasks.push({
          id: t.id, text: t.title, parent: LANE_UNASSIGNED,
          start: d.start, end: d.end, progress: t.progress, type: 'task',
          projectColor: projectColor(t.project_id, projects),
        });
      });
    }

    // ── Links (only between tasks that have display dates) ────────────────────
    const visibleIds = new Set(ganttTasks.filter(t => t.id < 999900).map(t => t.id as number));
    const ganttLinks = tasks.flatMap(t =>
      (t.dependencies || [])
        .filter(d => visibleIds.has(d.task_id) && visibleIds.has(d.depends_on_id))
        .map(d => ({ id: d.id, source: d.depends_on_id, target: d.task_id, type: 'e2s' as const }))
    );

    return { ganttTasks, ganttLinks };
  }, [tasks, projects, people]);

  const columns = useMemo(
    () => [{ id: 'text', header: 'Task', width: 200, flexgrow: 1 }],
    []
  );

  const handleAction = useCallback(
    (action: any) => {
      if (!action) return;
      const { type, id, obj } = action;
      if (id >= 999900) return; // ignore swim-lane headers

      if (type === 'update-task' && obj) {
        const startStr = obj.start ? format(obj.start, 'yyyy-MM-dd') : undefined;
        const endStr = obj.end ? format(obj.end, 'yyyy-MM-dd') : undefined;
        if (startStr && endStr) {
          moveTask.mutate({ id, start_date: startStr, end_date: endStr });
        } else if (obj.progress !== undefined) {
          updateTask.mutate({ id, data: { progress: obj.progress } });
        }
      }
      if (type === 'select-task') setSelectedTaskId(id);
    },
    [moveTask, updateTask, setSelectedTaskId]
  );

  const visibleTaskCount = ganttTasks.filter(t => t.id < 999900).length;
  const GanttSkin = darkMode ? WillowDark : Willow;

  // Inject per-task project colors as CSS (overrides SVAR's default blue)
  const barColorCSS = useMemo(() => {
    return ganttTasks
      .filter(t => t.id < 999900 && t.projectColor)
      .map(t => {
        const c = t.projectColor as string;
        // Use 80% opacity for regular tasks, 100% for milestones (narrower bars)
        const bg = c + 'cc'; // cc = ~80% opacity in hex
        return `.wx-bar[data-id="${t.id}"]{background-color:${bg}!important;border-left:3px solid ${c}!important;}`;
      })
      .join('');
  }, [ganttTasks]);

  return (
    <>
    <style>{barColorCSS}</style>
    <div className="flex-1 overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* Zoom toolbar */}
      <div
        className="flex items-center gap-2 px-3 border-b flex-shrink-0"
        style={{ height: 36, borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Zoom:</span>
        <button
          onClick={zoomOut}
          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Zoom out"
        >−</button>
        <span className="text-xs font-medium w-14 text-center" style={{ color: 'var(--text-primary)' }}>
          {ZOOM_LABELS[zoomLevel]}
        </span>
        <button
          onClick={zoomIn}
          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Zoom in"
        >+</button>
        <span className="text-xs ml-4" style={{ color: 'var(--text-muted)' }}>
          {visibleTaskCount} tasks with dates
        </span>
      </div>

      {/* Gantt chart */}
      <div className="flex-1 overflow-hidden">
        <GanttSkin>
          <Gantt
            tasks={ganttTasks}
            links={ganttLinks}
            scales={scales}
            columns={columns}
            cellWidth={cellWidth}
            cellHeight={38}
            onAction={handleAction}
          />
        </GanttSkin>
      </div>
    </div>
    </>
  );
}
