"""Discover department PDF links and preserve every HTML schedule slot."""

from __future__ import annotations

import re
import unicodedata
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlsplit

from .common import SOURCE_ROOT, DAYS, require_pdf_url, canonical_url, stable_id
from .http_client import PublicHttpClient


class _PortalParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchor: dict[str, Any] | None = None
        self.details: list[dict[str, str]] = []
        self.summary_target: dict[str, str] | None = None
        self.class_stack: list[str] = []
        self.faculties: list[dict[str, str]] = []
        self.links: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        classes = values.get("class", "").split()
        if tag == "details":
            self.details.append({"class": " ".join(classes), "summary": ""})
        if tag == "summary" and self.details:
            self.summary_target = self.details[-1]
        if tag == "a":
            self.anchor = {"href": values.get("href", ""), "classes": classes,
                           "text": [], "code": [], "class_stack": [],
                           "details": [dict(item) for item in self.details]}
        if self.anchor is not None and tag not in ("a",):
            self.anchor["class_stack"].append((tag, classes))

    def handle_endtag(self, tag: str) -> None:
        if tag == "summary":
            self.summary_target = None
        if self.anchor is not None and tag == "a":
            item = self.anchor
            if "faculty-card" in item["classes"]:
                self.faculties.append({"href": item["href"], "name": " ".join(item["text"]).strip()})
            elif item["href"].lower().split("?", 1)[0].endswith(".pdf"):
                item["title"] = " ".join(item["text"]).strip()
                item["code"] = " ".join(item["code"]).strip()
                self.links.append(item)
            self.anchor = None
            return
        if self.anchor is not None:
            stack = self.anchor["class_stack"]
            for index in range(len(stack) - 1, -1, -1):
                if stack[index][0] == tag:
                    del stack[index:]
                    break
        if tag == "details" and self.details:
            self.details.pop()

    def handle_data(self, data: str) -> None:
        if self.summary_target is not None:
            self.summary_target["summary"] += data
        if self.anchor is not None:
            self.anchor["text"].append(data)
            if any("code-tag" in classes for _, classes in self.anchor["class_stack"]):
                self.anchor["code"].append(data)


def _html_slot(detail_path: list[dict[str, str]]) -> dict[str, Any]:
    term = next((item["summary"].strip() for item in detail_path if "semester" in item["class"]), "")
    day_label = next((item["summary"].strip() for item in detail_path if "day" in item["class"]), "")
    period_label = next((item["summary"].strip() for item in detail_path if "period" in item["class"]), "")
    day = None
    match = re.search(r"([月火水木金土日])曜", day_label)
    if match:
        day = DAYS[match.group(1)]
    period_match = re.search(r"([0-9０-９]+)", period_label)
    period = int(period_match.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789"))) if period_match else None
    return {"term_label": term, "day_label": day_label, "period_label": period_label,
            "day": day, "period": period, "source_kind": "html"}


def _faculty_id(url: str) -> str:
    parts = urlsplit(url)
    match = re.search(r"/syllabus/([^/]+)/index\.html$", parts.path, re.IGNORECASE)
    if not match:
        raise ValueError(f"department index is not a direct syllabus department page: {url}")
    return match.group(1).lower()


def parse_homepage(html: str, home_url: str = SOURCE_ROOT) -> list[dict[str, str]]:
    parser = _PortalParser()
    parser.feed(html)
    faculties: dict[str, dict[str, str]] = {}
    for raw in parser.faculties:
        try:
            url = canonical_url(raw["href"], home_url)
            department = _faculty_id(url)
        except ValueError:
            continue
        name = re.sub(r"\s+", " ", raw["name"]).strip()
        if name:
            faculties.setdefault(url, {"department": department, "department_name": name, "url": url})
    return list(faculties.values())


def parse_department(html: str, department: dict[str, str]) -> list[dict[str, Any]]:
    parser = _PortalParser()
    parser.feed(html)
    sources: dict[str, dict[str, Any]] = {}
    for link in parser.links:
        try:
            url = require_pdf_url(link["href"], department["url"])
        except ValueError:
            continue
        source = sources.setdefault(url, {
            "id": stable_id("source", url), "url": url, "department": department["department"],
            "department_name": department["department_name"], "slots": [],
            "anchor_titles": [], "anchor_codes": [], "status": "pending",
            "last_attempt_status": "pending", "sha256": None, "fetched_at": None,
            "last_attempt_at": None, "last_error": None,
        })
        slot = _html_slot(link["details"])
        if slot not in source["slots"]:
            source["slots"].append(slot)
        title = re.sub(r"\s+", " ", link.get("title", "")).strip()
        code = re.sub(r"\s+", " ", link.get("code", "")).strip()
        if code:
            normalized_code = unicodedata.normalize("NFKC", code)
            wrapped_code = re.fullmatch(r"\s*[（(\[]*([A-Za-z0-9][A-Za-z0-9-]{3,})[）)\]]*\s*", normalized_code)
            if wrapped_code:
                code = wrapped_code.group(1)
        if not code:
            m = re.search(r"\(([A-Za-z0-9-]{4,})\)\s*$", title)
            if m:
                code = m.group(1)
                title = title[:m.start()].strip()
        if title and title not in source["anchor_titles"]:
            source["anchor_titles"].append(title)
        if code and code not in source["anchor_codes"]:
            source["anchor_codes"].append(code)
    return list(sources.values())


def discover(client: PublicHttpClient) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    html, home_metadata = client.get_html(SOURCE_ROOT)
    faculties = parse_homepage(html, home_metadata["final_url"])
    if not faculties:
        raise RuntimeError("public syllabus homepage contained no department index links")
    index_rows: list[dict[str, Any]] = []
    all_sources: dict[str, dict[str, Any]] = {}
    for faculty in faculties:
        row: dict[str, Any] = {**faculty, "status": "pending", "http_status": None,
                               "discovered_count": 0, "error": None}
        try:
            page, metadata = client.get_html(faculty["url"])
            row["http_status"] = metadata["http_status"]
            row["final_url"] = metadata["final_url"]
            discovered = parse_department(page, faculty)
            row["status"] = "ready"
            row["discovered_count"] = len(discovered)
            for source in discovered:
                existing = all_sources.get(source["url"])
                if existing:
                    for slot in source["slots"]:
                        if slot not in existing["slots"]:
                            existing["slots"].append(slot)
                    for field in ("anchor_titles", "anchor_codes"):
                        for value in source[field]:
                            if value not in existing[field]:
                                existing[field].append(value)
                else:
                    all_sources[source["url"]] = source
        except Exception as exc:  # Index failures are retained in coverage.
            row["status"] = "failed"
            row["error"] = str(exc)
        index_rows.append(row)
    return list(all_sources.values()), index_rows
