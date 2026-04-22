## **Auto-Arrangement Algorithm ("Tetris" Packer)**

**Context & Trigger:**\
Implement a manual "Auto-Arrange" button that repacks all currently *visible* tasks. The algorithm must be completely deterministic so that pressing it twice without changing any data results in the exact same layout.

**Core Constraints:**

1. **Assignee Isolation:** The timeline is separated by assignee. The packing algorithm must run independently for each assignee's swim lane. Tasks never switch assignees during auto-arrangement.
2. **No Overlaps:** Within a single row, tasks cannot overlap in time.
3. **Deterministic:** All sorting and scoring must have explicit fallback tie-breakers (e.g., `start_date`, then `task_id`) so the layout is mathematically stable.

**Algorithm Architecture:**\
Use a two-phase greedy packer.

* **Phase 1 (Global Sort):** Decide the order in which tasks are placed ("largest/most important rocks first").
* **Phase 2 (Row Selection):** For each task, evaluate all valid rows and place it in the one with the highest "fit score".

***

## **Phase 1: Task Placement Order (Global Sort)**

Calculate a `PlacementPriorityScore` for every task in the lane, then sort descending. The goal is to place structural and urgent tasks first, so they get the best choice of rows.

Factors to include in the score (tune weights as appropriate for the data):

* **Urgency / Deadlines:** High bonus if the task is linked to a near-term hard milestone.
* **Priority:** High bonus for `Priority = High`, small penalty for `Priority = Low`.
* **Dependency Weight (Blocker):** Bonus based on the number of downstream dependents. Tasks that block others need to be placed first so dependents can route near them.
* **Duration / Size:** Slight bonus for longer duration tasks. It is mathematically easier to pack large blocks first and let short tasks fill the gaps. But make sure this doens't just place low-density long tasks at the top - as these should not get first attention. 

*Deterministic Tie-breaker:* If scores are equal, sort by `start_date` (earliest first), then by `task_duration` (longest first), then alphabetically by `task_id`.

***

## **Phase 2: Row Scoring & Placement**

Iterate through the sorted task list. For the current task, look at all existing rows in the lane (plus one new empty row at the bottom).

**Step 2A: Filter invalid rows**\
Instantly discard any row where the task's start/end dates overlap with a task already placed in that row.

**Step 2B: Score valid rows**\
Calculate a `RowFitScore` for each remaining valid row. The goal is to balance visibility, dependency routing, and visual grouping.

Factors for the row score (tune these weights):

* **Visibility (Top-heaviness):** Apply a penalty for moving further down the rows (Row 0 is better than Row 5). **Crucial:** Multiply this penalty by the task's Priority/Urgency. High-priority tasks strongly demand top rows; low-priority background tasks are fine floating at the bottom.
* **Dependency Proximity:** If the task has placed parents or children, apply a strong bonus if the candidate row is vertically close to them (e.g., `max(0, 3 - distance_to_parent_row)`). This keeps dependency arrows short and horizontal rather than creating long diagonal visual spaghetti.
* **Project Affinity:** Bonus if the candidate row contains, or is directly adjacent to, other tasks from the same Project. This naturally groups colors together without forcing a strict grouping.
* **Gap Minimization (Tetris Fit):** Bonus if the task starts very shortly after the previous task in that row ends. This creates tightly packed lines and reduces awkward floating gaps.

**Step 2C: Place the task**\
Place the task in the row with the highest `RowFitScore`.\
*Deterministic Tie-breaker:* If multiple rows have the same score, pick the lowest row index (closest to the top).

***

## **Post-Processing / Execution Notes**

* **State Update:** Calculate all positions in memory first, then dispatch a single bulk update to the UI/Database to avoid cascading re-renders.
* **Animation (Optional):** If the Gantt library supports it, let the bars animate to their new Y-positions so the user can visually track where their tasks moved.
* **Tuning:** Claude Code should implement the scoring factors as easily tunable constants or variables so they can be adjusted if the layout feels too fragmented or too strict.

