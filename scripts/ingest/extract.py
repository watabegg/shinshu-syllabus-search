"""PDF text extraction and conservative syllabus header parsing."""

from __future__ import annotations

import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Any

from .common import PARSER_VERSION, compact_json, normalize_text, sha256_bytes, stable_id, utc_now
from .normalize import classify_modalities, detect_slots, has_japanese, search_fields

FIELD_LABELS: dict[str, tuple[str, ...]] = {
    "registration_code": ("時間割コード", "登録コード", "講義コード", "科目コード"),
    "year": ("開講年度", "年度"),
    "title": ("授業科目名", "授業題目", "授業科目", "科目名称", "講義名", "科目名", "授業名"),
    "teacher_primary": ("担当教員", "主担当教員", "主担当", "担当者"),
    "teacher_sub": ("副担当",),
    "credits": ("単位数",),
    "term": ("講義期間", "開講期間", "開講学期", "学期"),
    "schedule": ("曜日・時限", "曜日･時限", "曜日時限", "曜日・講時", "曜日･講時"),
    "room": ("講義室", "教室等", "教室", "講義場所"),
    "teaching_format": ("授業形態", "授業区分", "授業方式", "講義形態"),
    "distance_flag": ("遠隔授業科目", "遠隔授業",),
    "_boundary": ("英文授業科目名", "英文授業名", "対象専攻／学年", "対象専攻/学年",
                  "対象専攻/学年、講義期間、曜日・時限", "対象学生", "対象学年", "履修学年",
                  "備考", "授業科目区分"),
}
ALL_LABELS = sorted({label for labels in FIELD_LABELS.values() for label in labels}, key=len, reverse=True)
# Labels appear at the start of a layout cell, while the same words may also
# occur at the end of values (for example a room name ending in 講義室).
LABEL_RE = re.compile(r"(?<!\S)(?:" + "|".join(re.escape(label) for label in ALL_LABELS) + r")(?=[\s:：]|$)")


def extract_pdf(pdf_path: Path, timeout: int = 60) -> tuple[list[str], list[str]]:
    try:
        process = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf_path), "-"],
                                 check=False, capture_output=True, timeout=timeout)
    except FileNotFoundError as exc:
        raise RuntimeError("pdftotext (Poppler) is required but was not found") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"pdftotext exceeded {timeout}s") from exc
    text = process.stdout.decode("utf-8", errors="replace")
    stderr = process.stderr.decode("utf-8", errors="replace").strip()
    warnings: list[str] = []
    if process.returncode != 0:
        raise RuntimeError(f"pdftotext failed with exit {process.returncode}: {stderr[:300]}")
    if "\ufffd" in text:
        warnings.append("extracted text contains Unicode replacement characters")
    if stderr:
        warnings.append(f"pdftotext: {stderr[:300]}")
    pages = text.split("\f")
    while pages and not pages[-1].strip():
        pages.pop()
    if not pages:
        raise RuntimeError("pdftotext returned no text")
    return pages, warnings


def _preamble(pages: list[str]) -> str:
    first_page = pages[0] if pages else ""
    normalized = unicodedata.normalize("NFKC", first_page)
    marker = re.search(
        r"(?m)^\s*(?:\(?\s*1\s*\)?\s*(?:授業|【|[\u3040-\u30ff\u4e00-\u9fff])|"
        r"信大コンピテンシー|授業の達成目標|授業の概要|授業概要|授業計画)", normalized)
    if marker:
        return normalized[:marker.start()]
    return "\n".join(normalized.splitlines()[:45])


def _field_values(header: str) -> dict[str, list[str]]:
    matches = list(LABEL_RE.finditer(header))
    values: dict[str, list[str]] = {name: [] for name in FIELD_LABELS}
    label_to_field = {label: field for field, labels in FIELD_LABELS.items() for label in labels}
    for index, match in enumerate(matches):
        field = label_to_field[match.group(0)]
        if field == "_boundary":
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(header)
        raw = header[match.end():end]
        # Each label's value is normally on the same layout row. A few exported
        # PDFs place it immediately below, so retain later nonempty lines too.
        lines = [re.sub(r"\s+", " ", line).strip(" \t:：|・") for line in raw.splitlines()]
        value = " ".join(line for line in lines if line).strip()
        if value:
            values[field].append(value)
    return values


