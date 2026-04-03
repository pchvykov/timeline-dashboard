"""SQLAlchemy engine + session factory with WAL mode."""

import os
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# DASHBOARD_DB_PATH env var lets an external system (e.g. personal_os) point
# the dashboard at a db file outside this repo. Defaults to tasks.db in the
# dashboard root for standalone / open-source use.
_default = Path(__file__).resolve().parent.parent / "tasks.db"
DB_PATH = Path(os.environ.get("DASHBOARD_DB_PATH", str(_default)))
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
