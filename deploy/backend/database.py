from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional

from models import WorkflowConfig

DB_PATH = os.environ.get("STUDIO_DB_PATH", "/data/studio.db")


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                max_rounds INTEGER NOT NULL DEFAULT 6,
                human_in_the_loop INTEGER NOT NULL DEFAULT 1,
                graph_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS execution_runs (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                workflow_name TEXT NOT NULL,
                task_prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                rounds_executed INTEGER NOT NULL DEFAULT 0,
                max_rounds INTEGER NOT NULL DEFAULT 6,
                events_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                completed_at TEXT
            )
            """
        )
        conn.commit()


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def list_workflows() -> List[WorkflowConfig]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM workflows ORDER BY updated_at DESC"
        ).fetchall()
        results: List[WorkflowConfig] = []
        for row in rows:
            graph = json.loads(row["graph_json"])
            results.append(
                WorkflowConfig(
                    id=row["id"],
                    name=row["name"],
                    description=row["description"],
                    maxRounds=row["max_rounds"],
                    humanInTheLoop=bool(row["human_in_the_loop"]),
                    nodes=graph.get("nodes", []),
                    edges=graph.get("edges", []),
                    updatedAt=row["updated_at"],
                )
            )
        return results


def get_workflow(workflow_id: str) -> Optional[WorkflowConfig]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM workflows WHERE id = ?", (workflow_id,)
        ).fetchone()
        if not row:
            return None
        graph = json.loads(row["graph_json"])
        return WorkflowConfig(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            maxRounds=row["max_rounds"],
            humanInTheLoop=bool(row["human_in_the_loop"]),
            nodes=graph.get("nodes", []),
            edges=graph.get("edges", []),
            updatedAt=row["updated_at"],
        )


def upsert_workflow(workflow: WorkflowConfig) -> WorkflowConfig:
    updated_at = datetime.now(timezone.utc).isoformat()
    graph_json = json.dumps(
        {
            "nodes": [n.model_dump() for n in workflow.nodes],
            "edges": [e.model_dump() for e in workflow.edges],
        }
    )
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO workflows (id, name, description, max_rounds, human_in_the_loop, graph_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                max_rounds = excluded.max_rounds,
                human_in_the_loop = excluded.human_in_the_loop,
                graph_json = excluded.graph_json,
                updated_at = excluded.updated_at
            """,
            (
                workflow.id,
                workflow.name,
                workflow.description,
                workflow.maxRounds,
                1 if workflow.humanInTheLoop else 0,
                graph_json,
                updated_at,
            ),
        )
        conn.commit()
    workflow.updatedAt = updated_at
    return workflow


def create_run_record(
    run_id: str, workflow: WorkflowConfig, task_prompt: str
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO execution_runs (id, workflow_id, workflow_name, task_prompt, status, rounds_executed, max_rounds, events_json, created_at)
            VALUES (?, ?, ?, ?, 'running', 0, ?, '[]', ?)
            """,
            (run_id, workflow.id, workflow.name, task_prompt, workflow.maxRounds, now),
        )
        conn.commit()


def update_run_record(
    run_id: str,
    status: str,
    rounds_executed: int,
    events: List[Dict[str, Any]],
    completed: bool = False,
) -> None:
    completed_at = datetime.now(timezone.utc).isoformat() if completed else None
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE execution_runs
            SET status = ?, rounds_executed = ?, events_json = ?, completed_at = COALESCE(?, completed_at)
            WHERE id = ?
            """,
            (status, rounds_executed, json.dumps(events), completed_at, run_id),
        )
        conn.commit()


def list_runs(limit: int = 25) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, workflow_id, workflow_name, task_prompt, status, rounds_executed, max_rounds, created_at, completed_at
            FROM execution_runs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