def _choose(values: list[str], *, first_line: bool = False) -> str:
    for value in values:
        cleaned = re.sub(r"\s+", " ", value).strip(" \t:：|・")
        if cleaned:
            if first_line:
                return cleaned.split(" | ", 1)[0].strip()
            return cleaned
    return ""


def _extract_title(fields: dict[str, list[str]], header: str) -> str:
    fallback = ""
    for value in fields["title"]:
        if value:
            # A separated course-name row sometimes includes its English name
            # before the next field. Prefer the first Japanese-bearing segment.
            candidates = [part.strip() for part in re.split(r"\s{2,}| \| ", value) if part.strip()]
            if candidates:
                for candidate in candidates:
                    if has_japanese(candidate):
                        return candidate
                if not fallback:
                    fallback = candidates[0]
    # One current nursing-school template renders the Japanese title above the
    # standalone 科目名 label. Use only an unlabeled Japanese preamble row.
    for line in header.splitlines()[:8]:
        candidate = re.sub(r"\s+", " ", line).strip()
        if (has_japanese(candidate) and not LABEL_RE.search(candidate)
                and not re.search(r"(?:登録|時間割|開講|年度|単位数|担当教員|英文授業)", candidate)):
            return candidate
    return fallback


def _clean_teacher(primary: str, secondary: str) -> str:
    pieces = [value.strip() for value in (primary, secondary) if value.strip()]
    # PDF layout extraction can place the 副担当 label beside a wrapped
    # primary-teacher line. A slash would invent a reliable name boundary and
    # break searches for names split across those two values. Whitespace is
    # retained for display and removed by teacher_search normalization.
    return " ".join(pieces)


