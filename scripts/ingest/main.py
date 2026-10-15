#!/usr/bin/env python3
"""Discover and ingest public Shinshu University syllabus PDFs."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest.common import (
    COURSE_KEYS, PARSER_VERSION, SOURCE_ROOT, atomic_write, compact_json, course_from_jsonl,
    load_aliases, natural_key, sha256_bytes, stable_id, utc_now,
)
from scripts.ingest.discover import discover as discover_sources
from scripts.ingest.export import apply_sqlite, export_sql, validate_course_export_limits
from scripts.ingest.extract import extract_file
from scripts.ingest.http_client import PublicHttpClient

DEFAULT_OUTPUT = ROOT / "data"
DEFAULT_ALIASES = ROOT / "config" / "aliases.json"


def _read_manifest(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read existing manifest {path}: {exc}") from exc
    return data if isinstance(data, dict) and data.get("schema_version") == 1 else None


def _source_state(source: dict[str, Any], previous: dict[str, Any] | None = None) -> dict[str, Any]:
    result = dict(source)
    result["id"] = str(source.get("id") or stable_id("source", str(source["url"])))
    if previous:
        for key in ("status", "last_attempt_status", "sha256", "fetched_at", "last_attempt_at", "last_error", "etag", "last_modified"):
            if previous.get(key) is not None:
                result[key] = previous[key]
    result.setdefault("status", "pending")
    result.setdefault("last_attempt_status", "pending")
    result.setdefault("sha256", None)
    result.setdefault("fetched_at", None)
    result.setdefault("last_attempt_at", None)
    result.setdefault("last_error", None)
    return result


def _merge_discovery(sources: list[dict[str, Any]], indexes: list[dict[str, Any]],
                     old_manifest: dict[str, Any] | None,
                     old_courses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    old_by_url = {item.get("url"): item for item in (old_manifest or {}).get("sources", [])}
    new_by_url: dict[str, dict[str, Any]] = {}
    for item in sources:
        new_by_url[item["url"]] = _source_state(item, old_by_url.get(item["url"]))
    indexes_by_id = {item["department"]: item for item in indexes}
    courses_by_source = {course.get("source_id"): course for course in old_courses}
    for url, old in old_by_url.items():
        if url in new_by_url:
            continue
        old = dict(old)
        department = str(old.get("department", ""))
        index = indexes_by_id.get(department)
        prior_course = courses_by_source.get(old.get("id"))
        if index and index.get("status") == "failed":
            old["status"] = "ready" if prior_course else "failed"
            old["last_attempt_status"] = "failed"
            old["last_error"] = f"department index unavailable: {index.get('error', 'unknown error')}"
        elif prior_course:
            # Keep a previously accepted course usable when a successful index
            # refresh no longer lists its PDF. Its current publication status
            # remains ready; the separate attempt status records discovery loss.
            old["status"] = "ready"
            old["last_attempt_status"] = "missing"
            old["last_error"] = "PDF URL was absent from the successfully fetched department index"
            warnings = prior_course.setdefault("parse_warnings", [])
            warning = "source URL is absent from the latest index"
            if warning not in warnings:
                warnings.append(warning)
        else:
            old["status"] = "missing"
            old["last_attempt_status"] = "missing"
            old["last_error"] = "PDF URL was absent from the successfully fetched department index"
        new_by_url[url] = old
    return list(new_by_url.values())


def _counts(sources: list[dict[str, Any]], courses: list[dict[str, Any]], discovered_count: int) -> dict[str, int]:
    return {
        "discovered": discovered_count,
        "ready": sum(source.get("status") == "ready" for source in sources),
        "failed": sum(source.get("last_attempt_status") == "failed" or source.get("status") == "failed" for source in sources),
        "conflict": sum(source.get("last_attempt_status") == "conflict" or source.get("status") == "conflict" for source in sources),
        "pending": sum(source.get("status") == "pending" for source in sources),
        "missing": sum(source.get("status") == "missing" or source.get("last_attempt_status") == "missing" for source in sources),
        "courses": len(courses),
        "unknown_modality": sum("unknown" in course.get("modalities", []) for course in courses),
        "parse_warnings": sum(len(course.get("parse_warnings", [])) for course in courses),
    }


def _run_status(counts: dict[str, int], indexes: list[dict[str, Any]]) -> str:
    has_index_error = any(index.get("status") != "ready" for index in indexes)
    if counts["failed"] == 0 and counts["conflict"] == 0 and counts["pending"] == 0 and counts["missing"] == 0 and not has_index_error:
        return "completed"
    if counts["ready"] == 0 and (counts["failed"] > 0 or has_index_error):
        return "failed"
    return "partial"


def _write_run(output: Path, sources: list[dict[str, Any]], indexes: list[dict[str, Any]],
               courses: list[dict[str, Any]], *, run_id: str, mode: str,
               started_at: str, discovered_count: int, sample_errors: list[str] | None = None) -> dict[str, Any]:
    finished_at = utc_now()
    counts = _counts(sources, courses, discovered_count)
    manifest = {
        "schema_version": 1,
        "run": {
            "id": run_id, "mode": mode, "started_at": started_at, "finished_at": finished_at,
            "status": _run_status(counts, indexes), "parser_version": PARSER_VERSION,
            "discovered_count": discovered_count,
        },
        "counts": counts,
        "indexes": indexes,
        "sources": sources,
        "sample_errors": sample_errors or [],
    }
    atomic_write(output / "courses.jsonl", "".join(json.dumps({key: course[key] for key in COURSE_KEYS}, ensure_ascii=False, separators=(",", ":")) + "\n" for course in courses))
    atomic_write(output / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def _write_discovery(output: Path, *, delay: float) -> dict[str, Any]:
    started_at = utc_now()
    run_id = f"ingest-{uuid.uuid4().hex}"
    old_manifest = _read_manifest(output / "manifest.json")
    courses = course_from_jsonl(output / "courses.jsonl")
    client = PublicHttpClient(delay=delay)
    discovered, indexes = discover_sources(client)
    sources = _merge_discovery(discovered, indexes, old_manifest, courses)
    manifest = _write_run(output, sources, indexes, courses, run_id=run_id, mode="discover",
                          started_at=started_at, discovered_count=len(discovered))
    return manifest


def _sample_key(path: Path) -> tuple[str, str | None]:
    stem = path.stem
    if "-" not in stem:
        return stem.casefold(), None
    department, basename = stem.split("-", 1)
    return basename.casefold(), department.casefold()


def _match_samples(samples_dir: Path, sources: list[dict[str, Any]]) -> tuple[list[tuple[dict[str, Any], Path]], list[str]]:
    files = sorted(path for path in samples_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pdf") if samples_dir.exists() else []
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    by_basename: dict[str, list[dict[str, Any]]] = {}
    for source in sources:
        basename = Path(urlsplit(source["url"]).path).name.casefold()
        by_key.setdefault((str(source["department"]).casefold(), basename), []).append(source)
        by_basename.setdefault(basename, []).append(source)
    pairs: list[tuple[dict[str, Any], Path]] = []
    errors: list[str] = []
    for path in files:
        basename, department = _sample_key(path)
        key = basename if basename.endswith(".pdf") else basename + ".pdf"
        candidates = by_key.get((department, key), []) if department else []
        if not candidates:
            candidates = by_basename.get(key, [])
        if len(candidates) == 1:
            pairs.append((candidates[0], path))
        elif len(candidates) > 1:
            errors.append(f"sample {path.name} maps to multiple department URLs")
        else:
            errors.append(f"sample {path.name} has no matching public index URL")
    return pairs, errors


def _copy_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    shutil.copyfile(source, temporary)
    temporary.replace(destination)


def _quarantine(output: Path, source_id: str, payload: bytes | None, suffix: str, reason: str) -> None:
    folder = output / "quarantine"
    folder.mkdir(parents=True, exist_ok=True)
    if payload:
        target = folder / f"{source_id}.{suffix}"
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_bytes(payload)
        temporary.replace(target)
    note = folder / f"{source_id}.json"
    atomic_write(note, json.dumps({"source_id": source_id, "reason": reason, "at": utc_now()}, ensure_ascii=False, indent=2) + "\n")


def _get_pdf(source: dict[str, Any], output: Path, client: PublicHttpClient,
             *, refresh: bool, sample_path: Path | None = None) -> tuple[bytes, str, dict[str, Any]]:
    cache_path = output / "cache" / f"{source['id']}.pdf"
    metadata = {"etag": source.get("etag"), "last_modified": source.get("last_modified"),
                "fetched_at": source.get("fetched_at")}
    if sample_path is not None:
        payload = sample_path.read_bytes()
        if len(payload) > 10 * 1024 * 1024:
            raise ValueError("PDF exceeds 10 MiB limit")
        if not payload.startswith(b"%PDF-"):
            raise ValueError("local sample does not have a PDF magic header")
        _copy_atomic(sample_path, cache_path)
        return payload, sha256_bytes(payload), {**metadata, "fetched_at": source.get("fetched_at") or utc_now(), "sample_path": str(sample_path)}
    if cache_path.exists() and not refresh:
        payload = cache_path.read_bytes()
        if not payload.startswith(b"%PDF-"):
            raise ValueError("cached file does not have a PDF magic header")
        return payload, sha256_bytes(payload), metadata
    headers: dict[str, str] = {}
    if cache_path.exists() and refresh:
        if source.get("etag"):
            headers["If-None-Match"] = str(source["etag"])
        if source.get("last_modified"):
            headers["If-Modified-Since"] = str(source["last_modified"])
    response, payload, final_url = client.get_pdf(source["url"], headers=headers)
    if response.status_code == 304:
        if not cache_path.exists():
            raise ValueError("server returned 304 but no cached PDF exists")
        payload = cache_path.read_bytes()
        fetched_at = metadata.get("fetched_at") or utc_now()
    else:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/pdf":
            raise ValueError(f"expected application/pdf, received {content_type or 'unknown content type'}")
        if not payload.startswith(b"%PDF-"):
            raise ValueError("response does not have a PDF magic header")
        _copy_atomic_from_bytes(payload, cache_path)
        metadata["etag"] = response.headers.get("ETag")
        metadata["last_modified"] = response.headers.get("Last-Modified")
        fetched_at = utc_now()
    metadata["fetched_at"] = fetched_at
    metadata["final_url"] = final_url
    return payload, sha256_bytes(payload), metadata


def _copy_atomic_from_bytes(payload: bytes, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    temporary.write_bytes(payload)
    temporary.replace(destination)


def _valid_course(course: dict[str, Any]) -> None:
    for field in ("year", "registration_code", "title"):
        value = course.get(field)
        if not value:
            raise ValueError(f"required PDF field missing: {field}")
    if not isinstance(course.get("year"), int) or not (1900 <= course["year"] <= 2200):
        raise ValueError(f"invalid opening year: {course.get('year')!r}")
    if not course.get("slots"):
        course["parse_warnings"].append("no schedule slot was found in PDF or department HTML")


def _validate_natural_identity(course: dict[str, Any], current: dict[str, dict[str, Any]],
                               course_by_source: dict[str, dict[str, Any]]) -> None:
    key = natural_key(course)
    for other in current.values():
        if natural_key(other) == key and other["source_url"] != course["source_url"]:
            raise ValueError(f"natural key {key!r} is already used by {other['source_url']}")
    for source_id, other in course_by_source.items():
        if source_id != course["source_id"] and natural_key(other) == key and other["source_url"] != course["source_url"]:
            raise ValueError(f"natural key {key!r} conflicts with prior valid record {other['source_url']}")


def _run_ingestion(output: Path, *, delay: float, limit: int | None,
                   offline_samples: Path | None, refresh: bool,
                   aliases_path: Path) -> dict[str, Any]:
    started_at = utc_now()
    run_id = f"ingest-{uuid.uuid4().hex}"
    old_manifest = _read_manifest(output / "manifest.json")
    old_courses = course_from_jsonl(output / "courses.jsonl")
    client = PublicHttpClient(delay=delay)
    if offline_samples is not None and old_manifest and old_manifest.get("indexes") and not refresh:
        current_discovered = [dict(source) for source in old_manifest.get("sources", []) if source.get("status") != "missing"]
        indexes = [dict(item) for item in old_manifest.get("indexes", [])]
        discovered_count = int((old_manifest.get("run") or {}).get(
            "discovered_count", (old_manifest.get("counts") or {}).get("discovered", len(current_discovered))))
        # A previous run can carry stale and failed source states. Restore public
        # listing fields while retaining prior attempt metadata.
        old_by_url = {source.get("url"): source for source in old_manifest.get("sources", [])}
        current_discovered = [_source_state(source, old_by_url.get(source["url"])) for source in current_discovered]
        discovered = current_discovered
    else:
        current_discovered, indexes = discover_sources(client)
        discovered_count = len(current_discovered)
        discovered = _merge_discovery(current_discovered, indexes, old_manifest, old_courses)

    current_sources = {source["id"]: source for source in discovered}
    for source in old_manifest.get("sources", []) if old_manifest else []:
        if source.get("id") not in current_sources:
            prior = dict(source)
            prior["status"] = "ready" if any(course.get("source_id") == prior.get("id") for course in old_courses) else "missing"
            prior["last_attempt_status"] = "missing"
            current_sources[prior["id"]] = prior
    sources = list(current_sources.values())

    selected: list[tuple[dict[str, Any], Path | None]]
    sample_errors: list[str] = []
    if offline_samples is not None:
        selected, sample_errors = _match_samples(offline_samples, current_discovered)
        if limit is not None:
            selected = selected[:max(0, limit)]
        samples_out = output / "samples"
        for _, sample_path in selected:
            _copy_atomic(sample_path, samples_out / sample_path.name)
    else:
        chosen = current_discovered if limit is None else current_discovered[:max(0, limit)]
        selected = [(source, None) for source in chosen]

    aliases = load_aliases(aliases_path)
    cache_dir = output / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    sources_by_id = {source["id"]: source for source in sources}
    courses_by_source: dict[str, dict[str, Any]] = {course["source_id"]: course for course in old_courses}
    # Use old valid rows in identity checks, but let a source replace its own row.
    current_new: dict[str, dict[str, Any]] = {}
    for index, (discovered_source, sample_path) in enumerate(selected, 1):
        source = sources_by_id.get(discovered_source["id"], discovered_source)
        source["last_attempt_at"] = utc_now()
        source["last_error"] = None
        print(f"[{index}/{len(selected)}] {source['url']}", flush=True)
        payload: bytes | None = None
        try:
            payload, file_hash, metadata = _get_pdf(source, output, client,
                                                    refresh=refresh, sample_path=sample_path)
            cache_path = cache_dir / f"{source['id']}.pdf"
            course, _ = extract_file(cache_path, source=source, source_sha256=file_hash,
                                    aliases=aliases, fetched_at=metadata.get("fetched_at"))
            _valid_course(course)
            validate_course_export_limits(course)
            _validate_natural_identity(course, current_new, courses_by_source)
            current_new[source["id"]] = course
            courses_by_source[source["id"]] = course
            source.update({"status": "ready", "last_attempt_status": "ready", "sha256": file_hash,
                           "fetched_at": metadata.get("fetched_at"), "etag": metadata.get("etag"),
                           "last_modified": metadata.get("last_modified"), "last_error": None,
                           "sample_path": metadata.get("sample_path")})
        except Exception as exc:
            message = str(exc)
            previous = courses_by_source.get(source["id"])
            source["status"] = "ready" if previous else ("conflict" if "natural key" in message else "failed")
            source["last_attempt_status"] = "conflict" if "natural key" in message else "failed"
            source["last_error"] = message
            if payload is None:
                candidate_cache = cache_dir / f"{source['id']}.pdf"
                if candidate_cache.exists():
                    payload = candidate_cache.read_bytes()
            _quarantine(output, source["id"], payload, "pdf", message)
            if source["last_attempt_status"] == "failed":
                print(f"  failed: {message}", file=sys.stderr, flush=True)
            else:
                print(f"  conflict: {message}", file=sys.stderr, flush=True)

    courses = list(courses_by_source.values())
    courses.sort(key=lambda course: (course["year"], course["department"], course["registration_code"], course.get("variant_key", ""), course["source_url"]))
    manifest = _write_run(output, sources, indexes, courses, run_id=run_id,
                          mode="offline-samples" if offline_samples is not None else "run",
                          started_at=started_at, discovered_count=discovered_count, sample_errors=sample_errors)
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ingest the public Shinshu University syllabus index and PDFs.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("discover", "run", "export"):
        command = sub.add_parser(name, help={
            "discover": "fetch the 21 public department indexes and record PDF URLs plus schedule slots",
            "run": "discover and ingest PDFs, with optional local samples for offline extraction",
            "export": "write idempotent Wrangler SQL and optionally apply to local SQLite",
        }[name])
        command.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="runtime data directory (default: data)")
        if name == "run":
            command.add_argument("--limit", type=int, help="maximum PDF documents to ingest (all remain listed in the manifest)")
        if name in ("discover", "run"):
            command.add_argument("--delay", type=float, default=1.0, help="minimum seconds between HTTP requests (default: 1)")
        if name == "run":
            command.add_argument("--offline-samples", type=Path, help="use local *.pdf samples instead of downloading matching PDFs")
            command.add_argument("--refresh", action="store_true", help="refresh index pages and bypass the PDF cache")
            command.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES, help="teacher/room alias JSON")
        if name == "export":
            command.add_argument("--apply-sqlite", action="store_true", help="also apply one transaction per course to output/syllabus.sqlite")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        if args.command == "discover":
            manifest = _write_discovery(args.output, delay=args.delay)
            print(json.dumps(manifest["counts"], ensure_ascii=False, sort_keys=True))
            print(f"Wrote {args.output / 'manifest.json'} with {manifest['counts']['discovered']} PDF URLs")
            return 0 if all(item.get("status") == "ready" for item in manifest["indexes"]) else 1
        if args.command == "run":
            manifest = _run_ingestion(args.output, delay=args.delay, limit=args.limit,
                                      offline_samples=args.offline_samples, refresh=args.refresh,
                                      aliases_path=args.aliases)
            print(json.dumps(manifest["counts"], ensure_ascii=False, sort_keys=True))
            print(f"Wrote {args.output / 'courses.jsonl'} and {args.output / 'manifest.json'}")
            return 0 if manifest["counts"]["failed"] == 0 and manifest["counts"]["conflict"] == 0 and not manifest.get("sample_errors") else 1
        sql_path = export_sql(args.output)
        if args.apply_sqlite:
            apply_sqlite(args.output, args.output / "syllabus.sqlite")
            print(f"Applied course transactions to {args.output / 'syllabus.sqlite'}")
        print(f"Wrote {sql_path}")
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"ingest {args.command} failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
