# Timeline Dashboard

A self-hosted personal project timeline — swim-lane Gantt chart with a FastAPI backend and React frontend, backed by SQLite.

![screenshot placeholder](docs/screenshot.png)

## Features

- Swim-lane Gantt chart grouped by assignee
- Drag to move and resize tasks
- Drag tasks between lanes to reassign
- Dependency arrows (connect tasks, delete with click)
- Continuous zoom (trackpad pinch / Ctrl+scroll)
- Undo / redo (Cmd+Z / Cmd+Shift+Z)
- Task detail panel: status, priority, density, progress, notes/checklist
- Project color picker
- Sidebar filters: show/hide projects and people, drag to reorder
- Dark mode, persisted UI state (zoom, filters, lane order)

## Quick start

**Requirements:** Python 3.10+, Node 18+

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/timeline-dashboard
cd timeline-dashboard

# 2. Install backend deps
cd backend && pip install -r requirements.txt && cd ..

# 3. Install frontend deps
cd frontend && npm install && cd ..

# 4. Seed demo data (creates tasks.db)
python3 scripts/seed_demo_data.py

# 5. Launch
chmod +x launch.command && ./launch.command
```

Then open http://localhost:5173.

## Seeding demo data

```bash
python3 scripts/seed_demo_data.py          # first run
python3 scripts/seed_demo_data.py --reset  # wipe and re-seed
```

## Connecting to an external database

By default the backend creates/uses `tasks.db` inside the dashboard folder.
To point it at a database file elsewhere (e.g. a personal notes system):

```bash
export DASHBOARD_DB_PATH=/path/to/your/tasks.db
./launch.command
```

Or set it in a `.env` file in the backend folder:
```
DASHBOARD_DB_PATH=/path/to/your/tasks.db
```

## Project structure

```
dashboard/
├── backend/          FastAPI app (Python)
│   ├── main.py
│   ├── database.py   SQLAlchemy engine (reads DASHBOARD_DB_PATH)
│   ├── models.py     ORM models
│   ├── schemas.py    Pydantic schemas
│   └── routers/      tasks, projects, people
├── frontend/         React + Vite + Tailwind
│   └── src/
│       ├── components/gantt/   CustomGantt, TaskDetailPanel, TaskDetailModal
│       ├── components/layout/  Sidebar, TopBar
│       ├── hooks/              useTasks (react-query)
│       ├── lib/api.ts          REST client
│       └── store/uiStore.ts    Zustand persisted UI state
├── scripts/
│   └── seed_demo_data.py
└── launch.command    One-click launcher (Mac)
```

## API

Interactive docs at http://localhost:8000/docs once running.

| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks` | List tasks (filterable by project, status, assignee, type) |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/{id}` | Partial update |
| DELETE | `/api/tasks/{id}` | Delete task |
| POST | `/api/tasks/{id}/move` | Update start/end dates |
| POST | `/api/tasks/{id}/dependencies` | Add dependency |
| DELETE | `/api/tasks/dependencies/{id}` | Remove dependency |
| GET | `/api/projects` | List projects |
| PATCH | `/api/projects/{id}` | Update project (e.g. color) |
| POST | `/api/projects` | Create project |
| GET | `/api/people` | List people |

## Tech stack

- **Backend:** FastAPI, SQLAlchemy, SQLite (WAL mode)
- **Frontend:** React 18, Vite, Tailwind CSS, Zustand, TanStack Query, date-fns

## License

MIT
