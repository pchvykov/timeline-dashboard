---
type: evergreen
created: 2026-04-03
project: null
tags: []
---

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

## Task design principles

When creating or managing tasks (whether via the UI, API, or an AI assistant), these principles produce a timeline that's actually readable and useful:

### Duration
- **Single day** — tasks you'd finish in one sitting. Set `start_date = end_date`.
- **Multi-day focused** — tasks requiring several real work sessions. Set a realistic span; don't pad.
- **Long ongoing** — background work spanning weeks/months (monitoring, recurring sends, check-ins). Cover the full active period; keep density low.

### Density (1–100, where 100 = can't do much else that day)
Calibrated to a typical ~6h workday:

| Density | Meaning | Example |
|---|---|---|
| 100% | Full immersion, all-day | Deep writing session, all-day debugging |
| 60–70% | Significant focused work | Writing a blog post, building a feature |
| 40–50% | Several hours, leaves room for other things | Technical setup, campaign prep |
| 20–30% | A few focused hours | Writing 4 partner emails, 30-min daily check-in |
| 10–15% | Background / recurring light work | Monitoring metrics, responding to inquiries |
| 5% | Holding container / reference | Idea backlog, someday/maybe list |

**Quick calibration examples:**
- Sending 1 email → 10% × 1 day
- Sending 10 similar emails → 30% × 1 day
- Sending 50 personalized emails → 30% × 3 days (spread to avoid fatigue)
- Writing a blog post (3–8h) → 60–70% × 1–2 days
- Monthly monitoring → 10% across full duration

### Splitting vs. grouping
- **Split** tasks that require different mental modes or would be done on different days (e.g., "send announcement email to list" vs. "write personalized invitations" — one is a quick send, the other needs individual thought per recipient).
- **Group** tasks that flow naturally in one session or form a recurring cadence container (e.g., a blog writing queue with multiple post ideas; a monthly email cadence — same motion repeated).
- **Test:** "Would I sit down and do these at the same time?" → yes: group. No: split.

## Tech stack

- **Backend:** FastAPI, SQLAlchemy, SQLite (WAL mode)
- **Frontend:** React 18, Vite, Tailwind CSS, Zustand, TanStack Query, date-fns

## License

MIT
