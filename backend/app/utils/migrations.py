from __future__ import annotations

import logging

from sqlalchemy import inspect, text

from ..extensions import db

logger = logging.getLogger(__name__)


def _has_column(table: str, column: str) -> bool:
    insp = inspect(db.engine)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def ensure_sqlite_schema() -> None:
    """Lightweight schema migration for SQLite.

    This project uses db.create_all() (no Alembic). For SQLite we can add new
    columns with ALTER TABLE. This function is safe to run on each startup.
    """

    if db.engine.dialect.name != "sqlite":
        return

    # Columns for Task table
    alter_statements: list[str] = []
    if not _has_column("task", "assigned_by_id"):
        alter_statements.append("ALTER TABLE task ADD COLUMN assigned_by_id INTEGER")
    if not _has_column("task", "description"):
        alter_statements.append("ALTER TABLE task ADD COLUMN description TEXT NOT NULL DEFAULT ''")
    if not _has_column("task", "status"):
        alter_statements.append("ALTER TABLE task ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'new'")

    if not alter_statements:
        return

    logger.warning("Applying SQLite schema updates: %s", alter_statements)
    with db.engine.begin() as conn:
        for stmt in alter_statements:
            conn.execute(text(stmt))
