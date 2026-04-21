---
type: evergreen
created: 2026-04-03
project: null
tags: []
---

# Timeline Dashboard

A self-hosted personal project timeline — swim-lane Gantt chart with a FastAPI backend and React frontend, backed by SQLite.

## Features

**Gantt / timeline**
- Swim-lane Gantt grouped by assignee; drag to move, resize, and reassign tasks across lanes
- Dependency arrows between tasks (drag from right edge to connect; click arrow to delete)
- Done tasks remain on the timeline with muted/dashed styling
- Continuous zoom via trackpad pinch or Ctrl+scroll, anchored to cursor position
- Lane height resizable by dragging the bottom edge of each lane header

**Task editing**
- Right-side detail panel: title, description, status, priority, dates, density/progress sliders, notes, checklist
- Markdown checklists (`- [ ] item`) in the description field are auto-migrated to the UI checklist on first open
- Panel width is draggable (left edge handle) and persisted across sessions

**Undo / redo**
- Global undo/redo stack (Cmd+Z / Cmd+Shift+Z) tracks every DB change: edits, moves, resizes, creates, deletes, dependency changes
- Undo/Redo buttons in the top bar show the action label on hover

**Sidebar**
- Filter timeline by project and/or person (checkboxes)
- Drag to reorder lanes
- **Projects:** inline rename (double-click), color picker, archive/unarchive, create new (+)
- **People:** inline rename (double-click), color picker, delete, create new (+)

**Persistence**
- Zoom level, sidebar filters, lane order, lane heights, panel width — all persisted to localStorage
- Dark mode toggle, persisted

## Quick start

**Requirements:** Python 3.10+, Node 18+

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/timeline-dashboard
cd timeline-dashboard

# 2. Backend deps
cd backend && python3 -m venv venv && venv/bin/pip install -r requirements.txt && cd ..

# 3. Frontend deps
cd frontend && npm install && cd ..

# 4. Seed demo data (creates tasks.db)
python3 scripts/seed_demo_data.py

# 5. Launch
chmod +x launch.command && ./launch.command
```

Open http://localhost:5173. API docs at http://localhost:8000/docs.

## Seeding demo data

```bash
python3 scripts/seed_demo_data.py          # first run
python3 scripts/seed_demo_data.py --reset  # wipe and re-seed
```

## External database

By default the backend creates `tasks.db` inside the dashboard folder. To point it elsewhere:

```bash
export DASHBOARD_DB_PATH=/path/to/your/tasks.db
./launch.command
```

Or set it in `backend/.env`:
```
DASHBOARD_DB_PATH=/path/to/your/tasks.db
```

## Project structure

```
dashboard/
├── backend/                FastAPI app (Python)
│   ├── main.py             App entry point, CORS, router registration
│   ├── database.py         SQLAlchemy engine + WAL mode (reads DASHBOARD_DB_PATH)
│   ├── models.py           ORM models; auto-logs changes to task_history
│   ├── schemas.py          Pydantic request/response schemas
│   └── routers/
│       ├── tasks.py        Task CRUD + move + dependencies
│       ├── projects.py     Project CRUD
│       └── people.py       Person CRUD
├── frontend/               React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── components/
│       │   ├── gantt/
│       │   │   ├── CustomGantt.tsx       Main SVG Gantt, drag/resize/zoom
│       │   │   ├── TaskDetailPanel.tsx   Task edit form (status, notes, checklist…)
│       │   │   └── TaskDetailModal.tsx   Fixed-position panel wrapper + resize handle
│       │   └── layout/
│       │       ├── TopBar.tsx            Undo/Redo buttons, dark mode toggle
│       │       └── Sidebar.tsx           Project/people filters + CRUD
│       ├── hooks/useTasks.ts             TanStack Query mutations (all push to undo store)
│       ├── lib/api.ts                    Typed REST client
│       └── store/
│           ├── uiStore.ts               Zustand: filters, zoom, lane heights, panel width
│           └── undoStore.ts             Zustand: global undo/redo action stack
├── scripts/
│   └── seed_demo_data.py
└── launch.command          One-click launcher (Mac) — starts backend + frontend + opens browser
```

## API reference

Interactive docs: http://localhost:8000/docs

| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks` | List tasks (filter: `project_id`, `status`, `assignee_id`, `type`, `updated_since`) |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/{id}` | Partial update |
| DELETE | `/api/tasks/{id}` | Delete task |
| POST | `/api/tasks/{id}/move` | Update start/end dates |
| GET | `/api/tasks/{id}/history` | Audit log (last 50 changes) |
| POST | `/api/tasks/{id}/dependencies` | Add dependency |
| DELETE | `/api/tasks/dependencies/{id}` | Remove dependency |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| PATCH | `/api/projects/{id}` | Update project (name, color, archived…) |
| GET | `/api/people` | List people |
| POST | `/api/people` | Create person |
| PATCH | `/api/people/{id}` | Update person (name, color, avatar_initials) |
| DELETE | `/api/people/{id}` | Delete person |

## Data model

**Task key fields**

| Field | Type | Notes |
|---|---|---|
| `title` | string | |
| `type` | `task` \| `milestone` | |
| `status` | `todo` \| `in_progress` \| `blocked` \| `done` | |
| `priority` | 1–3 | 3 = urgent |
| `density` | 1–100 | % of daily capacity consumed |
| `progress` | 0–100 | completion % |
| `start_date` / `end_date` | `YYYY-MM-DD` | |
| `deadline` | `YYYY-MM-DD` | hard constraint, shown in red |
| `lane_y` | int | vertical row within assignee lane |
| `notes` | JSON string | `{freeform: string, checklist: [{id, text, done}]}` |
| `tags` | JSON array string | |

**Density calibration guide**

| Density | Meaning | Example |
|---|---|---|
| 100% | Full-day immersion | Deep writing, all-day debugging |
| 60–70% | Significant focused work | Building a feature, writing a post |
| 40–50% | Several hours, some slack | Technical setup, campaign prep |
| 20–30% | A few focused hours | Writing 4 emails, a 30-min daily check-in |
| 10–15% | Light background work | Monitoring metrics, responding to inquiries |
| 5% | Holding container / backlog | Someday/maybe list |

**Splitting vs. grouping tasks:** split when tasks require different mental modes or would happen on different days. Group when they flow in one sitting or form a recurring cadence. Test: "Would I sit down and do these at the same time?" — yes: group, no: split.

## Tech stack

| Layer | Tech |
|---|---|
| Backend | FastAPI, SQLAlchemy 2, SQLite (WAL mode), Uvicorn |
| Frontend | React 18, Vite, Tailwind CSS 4, Zustand, TanStack Query v5, date-fns |

## License

MIT
