import {
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { TaskDetailModal } from './TaskDetailModal';
import { addDays, subDays, differenceInCalendarDays, format } from 'date-fns';
import type { Task, Project, Person } from '../../lib/api';
import { useMoveTask, useUpdateTask, useCreateTask, useAddDependency, useDeleteDependency } from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';

// ── Constants ────────────────────────────────────────────────────────────────
const LANE_HEADER_WIDTH = 140;
const DATE_HEADER_HEIGHT = 64;
const TASK_HEIGHT = 28;
const TASK_ROW_HEIGHT = 36;
const MIN_LANE_HEIGHT = 60;
const DEFAULT_LANE_HEIGHT = 120;

function derivedZoomLevel(pxPerDay: number): string {
  if (pxPerDay >= 30) return 'week';
  if (pxPerDay >= 10) return 'month';
  if (pxPerDay >= 4) return 'quarter';
  return 'year';
}

function zoomLabel(pxPerDay: number): string {
  const lvl = derivedZoomLevel(pxPerDay);
  return { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }[lvl] ?? 'Month';
}

// ── Interfaces ───────────────────────────────────────────────────────────────
interface Props {
  tasks: Task[];
  projects: Project[];
  people: Person[];
}

interface DateRange {
  start: Date;
  end: Date;
}

interface Lane {
  id: string;
  label: string;
  color?: string;
  personId?: number | null;
  tasks: Task[];
}

interface DragState {
  taskId: number;
  type: 'move' | 'resize-left' | 'resize-right' | 'connect-dep';
  startMouseX: number;
  startMouseY: number;
  originalStart: Date;
  originalEnd: Date;
  originalLaneY: number;
  originalAssigneeId: number | null;
  originalLaneKey: string;
}

interface TaskRect {
  x: number;
  y: number; // absolute Y in the scrollable area (includes DATE_HEADER_HEIGHT + lane offset)
  w: number;
  h: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getDisplayDates(task: Task): DateRange | null {
  if (task.start_date && task.end_date) {
    const s = new Date(task.start_date);
    const e = new Date(task.end_date);
    return { start: s, end: e <= s ? addDays(s, 1) : e };
  }
  const fallback = task.deadline ?? task.end_date ?? task.start_date;
  if (fallback) {
    const d = new Date(fallback);
    if (task.type === 'milestone') return { start: d, end: addDays(d, 1) };
    return { start: subDays(d, 1), end: d };
  }
  return null;
}

function projectColor(projectId: number | null, projects: Project[]): string {
  if (!projectId) return '#6b7280';
  return projects.find((p) => p.id === projectId)?.color ?? '#6b7280';
}

const STATUS_BORDER: Record<string, string> = {
  todo: '#9ca3af',
  in_progress: '#3b82f6',
  blocked: '#ef4444',
  done: '#22c55e',
};

function dateToX(date: Date, viewStart: Date, pxPerDay: number): number {
  return differenceInCalendarDays(date, viewStart) * pxPerDay;
}

function xToDate(x: number, viewStart: Date, pxPerDay: number): Date {
  const days = Math.round(x / pxPerDay);
  return addDays(viewStart, days);
}

function clampDate(date: Date, min: Date, max: Date): Date {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

// ── Date header helpers ──────────────────────────────────────────────────────
function buildMonthTicks(viewStart: Date, viewEnd: Date, pxPerDay: number) {
  const ticks: { label: string; x: number; width: number }[] = [];
  let cur = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1);
  while (cur <= viewEnd) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const x = dateToX(cur < viewStart ? viewStart : cur, viewStart, pxPerDay);
    const endX = dateToX(next > viewEnd ? viewEnd : next, viewStart, pxPerDay);
    ticks.push({ label: format(cur, 'MMM yyyy'), x, width: endX - x });
    cur = next;
  }
  return ticks;
}

function buildWeekTicks(viewStart: Date, viewEnd: Date, pxPerDay: number, zoomLevel: string) {
  const ticks: { label: string; x: number }[] = [];

  if (zoomLevel === 'week') {
    // Day ticks
    let cur = new Date(viewStart);
    while (cur <= viewEnd) {
      ticks.push({ label: format(cur, 'd'), x: dateToX(cur, viewStart, pxPerDay) });
      cur = addDays(cur, 1);
    }
  } else if (zoomLevel === 'month') {
    // Week ticks (mondays)
    let cur = new Date(viewStart);
    // align to monday
    const dow = cur.getDay();
    if (dow !== 1) cur = addDays(cur, (8 - dow) % 7);
    while (cur <= viewEnd) {
      ticks.push({ label: format(cur, 'MMM d'), x: dateToX(cur, viewStart, pxPerDay) });
      cur = addDays(cur, 7);
    }
  } else if (zoomLevel === 'quarter') {
    // Month ticks
    let cur = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1);
    while (cur <= viewEnd) {
      ticks.push({ label: format(cur, 'MMM'), x: dateToX(cur, viewStart, pxPerDay) });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  } else {
    // Year: Quarter ticks
    let cur = new Date(viewStart.getFullYear(), Math.floor(viewStart.getMonth() / 3) * 3, 1);
    while (cur <= viewEnd) {
      const q = Math.floor(cur.getMonth() / 3) + 1;
      ticks.push({ label: `Q${q} ${cur.getFullYear()}`, x: dateToX(cur, viewStart, pxPerDay) });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
    }
  }
  return ticks;
}

// ── Arrow component ──────────────────────────────────────────────────────────
function BezierArrow({
  sx, sy, tx, ty, depId, onDelete,
}: {
  sx: number; sy: number; tx: number; ty: number;
  depId: number;
  onDelete: (id: number) => void;
}) {
  const cx1 = sx + 40;
  const cy1 = sy;
  const cx2 = tx - 40;
  const cy2 = ty;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const arrowSize = 6;

  const [hover, setHover] = useState(false);

  return (
    <g>
      <path
        d={`M ${sx} ${sy} C ${cx1} ${cy1} ${cx2} ${cy2} ${tx} ${ty}`}
        stroke={hover ? 'var(--today-line)' : 'var(--text-muted)'}
        strokeWidth={1.5}
        fill="none"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        strokeOpacity={0.6}
      />
      {/* arrowhead */}
      <polygon
        points={`${tx},${ty} ${tx - arrowSize},${ty - arrowSize / 2} ${tx - arrowSize},${ty + arrowSize / 2}`}
        fill="var(--text-muted)"
        fillOpacity={0.6}
      />
      {/* Delete button on hover */}
      {hover && (
        <g
          onClick={() => onDelete(depId)}
          style={{ cursor: 'pointer', pointerEvents: 'all' }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          <circle cx={mx} cy={my} r={8} fill="var(--today-line)" opacity={0.9} />
          <text x={mx} y={my + 4} textAnchor="middle" fill="white" fontSize={12} fontWeight="bold">
            ×
          </text>
        </g>
      )}
    </g>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export function CustomGantt({ tasks, projects, people }: Props) {
  const moveTask = useMoveTask();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const addDependency = useAddDependency();
  const deleteDependency = useDeleteDependency();
  const setSelectedTaskId = useUIStore((s) => s.setSelectedTaskId);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const pxPerDay = useUIStore((s) => s.pxPerDay);
  const setPxPerDay = useUIStore((s) => s.setPxPerDay);
  const laneHeights = useUIStore((s) => s.laneHeights);
  const setLaneHeight = useUIStore((s) => s.setLaneHeight);
  const personOrder = useUIStore((s) => s.personOrder);
  const setPersonOrder = useUIStore((s) => s.setPersonOrder);

  const zoomLevel = derivedZoomLevel(pxPerDay);
  const pxPerDayRef = useRef(pxPerDay);
  useEffect(() => { pxPerDayRef.current = pxPerDay; }, [pxPerDay]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<DragState | null>(null);
  const resizeLane = useRef<{ laneId: string; startY: number; startHeight: number } | null>(null);
  const autoPlacedRef = useRef<Set<number>>(new Set());
  const undoStack = useRef<Array<{ undo: () => void; redo: () => void }>>([]);
  const redoStack = useRef<Array<{ undo: () => void; redo: () => void }>>([]);
  const pendingScrollLeft = useRef<number | null>(null);
  // Tracks whether the initial "scroll to today" has already run
  const didScrollToToday = useRef(false);

  // After a zoom re-render, restore the focal-point scroll position
  useEffect(() => {
    if (pendingScrollLeft.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingScrollLeft.current;
      pendingScrollLeft.current = null;
    }
  }, [pxPerDay]);

  // Zoom around a specific content-X pixel (cursor or viewport center)
  const zoomToFactor = useCallback((factor: number, focalContentX: number, focalScreenX: number) => {
    const newPx = Math.max(1, Math.min(80, pxPerDayRef.current * factor));
    pendingScrollLeft.current = Math.max(0, focalContentX * (newPx / pxPerDayRef.current) - focalScreenX);
    setPxPerDay(newPx);
  }, [setPxPerDay]);

  // ── Drag overlay state (minimal re-renders) ──────────────────────────────
  const [dragOverlay, setDragOverlay] = useState<{
    taskId: number;
    x: number;
    y: number;
    width: number;
    color: string;
  } | null>(null);
  const [connectLine, setConnectLine] = useState<{
    sx: number; sy: number; ex: number; ey: number;
  } | null>(null);
  const [hoveredDepId, setHoveredDepId] = useState<number | null>(null);
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);
  const laneReorder = useRef<{ srcLaneId: string; startY: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  // ── Compute view range from task dates ──────────────────────────────────
  const { viewStart, viewEnd } = useMemo(() => {
    const ranges = tasks
      .map((t) => getDisplayDates(t))
      .filter((r): r is DateRange => r !== null);
    if (ranges.length === 0) {
      const today = new Date();
      return { viewStart: subDays(today, 30), viewEnd: addDays(today, 90) };
    }
    const minDate = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
    const maxDate = new Date(Math.max(...ranges.map((r) => r.end.getTime())));
    return {
      viewStart: subDays(minDate, 30),
      viewEnd: addDays(maxDate, 30),
    };
  }, [tasks]);

  const totalDays = differenceInCalendarDays(viewEnd, viewStart);
  const totalWidth = totalDays * pxPerDay;

  // ── Build lanes ──────────────────────────────────────────────────────────
  const lanes = useMemo<Lane[]>(() => {
    const milestones = tasks.filter((t) => t.type === 'milestone');
    const regularTasks = tasks.filter((t) => t.type !== 'milestone');

    const result: Lane[] = [];

    if (milestones.length > 0) {
      result.push({ id: 'milestones', label: 'Milestones', tasks: milestones });
    }

    // Respect personOrder from uiStore; fall back to alphabetical
    let orderedPeople: typeof people;
    if (personOrder.length > 0) {
      const byId = Object.fromEntries(people.map((p) => [p.id, p]));
      orderedPeople = personOrder.map((id) => byId[id]).filter(Boolean);
      people.forEach((p) => { if (!personOrder.includes(p.id)) orderedPeople.push(p); });
    } else {
      orderedPeople = [...people].sort((a, b) => a.name.localeCompare(b.name));
    }

    orderedPeople.forEach((person) => {
      const personTasks = regularTasks.filter((t) => t.assignee_id === person.id);
      if (personTasks.length > 0) {
        result.push({
          id: `person-${person.id}`,
          label: person.name,
          color: person.color,
          personId: person.id,
          tasks: personTasks,
        });
      }
    });

    const unassigned = regularTasks.filter((t) => !t.assignee_id);
    if (unassigned.length > 0) {
      result.push({ id: 'unassigned', label: 'Unassigned', tasks: unassigned });
    }

    return result;
  }, [tasks, people, personOrder]);

  // ── Auto-layout: compute lane_y for tasks not yet placed ──────────────
  const autoLayoutRef = useRef<Record<number, number>>({});

  const computedLaneY = useCallback(
    (task: Task, laneTasks: Task[]): number => {
      // If already in DB with non-zero lane_y or already auto-placed, use that
      if (task.lane_y !== 0) return task.lane_y;
      if (autoLayoutRef.current[task.id] !== undefined) {
        return autoLayoutRef.current[task.id];
      }

      // Greedy packing: sort by start date, find lowest non-overlapping row
      const sortedByStart = [...laneTasks]
        .filter((t) => t.id !== task.id)
        .sort((a, b) => {
          const aD = getDisplayDates(a);
          const bD = getDisplayDates(b);
          return (aD?.start.getTime() ?? 0) - (bD?.start.getTime() ?? 0);
        });

      const taskDates = getDisplayDates(task);
      if (!taskDates) {
        autoLayoutRef.current[task.id] = 0;
        return 0;
      }

      // Find which rows are occupied at task's time range
      const rowMax: Record<number, Date> = {};
      sortedByStart.forEach((other) => {
        const ld = autoLayoutRef.current[other.id] ?? other.lane_y;
        const od = getDisplayDates(other);
        if (!od) return;
        const curMax = rowMax[ld];
        if (!curMax || od.end > curMax) rowMax[ld] = od.end;
      });

      // Find first row where task fits
      let row = 0;
      while (rowMax[row] && rowMax[row] > taskDates.start) {
        row++;
      }

      autoLayoutRef.current[task.id] = row;
      return row;
    },
    []
  );

  // Save auto-placements to DB (silent, once per task)
  useEffect(() => {
    tasks.forEach((task) => {
      if (task.lane_y === 0 && autoLayoutRef.current[task.id] !== undefined) {
        const computedY = autoLayoutRef.current[task.id];
        if (computedY !== 0 && !autoPlacedRef.current.has(task.id)) {
          autoPlacedRef.current.add(task.id);
          updateTask.mutate({ id: task.id, data: { lane_y: computedY } });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // ── Compute lane heights ─────────────────────────────────────────────────
  const laneHeightMap = useMemo(() => {
    const map: Record<string, number> = {};
    lanes.forEach((lane) => {
      // Compute min height needed
      let maxRow = 0;
      lane.tasks.forEach((task) => {
        const laneY = task.lane_y !== 0
          ? task.lane_y
          : (autoLayoutRef.current[task.id] ?? 0);
        if (laneY > maxRow) maxRow = laneY;
      });
      const minH = (maxRow + 1) * TASK_ROW_HEIGHT + 16;
      const stored = laneHeights[lane.id] ?? DEFAULT_LANE_HEIGHT;
      map[lane.id] = Math.max(stored, minH, MIN_LANE_HEIGHT);
    });
    return map;
  }, [lanes, laneHeights]);

  const totalHeight = useMemo(() => {
    return DATE_HEADER_HEIGHT +
      lanes.reduce((acc, lane) => acc + (laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT), 0);
  }, [lanes, laneHeightMap]);

  // ── Lane top positions ───────────────────────────────────────────────────
  const laneTopMap = useMemo(() => {
    const map: Record<string, number> = {};
    let y = DATE_HEADER_HEIGHT;
    lanes.forEach((lane) => {
      map[lane.id] = y;
      y += laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT;
    });
    return map;
  }, [lanes, laneHeightMap]);

  // ── Task rect map for dependency arrows ─────────────────────────────────
  const taskRectMap = useMemo(() => {
    const map = new Map<number, TaskRect>();
    lanes.forEach((lane) => {
      const laneTop = laneTopMap[lane.id] ?? 0;
      lane.tasks.forEach((task) => {
        const dates = getDisplayDates(task);
        if (!dates) return;
        const x = dateToX(dates.start, viewStart, pxPerDay);
        const w = Math.max(dateToX(dates.end, viewStart, pxPerDay) - x, 4);
        const laneY = task.lane_y !== 0
          ? task.lane_y
          : (autoLayoutRef.current[task.id] ?? 0);
        const y = laneTop + laneY * TASK_ROW_HEIGHT + 4;
        map.set(task.id, { x, y, w, h: TASK_HEIGHT });
      });
    });
    return map;
  }, [lanes, laneTopMap, viewStart, pxPerDay]);

  // ── Today line ──────────────────────────────────────────────────────────
  const todayX = useMemo(
    () => dateToX(new Date(), viewStart, pxPerDay),
    [viewStart, pxPerDay]
  );

  // ── Scroll sync ──────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !labelsRef.current) return;
    labelsRef.current.scrollTop = scrollRef.current.scrollTop;
  }, []);

  // ── Scroll to today — only on initial mount, not on every zoom ──────────
  useEffect(() => {
    if (!didScrollToToday.current && scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayX - 200);
      didScrollToToday.current = true;
    }
  }, [todayX]);

  // ── Determine lane from mouseY in the scrollable area ───────────────────
  const getLaneFromY = useCallback(
    (absoluteY: number): { lane: Lane | null; laneLocalY: number } => {
      for (const lane of lanes) {
        const top = laneTopMap[lane.id] ?? 0;
        const height = laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT;
        if (absoluteY >= top && absoluteY < top + height) {
          return { lane, laneLocalY: absoluteY - top };
        }
      }
      return { lane: null, laneLocalY: 0 };
    },
    [lanes, laneTopMap, laneHeightMap]
  );

  // ── Find nearest valid snap row across ALL lanes ─────────────────────────
  // Avoids cursor-at-lane-boundary returning a row from the adjacent lane.
  const getNearestSnapRow = useCallback(
    (absoluteY: number): { lane: Lane; row: number } | null => {
      let best: { lane: Lane; row: number; dist: number } | null = null;
      for (const lane of lanes) {
        const laneTop = laneTopMap[lane.id] ?? 0;
        const laneH = laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT;
        const maxRow = Math.max(0, Math.floor((laneH - 4 - TASK_HEIGHT) / TASK_ROW_HEIGHT));
        for (let row = 0; row <= maxRow; row++) {
          const snapY = laneTop + row * TASK_ROW_HEIGHT + 4 + TASK_HEIGHT / 2;
          const dist = Math.abs(absoluteY - snapY);
          if (!best || dist < best.dist) best = { lane, row, dist };
        }
      }
      return best ? { lane: best.lane, row: best.row } : null;
    },
    [lanes, laneTopMap, laneHeightMap]
  );

  // ── Double-click on blank lane space → create task ───────────────────────
  const handleLaneDoubleClick = useCallback(
    (e: React.MouseEvent, lane: Lane) => {
      if (!scrollRef.current) return;
      const rect = scrollRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left + scrollRef.current.scrollLeft;
      const clickDate = xToDate(clickX, viewStart, pxPerDay);
      const dateStr = format(clickDate, 'yyyy-MM-dd');
      const endStr = format(addDays(clickDate, 1), 'yyyy-MM-dd');
      createTask.mutate(
        {
          title: 'New task',
          assignee_id: lane.personId ?? null,
          start_date: dateStr,
          end_date: endStr,
          status: 'todo',
          priority: 2,
          density: 100,
        },
        { onSuccess: (t) => setSelectedTaskId(t.id) }
      );
    },
    [viewStart, pxPerDay, createTask, setSelectedTaskId]
  );

  // ── Mouse event handlers ─────────────────────────────────────────────────
  const handleTaskMouseDown = useCallback(
    (
      e: React.MouseEvent,
      task: Task,
      dragType: 'move' | 'resize-left' | 'resize-right' | 'connect-dep',
      laneKey: string
    ) => {
      e.stopPropagation();
      e.preventDefault();
      const dates = getDisplayDates(task);
      if (!dates) return;

      dragState.current = {
        taskId: task.id,
        type: dragType,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        originalStart: dates.start,
        originalEnd: dates.end,
        originalLaneY: task.lane_y,
        originalAssigneeId: task.assignee_id,
        originalLaneKey: laneKey,
      };

      if (dragType !== 'connect-dep') {
        const rect = taskRectMap.get(task.id);
        if (rect) {
          const color = projectColor(task.project_id, projects);
          setDragOverlay({ taskId: task.id, x: e.clientX - 60, y: e.clientY - 14, width: rect.w, color });
        }
      }
    },
    [taskRectMap, projects]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Lane resize
      if (resizeLane.current) {
        const dy = e.clientY - resizeLane.current.startY;
        const newH = Math.max(MIN_LANE_HEIGHT, resizeLane.current.startHeight + dy);
        setLaneHeight(resizeLane.current.laneId, newH);
        return;
      }

      // Lane reorder — highlight target lane under cursor
      if (laneReorder.current && labelsRef.current) {
        const labelsRect = labelsRef.current.getBoundingClientRect();
        const mouseY = e.clientY - labelsRect.top + labelsRef.current.scrollTop + DATE_HEADER_HEIGHT;
        // Find which lane is under the cursor using laneTopMap
        let targetId: string | null = null;
        for (const [id, top] of Object.entries(laneTopMap)) {
          const h = laneHeightMap[id] ?? DEFAULT_LANE_HEIGHT;
          if (mouseY >= top && mouseY < top + h) { targetId = id; break; }
        }
        setDragOverLaneId(targetId);
        return;
      }

      if (!dragState.current || !scrollRef.current) return;
      const ds = dragState.current;
      const dx = e.clientX - ds.startMouseX;

      if (ds.type === 'connect-dep') {
        // Show line from source task right edge to mouse
        const srcRect = taskRectMap.get(ds.taskId);
        if (srcRect && scrollRef.current) {
          const containerRect = scrollRef.current.getBoundingClientRect();
          const scrollLeft = scrollRef.current.scrollLeft;
          const scrollTop = scrollRef.current.scrollTop;
          const sx = srcRect.x + srcRect.w - scrollLeft + containerRect.left;
          const sy = srcRect.y + srcRect.h / 2 - scrollTop + containerRect.top;
          setConnectLine({ sx, sy, ex: e.clientX, ey: e.clientY });
        }
        return;
      }

      if (ds.type === 'move') {
        const deltaDays = Math.round(dx / pxPerDay);
        const newStart = addDays(ds.originalStart, deltaDays);

        const scrollRect = scrollRef.current.getBoundingClientRect();
        const x = dateToX(newStart, viewStart, pxPerDay) - scrollRef.current.scrollLeft + scrollRect.left;
        const rect = taskRectMap.get(ds.taskId);
        const width = rect?.w ?? 80;
        const color = projectColor(
          tasks.find((t) => t.id === ds.taskId)?.project_id ?? null,
          projects
        );
        // Snap ghost Y to the nearest valid row across all lanes
        const mouseYInScroll = e.clientY - scrollRect.top + scrollRef.current.scrollTop;
        const snap = getNearestSnapRow(mouseYInScroll);
        const snappedScreenY = snap
          ? scrollRect.top - scrollRef.current.scrollTop + (laneTopMap[snap.lane.id] ?? 0) + snap.row * TASK_ROW_HEIGHT + 4
          : e.clientY - TASK_HEIGHT / 2;
        setDragOverlay({ taskId: ds.taskId, x, y: snappedScreenY, width, color });
        return;
      }

      if (ds.type === 'resize-right') {
        const deltaDays = Math.round(dx / pxPerDay);
        const newEnd = addDays(ds.originalEnd, deltaDays);
        if (newEnd <= ds.originalStart) return;
        const rect = taskRectMap.get(ds.taskId);
        if (!rect || !scrollRef.current) return;
        const scrollRect = scrollRef.current.getBoundingClientRect();
        const x = rect.x - scrollRef.current.scrollLeft + scrollRect.left;
        const newWidth = dateToX(newEnd, viewStart, pxPerDay) - rect.x;
        const color = projectColor(
          tasks.find((t) => t.id === ds.taskId)?.project_id ?? null,
          projects
        );
        setDragOverlay({ taskId: ds.taskId, x, y: e.clientY - 14, width: Math.max(newWidth, 4), color });
        return;
      }

      if (ds.type === 'resize-left') {
        const deltaDays = Math.round(dx / pxPerDay);
        const newStart = addDays(ds.originalStart, deltaDays);
        if (newStart >= ds.originalEnd) return;
        const rect = taskRectMap.get(ds.taskId);
        if (!rect || !scrollRef.current) return;
        const scrollRect = scrollRef.current.getBoundingClientRect();
        const newX = dateToX(newStart, viewStart, pxPerDay) - scrollRef.current.scrollLeft + scrollRect.left;
        const newWidth = dateToX(ds.originalEnd, viewStart, pxPerDay) - dateToX(newStart, viewStart, pxPerDay);
        const color = projectColor(
          tasks.find((t) => t.id === ds.taskId)?.project_id ?? null,
          projects
        );
        setDragOverlay({ taskId: ds.taskId, x: newX, y: e.clientY - 14, width: Math.max(newWidth, 4), color });
        return;
      }
    },
    [pxPerDay, viewStart, taskRectMap, tasks, projects, setLaneHeight, laneTopMap, laneHeightMap, getNearestSnapRow]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      // Lane resize end
      if (resizeLane.current) {
        resizeLane.current = null;
        return;
      }

      // Lane reorder end
      if (laneReorder.current) {
        const srcLaneId = laneReorder.current.srcLaneId;
        laneReorder.current = null;
        if (dragOverLaneId && dragOverLaneId !== srcLaneId) {
          const personLanes = lanes.filter((l) => l.personId != null);
          const ids = personLanes.map((l) => l.personId as number);
          const srcPersonId = Number(srcLaneId.replace('person-', ''));
          const tgtPersonId = Number(dragOverLaneId.replace('person-', ''));
          const srcIdx = ids.indexOf(srcPersonId);
          const tgtIdx = ids.indexOf(tgtPersonId);
          if (srcIdx !== -1 && tgtIdx !== -1) {
            const next = [...ids];
            next.splice(srcIdx, 1);
            next.splice(tgtIdx, 0, srcPersonId);
            setPersonOrder(next);
          }
        }
        setDragOverLaneId(null);
        return;
      }

      if (!dragState.current) return;
      const ds = dragState.current;
      const dx = e.clientX - ds.startMouseX;

      setDragOverlay(null);
      setConnectLine(null);

      if (ds.type === 'connect-dep') {
        // Find task under cursor
        if (!scrollRef.current) { dragState.current = null; return; }
        const scrollRect = scrollRef.current.getBoundingClientRect();
        const mouseXInScroll = e.clientX - scrollRect.left + scrollRef.current.scrollLeft;
        const mouseYInScroll = e.clientY - scrollRect.top + scrollRef.current.scrollTop;

        let targetTaskId: number | null = null;
        for (const [tid, rect] of taskRectMap.entries()) {
          if (
            tid !== ds.taskId &&
            mouseXInScroll >= rect.x &&
            mouseXInScroll <= rect.x + rect.w &&
            mouseYInScroll >= rect.y &&
            mouseYInScroll <= rect.y + rect.h
          ) {
            targetTaskId = tid;
            break;
          }
        }
        if (targetTaskId !== null) {
          addDependency.mutate({ taskId: targetTaskId, dependsOnId: ds.taskId });
        }
        dragState.current = null;
        return;
      }

      const dy = e.clientY - ds.startMouseY;
      if (dx * dx + dy * dy < 25) {
        // It was a click — open detail modal
        setSelectedTaskId(ds.taskId);
        dragState.current = null;
        return;
      }

      const deltaDays = Math.round(dx / pxPerDay);
      if (ds.type === 'move') {
        const newStart = addDays(ds.originalStart, deltaDays);
        const newEnd = addDays(ds.originalEnd, deltaDays);

        if (scrollRef.current) {
          const scrollRect = scrollRef.current.getBoundingClientRect();
          const mouseYInScroll = e.clientY - scrollRect.top + scrollRef.current.scrollTop;
          const snap = getNearestSnapRow(mouseYInScroll);
          const dropLane = snap?.lane ?? null;
          const newLaneY = snap?.row ?? 0;

          const task = tasks.find((t) => t.id === ds.taskId);
          if (!task) { dragState.current = null; return; }

          const undoFns: (() => void)[] = [];
          const redoFns: (() => void)[] = [];

          const newStartStr = format(newStart, 'yyyy-MM-dd');
          const newEndStr = format(newEnd, 'yyyy-MM-dd');
          if (newStartStr !== task.start_date || newEndStr !== task.end_date) {
            const origDates = { id: ds.taskId, start_date: task.start_date ?? newStartStr, end_date: task.end_date ?? newEndStr };
            const newDates = { id: ds.taskId, start_date: newStartStr, end_date: newEndStr };
            moveTask.mutate(newDates);
            undoFns.push(() => moveTask.mutate(origDates));
            redoFns.push(() => moveTask.mutate(newDates));
          }

          const updates: Partial<Task> = {};
          const undoUpdates: Partial<Task> = {};
          if (dropLane && dropLane.id !== ds.originalLaneKey) {
            updates.assignee_id = dropLane.personId ?? null;
            undoUpdates.assignee_id = ds.originalAssigneeId;
          }
          if (newLaneY !== ds.originalLaneY) {
            updates.lane_y = newLaneY;
            undoUpdates.lane_y = ds.originalLaneY;
          }
          if (Object.keys(updates).length > 0) {
            updateTask.mutate({ id: ds.taskId, data: updates });
            undoFns.push(() => updateTask.mutate({ id: ds.taskId, data: undoUpdates }));
            redoFns.push(() => updateTask.mutate({ id: ds.taskId, data: updates }));
          }

          if (undoFns.length > 0) {
            undoStack.current.push({ undo: () => undoFns.forEach(f => f()), redo: () => redoFns.forEach(f => f()) });
            redoStack.current = [];
          }
        }
      } else if (ds.type === 'resize-right') {
        const newEnd = addDays(ds.originalEnd, deltaDays);
        if (newEnd > ds.originalStart) {
          const origDates = { id: ds.taskId, start_date: format(ds.originalStart, 'yyyy-MM-dd'), end_date: format(ds.originalEnd, 'yyyy-MM-dd') };
          const newDates = { id: ds.taskId, start_date: format(ds.originalStart, 'yyyy-MM-dd'), end_date: format(newEnd, 'yyyy-MM-dd') };
          moveTask.mutate(newDates);
          undoStack.current.push({ undo: () => moveTask.mutate(origDates), redo: () => moveTask.mutate(newDates) });
          redoStack.current = [];
        }
      } else if (ds.type === 'resize-left') {
        const newStart = addDays(ds.originalStart, deltaDays);
        if (newStart < ds.originalEnd) {
          const origDates = { id: ds.taskId, start_date: format(ds.originalStart, 'yyyy-MM-dd'), end_date: format(ds.originalEnd, 'yyyy-MM-dd') };
          const newDates = { id: ds.taskId, start_date: format(newStart, 'yyyy-MM-dd'), end_date: format(ds.originalEnd, 'yyyy-MM-dd') };
          moveTask.mutate(newDates);
          undoStack.current.push({ undo: () => moveTask.mutate(origDates), redo: () => moveTask.mutate(newDates) });
          redoStack.current = [];
        }
      }

      dragState.current = null;
    },
    [pxPerDay, addDependency, moveTask, updateTask, getNearestSnapRow, tasks, taskRectMap, setSelectedTaskId, dragOverLaneId, lanes, setPersonOrder]
  );

  // Register global mouse events
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Undo / redo key binding (Cmd+Z / Cmd+Shift+Z)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const action = undoStack.current.pop();
        if (action) { action.undo(); redoStack.current.push(action); }
      } else if (e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        const action = redoStack.current.pop();
        if (action) { action.redo(); undoStack.current.push(action); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Wheel / pinch zoom (Ctrl+wheel = pinch on trackpad) — continuous, anchored to cursor
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = Math.pow(0.9, e.deltaY / 17);
      const rect = el.getBoundingClientRect();
      const focalScreenX = e.clientX - rect.left;
      const focalContentX = focalScreenX + el.scrollLeft;
      zoomToFactor(factor, focalContentX, focalScreenX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomToFactor]);

  // ── Date header ticks ────────────────────────────────────────────────────
  const monthTicks = useMemo(
    () => buildMonthTicks(viewStart, viewEnd, pxPerDay),
    [viewStart, viewEnd, pxPerDay]
  );
  const subTicks = useMemo(
    () => buildWeekTicks(viewStart, viewEnd, pxPerDay, zoomLevel),
    [viewStart, viewEnd, pxPerDay, zoomLevel]
  );

  // ── Dependency arrows data ───────────────────────────────────────────────
  const depArrows = useMemo(() => {
    const arrows: { depId: number; sx: number; sy: number; tx: number; ty: number }[] = [];
    tasks.forEach((task) => {
      (task.dependencies ?? []).forEach((dep) => {
        const srcRect = taskRectMap.get(dep.depends_on_id);
        const tgtRect = taskRectMap.get(dep.task_id);
        if (!srcRect || !tgtRect) return;
        arrows.push({
          depId: dep.id,
          sx: srcRect.x + srcRect.w,
          sy: srcRect.y + srcRect.h / 2,
          tx: tgtRect.x,
          ty: tgtRect.y + tgtRect.h / 2,
        });
      });
    });
    return arrows;
  }, [tasks, taskRectMap]);

  const handleDeleteDep = useCallback(
    (depId: number) => {
      deleteDependency.mutate(depId);
    },
    [deleteDependency]
  );

  const visibleTaskCount = tasks.filter((t) => {
    return getDisplayDates(t) !== null;
  }).length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="flex-1 overflow-hidden flex flex-col"
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 border-b flex-shrink-0"
        style={{ height: 36, borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Zoom:</span>
        <button
          onClick={() => {
            if (!scrollRef.current) return;
            const half = scrollRef.current.clientWidth / 2;
            zoomToFactor(1 / 1.5, scrollRef.current.scrollLeft + half, half);
          }}
          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Zoom out"
        >
          −
        </button>
        <span
          className="text-xs font-medium w-14 text-center"
          style={{ color: 'var(--text-primary)' }}
        >
          {zoomLabel(pxPerDay)}
        </span>
        <button
          onClick={() => {
            if (!scrollRef.current) return;
            const half = scrollRef.current.clientWidth / 2;
            zoomToFactor(1.5, scrollRef.current.scrollLeft + half, half);
          }}
          className="w-6 h-6 rounded flex items-center justify-center text-sm font-bold"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Zoom in"
        >
          +
        </button>
        <span className="text-xs ml-4" style={{ color: 'var(--text-muted)' }}>
          {visibleTaskCount} tasks with dates
        </span>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Lane labels (left sidebar, Y-sync'd via ref) */}
        <div
          ref={labelsRef}
          style={{
            width: LANE_HEADER_WIDTH,
            flexShrink: 0,
            overflow: 'hidden',
            borderRight: '1px solid var(--border)',
            backgroundColor: 'var(--bg-elevated)',
            position: 'relative',
          }}
        >
          {/* Spacer for date header */}
          <div style={{ height: DATE_HEADER_HEIGHT, borderBottom: '1px solid var(--border)' }} />
          {lanes.map((lane) => {
            const isPersonLane = lane.personId != null;
            const isOver = dragOverLaneId === lane.id;
            return (
              <div
                key={lane.id}
                onMouseDown={isPersonLane ? (e) => {
                  e.preventDefault();
                  laneReorder.current = { srcLaneId: lane.id, startY: e.clientY };
                } : undefined}
                style={{
                  height: laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT,
                  borderBottom: '1px solid var(--border)',
                  borderTop: isOver ? '2px solid var(--accent)' : '2px solid transparent',
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: '8px 8px',
                  boxSizing: 'border-box',
                  cursor: isPersonLane ? 'grab' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  {lane.color && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: lane.color,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {lane.label}
                  </span>
                  {isPersonLane && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.5, flexShrink: 0 }}>
                      ⠿
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Timeline area */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowX: 'auto',
            overflowY: 'auto',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: totalWidth,
              minHeight: totalHeight,
            }}
          >
            {/* Date header */}
            <div
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 20,
                backgroundColor: 'var(--bg-elevated)',
                borderBottom: '1px solid var(--border)',
                height: DATE_HEADER_HEIGHT,
                width: '100%',
              }}
            >
              {/* Month row */}
              <div style={{ height: 32, position: 'relative', borderBottom: '1px solid var(--border)' }}>
                {monthTicks.map((tick, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: tick.x,
                      width: tick.width,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      borderRight: '1px solid var(--border)',
                      boxSizing: 'border-box',
                    }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
              {/* Sub-tick row */}
              <div style={{ height: 32, position: 'relative' }}>
                {subTicks.map((tick, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: tick.x,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 4,
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      borderRight: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                      boxSizing: 'border-box',
                    }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Today line */}
            {todayX >= 0 && todayX <= totalWidth && (
              <div
                style={{
                  position: 'absolute',
                  left: todayX,
                  top: DATE_HEADER_HEIGHT,
                  bottom: 0,
                  width: 2,
                  backgroundColor: 'var(--today-line)',
                  zIndex: 10,
                  opacity: 0.7,
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Lane backgrounds and task bars */}
            {lanes.map((lane) => {
              const laneTop = laneTopMap[lane.id] ?? 0;
              const laneHeight = laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT;

              return (
                <div
                  key={lane.id}
                  onDoubleClick={(e) => handleLaneDoubleClick(e, lane)}
                  style={{
                    position: 'absolute',
                    top: laneTop,
                    left: 0,
                    width: '100%',
                    height: laneHeight,
                    borderBottom: '1px solid var(--border)',
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Subtle lane stripe */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: lane.id === 'milestones'
                        ? 'rgba(99,102,241,0.03)'
                        : 'transparent',
                    }}
                  />

                  {/* Task bars */}
                  {lane.tasks.map((task) => {
                    const dates = getDisplayDates(task);
                    if (!dates) return null;

                    const x = dateToX(dates.start, viewStart, pxPerDay);
                    const w = Math.max(
                      dateToX(dates.end, viewStart, pxPerDay) - x,
                      task.type === 'milestone' ? pxPerDay : 4
                    );
                    const laneY = task.lane_y !== 0
                      ? task.lane_y
                      : computedLaneY(task, lane.tasks);
                    const barTop = laneY * TASK_ROW_HEIGHT + 4;
                    const color = projectColor(task.project_id, projects);
                    const statusBorderColor = STATUS_BORDER[task.status] ?? '#9ca3af';

                    const isDragging = dragState.current?.taskId === task.id;
                    const isDone = task.status === 'done';
                    // density 1–100 → opacity 0.35–1.0; done tasks always muted
                    const densityOpacity = isDone ? 0.28 : 0.35 + (task.density / 100) * 0.65;

                    return (
                      <div
                        key={task.id}
                        onMouseEnter={(e) => setTooltip({ text: task.title, x: e.clientX, y: e.clientY - 32 })}
                        onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY - 32 } : null)}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          position: 'absolute',
                          left: x,
                          top: barTop,
                          width: w,
                          height: TASK_HEIGHT,
                          backgroundColor: isDone ? color + '33' : color + 'cc',
                          border: isDone ? `1.5px dashed ${color}88` : `none`,
                          borderLeft: isDone ? `1.5px dashed ${color}88` : `3px solid ${statusBorderColor}`,
                          borderRadius: task.type === 'milestone' ? '3px' : '4px',
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 5,
                          cursor: 'grab',
                          userSelect: 'none',
                          zIndex: isDragging ? 15 : 6,
                          opacity: isDragging ? 0.4 : densityOpacity,
                          boxShadow: isDone ? 'none' : '0 1px 3px rgba(0,0,0,0.2)',
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                        }}
                        onMouseDown={(e) => handleTaskMouseDown(e, task, 'move', lane.id)}
                      >
                        {/* Task title */}
                        <span
                          style={{
                            fontSize: 11,
                            color: '#ffffff',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                            pointerEvents: 'none',
                          }}
                        >
                          {task.title}
                        </span>

                        {/* Progress bar */}
                        {task.progress > 0 && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 3,
                              width: `${task.progress}%`,
                              height: 2,
                              backgroundColor: 'rgba(255,255,255,0.6)',
                              borderRadius: 1,
                              pointerEvents: 'none',
                            }}
                          />
                        )}

                        <div
                          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 2 }}
                          onMouseDown={(e) => { e.stopPropagation(); handleTaskMouseDown(e, task, 'resize-left', lane.id); }}
                        />
                        <div
                          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 2 }}
                          onMouseDown={(e) => { e.stopPropagation(); handleTaskMouseDown(e, task, 'resize-right', lane.id); }}
                        />
                        <ConnectDot task={task} lane={lane} onMouseDown={handleTaskMouseDown} />
                      </div>
                    );
                  })}

                  {/* Lane resize handle */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 6,
                      cursor: 'row-resize',
                      zIndex: 20,
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      resizeLane.current = {
                        laneId: lane.id,
                        startY: e.clientY,
                        startHeight: laneHeight,
                      };
                    }}
                  />
                </div>
              );
            })}

            {/* Dependency arrows SVG */}
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: totalWidth,
                height: totalHeight,
                pointerEvents: 'none',
                zIndex: 8,
                overflow: 'visible',
              }}
            >
              {depArrows.map((arrow) => (
                <BezierArrow
                  key={arrow.depId}
                  sx={arrow.sx}
                  sy={arrow.sy}
                  tx={arrow.tx}
                  ty={arrow.ty}
                  depId={arrow.depId}
                  onDelete={handleDeleteDep}
                />
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* Drag overlay (fixed position) */}
      {dragOverlay && (
        <div
          style={{
            position: 'fixed',
            left: dragOverlay.x,
            top: dragOverlay.y,
            width: dragOverlay.width,
            height: TASK_HEIGHT,
            backgroundColor: dragOverlay.color + 'aa',
            border: `2px dashed ${dragOverlay.color}`,
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 200,
          }}
        />
      )}

      {/* Connect line overlay */}
      {connectLine && (
        <svg
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 200,
          }}
        >
          <line
            x1={connectLine.sx}
            y1={connectLine.sy}
            x2={connectLine.ex}
            y2={connectLine.ey}
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
        </svg>
      )}

      {/* Instant hover tooltip */}
      {tooltip && !dragOverlay && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 8,
            top: tooltip.y,
            zIndex: 300,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 12,
            color: 'var(--text-primary)',
            pointerEvents: 'none',
            maxWidth: 320,
            whiteSpace: 'pre-wrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Task detail modal */}
      {selectedTaskId && (() => {
        const selectedTask = tasks.find((t) => t.id === selectedTaskId);
        return selectedTask ? (
          <TaskDetailModal task={selectedTask} projects={projects} people={people} />
        ) : null;
      })()}
    </div>
  );
}

// ── Connect Dot sub-component (separate to use local hover state) ─────────────
function ConnectDot({
  task,
  lane,
  onMouseDown,
}: {
  task: Task;
  lane: Lane;
  onMouseDown: (
    e: React.MouseEvent,
    task: Task,
    type: 'move' | 'resize-left' | 'resize-right' | 'connect-dep',
    laneKey: string
  ) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      style={{
        position: 'absolute',
        right: -6,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: 'var(--accent)',
        border: '2px solid white',
        cursor: 'crosshair',
        zIndex: 10,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.1s',
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, task, 'connect-dep', lane.id);
      }}
    />
  );
}
