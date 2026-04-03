"""FastAPI application for the Timeline Dashboard."""

import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

# Ensure backend package is on the path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import engine, Base
from routers import tasks, projects, people


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup (idempotent)
    Base.metadata.create_all(bind=engine)

    # Idempotent migration: add lane_y column if it doesn't exist
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(tasks)"))
        columns = [row[1] for row in result.fetchall()]
        if "lane_y" not in columns:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN lane_y INTEGER NOT NULL DEFAULT 0"))
            conn.commit()

    yield


app = FastAPI(
    title="Timeline Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(projects.router)
app.include_router(people.router)


@app.get("/health")
def health():
    return {"status": "ok"}
