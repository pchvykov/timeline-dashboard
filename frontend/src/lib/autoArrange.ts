import { addDays, subDays } from 'date-fns';
import type { Task } from './api';

// ── Tunable weights ──────────────────────────────────────────────────────────
//
// Zone structure comes from Phase 1 seed ORDER, not from per-row gravity scores.
// Gravity scores (penalty/bonus per row index) were removed because they drove
// tasks to extreme rows and left empty gaps in the middle. Instead, low-density /
// low-priority tasks seed first and claim top rows in Phase 2's greedy placement.
// High-priority tasks seed last and land below them. Phase 3 only refines
// dependency routing and project grouping — it never introduces gravity-induced gaps.
//
const W = {
  // ── Zone separation (Phase 1 seed order) ───────────────────────────────────

  // Controls how strongly *priority* pushes a task toward the bottom zone.
  // Seed score = ZONE_WEIGHT_PRIORITY × priority_norm + ZONE_WEIGHT_DENSITY × density_norm
  //            + normalised_start_date.
  // Low seed score → seeds first → top rows.  High seed score → seeds last → bottom rows.
  // Set to 0 to remove priority from zone placement (zone driven by density only).
  ZONE_WEIGHT_PRIORITY: 2,

  // Controls how strongly *density* pushes a task toward the bottom zone.
  // Kept higher than ZONE_WEIGHT_PRIORITY so high-density tasks (active, intensive work)
  // sink more reliably to the bottom even when their priority rating is moderate.
  // Set to 0 to remove density from zone placement (zone driven by priority only).
  ZONE_WEIGHT_DENSITY: 2,

  // Within tasks of similar zone score, longer tasks seed first so shorter tasks can
  // fill gaps around them ("big rocks first"). Applies as: log(1 + duration_days) × this.
  // Set to 0 to ignore duration in seed ordering.
  // Keep low (< 0.3) — large values let bulky low-priority tasks jump ahead of urgent ones.
  DURATION_SORT_WEIGHT: 0.5,

  // ── Phase 3 refinement scoring ─────────────────────────────────────────────

  // Pulls a task toward the row of its *parent* (the task it depends on).
  // Increase → dependency arrows become shorter / more horizontal; blockers and
  // dependents cluster on adjacent rows. Very high values can break zone structure.
  RUBBER_BAND_PARENT: 25,

  // Same pull toward *child* tasks (tasks that depend on this one).
  // Kept lower than PARENT so parents anchor first, children route around them.
  RUBBER_BAND_CHILD: 15,

  // Bonus for landing on a row that already contains another task from the same project.
  // Increase → stronger same-row colour grouping. Decrease → projects spread across rows.
  PROJECT_AFFINITY_SAME_ROW: 9,

  // Bonus for landing one row above or below another same-project task.
  // Works with SAME_ROW to create 2-3 row colour bands. Increase to widen bands.
  PROJECT_AFFINITY_ADJACENT: 6,

  // Bonus when a task's start date falls within TETRIS_GAP_DAYS of where another task
  // ends in the same row — rewards snug temporal fits.
  // Set to 0 for more breathing room between tasks.
  // Set negative to actively spread tasks apart (anti-clustering).
  TETRIS_FIT: 1,

  // Maximum gap in days that still earns the TETRIS_FIT bonus.
  // Decrease (e.g. 3) → only tightly adjacent tasks pack together; more whitespace overall.
  // Increase → tasks pack even across moderate gaps.
  TETRIS_GAP_DAYS: 7,

  // Number of refinement passes in Phase 3. More passes → better dependency / affinity
  // grouping but slower. 3–4 is the sweet spot; returns diminish sharply beyond 5.
  MAX_ITERATIONS: 4,
};

interface DateRange { start: Date; end: Date }

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

interface Placed { taskId: number; start: Date; end: Date; projectId: number | null }
type Board = Map<number, Placed[]>;

function overlaps(a: DateRange, b: Placed): boolean {
  return a.start < b.end && a.end > b.start;
}

