"""Idempotent D1 SQL export and transactional local SQLite application."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from .common import COURSE_KEYS, atomic_write, compact_json, course_from_jsonl, utc_now

ROOT = Path(__file__).resolve().parents[2]
MAX_D1_SQL_BYTES = 100_000
MAX_D1_ROW_BYTES = 2 * 1024 * 1024
COURSE_COLUMNS = (
    "id", "source_id", "year", "department", "department_name", "registration_code", "variant_key",
    "title", "teacher_text", "room_text", "credits", "term_text", "title_search", "teacher_search",
    "room_search", "code_search", "body_search", "raw_metadata_json", "parse_warnings_json",
    "modality_evidence_json", "content_revision",
)


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    # SQLite SQL files can carry embedded NULs only via an expression.
    chunks = text.split("\x00")
    quoted = ["'" + chunk.replace("'", "''") + "'" for chunk in chunks]
    return " || char(0) || ".join(quoted)


def _course_value(course: dict[str, Any], column: str) -> Any:
    source = {
        "raw_metadata_json": compact_json(course.get("raw_metadata", {})),
        "parse_warnings_json": compact_json(course.get("parse_warnings", [])),
        "modality_evidence_json": compact_json(course.get("modality_evidence", [])),
    }
    # dict.get evaluates its default eagerly. Keep the fallback explicit so
    # derived JSON columns do not require duplicate keys on the course object.
    return source[column] if column in source else course[column]


def _insert_course_sql(course: dict[str, Any]) -> list[str]:
    columns = ", ".join(COURSE_COLUMNS)
    values = ", ".join(sql_literal(_course_value(course, column)) for column in COURSE_COLUMNS)
    updates = ", ".join(f"{column}=excluded.{column}" for column in COURSE_COLUMNS if column != "id")
    course_sql = (
        f"INSERT INTO courses ({columns}) VALUES ({values}) "
        f"ON CONFLICT(id) DO UPDATE SET {updates};"
    )
    sid = sql_literal(course["source_id"])
    cid = sql_literal(course["id"])
    statements = [
        f"DELETE FROM course_search WHERE rowid IN (SELECT rowid FROM courses WHERE source_id={sid});",
        f"DELETE FROM courses WHERE source_id={sid} AND id<>{cid};",
        course_sql,
        f"DELETE FROM course_slots WHERE course_id={cid};",
        f"DELETE FROM course_modalities WHERE course_id={cid};",
        f"DELETE FROM course_pages WHERE course_id={cid};",
    ]
    for slot in course.get("slots", []):
        statements.append(
            "INSERT INTO course_slots (course_id,term_label,day_label,period_label,day,period,source_kind) VALUES ("
            + ",".join(sql_literal(value) for value in (
                course["id"], slot.get("term_label", ""), slot.get("day_label", ""),
                slot.get("period_label", ""), slot.get("day"), slot.get("period"), slot["source_kind"],
            )) + ");"
        )
    for modality in course.get("modalities", []):
        statements.append(f"INSERT INTO course_modalities (course_id,modality) VALUES ({cid},{sql_literal(modality)});")
    for page in course.get("pages", []):
        statements.append(
            "INSERT INTO course_pages (course_id,page_number,raw_text) VALUES ("
            + ",".join(sql_literal(value) for value in (course["id"], page["page_number"], page["raw_text"]))
            + ");"
        )
    statements.append(
        "INSERT INTO course_search (rowid,title,teacher,code,body) "
        f"SELECT rowid,title_search,teacher_search,code_search,body_search FROM courses WHERE id={cid};"
    )
    return statements


def validate_course_export_limits(course: dict[str, Any]) -> None:
    row_bytes = sum(len(str(_course_value(course, column) or "").encode("utf-8")) for column in COURSE_COLUMNS)
    if row_bytes > MAX_D1_ROW_BYTES:
        raise ValueError(f"course row is {row_bytes} bytes; D1 row limit is {MAX_D1_ROW_BYTES} bytes")
    for statement in _insert_course_sql(course):
        statement_bytes = len(statement.encode("utf-8"))
        if statement_bytes > MAX_D1_SQL_BYTES:
            raise ValueError(f"course SQL statement is {statement_bytes} bytes; D1 SQL statement limit is {MAX_D1_SQL_BYTES} bytes")


def _manifest_counts(manifest: dict[str, Any]) -> dict[str, int]:
    sources = manifest.get("sources", [])
    statuses = [str(source.get("status", "pending")) for source in sources]
    return {
        "discovered": len(sources),
        "ready": sum(status == "ready" for status in statuses),
        "failed": sum(source.get("last_attempt_status", source.get("status")) == "failed" for source in sources),
        "conflict": sum(status == "conflict" for status in statuses),
    }


def build_import_sql(courses: Iterable[dict[str, Any]], manifest: dict[str, Any]) -> str:
    run = manifest.get("run", {})
    counts = manifest.get("counts") or _manifest_counts(manifest)
    import_id = str(run.get("id", "ingest-import"))
    status = str(run.get("status", "partial"))
    started_at = str(run.get("started_at", utc_now()))
    finished_at = str(run.get("finished_at", utc_now()))
    statements = [
        "-- Generated by scripts/ingest/main.py export. Re-running is idempotent.",
        "-- Wrangler D1 SQL imports omit explicit transaction directives. This file is not a per-course atomic production refresh; verify staged D1 behavior first.",
        "INSERT INTO imports (id,started_at,finished_at,status,discovered_count,ready_count,failed_count,conflict_count,parser_version) VALUES ("
        + ",".join(sql_literal(value) for value in (
            import_id, started_at, finished_at, status, counts["discovered"], counts["ready"],
            counts["failed"], counts["conflict"], run.get("parser_version", "syllabus-ingest-1"),
        ))
        + ") ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at,status=excluded.status,"
          "discovered_count=excluded.discovered_count,ready_count=excluded.ready_count,"
          "failed_count=excluded.failed_count,conflict_count=excluded.conflict_count;",
    ]
    for source in manifest.get("sources", []):
        source_id = source["id"]
        attempt_status = source.get("last_attempt_status", source.get("status", "pending"))
        values = (
            source_id, source["url"], source.get("sha256"), source.get("fetched_at"),
            source.get("status", "pending"), source.get("last_error"), import_id,
            source.get("last_attempt_at"), attempt_status,
        )
        source_row_bytes = sum(len(str(value or "").encode("utf-8")) for value in values)
        if source_row_bytes > MAX_D1_ROW_BYTES:
            raise ValueError(f"source row is {source_row_bytes} bytes; D1 row limit is {MAX_D1_ROW_BYTES} bytes")
        statements.append(
            "INSERT INTO source_documents (id,url,sha256,fetched_at,status,last_error,import_id,last_attempt_at,last_attempt_status) VALUES ("
            + ",".join(sql_literal(value) for value in values)
            + ") ON CONFLICT(id) DO UPDATE SET url=excluded.url,sha256=COALESCE(excluded.sha256,source_documents.sha256),"
              "fetched_at=COALESCE(excluded.fetched_at,source_documents.fetched_at),status=excluded.status,"
              "last_error=excluded.last_error,import_id=excluded.import_id,last_attempt_at=excluded.last_attempt_at,"
              "last_attempt_status=excluded.last_attempt_status;"
        )
    for course in courses:
        validate_course_export_limits(course)
        statements.extend(_insert_course_sql(course))
    for statement in statements:
        statement_bytes = len(statement.encode("utf-8"))
        if statement_bytes > MAX_D1_SQL_BYTES:
            raise ValueError(f"generated SQL statement is {statement_bytes} bytes; D1 SQL statement limit is {MAX_D1_SQL_BYTES} bytes")
    return "\n".join(statements) + "\n"


def export_sql(output_dir: Path) -> Path:
    courses = course_from_jsonl(output_dir / "courses.jsonl")
    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    sql_path = output_dir / "import.sql"
    atomic_write(sql_path, build_import_sql(courses, manifest))
    return sql_path


def _migrate(conn: sqlite3.Connection) -> None:
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "courses" in tables:
        return
    migration_dir = ROOT / "migrations"
    for path in sorted(migration_dir.glob("*.sql")):
        conn.executescript(path.read_text(encoding="utf-8"))
    conn.execute("PRAGMA foreign_keys=ON")


def _apply_source(conn: sqlite3.Connection, source: dict[str, Any], import_id: str) -> None:
    conn.execute(
        "INSERT INTO source_documents (id,url,sha256,fetched_at,status,last_error,import_id,last_attempt_at,last_attempt_status) "
        "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,"
        "sha256=COALESCE(excluded.sha256,source_documents.sha256),"
        "fetched_at=COALESCE(excluded.fetched_at,source_documents.fetched_at),status=excluded.status,"
        "last_error=excluded.last_error,import_id=excluded.import_id,last_attempt_at=excluded.last_attempt_at,"
        "last_attempt_status=excluded.last_attempt_status",
        (source["id"], source["url"], source.get("sha256"), source.get("fetched_at"),
         source.get("status", "pending"), source.get("last_error"), import_id,
         source.get("last_attempt_at"), source.get("last_attempt_status", source.get("status", "pending"))),
    )


def _apply_course(conn: sqlite3.Connection, course: dict[str, Any]) -> None:
    values = [_course_value(course, column) for column in COURSE_COLUMNS]
    update_columns = ",".join(f"{column}=excluded.{column}" for column in COURSE_COLUMNS if column != "id")
    placeholders = ",".join("?" for _ in COURSE_COLUMNS)
    conn.execute("DELETE FROM course_search WHERE rowid IN (SELECT rowid FROM courses WHERE source_id=?)", (course["source_id"],))
    conn.execute("DELETE FROM courses WHERE source_id=? AND id<>?", (course["source_id"], course["id"]))
    conn.execute(f"INSERT INTO courses ({','.join(COURSE_COLUMNS)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {update_columns}", values)
    conn.execute("DELETE FROM course_slots WHERE course_id=?", (course["id"],))
    conn.execute("DELETE FROM course_modalities WHERE course_id=?", (course["id"],))
    conn.execute("DELETE FROM course_pages WHERE course_id=?", (course["id"],))
    conn.executemany(
        "INSERT INTO course_slots (course_id,term_label,day_label,period_label,day,period,source_kind) VALUES (?,?,?,?,?,?,?)",
        [(course["id"], slot.get("term_label", ""), slot.get("day_label", ""), slot.get("period_label", ""),
          slot.get("day"), slot.get("period"), slot["source_kind"]) for slot in course.get("slots", [])],
    )
    conn.executemany("INSERT INTO course_modalities (course_id,modality) VALUES (?,?)",
                     [(course["id"], modality) for modality in course.get("modalities", [])])
    conn.executemany("INSERT INTO course_pages (course_id,page_number,raw_text) VALUES (?,?,?)",
                     [(course["id"], page["page_number"], page["raw_text"]) for page in course.get("pages", [])])
    rowid = conn.execute("SELECT rowid FROM courses WHERE id=?", (course["id"],)).fetchone()[0]
    conn.execute("INSERT INTO course_search (rowid,title,teacher,code,body) VALUES (?,?,?,?,?)",
                 (rowid, course["title_search"], course["teacher_search"], course["code_search"], course["body_search"]))


def apply_sqlite(output_dir: Path, db_path: Path) -> None:
    courses = course_from_jsonl(output_dir / "courses.jsonl")
    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    run = manifest.get("run", {})
    import_id = str(run.get("id", "ingest-import"))
    counts = manifest.get("counts") or _manifest_counts(manifest)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        _migrate(conn)
        conn.execute(
            "INSERT INTO imports (id,started_at,finished_at,status,discovered_count,ready_count,failed_count,conflict_count,parser_version) "
            "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at,status=excluded.status,"
            "discovered_count=excluded.discovered_count,ready_count=excluded.ready_count,failed_count=excluded.failed_count,"
            "conflict_count=excluded.conflict_count,parser_version=excluded.parser_version",
            (import_id, run.get("started_at", utc_now()), run.get("finished_at", utc_now()), run.get("status", "partial"),
             counts["discovered"], counts["ready"], counts["failed"], counts["conflict"],
             run.get("parser_version", "syllabus-ingest-1")),
        )
        for source in manifest.get("sources", []):
            with conn:
                _apply_source(conn, source, import_id)
        sources_by_id = {source["id"]: source for source in manifest.get("sources", [])}
        for course in courses:
            with conn:
                source = sources_by_id.get(course["source_id"])
                if source:
                    _apply_source(conn, source, import_id)
                _apply_course(conn, course)
    finally:
        conn.close()
