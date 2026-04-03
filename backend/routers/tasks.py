"""Task CRUD + move/reassign/history endpoints."""

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import Task, TaskDependency, TaskHistory, _task_to_snapshot
from schemas import (
    TaskCreate, TaskUpdate, TaskOut, TaskMove, TaskReassign,
    TaskHistoryOut, DependencyOut, DependencyCreate,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(
    project_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    type: Optional[str] = Query(None),
    updated_since: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Task)
    if project_id is not None:
        q = q.filter(Task.project_id == project_id)
    if status is not None:
        q = q.filter(Task.status == status)
    if assignee_id is not None:
        q = q.filter(Task.assignee_id == assignee_id)
    if type is not None:
        q = q.filter(Task.type == type)
    if updated_since is not None:
        q = q.filter(Task.updated_at > updated_since)
    return q.order_by(Task.start_date, Task.deadline).all()


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskCreate, db: Session = Depends(get_db)):
    task = Task(**data.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    # Log creation history (after we have the id)
    db.add(TaskHistory(
        task_id=task.id,
        changed_by="user",
        change_type="create",
        snapshot=_task_to_snapshot(task),
    ))
    db.commit()
    return task


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskCreate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    for key, value in data.model_dump().items():
        setattr(task, key, value)
    task.updated_at = datetime.utcnow().isoformat()
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def patch_task(task_id: int, data: TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)
    task.updated_at = datetime.utcnow().isoformat()
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    # Snapshot before delete
    db.add(TaskHistory(
        task_id=task.id,
        changed_by="user",
        change_type="delete",
        snapshot=_task_to_snapshot(task),
    ))
    db.delete(task)
    db.commit()


@router.post("/{task_id}/move", response_model=TaskOut)
def move_task(task_id: int, data: TaskMove, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    task.start_date = data.start_date
    task.end_date = data.end_date
    task.updated_at = datetime.utcnow().isoformat()
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/reassign", response_model=TaskOut)
def reassign_task(task_id: int, data: TaskReassign, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    task.assignee_id = data.assignee_id
    task.updated_at = datetime.utcnow().isoformat()
    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_id}/history", response_model=list[TaskHistoryOut])
def get_task_history(task_id: int, db: Session = Depends(get_db)):
    return (
        db.query(TaskHistory)
        .filter(TaskHistory.task_id == task_id)
        .order_by(TaskHistory.changed_at.desc())
        .limit(50)
        .all()
    )


@router.post("/{task_id}/dependencies", response_model=DependencyOut, status_code=201)
def add_dependency(task_id: int, data: DependencyCreate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    dep = TaskDependency(task_id=task_id, depends_on_id=data.depends_on_id, type=data.type)
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return dep


@router.delete("/dependencies/{dep_id}", status_code=204)
def delete_dependency(dep_id: int, db: Session = Depends(get_db)):
    dep = db.get(TaskDependency, dep_id)
    if not dep:
        raise HTTPException(404, "Dependency not found")
    db.delete(dep)
    db.commit()
