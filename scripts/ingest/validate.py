#!/usr/bin/env python3
"""Validate an ingestion manifest, JSONL contract, and local sample PDFs."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.ingest.common import (  # noqa: E402
    COURSE_KEYS,
    course_from_jsonl,
    natural_key,
    normalize_text,
    require_pdf_url,
    sha256_bytes,
    stable_id,
)
from scripts.ingest.extract import extract_pdf  # noqa: E402
from scripts.ingest.main import _match_samples  # noqa: E402

HASH_RE = re.compile(r"^[0-9a-f]{64}$")
SOURCE_STATUSES = {"pending", "ready", "failed", "conflict", "missing"}
MODALITIES = {"in_person", "on_demand", "live_online", "remote_unspecified", "unknown"}


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot load manifest {path}: {exc}") from exc
    if not isinstance(manifest, dict):
        raise ValueError("manifest root must be an object")
    return manifest


def validate(manifest_path: Path, samples_dir: Path, strict: bool) -> tuple[list[str], dict[str, Any]]:
    errors: list[str] = []
    manifest = _load_manifest(manifest_path)
    output_dir = manifest_path.parent
    try:
        courses = course_from_jsonl(output_dir / "courses.jsonl")
    except ValueError as exc:
        return [str(exc)], {}
    sources = manifest.get("sources")
    indexes = manifest.get("indexes")
    if manifest.get("schema_version") != 1:
        errors.append("manifest schema_version must be 1")
    if not isinstance(sources, list):
        errors.append("manifest sources must be a list")
        sources = []
    if not isinstance(indexes, list):
        errors.append("manifest indexes must be a list")
        indexes = []

    source_by_id: dict[str, dict[str, Any]] = {}
    source_by_url: dict[str, dict[str, Any]] = {}
    source_ids: set[str] = set()
    for number, source in enumerate(sources, 1):
        label = f"source #{number}"
        if not isinstance(source, dict):
            errors.append(f"{label} is not an object")
            continue
        source_id = source.get("id")
        url = source.get("url")
        try:
            canonical = require_pdf_url(str(url))
        except ValueError as exc:
            errors.append(f"{label} has unsafe PDF URL: {exc}")
            continue
        if canonical != url:
            errors.append(f"{label} URL is not canonical: {url}")
        expected_id = stable_id("source", canonical)
        if source_id != expected_id:
            errors.append(f"{label} ID does not match its URL: {source_id}")
        if source_id in source_ids:
            errors.append(f"duplicate source ID: {source_id}")
        if canonical in source_by_url:
            errors.append(f"duplicate source URL: {canonical}")
        source_ids.add(str(source_id))
        source_by_id[str(source_id)] = source
        source_by_url[canonical] = source
        if source.get("status") not in SOURCE_STATUSES:
            errors.append(f"{label} has invalid status {source.get('status')!r}")
        if source.get("last_attempt_status") not in SOURCE_STATUSES:
            errors.append(f"{label} has invalid last_attempt_status {source.get('last_attempt_status')!r}")
        slots = source.get("slots", [])
        if not isinstance(slots, list):
            errors.append(f"{label} slots must be a list")
            continue
        seen_slots: set[str] = set()
        for slot in slots:
            if not isinstance(slot, dict):
                errors.append(f"{label} contains a non-object HTML slot")
                continue
            if slot.get("source_kind") != "html":
                errors.append(f"{label} contains a non-HTML source slot")
            day, period = slot.get("day"), slot.get("period")
            if day is not None and (not isinstance(day, int) or not 1 <= day <= 7):
                errors.append(f"{label} has invalid HTML day {day!r}")
            if period is not None and (not isinstance(period, int) or period < 1):
                errors.append(f"{label} has invalid HTML period {period!r}")
            for field in ("term_label", "day_label", "period_label"):
                if not isinstance(slot.get(field), str):
                    errors.append(f"{label} HTML slot {field} must be text")
            key = json.dumps(slot, ensure_ascii=False, sort_keys=True)
            if key in seen_slots:
                errors.append(f"{label} contains duplicate HTML slot metadata")
            seen_slots.add(key)

    if len(source_by_url) != len(sources):
        # Per-source URL problems were reported above; avoid secondary errors.
        pass
    departments = {str(index.get("department", "")) for index in indexes if isinstance(index, dict)}
    index_failures = [index for index in indexes if not isinstance(index, dict) or index.get("status") != "ready"]
    for index in index_failures:
        if isinstance(index, dict):
            errors.append(f"department index {index.get('department', '?')} status is {index.get('status')!r}: {index.get('error') or ''}".rstrip())
        else:
            errors.append("manifest contains a non-object department index")
    if strict and len(indexes) != 21:
        errors.append(f"strict coverage expects all 21 department indexes; found {len(indexes)}")
    if len(departments) != len(indexes):
        errors.append("department index IDs are missing or duplicated")

    course_ids: set[str] = set()
    natural_keys: dict[tuple[int, str, str, str], str] = {}
    courses_by_source: dict[str, dict[str, Any]] = {}
    for number, course in enumerate(courses, 1):
        label = f"course line #{number}"
        if set(course) != set(COURSE_KEYS):
            missing = sorted(set(COURSE_KEYS) - set(course))
            extra = sorted(set(course) - set(COURSE_KEYS))
            errors.append(f"{label} contract keys mismatch (missing={missing}, extra={extra})")
            continue
        if course.get("schema_version") != 1:
            errors.append(f"{label} schema_version must be 1")
        course_id = course.get("id")
        source_id = course.get("source_id")
        if course_id in course_ids:
            errors.append(f"duplicate course ID: {course_id}")
        course_ids.add(str(course_id))
        for field in ("year", "department", "registration_code", "title"):
            if not course.get(field):
                errors.append(f"{label} required field {field} is empty")
        if not isinstance(course.get("year"), int) or not 1900 <= course.get("year", 0) <= 2200:
            errors.append(f"{label} year is invalid: {course.get('year')!r}")
        if not HASH_RE.fullmatch(str(course.get("source_sha256", ""))):
            errors.append(f"{label} source_sha256 is not a lowercase SHA-256")
        source = source_by_id.get(str(source_id))
        if source is None:
            errors.append(f"{label} refers to unknown source_id {source_id!r}")
        else:
            if course.get("source_url") != source.get("url"):
                errors.append(f"{label} source URL differs from its manifest record")
            if source.get("status") != "ready":
                errors.append(f"{label} exists while its source status is {source.get('status')!r}")
        try:
            key = natural_key(course)
        except (KeyError, TypeError, ValueError):
            key = None
        if key is not None:
            previous_source = natural_keys.get(key)
            if previous_source is not None and previous_source != source_id:
                errors.append(f"natural key {key!r} is duplicated by different sources")
            natural_keys[key] = str(source_id)
        if str(source_id) in courses_by_source:
            errors.append(f"source {source_id} has more than one valid course")
        courses_by_source[str(source_id)] = course
        if not isinstance(course.get("raw_metadata"), dict):
            errors.append(f"{label} raw_metadata must be an object")
        for field in ("parse_warnings", "modalities", "modality_evidence", "slots", "pages"):
            if not isinstance(course.get(field), list):
                errors.append(f"{label} {field} must be a list")
        if not isinstance(course.get("parse_warnings"), list):
            continue
        if any(not isinstance(warning, str) for warning in course["parse_warnings"]):
            errors.append(f"{label} parse_warnings must contain strings")
        if not set(course.get("modalities", [])) <= MODALITIES:
            errors.append(f"{label} has unknown modality values")
        if not isinstance(course.get("body_search"), str) or course.get("body_search") != normalize_text(
            "\n".join(page.get("raw_text", "") for page in course.get("pages", []) if isinstance(page, dict))
        ):
            errors.append(f"{label} body_search does not match normalized extracted page text")
        for slot in course.get("slots", []):
            if not isinstance(slot, dict) or slot.get("source_kind") not in {"html", "pdf"}:
                errors.append(f"{label} contains an invalid slot")
                continue
            if slot.get("day") is not None and (not isinstance(slot["day"], int) or not 1 <= slot["day"] <= 7):
                errors.append(f"{label} slot has invalid day {slot.get('day')!r}")
            if slot.get("period") is not None and (not isinstance(slot["period"], int) or slot["period"] < 1):
                errors.append(f"{label} slot has invalid period {slot.get('period')!r}")
        for page_number, page in enumerate(course.get("pages", []), 1):
            if not isinstance(page, dict) or page.get("page_number") != page_number or not isinstance(page.get("raw_text"), str):
                errors.append(f"{label} page records must be text and numbered contiguously from 1")
                break

    sample_files = sorted(samples_dir.glob("*.pdf")) if samples_dir.exists() else []
    sample_pairs, sample_mapping_errors = _match_samples(samples_dir, sources)
    errors.extend(sample_mapping_errors)
    sampled: set[str] = set()
    sample_chars = 0
    sample_pages = 0
    for source, path in sample_pairs:
        sampled.add(source["id"])
        if source.get("status") != "ready":
            errors.append(f"sample {path.name} maps to non-ready source {source['id']}")
        course = courses_by_source.get(source["id"])
        if course is None:
            errors.append(f"sample {path.name} has no valid course record")
            continue
        try:
            payload = path.read_bytes()
            if len(payload) > 10 * 1024 * 1024:
                errors.append(f"sample {path.name} exceeds 10 MiB")
            if not payload.startswith(b"%PDF-"):
                errors.append(f"sample {path.name} lacks a PDF magic header")
            digest = sha256_bytes(payload)
            if digest != course.get("source_sha256"):
                errors.append(f"sample {path.name} SHA-256 differs from the accepted course record")
            extracted_pages, _ = extract_pdf(path)
            stored_pages = [page.get("raw_text") for page in course.get("pages", [])]
            if extracted_pages != stored_pages:
                errors.append(f"sample {path.name} Poppler text differs from stored course pages")
            sample_pages += len(extracted_pages)
            sample_chars += sum(len(page) for page in extracted_pages)
        except (OSError, RuntimeError, ValueError) as exc:
            errors.append(f"could not validate sample {path.name}: {exc}")

    if strict and not sample_files:
        errors.append(f"strict validation found no PDF samples in {samples_dir}")
    if strict and len(sampled) != len(sample_files):
        errors.append(f"strict validation matched {len(sampled)} of {len(sample_files)} sample PDFs")
    sample_errors = manifest.get("sample_errors", [])
    if strict and sample_errors:
        errors.append(f"manifest records {len(sample_errors)} offline sample mapping error(s)")

    status_counts = Counter(str(source.get("status", "invalid")) for source in sources if isinstance(source, dict))
    modality_counts = Counter(modality for course in courses for modality in course.get("modalities", []) if isinstance(modality, str))
    parse_warning_count = sum(len(course.get("parse_warnings", [])) for course in courses if isinstance(course.get("parse_warnings"), list))
    html_slot_count = sum(len(source.get("slots", [])) for source in sources if isinstance(source, dict) and isinstance(source.get("slots", []), list))
    report = {
        "indexes": len(indexes),
        "sources": len(sources),
        "source_statuses": dict(sorted(status_counts.items())),
        "courses": len(courses),
        "html_slots": html_slot_count,
        "sample_pdfs": len(sample_files),
        "sampled_sources": len(sampled),
        "sample_pages": sample_pages,
        "sample_extracted_characters": sample_chars,
        "modalities": dict(sorted(modality_counts.items())),
        "parse_warnings": parse_warning_count,
        "unknown_modality_courses": sum("unknown" in course.get("modalities", []) for course in courses),
        "errors": len(errors),
        "strict": strict,
    }
    return errors, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate ingestion output and local PDF samples.")
    parser.add_argument("--manifest", type=Path, required=True, help="manifest.json path")
    parser.add_argument("--samples", type=Path, required=True, help="directory containing local sample PDFs")
    parser.add_argument("--strict", action="store_true", help="require a complete 21-index discovery and all samples ready")
    args = parser.parse_args(argv)
    try:
        errors, report = validate(args.manifest, args.samples, args.strict)
    except ValueError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
