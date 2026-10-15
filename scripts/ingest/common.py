"""Shared ingestion contracts and deterministic normalization helpers."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

SOURCE_HOST = "lms.ealps.shinshu-u.ac.jp"
SOURCE_ROOT = f"https://{SOURCE_HOST}/syllabus/"
PARSER_VERSION = "syllabus-ingest-1"
MAX_PDF_BYTES = 10 * 1024 * 1024
REQUEST_TIMEOUT = 30

DAYS = {"月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6, "日": 7}
DASHES = str.maketrans({chr(code): "-" for code in (*range(0x2010, 0x2016), 0x2212, 0xFF0D)})
COURSE_KEYS = (
    "schema_version", "id", "source_id", "source_url", "source_sha256", "fetched_at",
    "year", "department", "department_name", "registration_code", "variant_key", "title",
    "teacher_text", "room_text", "credits", "term_text", "title_search", "teacher_search",
    "room_search", "code_search", "body_search", "raw_metadata", "parse_warnings", "modalities",
    "modality_evidence", "slots", "pages", "content_revision",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_id(prefix: str, value: str, length: int = 32) -> str:
    return f"{prefix}_{sha256_bytes(value.encode('utf-8'))[:length]}"


def canonical_url(url: str, base: str | None = None) -> str:
    """Resolve an URL and reject anything outside the public syllabus origin."""
    resolved = urljoin(base or SOURCE_ROOT, url.strip())
    parts = urlsplit(resolved)
    if parts.scheme.lower() != "https" or (parts.hostname or "").lower() != SOURCE_HOST:
        raise ValueError(f"URL is outside the permitted HTTPS host: {url}")
    if parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError(f"URL contains an unsupported authority: {url}")
    path = re.sub(r"/{2,}", "/", parts.path)
    if not path.startswith("/syllabus/"):
        raise ValueError(f"URL is outside /syllabus/: {url}")
    if "\\" in path or any(part in (".", "..") for part in path.split("/")):
        raise ValueError(f"URL contains an unsafe path: {url}")
    if parts.query or parts.fragment:
        # The source currently uses path-only URLs; rejecting query variants avoids
        # treating tracking or redirect parameters as canonical PDF identities.
        raise ValueError(f"URL has an unsupported query or fragment: {url}")
    return urlunsplit(("https", SOURCE_HOST, path, "", ""))


def require_pdf_url(url: str, base: str | None = None) -> str:
    canonical = canonical_url(url, base)
    if not urlsplit(canonical).path.lower().endswith(".pdf"):
        raise ValueError(f"URL is not a PDF under the syllabus source: {url}")
    return canonical


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    return re.sub(r"\s+", " ", value).strip()


def normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).translate(DASHES).lower()
    return re.sub(r"\s+", "", value).strip()


def load_aliases(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {"teachers": {}, "rooms": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, dict[str, str]] = {"teachers": {}, "rooms": {}}
    for group in result:
        for alias, canonical in (data.get(group) or {}).items():
            alias_key = normalize_key(str(alias))
            canonical_value = str(canonical).strip()
            if alias_key and canonical_value:
                result[group][alias_key] = canonical_value
    return result


def alias_search(value: str, aliases: dict[str, str]) -> str:
    """Keep the observed form and append canonical tokens for exact aliases.

    Teacher and room aliases can match the complete field or a complete item
    separated by punctuation. Names and room numbers are never matched as
    substrings (for example, alias 工101 does not match 工1010).
    """
    base = normalize_key(value)
    parts = {normalize_key(part) for part in re.split(r"[/／・･、,，;；|｜]", value) if normalize_key(part)}
    additions = sorted({normalize_key(canonical) for alias, canonical in aliases.items()
                        if normalize_key(alias) in parts and normalize_key(canonical)
                        and normalize_key(canonical) not in parts})
    return " ".join([base, *additions]).strip()


def natural_key(course: dict[str, Any]) -> tuple[int, str, str, str]:
    return (int(course["year"]), str(course["department"]), str(course["registration_code"]),
            str(course.get("variant_key", "")))


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def course_from_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    courses: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            course = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid JSONL at {path}:{line_no}: {exc}") from exc
        courses.append(course)
    return courses


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)