<br />

\============================================

## **Auto-Arrangement Algorithm v2: Iterative Row Packer**

**Context & Trigger:**\
Implement a manual "Auto-Arrange" button that repacks all currently visible tasks. The algorithm must be completely deterministic, run independently per assignee lane, and prevent any time-overlaps within the same row.

**The Flaw in Single-Pass:**\
If we place tasks one by one, early tasks don't know where their dependencies or related project tasks will end up.\
**The Solution:** We use a multi-pass approach. Pass 1 gets everything legally on the board. Pass 2+ iteratively "relaxes" the board by letting tasks reconsider their row now that they can see where their neighbors landed.

## **Phase 1: Global Sort (The "Seed" Order)**

Determine the order we will process the tasks.\
Sort tasks primarily chronologically, so time flows naturally and parents are generally processed before children.

* **Sort Key 1:** `start_date` (Earliest first)
* **Sort Key 2:** Priority / Urgency (High first)
* **Sort Key 3:** Duration (Longest first)
* **Deterministic Tie-breaker:** `task_id` (Alphabetical/Numerical)

## **Phase 2: Initial Draft Placement**

Iterate through the sorted tasks and place them in the first available legal row (lowest row index where the task's start/end dates do not overlap with already placed tasks).\
*Goal:* Just get everything on the board legally. Do not worry about perfect grouping yet.

## **Phase 3: Iterative Refinement ("Relaxation Loop")**

This is where dependencies and affinities are resolved.\
Loop over the tasks (using the same order as Phase 1) and try to find a *better* row now that the rest of the board is populated.

**For loop iteration = 1 to MAX\_ITERATIONS (e.g., 3 or 4):**

1. Track `moves_made = 0`.
2. For each task:
   * Temporarily "remove" the task from its current row.
   * Find all valid rows for this task (no overlaps).
   * Calculate a `RowFitScore` for every valid row based on the *current* state of the board.
   * Place the task in the row with the best score.
   * If the best row is different from its old row, increment `moves_made`.
3. If `moves_made == 0`, break the loop early. The layout has settled into its mathematically optimal state.

**RowFitScore Factors for Phase 3 (Claude Code should tune these weights):**

* **The "Rubber Band" (Dependencies):** Huge penalty for vertical distance between this row and the rows of its *parents* and *children*. (e.g., `Penalty = abs(candidate_row - parent_row) + abs(candidate_row - child_row)`).
* **Project Affinity:** Bonus if the candidate row is adjacent to (or the same as) other tasks with the same Project ID.
* **Urgency/Priority Gravity:** Penalty for high-priority/urgent tasks being placed in higher-indexed (lower down) rows. They should float to the top.
* **Tetris Fit:** Small bonus if the task fits snugly against the task before or after it in the row, minimizing dead gaps.
* *Tie-breaker:* If scores tie, prefer the row closer to row 0 (top).

## **Phase 4: Final Compaction (Upward Gravity)**

The iterative relaxation might leave completely empty rows in the middle of the lane, or tasks that could slide up into gaps left by moving other tasks.

* Iterate through all tasks one last time (Earliest start date first).
* Look at all rows *above* the task's current row.
* If a higher row has space for the task without overlapping, move it up. (Do not recalculate the complex RowFitScore here, just pack them upwards to eliminate whitespace).

***

## **Why this addresses the problems:**

1. **The "Blind Spot" is fixed:** By Pass 2, when a task is looking for the best row, its dependencies are already on the board. The "Rubber Band" logic will physically pull dependent tasks into the same row or adjacent rows.
2. **Stable and Deterministic:** Because the iteration limit is hardcapped (e.g., 3 or 4 passes) and all scores use strict tie-breakers, the algorithm will never infinitely loop or produce different results on the same data.
3. **Graceful Degradation:** If the dependency graph is a tangled mess, the algorithm simply settles on the "least bad" arrangement of vertical distances rather than failing.
