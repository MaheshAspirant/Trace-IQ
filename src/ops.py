"""Writable operations layer for the workbench.

The generated dataset is immutable evidence: validation and reproducibility
checks depend on it. User actions (CAPA transitions, containment, comments,
preferences) are stored in a separate SQLite file, ``out/ops.db``, and merged
over the generated rows at read time. Every action appends an audit event, so
history is never overwritten.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS capa_override (
    capa_id                  TEXT PRIMARY KEY,
    status                   TEXT,
    containment_completed_at TEXT,
    verification_inspection_id TEXT,
    verified_at              TEXT,
    closed_at                TEXT,
    effectiveness_score      REAL,
    owner_role               TEXT,
    root_cause_category      TEXT,
    corrective_action        TEXT,
    updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS defect_override (
    defect_id  TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ops_event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    from_state  TEXT,
    to_state    TEXT,
    actor       TEXT NOT NULL,
    note        TEXT,
    payload     TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_ops_event_entity ON ops_event(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS setting (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

CAPA_FIELDS = (
    "status",
    "containment_completed_at",
    "verification_inspection_id",
    "verified_at",
    "closed_at",
    "effectiveness_score",
    "owner_role",
    "root_cause_category",
    "corrective_action",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


class OpsStore:
    def __init__(self, path: str):
        self.path = path
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        self._lock = threading.Lock()
        conn = self.connect()
        try:
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    # ------------------------------------------------------------- overrides
    def capa_overrides(self) -> dict:
        conn = self.connect()
        try:
            rows = conn.execute("SELECT * FROM capa_override").fetchall()
        finally:
            conn.close()
        return {r["capa_id"]: {k: r[k] for k in r.keys()} for r in rows}

    def defect_overrides(self) -> dict:
        conn = self.connect()
        try:
            rows = conn.execute("SELECT * FROM defect_override").fetchall()
        finally:
            conn.close()
        return {r["defect_id"]: r["status"] for r in rows}

    # ----------------------------------------------------------------- write
    def save_capa(self, capa_id: str, fields: dict, action: str, from_state: str,
                  to_state: str, actor: str, note: str | None = None) -> None:
        payload = {k: v for k, v in fields.items() if k in CAPA_FIELDS}
        stamp = now_iso()
        with self._lock:
            conn = self.connect()
            try:
                current = conn.execute(
                    "SELECT * FROM capa_override WHERE capa_id = ?", (capa_id,)
                ).fetchone()
                merged = dict(current) if current else {"capa_id": capa_id}
                merged.update({k: v for k, v in payload.items()})
                merged["updated_at"] = stamp
                columns = ["capa_id", *CAPA_FIELDS, "updated_at"]
                placeholders = ", ".join("?" for _ in columns)
                updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "capa_id")
                conn.execute(
                    f"INSERT INTO capa_override ({', '.join(columns)}) VALUES ({placeholders}) "
                    f"ON CONFLICT(capa_id) DO UPDATE SET {updates}",
                    [merged.get(c) for c in columns],
                )
                conn.execute(
                    "INSERT INTO ops_event (entity_type, entity_id, action, from_state, to_state,"
                    " actor, note, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    ("capa", capa_id, action, from_state, to_state, actor, note,
                     json.dumps(payload, default=str), stamp),
                )
                conn.commit()
            finally:
                conn.close()

    def save_defect(self, defect_id: str, status: str, action: str, from_state: str,
                    actor: str, note: str | None = None) -> None:
        stamp = now_iso()
        with self._lock:
            conn = self.connect()
            try:
                conn.execute(
                    "INSERT INTO defect_override (defect_id, status, updated_at) VALUES (?,?,?) "
                    "ON CONFLICT(defect_id) DO UPDATE SET status = excluded.status,"
                    " updated_at = excluded.updated_at",
                    (defect_id, status, stamp),
                )
                conn.execute(
                    "INSERT INTO ops_event (entity_type, entity_id, action, from_state, to_state,"
                    " actor, note, payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    ("defect", defect_id, action, from_state, status, actor, note,
                     json.dumps({"status": status}), stamp),
                )
                conn.commit()
            finally:
                conn.close()

    def add_note(self, entity_type: str, entity_id: str, note: str, actor: str) -> None:
        stamp = now_iso()
        with self._lock:
            conn = self.connect()
            try:
                conn.execute(
                    "INSERT INTO ops_event (entity_type, entity_id, action, actor, note, created_at)"
                    " VALUES (?,?,?,?,?,?)",
                    (entity_type, entity_id, "note", actor, note, stamp),
                )
                conn.commit()
            finally:
                conn.close()

    # ------------------------------------------------------------------ read
    def events(self, entity_type: str | None = None, entity_id: str | None = None,
               limit: int = 100) -> list:
        sql = "SELECT * FROM ops_event WHERE 1=1"
        params: list = []
        if entity_type:
            sql += " AND entity_type = ?"
            params.append(entity_type)
        if entity_id:
            sql += " AND entity_id = ?"
            params.append(entity_id)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        conn = self.connect()
        try:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]
        finally:
            conn.close()

    def recent_activity(self, limit: int = 20) -> list:
        return self.events(limit=limit)

    # ------------------------------------------------------------ preferences
    def settings(self) -> dict:
        conn = self.connect()
        try:
            rows = conn.execute("SELECT key, value FROM setting").fetchall()
        finally:
            conn.close()
        out = {}
        for row in rows:
            try:
                out[row["key"]] = json.loads(row["value"])
            except json.JSONDecodeError:
                out[row["key"]] = row["value"]
        return out

    def save_settings(self, patch: dict) -> dict:
        stamp = now_iso()
        with self._lock:
            conn = self.connect()
            try:
                for key, value in patch.items():
                    conn.execute(
                        "INSERT INTO setting (key, value, updated_at) VALUES (?,?,?) "
                        "ON CONFLICT(key) DO UPDATE SET value = excluded.value,"
                        " updated_at = excluded.updated_at",
                        (key, json.dumps(value), stamp),
                    )
                conn.commit()
            finally:
                conn.close()
        return self.settings()

    def clear_history(self) -> None:
        with self._lock:
            conn = self.connect()
            try:
                conn.execute("DELETE FROM ops_event")
                conn.execute("DELETE FROM capa_override")
                conn.execute("DELETE FROM defect_override")
                conn.commit()
            finally:
                conn.close()