function isRowValid(board: Board, row: number, dates: DateRange, excludeId: number): boolean {
  return !(board.get(row) ?? []).filter(t => t.taskId !== excludeId).some(t => overlaps(dates, t));
}

function getValidRows(board: Board, dates: DateRange, excludeId: number): number[] {
  const maxRow = board.size === 0 ? -1 : Math.max(...Array.from(board.keys()));
  const result: number[] = [];
  for (let r = 0; r <= maxRow + 1; r++) {
    if (isRowValid(board, r, dates, excludeId)) result.push(r);
  }
  if (!result.includes(maxRow + 1)) result.push(maxRow + 1);
  return result;
}

function rowFitScore(
  board: Board,
  row: number,
  task: Task,
  dates: DateRange,
  taskRowMap: Map<number, number>,
  parentIds: number[],
  childIds: number[],
): number {
  let score = 0;

  // Rubber band: dependencies pull toward parent/child rows
  for (const pid of parentIds) {
    const pr = taskRowMap.get(pid);
    if (pr !== undefined) score -= Math.abs(row - pr) * W.RUBBER_BAND_PARENT;
  }
  for (const cid of childIds) {
    const cr = taskRowMap.get(cid);
    if (cr !== undefined) score -= Math.abs(row - cr) * W.RUBBER_BAND_CHILD;
  }

  // Project affinity: group same-project tasks together
  if (task.project_id !== null) {
    const rowTasks = board.get(row) ?? [];
    if (rowTasks.some(t => t.projectId === task.project_id)) {
      score += W.PROJECT_AFFINITY_SAME_ROW;
    }
    for (const adj of [row - 1, row + 1]) {
      if ((board.get(adj) ?? []).some(t => t.projectId === task.project_id)) {
        score += W.PROJECT_AFFINITY_ADJACENT;
      }
    }
  }

  // Tetris fit: bonus for starting shortly after something ends in this row
  const gapThresh = W.TETRIS_GAP_DAYS * 86400000;
  const rowTasks = board.get(row) ?? [];
  const hasTightFit = rowTasks.some(t => {
    const gap = dates.start.getTime() - t.end.getTime();
    return gap >= 0 && gap <= gapThresh;
  });
  if (hasTightFit) score += W.TETRIS_FIT;

  return score;
}

function placeTask(board: Board, task: Task, row: number, dates: DateRange): void {
  if (!board.has(row)) board.set(row, []);
  board.get(row)!.push({ taskId: task.id, start: dates.start, end: dates.end, projectId: task.project_id });
}

function removeTask(board: Board, taskId: number): void {
  for (const [row, tasks] of Array.from(board.entries())) {
    const idx = tasks.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      tasks.splice(idx, 1);
      if (tasks.length === 0) board.delete(row);
      return;
    }
  }
}

