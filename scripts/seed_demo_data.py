#!/usr/bin/env python3
"""
Seed the dashboard with demo projects, people, and tasks.

Run from the dashboard folder:
    python3 scripts/seed_demo_data.py

Creates (or resets) tasks.db with enough sample data to explore the UI.
Use --reset to wipe and re-seed an existing database.
"""

import json
import os
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(os.environ.get("DASHBOARD_DB_PATH",
               str(Path(__file__).resolve().parent.parent / "tasks.db")))


DDL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    color       TEXT    NOT NULL DEFAULT '#6366f1',
    description TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    color           TEXT    NOT NULL DEFAULT '#8b5cf6',
    avatar_initials TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    yaml_id        TEXT    UNIQUE,
    title          TEXT    NOT NULL,
    description    TEXT,
    type           TEXT    NOT NULL DEFAULT 'task'
                           CHECK(type IN ('task','milestone')),
    project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    assignee_id    INTEGER REFERENCES people(id)   ON DELETE SET NULL,
    start_date     TEXT,
    end_date       TEXT,
    density        INTEGER NOT NULL DEFAULT 100
                           CHECK(density BETWEEN 1 AND 100),
    status         TEXT    NOT NULL DEFAULT 'todo'
                           CHECK(status IN ('todo','in_progress','blocked','done')),
    priority       INTEGER NOT NULL DEFAULT 2
                           CHECK(priority IN (1,2,3)),
    progress       INTEGER NOT NULL DEFAULT 0
                           CHECK(progress BETWEEN 0 AND 100),
    parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    tags           TEXT    DEFAULT '[]',
    notes          TEXT,
    deadline       TEXT,
    lane_y         INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_dependencies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type         TEXT    NOT NULL DEFAULT 'finish_to_start'
                         CHECK(type IN ('finish_to_start','start_to_start',
                                        'finish_to_finish','start_to_finish'))
);

