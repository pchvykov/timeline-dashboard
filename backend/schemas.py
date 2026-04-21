"""Pydantic request/response schemas."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


# ── Projects ──────────────────────────────────────────────

class ProjectBase(BaseModel):
    name: str
    color: str = "#6366f1"
    description: Optional[str] = None
    archived: int = 0

class ProjectCreate(ProjectBase):
    pass

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    archived: Optional[int] = None

class ProjectOut(ProjectBase):
    id: int
    created_at: str
    updated_at: str
    model_config = {"from_attributes": True}


# ── People ────────────────────────────────────────────────

class PersonBase(BaseModel):
    name: str
    color: str = "#8b5cf6"
    avatar_initials: Optional[str] = None

class PersonCreate(PersonBase):
    pass

class PersonUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    avatar_initials: Optional[str] = None

class PersonOut(PersonBase):
    id: int
    created_at: str
    model_config = {"from_attributes": True}


# ── Tasks ─────────────────────────────────────────────────

class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    type: str = "task"
    project_id: Optional[int] = None
    assignee_id: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    density: int = 100
    status: str = "todo"
    priority: int = 2
    progress: int = 0
    parent_task_id: Optional[int] = None
    tags: str = "[]"
    notes: Optional[str] = None
    deadline: Optional[str] = None
    lane_y: int = -1

class TaskCreate(TaskBase):
    pass

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    type: Optional[str] = None
    project_id: Optional[int] = None
    assignee_id: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    density: Optional[int] = None
    status: Optional[str] = None
    priority: Optional[int] = None
    progress: Optional[int] = None
    parent_task_id: Optional[int] = None
    tags: Optional[str] = None
    notes: Optional[str] = None
    deadline: Optional[str] = None
    lane_y: Optional[int] = None

class TaskMove(BaseModel):
    start_date: str
    end_date: str

class TaskReassign(BaseModel):
    assignee_id: Optional[int] = None

class DependencyOut(BaseModel):
    id: int
    task_id: int
    depends_on_id: int
    type: str
    model_config = {"from_attributes": True}

class DependencyCreate(BaseModel):
    depends_on_id: int
    type: str = "finish_to_start"

class TaskHistoryOut(BaseModel):
    id: int
    task_id: int
    changed_by: str
    change_type: str
    snapshot: str
    changed_at: str
    model_config = {"from_attributes": True}

class TaskOut(TaskBase):
    id: int
    yaml_id: Optional[str] = None
    created_at: str
    updated_at: str
    dependencies: list[DependencyOut] = []
    model_config = {"from_attributes": True}
