import {
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useState,
  Fragment,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TaskDetailModal } from './TaskDetailModal';
import { addDays, subDays, differenceInCalendarDays, format } from 'date-fns';
import type { Task, Project, Person } from '../../lib/api';
import { api } from '../../lib/api';
import { useMoveTask, useUpdateTask, useCreateTask, useDeleteTask, useAddDependency, useDeleteDependency } from '../../hooks/useTasks';
import { useUIStore } from '../../store/uiStore';
import { useUndoStore } from '../../store/undoStore';
import { computeAutoArrange } from '../../lib/autoArrange';

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
  autoArrangeRef?: { current: ((() => Promise<void>) | null) };
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

interface CoTaskSnapshot {
  taskId: number;
  originalStart: Date;
  originalEnd: Date;
  originalLaneY: number;
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
  coTaskSnapshots?: CoTaskSnapshot[];
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

const URGENT_COLOR = '#FFDDDD';//'#FF5A6F';

function projectColor(projectId: number | null, projects: Project[]): string {
  if (!projectId) return '#6b7280';
  return projects.find((p) => p.id === projectId)?.color ?? '#6b7280';
}


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
export function CustomGantt({ tasks, projects, people, autoArrangeRef }: Props) {
  const qc = useQueryClient();
  const moveTask = useMoveTask();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();
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
  const [dragOverlays, setDragOverlays] = useState<Array<{
    taskId: number;
    x: number;
    y: number;
    width: number;
    color: string;
  }>>([]);
  const [connectLine, setConnectLine] = useState<{
    sx: number; sy: number; ex: number; ey: number;
  } | null>(null);
  const [hoveredDepId, setHoveredDepId] = useState<number | null>(null);
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null);
  const laneReorder = useRef<{ srcLaneId: string; startY: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [previewLaneY, setPreviewLaneY] = useState<Map<number, number> | null>(null);
  const previewClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Multi-select state ───────────────────────────────────────────────────
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  // Ref so event callbacks always read the latest set without stale-closure issues
  const selectedTaskIdsRef = useRef<Set<number>>(selectedTaskIds);
  useEffect(() => { selectedTaskIdsRef.current = selectedTaskIds; }, [selectedTaskIds]);
  const selectBoxStart = useRef<{ screenX: number; screenY: number } | null>(null);
  const [selectBoxRect, setSelectBoxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

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
      // lane_y >= 0 means explicitly placed (including row 0); < 0 is the auto-layout sentinel
      if (task.lane_y >= 0) return task.lane_y;
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

  // Save auto-placements to DB (silent, once per task, skip row 0 which keeps sentinel)
  useEffect(() => {
    tasks.forEach((task) => {
      if (task.lane_y < 0 && autoLayoutRef.current[task.id] !== undefined) {
        const computedY = autoLayoutRef.current[task.id];
        if (computedY !== 0 && !autoPlacedRef.current.has(task.id)) {
          autoPlacedRef.current.add(task.id);
          updateTask.mutate({ id: task.id, data: { lane_y: computedY } });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // ── Auto-Arrange: iterative row packer (v2 spec) ────────────────────────
  const handleAutoArrange = useCallback(async () => {
    const updates: { id: number; oldLaneY: number; newLaneY: number }[] = [];
    const preview = new Map<number, number>();

    lanes.forEach((lane) => {
      const newPositions = computeAutoArrange(lane.tasks, tasks);
      newPositions.forEach((newLaneY, taskId) => {
        const task = lane.tasks.find((t) => t.id === taskId);
        if (!task) return;
        preview.set(taskId, newLaneY);
        const oldLaneY = task.lane_y >= 0 ? task.lane_y : (autoLayoutRef.current[taskId] ?? 0);
        if (newLaneY !== oldLaneY) updates.push({ id: taskId, oldLaneY: task.lane_y, newLaneY });
      });
    });

    if (updates.length === 0) return;

    // Animate to new positions immediately, before the DB round-trip
    if (previewClearTimer.current) clearTimeout(previewClearTimer.current);
    setPreviewLaneY(preview);

    await Promise.all(updates.map(({ id, newLaneY }) => api.updateTask(id, { lane_y: newLaneY })));

    const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
    useUndoStore.getState().push({
      label: 'Auto-arrange',
      undo: () => Promise.all(updates.map(({ id, oldLaneY }) => api.updateTask(id, { lane_y: oldLaneY }))).then(invalidate),
      redo: () => Promise.all(updates.map(({ id, newLaneY }) => api.updateTask(id, { lane_y: newLaneY }))).then(invalidate),
    });

    await invalidate();
    // Clear preview after the refetch has landed (animation is 400ms; 1200ms is safe headroom)
    previewClearTimer.current = setTimeout(() => setPreviewLaneY(null), 1200);
  }, [lanes, tasks, qc]);

  useEffect(() => {
    if (autoArrangeRef) autoArrangeRef.current = handleAutoArrange;
  }, [autoArrangeRef, handleAutoArrange]);

  // ── Compute lane heights ─────────────────────────────────────────────────
  const laneHeightMap = useMemo(() => {
    const map: Record<string, number> = {};
    lanes.forEach((lane) => {
      let maxRow = 0;
      lane.tasks.forEach((task) => {
        const laneY = previewLaneY?.get(task.id) ?? (task.lane_y >= 0 ? task.lane_y : (autoLayoutRef.current[task.id] ?? 0));
        if (laneY > maxRow) maxRow = laneY;
      });
      const minH = (maxRow + 1) * TASK_ROW_HEIGHT + 16;
      const stored = laneHeights[lane.id] ?? DEFAULT_LANE_HEIGHT;
      map[lane.id] = Math.max(stored, minH, MIN_LANE_HEIGHT);
    });
    return map;
  }, [lanes, laneHeights, previewLaneY]);

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
        const laneY = previewLaneY?.get(task.id) ?? (task.lane_y >= 0 ? task.lane_y : (autoLayoutRef.current[task.id] ?? 0));
        const y = laneTop + laneY * TASK_ROW_HEIGHT + 4;
        map.set(task.id, { x, y, w, h: TASK_HEIGHT });
      });
    });
    return map;
  }, [lanes, laneTopMap, viewStart, pxPerDay, previewLaneY]);

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

      // Snap to the row the user clicked in — row 0 stays 0 (auto-layout sentinel
      // which naturally resolves to row 0 when the slot is free).
      const mouseYInScroll = e.clientY - rect.top + scrollRef.current.scrollTop;
      const snap = getNearestSnapRow(mouseYInScroll);
      // Use -1 (auto-layout sentinel) if no snap found; explicit row otherwise
      const laneY = snap && snap.lane.id === lane.id ? snap.row : -1;

      createTask.mutate(
        {
          title: 'New task',
          assignee_id: lane.personId ?? null,
          start_date: dateStr,
          end_date: endStr,
          status: 'todo',
          priority: 2,
          density: 100,
          lane_y: laneY,
        },
        { onSuccess: (t) => setSelectedTaskId(t.id) }
      );
    },
    [viewStart, pxPerDay, createTask, setSelectedTaskId, getNearestSnapRow]
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

      // Capture co-selected tasks for batch move (use ref for latest set)
      const currentSelection = selectedTaskIdsRef.current;
      if (dragType === 'move' && currentSelection.has(task.id)) {
        dragState.current.coTaskSnapshots = [...currentSelection]
          .filter((id) => id !== task.id)
          .flatMap((id) => {
            const t = tasks.find((t) => t.id === id);
            const d = t ? getDisplayDates(t) : null;
            if (!t || !d) return [];
            return [{ taskId: id, originalStart: d.start, originalEnd: d.end, originalLaneY: t.lane_y }];
          });
      }

      if (dragType !== 'connect-dep') {
        const rect = taskRectMap.get(task.id);
        if (rect && scrollRef.current) {
          const scrollRect = scrollRef.current.getBoundingClientRect();
          const screenX = rect.x - scrollRef.current.scrollLeft + scrollRect.left;
          const screenY = rect.y - scrollRef.current.scrollTop + scrollRect.top;
          const color = projectColor(task.project_id, projects);
          const overlays = [{ taskId: task.id, x: screenX, y: screenY, width: rect.w, color }];
          // Add ghost bars for all co-selected tasks
          if (dragState.current?.coTaskSnapshots) {
            for (const coSnap of dragState.current.coTaskSnapshots) {
              const coTask = tasks.find((t) => t.id === coSnap.taskId);
              const coRect = taskRectMap.get(coSnap.taskId);
              if (coTask && coRect) {
                overlays.push({
                  taskId: coSnap.taskId,
                  x: coRect.x - scrollRef.current.scrollLeft + scrollRect.left,
                  y: coRect.y - scrollRef.current.scrollTop + scrollRect.top,
                  width: coRect.w,
                  color: projectColor(coTask.project_id, projects),
                });
              }
            }
          }
          setDragOverlays(overlays);
        }
      }
    },
    [taskRectMap, projects, tasks]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // Rubber-band selection box
      if (selectBoxStart.current && !dragState.current) {
        const { screenX, screenY } = selectBoxStart.current;
        setSelectBoxRect({
          x: Math.min(screenX, e.clientX),
          y: Math.min(screenY, e.clientY),
          w: Math.abs(e.clientX - screenX),
          h: Math.abs(e.clientY - screenY),
        });
        return;
      }

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
        // Build overlay array: primary ghost at snapped Y, co-task ghosts shifted by same Y delta
        const primaryOrigScreenY = rect ? rect.y - scrollRef.current.scrollTop + scrollRect.top : snappedScreenY;
        const primaryDeltaScreenY = snappedScreenY - primaryOrigScreenY;
        const overlays = [{ taskId: ds.taskId, x, y: snappedScreenY, width, color }];
        if (ds.coTaskSnapshots) {
          for (const coSnap of ds.coTaskSnapshots) {
            const coTask = tasks.find((t) => t.id === coSnap.taskId);
            const coRect = taskRectMap.get(coSnap.taskId);
            if (!coTask || !coRect) continue;
            const coNewStart = addDays(coSnap.originalStart, Math.round(dx / pxPerDay));
            const coX = dateToX(coNewStart, viewStart, pxPerDay) - scrollRef.current.scrollLeft + scrollRect.left;
            const coScreenY = coRect.y - scrollRef.current.scrollTop + scrollRect.top + primaryDeltaScreenY;
            overlays.push({ taskId: coSnap.taskId, x: coX, y: coScreenY, width: coRect.w, color: projectColor(coTask.project_id, projects) });
          }
        }
        setDragOverlays(overlays);
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
        const y = rect.y - scrollRef.current.scrollTop + scrollRect.top;
        const newWidth = dateToX(newEnd, viewStart, pxPerDay) - rect.x;
        const color = projectColor(
          tasks.find((t) => t.id === ds.taskId)?.project_id ?? null,
          projects
        );
        setDragOverlays([{ taskId: ds.taskId, x, y, width: Math.max(newWidth, 4), color }]);
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
        const y = rect.y - scrollRef.current.scrollTop + scrollRect.top;
        const newWidth = dateToX(ds.originalEnd, viewStart, pxPerDay) - dateToX(newStart, viewStart, pxPerDay);
        const color = projectColor(
          tasks.find((t) => t.id === ds.taskId)?.project_id ?? null,
          projects
        );
        setDragOverlays([{ taskId: ds.taskId, x: newX, y, width: Math.max(newWidth, 4), color }]);
        return;
      }
    },
    [pxPerDay, viewStart, taskRectMap, tasks, projects, setLaneHeight, laneTopMap, laneHeightMap, getNearestSnapRow]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      // Rubber-band selection end
      if (selectBoxStart.current) {
        const start = selectBoxStart.current;
        selectBoxStart.current = null;
        setSelectBoxRect(null);
        const x1 = Math.min(start.screenX, e.clientX);
        const y1 = Math.min(start.screenY, e.clientY);
        const x2 = Math.max(start.screenX, e.clientX);
        const y2 = Math.max(start.screenY, e.clientY);
        if (x2 - x1 > 5 && y2 - y1 > 5 && scrollRef.current) {
          const el = scrollRef.current;
          const sr = el.getBoundingClientRect();
          const cx1 = x1 - sr.left + el.scrollLeft;
          const cy1 = y1 - sr.top + el.scrollTop;
          const cx2 = x2 - sr.left + el.scrollLeft;
          const cy2 = y2 - sr.top + el.scrollTop;
          const newSel = new Set<number>();
          for (const [taskId, rect] of taskRectMap.entries()) {
            if (rect.x < cx2 && rect.x + rect.w > cx1 && rect.y < cy2 && rect.y + rect.h > cy1) {
              newSel.add(taskId);
            }
          }
          setSelectedTaskIds(newSel);
        } else {
          setSelectedTaskIds(new Set());
        }
        return;
      }

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

      setDragOverlays([]);
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
        // It was a click — select/deselect
        setSelectedTaskIds((prev) => {
          if (e.shiftKey) {
            const next = new Set(prev);
            if (next.has(ds.taskId)) next.delete(ds.taskId); else next.add(ds.taskId);
            return next;
          }
          // Clicking an already-selected task keeps the multi-selection intact
          // (so you can immediately drag the group without losing selection)
          if (prev.has(ds.taskId) && prev.size > 1) return prev;
          return new Set([ds.taskId]);
        });
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

          const newStartStr = format(newStart, 'yyyy-MM-dd');
          const newEndStr = format(newEnd, 'yyyy-MM-dd');

          const laneChanged = dropLane && dropLane.id !== ds.originalLaneKey;
          const rowChanged = newLaneY !== ds.originalLaneY;

          // ── Multi-task batch: mutations with skipUndo + one manual undo entry ─
          if (ds.coTaskSnapshots && ds.coTaskSnapshots.length > 0) {
            const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
            const newAssigneeId = dropLane?.personId ?? null;
            const primaryLaneChanged = !!(dropLane && dropLane.id !== ds.originalLaneKey);

            // Snapshots for the single undo/redo entry we'll push manually
            type MoveSnap = { id: number; newS: string; newE: string; origS: string; origE: string };
            type UpdSnap  = { id: number; newData: Partial<Task>; origData: Partial<Task> };

            const moveSnaps: MoveSnap[] = [
              { id: ds.taskId, newS: newStartStr, newE: newEndStr,
                origS: format(ds.originalStart, 'yyyy-MM-dd'), origE: format(ds.originalEnd, 'yyyy-MM-dd') },
              ...ds.coTaskSnapshots.map((s) => ({
                id: s.taskId,
                newS: format(addDays(s.originalStart, deltaDays), 'yyyy-MM-dd'),
                newE: format(addDays(s.originalEnd, deltaDays), 'yyyy-MM-dd'),
                origS: format(s.originalStart, 'yyyy-MM-dd'),
                origE: format(s.originalEnd, 'yyyy-MM-dd'),
              })),
            ];

            const updSnaps: UpdSnap[] = [];

            // Compute row delta from primary's effective (displayed) row to avoid issues with auto-layout sentinels
            const primaryRect = taskRectMap.get(ds.taskId);
            const primaryLaneTop = laneTopMap[ds.originalLaneKey] ?? 0;
            const effectivePrimaryOrigRow = primaryRect
              ? Math.round((primaryRect.y - primaryLaneTop - 4) / TASK_ROW_HEIGHT)
              : Math.max(0, ds.originalLaneY);
            const rowDelta = newLaneY - effectivePrimaryOrigRow;

            // Primary: lane + row
            const primNew: Partial<Task> = {};
            const primOrig: Partial<Task> = {};
            if (primaryLaneChanged) { primNew.assignee_id = newAssigneeId; primOrig.assignee_id = task.assignee_id; }
            if (rowChanged)         { primNew.lane_y = newLaneY;           primOrig.lane_y = task.lane_y; }
            if (Object.keys(primNew).length > 0) updSnaps.push({ id: ds.taskId, newData: primNew, origData: primOrig });

            // Co-tasks: sync lane and apply same row delta as primary
            for (const s of ds.coTaskSnapshots) {
              const ct = tasks.find((t) => t.id === s.taskId);
              if (!ct) continue;
              const coNew: Partial<Task> = {};
              const coOrig: Partial<Task> = {};
              if (dropLane && ct.assignee_id !== newAssigneeId) {
                coNew.assignee_id = newAssigneeId;
                coOrig.assignee_id = ct.assignee_id;
              }
              if (rowDelta !== 0) {
                const coRect = taskRectMap.get(s.taskId);
                const coLaneKey = ct.assignee_id != null ? `person-${ct.assignee_id}` : 'unassigned';
                const coLaneTop = laneTopMap[coLaneKey] ?? 0;
                const coEffectiveRow = coRect
                  ? Math.round((coRect.y - coLaneTop - 4) / TASK_ROW_HEIGHT)
                  : Math.max(0, s.originalLaneY);
                const coNewLaneY = Math.max(0, coEffectiveRow + rowDelta);
                if (coNewLaneY !== coEffectiveRow) {
                  coNew.lane_y = coNewLaneY;
                  coOrig.lane_y = s.originalLaneY;
                }
              }
              if (Object.keys(coNew).length > 0) updSnaps.push({ id: s.taskId, newData: coNew, origData: coOrig });
            }

            // Fire via mutation hooks (skipUndo=true) so cache + network handling is proven
            for (const m of moveSnaps) {
              if (m.newS !== m.origS || m.newE !== m.origE) {
                moveTask.mutate({ id: m.id, start_date: m.newS, end_date: m.newE, skipUndo: true });
              }
            }
            for (const u of updSnaps) {
              updateTask.mutate({ id: u.id, data: u.newData, skipUndo: true });
            }

            // Single undo/redo entry for the whole group (uses direct API + manual invalidate)
            useUndoStore.getState().push({
              label: `Move ${moveSnaps.length} tasks`,
              undo: async () => {
                await Promise.all([
                  ...moveSnaps.filter((m) => m.newS !== m.origS || m.newE !== m.origE).map((m) => api.moveTask(m.id, m.origS, m.origE)),
                  ...updSnaps.map((u) => api.updateTask(u.id, u.origData)),
                ]);
                invalidate();
              },
              redo: async () => {
                await Promise.all([
                  ...moveSnaps.filter((m) => m.newS !== m.origS || m.newE !== m.origE).map((m) => api.moveTask(m.id, m.newS, m.newE)),
                  ...updSnaps.map((u) => api.updateTask(u.id, u.newData)),
                ]);
                invalidate();
              },
            });
          } else {
            // ── Single-task move: use mutation hooks (each push their own undo) ─
            if (newStartStr !== task.start_date || newEndStr !== task.end_date) {
              moveTask.mutate({ id: ds.taskId, start_date: newStartStr, end_date: newEndStr });
            }
            const upd: Partial<Task> = {};
            if (laneChanged) upd.assignee_id = dropLane!.personId ?? null;
            if (rowChanged) upd.lane_y = newLaneY;
            if (Object.keys(upd).length > 0) updateTask.mutate({ id: ds.taskId, data: upd });
          }
        }
      } else if (ds.type === 'resize-right') {
        const newEnd = addDays(ds.originalEnd, deltaDays);
        if (newEnd > ds.originalStart) {
          moveTask.mutate({ id: ds.taskId, start_date: format(ds.originalStart, 'yyyy-MM-dd'), end_date: format(newEnd, 'yyyy-MM-dd') });
        }
      } else if (ds.type === 'resize-left') {
        const newStart = addDays(ds.originalStart, deltaDays);
        if (newStart < ds.originalEnd) {
          moveTask.mutate({ id: ds.taskId, start_date: format(newStart, 'yyyy-MM-dd'), end_date: format(ds.originalEnd, 'yyyy-MM-dd') });
        }
      }

      dragState.current = null;
    },
    [pxPerDay, addDependency, moveTask, updateTask, getNearestSnapRow, tasks, taskRectMap, dragOverLaneId, lanes, setPersonOrder, qc, laneTopMap]
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

  // Escape clears selection; Cmd+Backspace/Delete deletes selected tasks
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTaskIds(new Set());
        return;
      }
      const isDelete = e.key === 'Backspace' || e.key === 'Delete';
      if ((e.metaKey || e.ctrlKey) && isDelete) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        const sel = selectedTaskIdsRef.current;
        if (sel.size > 0) {
          sel.forEach((id) => deleteTask.mutate(id));
          setSelectedTaskIds(new Set());
          setSelectedTaskId(null);
        } else if (selectedTaskId) {
          deleteTask.mutate(selectedTaskId);
          setSelectedTaskId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTask, selectedTaskId, setSelectedTaskId]);

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
        className="flex items-center gap-1 px-3 border-b flex-shrink-0"
        style={{ height: 34, borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}
      >
        <span className="text-xs mr-1" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>Zoom</span>
        <button
          onClick={() => {
            if (!scrollRef.current) return;
            const half = scrollRef.current.clientWidth / 2;
            zoomToFactor(1 / 1.5, scrollRef.current.scrollLeft + half, half);
          }}
          className="btn-icon"
          title="Zoom out"
        >
          −
        </button>
        <span
          className="text-xs font-medium w-12 text-center"
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
          className="btn-icon"
          title="Zoom in"
        >
          +
        </button>
        <span className="text-xs ml-3" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
          {visibleTaskCount} tasks
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
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    selectBoxStart.current = { screenX: e.clientX, screenY: e.clientY };
                  }}
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
                    const laneY = previewLaneY?.get(task.id) ?? (task.lane_y !== 0 ? task.lane_y : computedLaneY(task, lane.tasks));
                    const barTop = laneY * TASK_ROW_HEIGHT + 4;
                    const color = projectColor(task.project_id, projects);

                    const isDragging = dragState.current?.taskId === task.id ||
                      (dragState.current?.coTaskSnapshots?.some((s) => s.taskId === task.id) ?? false);
                    const isDone = task.status === 'done';
                    const isSelected = selectedTaskIds.has(task.id);
                    const isHigh = task.priority === 3;
                    const isLow = task.priority === 1;

                    // Priority-based border (project color, style by priority)
                    const borderStyle = isLow ? 'dashed' : 'solid';
                    const priorityBorder = `1.5px ${borderStyle} ${color}B0`;
                    const priorityShadow = isHigh ? `0 0 0 1.5px ${URGENT_COLOR}, 0 0 8px 2px ${URGENT_COLOR}40` : 'none';

                    // Bar background: subtle project-color tint
                    const barBg = color + '18';

                    // Density → fill height from bottom (min 5%)
                    const fillPct = Math.max(5, task.density);

                    return (
                      <Fragment key={task.id}>
                        {/* Task bar */}
                        <div
                          onMouseEnter={(e) => setTooltip({ text: task.title, x: e.clientX, y: e.clientY - 32 })}
                          onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY - 32 } : null)}
                          onMouseLeave={() => setTooltip(null)}
                          style={{
                            position: 'absolute',
                            left: x,
                            top: barTop,
                            width: w,
                            height: TASK_HEIGHT,
                            backgroundColor: barBg,
                            border: priorityBorder,
                            borderRadius: task.type === 'milestone' ? '4px' : '6px',
                            cursor: 'grab',
                            userSelect: 'none',
                            zIndex: isDragging ? 15 : isSelected ? 8 : 6,
                            opacity: isDone ? 0.2 : isDragging ? 0.4 : 1,
                            outline: isSelected ? '2px solid var(--accent)' : 'none',
                            outlineOffset: '2px',
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                            boxShadow: priorityShadow,
                            transition: previewLaneY ? 'top 0.4s ease' : undefined,
                          }}
                          onMouseDown={(e) => handleTaskMouseDown(e, task, 'move', lane.id)}
                          onDoubleClick={(e) => { e.stopPropagation(); setSelectedTaskId(task.id); }}
                        >
                          {/* Density fill — rises from the bottom */}
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              height: `${fillPct}%`,
                              backgroundColor: color + '55',
                              pointerEvents: 'none',
                            }}
                          />

                          {/* Task title */}
                          <span
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 5,
                              right: 5,
                              bottom: 0,
                              display: 'flex',
                              alignItems: 'center',
                              fontSize: 11,
                              color: color,
                              fontWeight: isHigh ? 700 : 400,
                              opacity: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              zIndex: 2,
                              pointerEvents: 'none',
                              // Shadow uses bg-base so text stays readable over the fill in both light/dark themes
                              textShadow: '0 0 4px var(--bg-base), 0 0 4px var(--bg-base)',
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
                                left: 0,
                                width: `${task.progress}%`,
                                height: 2,
                                backgroundColor: color,
                                opacity: 0.8,
                                borderRadius: 1,
                                pointerEvents: 'none',
                                zIndex: 3,
                              }}
                            />
                          )}

                          <div
                            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 4 }}
                            onMouseDown={(e) => { e.stopPropagation(); handleTaskMouseDown(e, task, 'resize-left', lane.id); }}
                          />
                          <div
                            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 4 }}
                            onMouseDown={(e) => { e.stopPropagation(); handleTaskMouseDown(e, task, 'resize-right', lane.id); }}
                          />
                          <ConnectDot task={task} lane={lane} onMouseDown={handleTaskMouseDown} />
                        </div>

                        {/* Hard deadline I-bar — rendered as sibling so it escapes task overflow */}
                        {task.hard_deadline ? (
                          <div
                            style={{
                              position: 'absolute',
                              left: x + w - 1,
                              top: barTop - 7,
                              height: TASK_HEIGHT + 14,
                              width: 3,
                              backgroundColor: URGENT_COLOR,
                              pointerEvents: 'none',
                              zIndex: 20,
                              transition: previewLaneY ? 'top 0.4s ease' : undefined,
                            }}
                          >
                            {/* Top serif */}
                            <div style={{ position: 'absolute', top: 0, left: -5, right: -5, height: 3, backgroundColor: URGENT_COLOR }} />
                            {/* Bottom serif */}
                            <div style={{ position: 'absolute', bottom: 0, left: -5, right: -5, height: 3, backgroundColor: URGENT_COLOR }} />
                          </div>
                        ) : null}
                      </Fragment>
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

      {/* Drag overlays (fixed position, one per dragged task) */}
      {dragOverlays.map((ov) => (
        <div
          key={ov.taskId}
          style={{
            position: 'fixed',
            left: ov.x,
            top: ov.y,
            width: ov.width,
            height: TASK_HEIGHT,
            backgroundColor: ov.color + 'aa',
            border: `2px dashed ${ov.color}`,
            borderRadius: 4,
            pointerEvents: 'none',
            zIndex: 200,
          }}
        />
      ))}

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
      {tooltip && dragOverlays.length === 0 && (
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

      {/* Rubber-band selection box */}
      {selectBoxRect && selectBoxRect.w > 4 && selectBoxRect.h > 4 && (
        <div
          style={{
            position: 'fixed',
            left: selectBoxRect.x,
            top: selectBoxRect.y,
            width: selectBoxRect.w,
            height: selectBoxRect.h,
            border: '1px solid var(--accent)',
            backgroundColor: 'rgba(99,102,241,0.08)',
            pointerEvents: 'none',
            zIndex: 150,
          }}
        />
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
