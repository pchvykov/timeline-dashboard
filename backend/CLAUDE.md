# Timeline Dashboard — Agent Reference

## Database
Path resolved by env var DASHBOARD_DB_PATH (set in launch.command for personal_os).
Default (standalone): dashboard/tasks.db
personal_os integration: personal_os/tasks.db (one level above dashboard/)

WAL mode must be enabled on every connection:
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;

## Key Tables
- tasks: core task data (start_date, end_date, deadline, assignee_id, project_id, density, type)
  - type='task' for regular tasks, type='milestone' for check-in milestones
- projects: project definitions with colors
- people: team members with colors and avatars
- task_history: audit log — ALWAYS write here before modifying tasks
- task_dependencies: links between tasks (finish_to_start, etc.)

## Scheduling Rules (for agent)
- Respect `deadline` field as a hard constraint (do not schedule end_date after deadline)
- Respect `priority` (3=high, must be scheduled before priority 2 and 1)
- Respect `task_dependencies` — a task cannot start before its depends_on task ends (finish_to_start)
- `density` represents % capacity (100 = full attention, 5 = background task)
- When modifying tasks, always log to task_history with changed_by='agent'

## Dashboard
- Frontend runs on http://localhost:5173
- Backend API runs on http://localhost:8000
- API docs: http://localhost:8000/docs
- The dashboard auto-refreshes every 10 seconds (polling) and will show agent changes live
