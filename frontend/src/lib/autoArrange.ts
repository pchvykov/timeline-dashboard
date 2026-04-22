import { addDays, subDays } from 'date-fns';
import type { Task } from './api';

// ── Tunable weights ──────────────────────────────────────────────────────────
const W = {
  // Pulls a task toward the row of its *parent* (the task it depends on).
  // Increase → dependency arrows become shorter/more horizontal; blockers and their
  // dependents cluster tightly. Very high values can override priority gravity.
  RUBBER_BAND_PARENT: 25,

  // Same pull, but toward *child* tasks (tasks that depend on this one).
  // Kept lower than PARENT so parents anchor first, children route around them.
  RUBBER_BAND_CHILD: 15,

  // Bonus for landing on a row that already contains another task from the same project.
  // Increase → stronger same-row color grouping. Decrease → projects spread across rows.
  PROJECT_AFFINITY_SAME_ROW: 9,

  // Bonus for landing one row above or below another same-project task.
  // Works with SAME_ROW to create 2-3 row color bands. Increase to widen bands.
  PROJECT_AFFINITY_ADJACENT: 6,

  // Penalty = row_index × normalised_priority (0–1). High-priority tasks float to row 0;
  // low-priority tasks are indifferent to where they sit.
  // Increase → top rows are more exclusively reserved for urgent work.
  // Decrease → tasks distribute more evenly regardless of priority.
  URGENCY_GRAVITY: 4,

  // Bonus when a task's start date falls within TETRIS_GAP_DAYS of where another task
  // ends in the same row — rewards snug temporal fits.
  // Set to 0 for more breathing room between tasks.
  // Set negative to actively spread tasks apart (anti-clustering).
  TETRIS_FIT: 1,

  // Maximum gap in days that still earns the TETRIS_FIT bonus.
  // Decrease (e.g. 3) → only tightly adjacent tasks pack together; more whitespace overall.
  // Increase → tasks pack even across moderate gaps.
  TETRIS_GAP_DAYS: 7,

  // Bonus = row_index × (1 − density). A low-density task (background work, slow-burn
  // research) gets a larger bonus for sitting in *lower* rows, keeping top rows free for
  // high-density, high-priority tasks.
  // Increase → stronger separation between active and background work.
  // Set to 0 to ignore density when choosing rows.
  DENSITY_GRAVITY: 4,

  // Controls how much density-adjusted duration influences the Phase 1 seeding order.
  // Formula: combined_score = priority_norm + log(1+duration_days) × density_norm × this.
  // At 0: duration is ignored; tasks seed purely by start_date then priority.
  // Increase (e.g. 0.3): longer, high-density tasks seed first so short tasks fill gaps.
  // Keep low (< 0.3) to prevent long low-density tasks from crowding out high-priority ones.
  DURATION_SORT_WEIGHT: 0.15,

  // Number of refinement passes in Phase 3. More passes → better dependency/affinity
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
  const priorityNorm = Math.max(0, Math.min(1, (task.priority ?? 3) / 5));
  const densityNorm  = Math.max(0, Math.min(1, (task.density  ?? 50) / 100));

  // High-priority tasks prefer top rows; low-priority are indifferent
  score -= row * priorityNorm * W.URGENCY_GRAVITY;

  // Low-density tasks prefer lower rows, freeing top rows for active work
  score += row * (1 - densityNorm) * W.DENSITY_GRAVITY;

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

  // Phase 1: Global Sort — chronological first, then density-adjusted combined score desc,
  // then id as a deterministic tie-breaker.
  // Duration is weighted by density so long low-density tasks don't crowd out urgent work.
  const sorted = Array.from(placeable).sort((a, b) => {
    const aD = getDisplayDates(a)!;
    const bD = getDisplayDates(b)!;
    const startDiff = aD.start.getTime() - bD.start.getTime();
    if (startDiff !== 0) return startDiff;

    const aPri  = (a.priority ?? 3) / 5;
    const bPri  = (b.priority ?? 3) / 5;
    const aDens = (a.density  ?? 50) / 100;
    const bDens = (b.density  ?? 50) / 100;
    const aDurDays = (aD.end.getTime() - aD.start.getTime()) / 86400000;
    const bDurDays = (bD.end.getTime() - bD.start.getTime()) / 86400000;
    const aScore = aPri + Math.log(1 + aDurDays) * aDens * W.DURATION_SORT_WEIGHT;
    const bScore = bPri + Math.log(1 + bDurDays) * bDens * W.DURATION_SORT_WEIGHT;
    const scoreDiff = bScore - aScore;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    return a.id - b.id;
  });

  // Phase 2: Initial Draft Placement — first legal row, no scoring
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

  // Phase 3: Iterative Refinement — relax with dependency/affinity/density scoring
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

  // Phase 4: Final Compaction — upward gravity, no scoring.
  // Low-density tasks are skipped: their position was deliberately chosen by Phase 3's
  // DENSITY_GRAVITY and compacting them upward would undo that.
  const COMPACT_DENSITY_THRESHOLD = 30;
  const compactOrder = [...sorted].sort((a, b) =>
    getDisplayDates(a)!.start.getTime() - getDisplayDates(b)!.start.getTime()
  );
  for (const task of compactOrder) {
    if ((task.density ?? 50) < COMPACT_DENSITY_THRESHOLD) continue;
    const dates = getDisplayDates(task)!;
    const currentRow = taskRowMap.get(task.id)!;
    removeTask(board, task.id);
    let bestUp = currentRow;
    for (let r = 0; r < currentRow; r++) {
      if (isRowValid(board, r, dates, task.id)) { bestUp = r; break; }
    }
    placeTask(board, task, bestUp, dates);
    taskRowMap.set(task.id, bestUp);
  }

  for (const task of sorted) {
    result.set(task.id, taskRowMap.get(task.id) ?? 0);
  }
  return result;
}
