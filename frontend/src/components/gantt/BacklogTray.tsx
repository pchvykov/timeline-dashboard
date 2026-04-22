import { useRef, useMemo, useEffect, type RefObject, type MouseEvent as ReactMouseEvent } from 'react';
import type { Task, Project } from '../../lib/api';
import { useUIStore } from '../../store/uiStore';

// ── Constants (mirrors CustomGantt) ─────────────────────────────────────────
export const CARD_WIDTH = 52;
const CARD_COL_WIDTH = 60;    // card + gap
const TASK_HEIGHT = 28;
const TASK_ROW_HEIGHT = 36;
const DATE_HEADER_HEIGHT = 64;
const DEFAULT_LANE_HEIGHT = 120;
const URGENT_COLOR = '#FFDDDD';

// ── Types ────────────────────────────────────────────────────────────────────
export interface TrayLane {
  id: string;
  label: string;
  color?: string;
  personId?: number | null;
}

export interface BacklogTrayProps {
  allTasks: Task[];
  backlogTasks: Task[];
  projects: Project[];
  lanes: TrayLane[];
  laneHeightMap: Record<string, number>;
  laneTopMap: Record<string, number>;
  /** Called when user starts dragging a tray card into the timeline */
  onBacklogDragStart: (taskId: number, e: ReactMouseEvent) => void;
  /** The gantt scroll container, used for vertical scroll sync */
  ganttScrollRef: RefObject<HTMLDivElement | null>;
  /** Lane to highlight as drop target (set by parent during drag) */
  dropHighlightLaneId?: string | null;
  /** Outer container ref so parent can check if cursor is over the tray */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** Mirror the Gantt tooltip — called on card hover */
  onTooltip?: (tip: { text: string; x: number; y: number } | null) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function projectColor(projectId: number | null, projects: Project[]): string {
  if (!projectId) return '#6b7280';
  return projects.find((p) => p.id === projectId)?.color ?? '#6b7280';
}

/** Compute topological depth + row for each task based on dependency graph. */
function computeTopoPositions(
  tasks: Task[],
): Map<number, { col: number; row: number }> {
  if (tasks.length === 0) return new Map();

  const taskIds = new Set(tasks.map((t) => t.id));

  // Build parent map restricted to tasks within this lane
  const parentsOf = new Map<number, number[]>();
  for (const task of tasks) {
    const inLaneParents = (task.dependencies ?? [])
      .map((d) => d.depends_on_id)
      .filter((id) => taskIds.has(id));
    parentsOf.set(task.id, inLaneParents);
  }

  // Iterative longest-path depth (handles cycles safely — just cap at tasks.length iterations)
  const depth = new Map<number, number>();
  for (const task of tasks) depth.set(task.id, 0);

  for (let pass = 0; pass < tasks.length; pass++) {
    let changed = false;
    for (const task of tasks) {
      const parents = parentsOf.get(task.id) ?? [];
      if (parents.length === 0) continue;
      const maxParentDepth = Math.max(...parents.map((id) => depth.get(id) ?? 0));
      const newDepth = maxParentDepth + 1;
      if ((depth.get(task.id) ?? 0) < newDepth) {
        depth.set(task.id, newDepth);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group by depth, sort within column using same zone logic as autoArrange:
  // low score (low priority + low density) → top rows, high score → bottom rows.
  const byDepth = new Map<number, Task[]>();
  for (const task of tasks) {
    const d = depth.get(task.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(task);
  }

  const zoneScore = (t: Task) =>
    2 * ((t.priority ?? 2) / 5) + 2 * ((t.density ?? 50) / 100);

  const positions = new Map<number, { col: number; row: number }>();
  for (const [col, colTasks] of Array.from(byDepth.entries())) {
    colTasks
      .sort((a, b) => zoneScore(a) - zoneScore(b) || a.id - b.id)
      .forEach((task, row) => {
        positions.set(task.id, { col, row });
      });
  }

  return positions;
}

// ── BezierArrow (tray-local, no delete button needed here) ───────────────────
function TrayArrow({ sx, sy, tx, ty }: { sx: number; sy: number; tx: number; ty: number }) {
  const arrowSize = 5;
  const dx = tx - sx;
  const cx1 = sx + Math.max(20, dx * 0.4);
  const cy1 = sy;
  const cx2 = tx - Math.max(20, dx * 0.4);
  const cy2 = ty;

  // Arrowhead direction from last bezier tangent
  const headDx = tx - cx2;
  const headDy = ty - cy2;
  const len = Math.sqrt(headDx * headDx + headDy * headDy) || 1;
  const ux = headDx / len;
  const uy = headDy / len;
  const px = -uy;
  const py = ux;

  return (
    <g pointerEvents="none">
      <path
        d={`M ${sx} ${sy} C ${cx1} ${cy1} ${cx2} ${cy2} ${tx} ${ty}`}
        stroke="var(--text-muted)"
        strokeWidth={1.5}
        fill="none"
        strokeOpacity={0.5}
      />
      <polygon
        points={`${tx},${ty} ${tx - ux * arrowSize + px * (arrowSize / 2)},${ty - uy * arrowSize + py * (arrowSize / 2)} ${tx - ux * arrowSize - px * (arrowSize / 2)},${ty - uy * arrowSize - py * (arrowSize / 2)}`}
        fill="var(--text-muted)"
        fillOpacity={0.5}
      />
    </g>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function BacklogTray({
  allTasks: _allTasks,
  backlogTasks,
  projects,
  lanes,
  laneHeightMap,
  laneTopMap,
  onBacklogDragStart,
  ganttScrollRef,
  dropHighlightLaneId = null,
  containerRef,
  onTooltip,
}: BacklogTrayProps) {
  const { trayOpen, toggleTray, trayWidth, setTrayWidth } = useUIStore();
  const trayScrollRef = useRef<HTMLDivElement>(null);
  const resizeDrag = useRef<{ startX: number; startWidth: number } | null>(null);

  // ── Scroll sync with Gantt ───────────────────────────────────────────────
  useEffect(() => {
    const gantt = ganttScrollRef.current;
    if (!gantt) return;
    const onScroll = () => {
      if (trayScrollRef.current) {
        trayScrollRef.current.scrollTop = gantt.scrollTop;
      }
    };
    gantt.addEventListener('scroll', onScroll, { passive: true });
    return () => gantt.removeEventListener('scroll', onScroll);
  }, [ganttScrollRef]);

  // ── Tray resize ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeDrag.current) return;
      const dx = e.clientX - resizeDrag.current.startX;
      setTrayWidth(resizeDrag.current.startWidth + dx);
    };
    const onUp = () => { resizeDrag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setTrayWidth]);

  // ── Group backlog tasks by lane ──────────────────────────────────────────
  const laneTasksMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const lane of lanes) {
      if (lane.id === 'milestones') {
        map.set(lane.id, []);
      } else if (lane.personId != null) {
        map.set(lane.id, backlogTasks.filter((t) => t.assignee_id === lane.personId));
      } else if (lane.id === 'unassigned') {
        map.set(lane.id, backlogTasks.filter((t) => !t.assignee_id));
      } else {
        map.set(lane.id, []);
      }
    }
    return map;
  }, [lanes, backlogTasks]);

  // ── Topo layout per lane ─────────────────────────────────────────────────
  const topoLayoutMap = useMemo(() => {
    const map = new Map<string, Map<number, { col: number; row: number }>>();
    for (const [laneId, laneTasks] of Array.from(laneTasksMap.entries())) {
      map.set(laneId, computeTopoPositions(laneTasks));
    }
    return map;
  }, [laneTasksMap]);

  // ── Card rect map (coords within tray scroll content, y starts at 0) ───────
  // laneTopMap uses DATE_HEADER_HEIGHT offset (matches Gantt); we subtract it
  // here so tray content y=0 aligns with the first lane when scrollTop=0.
  const cardRectMap = useMemo(() => {
    const map = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const lane of lanes) {
      const laneTop = (laneTopMap[lane.id] ?? 0) - DATE_HEADER_HEIGHT;
      const laneTasks = laneTasksMap.get(lane.id) ?? [];
      const positions = topoLayoutMap.get(lane.id) ?? new Map();
      for (const task of laneTasks) {
        const pos = positions.get(task.id);
        if (!pos) continue;
        map.set(task.id, {
          x: pos.col * CARD_COL_WIDTH + 4,
          y: laneTop + pos.row * TASK_ROW_HEIGHT + 4,
          w: CARD_WIDTH,
          h: TASK_HEIGHT,
        });
      }
    }
    return map;
  }, [lanes, laneTopMap, laneTasksMap, topoLayoutMap]);

  // ── Dependency arrows ────────────────────────────────────────────────────
  const depArrows = useMemo(() => {
    const arrows: { depId: number; sx: number; sy: number; tx: number; ty: number }[] = [];
    const backlogIds = new Set(backlogTasks.map((t) => t.id));
    for (const task of backlogTasks) {
      for (const dep of task.dependencies ?? []) {
        if (!backlogIds.has(dep.depends_on_id)) continue;
        const srcRect = cardRectMap.get(dep.depends_on_id);
        const tgtRect = cardRectMap.get(task.id);
        if (!srcRect || !tgtRect) continue;
        arrows.push({
          depId: dep.id,
          sx: srcRect.x + srcRect.w,
          sy: srcRect.y + srcRect.h / 2,
          tx: tgtRect.x,
          ty: tgtRect.y + tgtRect.h / 2,
        });
      }
    }
    return arrows;
  }, [backlogTasks, cardRectMap]);

  // ── Total content height (sum of lane heights, no header offset) ────────
  // Tray scroll area starts right after the fixed header, so we don't add
  // DATE_HEADER_HEIGHT here (unlike Gantt which has sticky header inside scroll).
  const totalContentHeight = useMemo(
    () => lanes.reduce((acc, lane) => acc + (laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT), 0),
    [lanes, laneHeightMap],
  );

  // ── Collapsed state ──────────────────────────────────────────────────────
  if (!trayOpen) {
    return (
      <div
        ref={containerRef}
        style={{
          width: 24,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          backgroundColor: 'var(--bg-elevated)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={toggleTray}
        title="Open Backlog Tray"
      >
        <div
          style={{
            height: DATE_HEADER_HEIGHT,
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: 'var(--text-muted)',
              letterSpacing: '0.1em',
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
            }}
          >
            BKG
          </span>
        </div>
      </div>
    );
  }

  // ── Expanded tray ────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        width: trayWidth,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--border)',
        backgroundColor: 'var(--bg-base)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Header — aligns with Gantt date header */}
      <div
        style={{
          height: DATE_HEADER_HEIGHT,
          flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 10,
          paddingRight: 6,
          boxSizing: 'border-box',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Backlog
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.6, marginTop: 1 }}>
            {backlogTasks.length} task{backlogTasks.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={toggleTray}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            fontSize: 14,
            lineHeight: 1,
            padding: '2px 4px',
            borderRadius: 3,
            opacity: 0.6,
          }}
          title="Collapse tray"
        >
          ‹
        </button>
      </div>

      {/* Scrollable lane content — synced with Gantt vertical scroll */}
      <div
        ref={trayScrollRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Inner content: height = sum of lane heights, y=0 = first lane top */}
        <div
          style={{
            position: 'relative',
            height: totalContentHeight,
            width: '100%',
          }}
        >
          {/* SVG overlay for dependency arrows */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 8,
              overflow: 'visible',
            }}
          >
            {depArrows.map((arr) => (
              <TrayArrow
                key={arr.depId}
                sx={arr.sx}
                sy={arr.sy}
                tx={arr.tx}
                ty={arr.ty}
              />
            ))}
          </svg>

          {/* Lane bands — positioned at laneTopMap offset minus header so y=0 aligns with scroll top */}
          {lanes.map((lane) => {
            const laneTop = (laneTopMap[lane.id] ?? 0) - DATE_HEADER_HEIGHT;
            const laneHeight = laneHeightMap[lane.id] ?? DEFAULT_LANE_HEIGHT;
            const laneTasks = laneTasksMap.get(lane.id) ?? [];
            const positions = topoLayoutMap.get(lane.id) ?? new Map();
            const isDropTarget = dropHighlightLaneId === lane.id;

            return (
              <div
                key={lane.id}
                style={{
                  position: 'absolute',
                  top: laneTop,
                  left: 0,
                  right: 0,
                  height: laneHeight,
                  borderBottom: '1px solid var(--border)',
                  boxSizing: 'border-box',
                  borderTop: isDropTarget ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {/* Task cards */}
                {laneTasks.map((task) => {
                  const pos = positions.get(task.id);
                  if (!pos) return null;

                  const color = projectColor(task.project_id, projects);
                  const isHigh = task.priority === 3;
                  const isLow = task.priority === 1;
                  const fillPct = Math.max(5, task.density ?? 100);
                  const barBg = color + '18';
                  const borderStyle = isLow ? 'dashed' : 'solid';
                  const priorityBorder = `1.5px ${borderStyle} ${color}B0`;
                  const priorityShadow = isHigh
                    ? `0 0 0 1.5px ${URGENT_COLOR}, 0 0 8px 2px ${URGENT_COLOR}40`
                    : 'none';

                  return (
                    <div
                      key={task.id}
                      onMouseEnter={(e) => onTooltip?.({ text: task.title, x: e.clientX, y: e.clientY - 32 })}
                      onMouseMove={(e) => onTooltip?.({ text: task.title, x: e.clientX, y: e.clientY - 32 })}
                      onMouseLeave={() => onTooltip?.(null)}
                      style={{
                        position: 'absolute',
                        left: pos.col * CARD_COL_WIDTH + 4,
                        top: pos.row * TASK_ROW_HEIGHT + 4,
                        width: CARD_WIDTH,
                        height: TASK_HEIGHT,
                        backgroundColor: barBg,
                        border: priorityBorder,
                        borderRadius: 6,
                        cursor: 'grab',
                        userSelect: 'none',
                        zIndex: 6,
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        boxShadow: priorityShadow,
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        onBacklogDragStart(task.id, e);
                      }}
                    >
                      {/* Density fill */}
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
                      {/* Title — ~5 chars visible */}
                      <span
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 4,
                          right: 2,
                          bottom: 0,
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: 10,
                          color,
                          fontWeight: isHigh ? 700 : 400,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                          textShadow: '0 0 4px var(--bg-base), 0 0 4px var(--bg-base)',
                          zIndex: 2,
                        }}
                      >
                        {task.title}
                      </span>
                      {/* Progress bar */}
                      {(task.progress ?? 0) > 0 && (
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
                    </div>
                  );
                })}

                {/* Empty lane placeholder */}
                {laneTasks.length === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--text-muted)',
                        opacity: 0.25,
                        userSelect: 'none',
                      }}
                    >
                      drop here
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Resize handle (right edge) */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: 'col-resize',
          zIndex: 20,
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          resizeDrag.current = { startX: e.clientX, startWidth: trayWidth };
        }}
      />
    </div>
  );
}