CREATE TABLE IF NOT EXISTS task_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    changed_by  TEXT    NOT NULL DEFAULT 'user',
    change_type TEXT    NOT NULL,
    snapshot    TEXT    NOT NULL,
    changed_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dates    ON tasks(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
"""

PROJECTS = [
    ("Research",      "#6366f1", "Ongoing research work"),
    ("Product",       "#ec4899", "Product development"),
    ("Marketing",     "#f97316", "Outreach and communications"),
    ("Operations",    "#22c55e", "Day-to-day ops and admin"),
]

PEOPLE = [
    ("Alice Chen",  "#6366f1", "AC"),
    ("Bob Martín",  "#ec4899", "BM"),
    ("Carol Singh", "#22c55e", "CS"),
]

# (yaml_id, title, project_idx, assignee_idx, start, end, deadline, status, priority, density, tags, notes)
TASKS = [
    # Research
    ("demo-001", "Literature review",       0, 0, "2026-03-01", "2026-03-21", "2026-04-01", "done",        3, 80,  '["research"]',   ""),
    ("demo-002", "Design experiment",       0, 0, "2026-03-15", "2026-04-10", "2026-04-15", "in_progress", 3, 100, '["research"]',   ""),
    ("demo-003", "Write up results",        0, 2, "2026-04-11", "2026-05-01", "2026-05-15", "todo",        2, 60,  '["research","writing"]', ""),
    ("demo-004", "Submit paper",            0, 0, "2026-05-02", "2026-05-10", "2026-05-15", "todo",        3, 100, '["research"]',   ""),
    # Product
    ("demo-005", "Spec v2 features",        1, 1, "2026-03-10", "2026-03-25", "2026-04-01", "done",        2, 80,  '["product"]',    ""),
    ("demo-006", "Implement auth module",   1, 1, "2026-03-20", "2026-04-15", "2026-04-20", "in_progress", 3, 100, '["product","dev"]', ""),
    ("demo-007", "QA testing sprint",       1, 2, "2026-04-16", "2026-04-30", "2026-05-01", "todo",        2, 100, '["product","qa"]', ""),
    ("demo-008", "Deploy to production",    1, 1, "2026-05-01", "2026-05-03", "2026-05-05", "todo",        3, 100, '["product"]',    ""),
    # Marketing
    ("demo-009", "Draft launch post",       2, 2, "2026-03-25", "2026-04-05", "2026-04-10", "todo",        2, 50,  '["marketing","writing"]', ""),
    ("demo-010", "Schedule social content", 2, 2, "2026-04-06", "2026-04-20", "2026-04-25", "todo",        1, 30,  '["marketing"]',  ""),
    ("demo-011", "Launch email campaign",   2, 0, "2026-05-04", "2026-05-08", "2026-05-10", "todo",        2, 60,  '["marketing"]',  ""),
    # Operations
    ("demo-012", "Q1 budget review",        3, 0, "2026-03-28", "2026-04-03", "2026-04-05", "done",        2, 40,  '["ops"]',        ""),
    ("demo-013", "Onboard new contractor",  3, 1, "2026-04-07", "2026-04-14", None,          "todo",        1, 50,  '["ops","people"]', ""),
    ("demo-014", "Renew software licenses", 3, 2, "2026-04-20", "2026-04-22", "2026-04-30", "todo",        1, 20,  '["ops"]',        ""),
    # Milestone
    ("demo-m01", "Product launch",          1, None, "2026-05-05", "2026-05-05", "2026-05-05", "todo",     3, 100, '["milestone"]',  ""),
]

DEPENDENCIES = [
    # write-up depends on experiment
    ("demo-003", "demo-002"),
    # submit depends on write-up
    ("demo-004", "demo-003"),
    # QA depends on auth
    ("demo-007", "demo-006"),
    # deploy depends on QA
    ("demo-008", "demo-007"),
    # launch email after deploy
    ("demo-011", "demo-008"),
]


def seed(reset: bool = False):
    print(f"Database: {DB_PATH}")

    if reset and DB_PATH.exists():
        DB_PATH.unlink()
        print("Existing database removed.")

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(DDL)

    # Projects
    pid = {}
    for name, color, desc in PROJECTS:
        cur = conn.execute("SELECT id FROM projects WHERE name=?", (name,))
        row = cur.fetchone()
        if row:
            pid[name] = row[0]
        else:
            cur = conn.execute(
                "INSERT INTO projects (name, color, description) VALUES (?,?,?)",
                (name, color, desc))
            pid[name] = cur.lastrowid
    conn.commit()
    print(f"Projects: {list(pid.keys())}")

    # People
    ppid = {}
    for name, color, initials in PEOPLE:
        cur = conn.execute("SELECT id FROM people WHERE name=?", (name,))
        row = cur.fetchone()
        if row:
            ppid[name] = row[0]
        else:
            cur = conn.execute(
                "INSERT INTO people (name, color, avatar_initials) VALUES (?,?,?)",
                (name, color, initials))
            ppid[name] = cur.lastrowid
    conn.commit()
    project_ids = list(pid.values())
    person_ids  = list(ppid.values())
    print(f"People: {list(ppid.keys())}")

    # Tasks
    task_id_by_yaml = {}
    for (yaml_id, title, proj_idx, person_idx, start, end, deadline,
         status, priority, density, tags, notes) in TASKS:
        cur = conn.execute("SELECT id FROM tasks WHERE yaml_id=?", (yaml_id,))
        row = cur.fetchone()
        if row:
            task_id_by_yaml[yaml_id] = row[0]
            continue
        task_type = "milestone" if yaml_id.startswith("demo-m") else "task"
        cur = conn.execute("""
            INSERT INTO tasks
              (yaml_id, title, type, project_id, assignee_id,
               start_date, end_date, deadline, status, priority,
               density, tags, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (yaml_id, title, task_type,
              project_ids[proj_idx],
              person_ids[person_idx] if person_idx is not None else None,
              start, end, deadline, status, priority, density, tags, notes))
        task_id_by_yaml[yaml_id] = cur.lastrowid
    conn.commit()
    print(f"Tasks: {len(task_id_by_yaml)} inserted/found")

    # Dependencies
    for src_yaml, dep_yaml in DEPENDENCIES:
        src_id = task_id_by_yaml.get(src_yaml)
        dep_id = task_id_by_yaml.get(dep_yaml)
        if src_id and dep_id:
            existing = conn.execute(
                "SELECT id FROM task_dependencies WHERE task_id=? AND depends_on_id=?",
                (src_id, dep_id)).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?,?)",
                    (src_id, dep_id))
    conn.commit()
    print(f"Dependencies: {len(DEPENDENCIES)} seeded")
    conn.close()
    print("Done. Run launch.command to start the dashboard.")


if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