def parse_course(pages: list[str], *, source: dict[str, Any], source_sha256: str,
                 aliases: dict[str, dict[str, str]], fetched_at: str | None = None) -> dict[str, Any]:
    header = _preamble(pages)
    fields = _field_values(header)
    warnings: list[str] = []
    code = unicodedata.normalize("NFKC", _choose(fields["registration_code"]))
    year_text = _choose(fields["year"])
    year_match = re.search(r"(?<!\d)(20\d{2})(?!\d)", unicodedata.normalize("NFKC", year_text))
    year = int(year_match.group(1)) if year_match else 0
    title = _extract_title(fields, header)
    if not code:
        warnings.append("registration code not found in PDF header")
    if not year:
        warnings.append("opening year not found in PDF header")
    if not title:
        warnings.append("course title not found in PDF header")

    teacher_primary = _choose(fields["teacher_primary"])
    teacher_sub = _choose(fields["teacher_sub"])
    teacher_text = _clean_teacher(teacher_primary, teacher_sub)
    if teacher_primary and teacher_sub:
        warnings.append("primary/sub teacher label boundary may be visually ambiguous in PDF layout text")
    room_text = _choose(fields["room"])
    credits = _choose(fields["credits"])
    term_text = _choose(fields["term"])
    schedule_text = _choose(fields["schedule"])
    # A nursing-school PDF template labels a combined row "単位数、講義室"
    # and places values on the next line. Read only that explicit row shape.
    combined_room = re.search(r"単位数\s*[、，,]\s*講義室\s*([\s\S]*?)(?=授業形態|授業科目区分|備考|$)", header)
    if combined_room:
        combined_value = re.sub(r"\s+", " ", combined_room.group(1)).strip()
        credit_match = re.search(r"([0-9０-９]+)\s*単位", combined_value)
        if credit_match:
            credits = unicodedata.normalize("NFKC", credit_match.group(1))
            room_text = combined_value[credit_match.end():].strip()
            room_text = re.split(r"\s+遠隔授業科目\b", room_text)[0].strip()
    if not term_text:
        term_match = re.search(r"(?<!\S)(前期|後期|通年|春学期|秋学期)(?:\([^)]*\))?", header)
        if term_match:
            term_text = term_match.group(0)
    if not schedule_text:
        schedule_matches = re.findall(r"[月火水木金土日]曜(?:日)?\s*[･・、,]?\s*[0-9]+\s*(?:時限|限|コマ)", header)
        if schedule_matches:
            schedule_text = " ".join(schedule_matches)
    slots = list(source.get("slots", []))
    for slot in detect_slots(term_text, schedule_text):
        if slot not in slots:
            slots.append(slot)
    if source.get("slots") and schedule_text:
        html_values = {(slot.get("day"), slot.get("period")) for slot in source["slots"] if slot.get("source_kind") == "html"}
        pdf_values = {(slot.get("day"), slot.get("period")) for slot in detect_slots(term_text, schedule_text)}
        known_html = {value for value in html_values if value[0] is not None or value[1] is not None}
        known_pdf = {value for value in pdf_values if value[0] is not None or value[1] is not None}
        if known_html and known_pdf and known_html != known_pdf:
            warnings.append(f"HTML/PDF schedule differs: html={sorted(known_html)} pdf={sorted(known_pdf)}")

    modalities, modality_evidence, modality_warnings = classify_modalities(pages)
    warnings.extend(modality_warnings)
    if not teacher_text:
        warnings.append("teacher fields were not found in PDF header")
    if not room_text:
        warnings.append("classroom field was not found in PDF header")

    department = str(source["department"])
    department_name = str(source["department_name"])
    if source.get("anchor_codes") and code and code not in source["anchor_codes"]:
        warnings.append(f"PDF registration code {code} differs from HTML code(s): {', '.join(source['anchor_codes'])}")
    normalized_title = normalize_text(title)
    if source.get("anchor_titles") and title and not any(
        normalized_title == normalize_text(html_title)
        or normalized_title in normalize_text(html_title)
        or normalize_text(html_title) in normalized_title
        for html_title in source["anchor_titles"]
    ):
        warnings.append("PDF title differs from the title shown in the department index")

    natural = f"{year}:{department}:{code}:"
    course_id = stable_id("course", natural)
    source_id = str(source.get("id") or stable_id("source", str(source["url"])))
    metadata = {
        "teacher_primary": teacher_primary,
        "teacher_sub": teacher_sub,
        "schedule": schedule_text,
        "teaching_format": _choose(fields["teaching_format"]),
        "distance_flag": _choose(fields["distance_flag"]),
        "html_titles": "\n".join(source.get("anchor_titles", [])),
        "html_codes": "\n".join(source.get("anchor_codes", [])),
    }
    metadata = {key: str(value) for key, value in metadata.items()}
    search = search_fields(title=title, teacher=teacher_text, room=room_text, code=code,
                           pages=pages, aliases=aliases)
    revision = sha256_bytes((PARSER_VERSION + ":" + source_sha256 + ":" + compact_json(aliases)).encode("utf-8"))
    course: dict[str, Any] = {
        "schema_version": 1,
        "id": course_id,
        "source_id": source_id,
        "source_url": str(source["url"]),
        "source_sha256": source_sha256,
        "fetched_at": fetched_at or utc_now(),
        "year": year,
        "department": department,
        "department_name": department_name,
        "registration_code": code,
        "variant_key": "",
        "title": title,
        "teacher_text": teacher_text,
        "room_text": room_text,
        "credits": credits,
        "term_text": term_text,
        **search,
        "raw_metadata": metadata,
        "parse_warnings": list(dict.fromkeys(warnings)),
        "modalities": modalities,
        "modality_evidence": modality_evidence,
        "slots": slots,
        "pages": [{"page_number": index, "raw_text": page} for index, page in enumerate(pages, 1)],
        "content_revision": revision,
    }
    # Keep the JSONL shape identical to the TypeScript contract.
    from .common import COURSE_KEYS
    return {key: course[key] for key in COURSE_KEYS}


def extract_file(pdf_path: Path, *, source: dict[str, Any], source_sha256: str,
                 aliases: dict[str, dict[str, str]], fetched_at: str | None = None) -> tuple[dict[str, Any], list[str]]:
    pages, warnings = extract_pdf(pdf_path)
    course = parse_course(pages, source=source, source_sha256=source_sha256,
                          aliases=aliases, fetched_at=fetched_at)
    course["parse_warnings"] = list(dict.fromkeys([*warnings, *course["parse_warnings"]]))
    return course, warnings
