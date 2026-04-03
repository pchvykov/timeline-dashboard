"""SQLAlchemy ORM models matching the timeline dashboard schema."""

import json
from datetime import datetime
from sqlalchemy import (
    Column, Integer, Text, ForeignKey, CheckConstraint, Index,
    event, inspect,
)
from sqlalchemy.orm import relationship, Session
from database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False, unique=True)
    color = Column(Text, nullable=False, default="#6366f1")
    description = Column(Text)
    archived = Column(Integer, nullable=False, default=0)
    created_at = Column(Text, nullable=False, default=lambda: datetime.utcnow().isoformat())
    updated_at = Column(Text, nullable=False, default=lambda: datetime.utcnow().isoformat())

    tasks = relationship("Task", back_populates="project")


class Person(Base):
    __tablename__ = "people"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    color = Column(Text, nullable=False, default="#8b5cf6")
    avatar_initials = Column(Text)
    created_at = Column(Text, nullable=False, default=lambda: datetime.utcnow().isoformat())

    tasks = relationship("Task", back_populates="assignee")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("status IN ('todo','in_progress','blocked','done')", name="ck_task_status"),
        CheckConstraint("priority IN (1,2,3)", name="ck_task_priority"),
        CheckConstraint("progress BETWEEN 0 AND 100", name="ck_task_progress"),
        CheckConstraint("density BETWEEN 1 AND 100", name="ck_task_density"),
        CheckConstraint("type IN ('task','milestone')", name="ck_task_type"),
        Index("idx_tasks_project", "project_id"),
        Index("idx_tasks_assignee", "assignee_id"),
        Index("idx_tasks_dates", "start_date", "end_date"),
        Index("idx_tasks_status", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    yaml_id = Column(Text, unique=True)
    title = Column(Text, nullable=False)
    description = Column(Text)
    type = Column(Text, nullable=False, default="task")
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="SET NULL"))
    assignee_id = Column(Integer, ForeignKey("people.id", ondelete="SET NULL"))
    start_date = Column(Text)
    end_date = Column(Text)
    density = Column(Integer, nullable=False, default=100)
    status = Column(Text, nullable=False, default="todo")
    priority = Column(Integer, nullable=False, default=2)
    progress = Column(Integer, nullable=False, default=0)
    parent_task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"))
    tags = Column(Text, default="[]")
    notes = Column(Text)
    deadline = Column(Text)
    lane_y = Column(Integer, nullable=False, default=0)
    created_at = Column(Text, nullable=False, default=lambda: datetime.utcnow().isoformat())
    updated_at = Column(Text, nullable=False, default=lambda: datetime.utcnow().isoformat())

    project = relationship("Project", back_populates="tasks")
    assignee = relationship("Person", back_populates="tasks")
    parent_task = relationship("Task", remote_side=[id], backref="subtasks")
    history = relationship("TaskHistory", back_populates="task", cascade="all, delete-orphan")

    # Dependencies where this task depends on another
    dependencies = relationship(
        "TaskDependency",
        foreign_keys="TaskDependency.task_id",
        back_populates="task",
        cascade="all, delete-orphan",
    )
    # Dependencies where another task depends on this one
    dependents = relationship(
        "TaskDependency",
        foreign_keys="TaskDependency.depends_on_id",
        back_populates="depends_on_task",
        cascade="all, delete-orphan",
    )


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    __table_args__ = (
        CheckConstraint(
            "type IN ('finish_to_start','start_to_start','finish_to_finish','start_to_finish')",
            name="ck_dep_type",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    depends_on_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    type = Column(Text, nullable=False, default="finish_to_start")

    task = relationship("Task", foreign_keys=[task_id], back_populates="dependencies")
    depends_on_task = relationship("Task", foreign_keys=[depends_on_id], back_populates="dependents")


class TaskHistory(Base):
    __tablename__ = "task_history"
    __table_args__ = (
        Index("idx_history_task", "task_id", "changed_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    changed_by = Column(Text, nullable=False, default="user")
    change_type = Column(Text, nullable=False)
    snapshot = Column(Text, nullable=False)
    changed_at = Column(Text, nullable=False, default=lambda: datetime.utcnow().isoformat())

    task = relationship("Task", back_populates="history")


def _task_to_snapshot(task: Task) -> str:
    """Serialize task state to JSON for history."""
    return json.dumps({
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "type": task.type,
        "project_id": task.project_id,
        "assignee_id": task.assignee_id,
        "start_date": task.start_date,
        "end_date": task.end_date,
        "density": task.density,
        "status": task.status,
        "priority": task.priority,
        "progress": task.progress,
        "parent_task_id": task.parent_task_id,
        "tags": task.tags,
        "notes": task.notes,
        "deadline": task.deadline,
    })


@event.listens_for(Session, "before_flush")
def before_flush_snapshot(session, flush_context, instances):
    """Record task history before any modification."""
    for obj in session.dirty:
        if isinstance(obj, Task):
            state = inspect(obj)
            if state.committed_state:
                # Build snapshot from committed (pre-change) values
                committed = {}
                for attr in state.attrs:
                    key = attr.key
                    history = attr.history
                    if history.deleted:
                        committed[key] = history.deleted[0]
                    elif history.unchanged:
                        committed[key] = history.unchanged[0]
                snapshot = json.dumps({k: v for k, v in committed.items()
                                       if k not in ("project", "assignee", "parent_task",
                                                     "subtasks", "history", "dependencies",
                                                     "dependents")})
                session.add(TaskHistory(
                    task_id=obj.id,
                    changed_by="user",
                    change_type="update",
                    snapshot=snapshot,
                ))

    for obj in session.new:
        if isinstance(obj, Task) and obj.id is not None:
            session.add(TaskHistory(
                task_id=obj.id,
                changed_by="user",
                change_type="create",
                snapshot=_task_to_snapshot(obj),
            ))

    for obj in session.deleted:
        if isinstance(obj, Task):
            session.add(TaskHistory(
                task_id=obj.id,
                changed_by="user",
                change_type="delete",
                snapshot=_task_to_snapshot(obj),
            ))