function pickBestRow(
  validRows: number[],
  board: Board,
  task: Task,
  dates: DateRange,
  taskRowMap: Map<number, number>,
  parentIds: number[],
  childIds: number[],
): number {
  let best = validRows[0];
  let bestScore = -Infinity;
  for (const r of validRows) {
    const s = rowFitScore(board, r, task, dates, taskRowMap, parentIds, childIds);
    if (s > bestScore || (s === bestScore && r < best)) { best = r; bestScore = s; }
  }
  return best;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes new lane_y assignments for all tasks in a single swim lane.
 * Pure function — no side effects, fully deterministic.
 */
export function computeAutoArrange(
  laneTasks: Task[],
  allTasks: Task[],
): Map<number, number> {
  const result = new Map<number, number>();

  // Build parent/child dependency maps
  const childrenOf = new Map<number, number[]>();
  const parentsOf = new Map<number, number[]>();
  for (const task of allTasks) {
    for (const dep of task.dependencies ?? []) {
      if (!childrenOf.has(dep.depends_on_id)) childrenOf.set(dep.depends_on_id, []);
      childrenOf.get(dep.depends_on_id)!.push(task.id);
      if (!parentsOf.has(task.id)) parentsOf.set(task.id, []);
      parentsOf.get(task.id)!.push(dep.depends_on_id);
    }
  }

  const placeable = laneTasks.filter(t => getDisplayDates(t) !== null);
  if (placeable.length === 0) return result;

  // Phase 1: Seed-order sort.
  //
  // seed_score = ZONE_WEIGHT × (priority_norm + density_norm) + normalised_start_date
  //
  // Low score → seeds first → Phase 2 places them in top rows.
  // High score → seeds last → placed in rows below the earlier tasks.
  //
  // This is the sole mechanism that creates the "top = background / bottom = urgent" zones.
  // No per-row gravity is used anywhere in Phase 3 — gravity causes gaps.
  const starts = placeable.map(t => getDisplayDates(t)!.start.getTime());
  const minStart = Math.min(...starts);
  const startRange = Math.max(...starts) - minStart || 1;

  const seedScore = (task: Task, dates: DateRange): number => {
    const priorityNorm = (task.priority ?? 3) / 5;
    const densityNorm  = (task.density  ?? 50) / 100;
    const startNorm    = (dates.start.getTime() - minStart) / startRange;
    const durationDays = (dates.end.getTime() - dates.start.getTime()) / 86400000;
    // Duration is a negative term: longer tasks get a lower seed score and seed earlier,
    // so shorter tasks can fill gaps around them. Kept small so it doesn't override zone order.
    const durationBonus = Math.log(1 + durationDays) * W.DURATION_SORT_WEIGHT;
    return W.ZONE_WEIGHT_PRIORITY * priorityNorm + W.ZONE_WEIGHT_DENSITY * densityNorm + startNorm - durationBonus;
  };

  const sorted = Array.from(placeable).sort((a, b) => {
    const aD = getDisplayDates(a)!;
    const bD = getDisplayDates(b)!;
    const diff = seedScore(a, aD) - seedScore(b, bD);
    if (Math.abs(diff) > 0.001) return diff;
    return a.id - b.id; // deterministic tie-breaker
  });

  // Phase 2: Initial Draft Placement — first legal row, no scoring.
  // Tasks arrive in zone order so greedy placement naturally stacks zones vertically.
  const board: Board = new Map();
  const taskRowMap = new Map<number, number>();

  for (const task of sorted) {
    const dates = getDisplayDates(task)!;
    const maxRow = board.size === 0 ? -1 : Math.max(...Array.from(board.keys()));
    let row = 0;
    while (row <= maxRow && !isRowValid(board, row, dates, task.id)) row++;
    placeTask(board, task, row, dates);
    taskRowMap.set(task.id, row);
  }

  // Phase 3: Iterative Refinement — dependency routing and project affinity only.
  // No gravity here: absolute row preferences create gaps. The zone structure from
  // Phase 1 is preserved because Phase 3's only incentives (rubber-band, affinity,
  // tetris) produce small, local moves rather than large jumps to extreme rows.
  for (let iter = 0; iter < W.MAX_ITERATIONS; iter++) {
    let movesMade = 0;
    for (const task of sorted) {
      const dates = getDisplayDates(task)!;
      const currentRow = taskRowMap.get(task.id)!;
      const parentIds = parentsOf.get(task.id) ?? [];
      const childIds = childrenOf.get(task.id) ?? [];

      removeTask(board, task.id);
      const validRows = getValidRows(board, dates, task.id);
      const newRow = pickBestRow(validRows, board, task, dates, taskRowMap, parentIds, childIds);
      placeTask(board, task, newRow, dates);
      taskRowMap.set(task.id, newRow);
      if (newRow !== currentRow) movesMade++;
    }
    if (movesMade === 0) break;
  }

  // Phase 4 (upward gravity) is intentionally omitted.
  // It would drag high-priority tasks back up from the bottom zone into the gaps
  // left by low-density tasks, destroying the zone structure.

  for (const task of sorted) {
    result.set(task.id, taskRowMap.get(task.id) ?? 0);
  }
  return result;
}
