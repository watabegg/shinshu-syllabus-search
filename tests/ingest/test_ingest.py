from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

from scripts.ingest.common import (
    COURSE_KEYS,
    alias_search,
    course_from_jsonl,
    require_pdf_url,
    stable_id,
)
from scripts.ingest.discover import parse_department, parse_homepage
from scripts.ingest.export import (
    MAX_D1_SQL_BYTES,
    apply_sqlite,
    build_import_sql,
    validate_course_export_limits,
)
from scripts.ingest.main import _merge_discovery, _run_ingestion, _validate_natural_identity, _write_run
from scripts.ingest.normalize import classify_modalities
from scripts.ingest.extract import parse_course
from scripts.ingest.http_client import MAX_SERVER_RETRY_WAIT, PublicHttpClient
from scripts.ingest.validate import validate as validate_output

ROOT = Path(__file__).resolve().parents[2]
ALIASES = {"teachers": {}, "rooms": {}}


HEADER = """時間割コード          FS000001    開講年度          2026
 授業科目名           多様な日本語の授業                         担当教員 山田   太郎
英文授業名            A course name                               副担当 佐藤 花子・鈴木 次郎
  単位数              2       講義期間 前期         曜日・時限 火曜･３時限
  講義室              工学部 １０１講義室    授業形態 講義
信大コンピテンシー   該当
(1)授業の概要
"""


def make_source(department: str = "fs", code: str = "FS000001", suffix: str = "") -> dict:
    url = f"https://lms.ealps.shinshu-u.ac.jp/syllabus/{department}/{code}{suffix}.pdf"
    return {
        "id": stable_id("source", url),
        "url": url,
        "department": department,
        "department_name": "テスト学部",
        "slots": [{
            "term_label": "前期", "day_label": "火曜日", "period_label": "3時限",
            "day": 2, "period": 3, "source_kind": "html",
        }],
        "anchor_titles": ["多様な日本語の授業"],
        "anchor_codes": [code],
        "status": "ready",
        "last_attempt_status": "ready",
        "sha256": None,
        "fetched_at": None,
        "last_attempt_at": None,
        "last_error": None,
    }


def make_course(source: dict | None = None) -> dict:
    source = source or make_source()
    pages = [HEADER + "\n授業の概要: public service course policy and searchable notes.\n"]
    return parse_course(pages, source=source, source_sha256="a" * 64, aliases=ALIASES,
                        fetched_at="2026-10-15T00:00:00Z")


def write_output(output: Path, courses: list[dict], sources: list[dict]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "courses.jsonl").write_text(
        "".join(json.dumps({key: course[key] for key in COURSE_KEYS}, ensure_ascii=False) + "\n" for course in courses),
        encoding="utf-8",
    )
    (output / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "run": {"id": "test-import", "started_at": "2026-10-15T00:00:00Z",
                "finished_at": "2026-10-15T00:00:00Z", "status": "completed",
                "parser_version": "test"},
        "counts": {"discovered": len(sources), "ready": len(sources), "failed": 0, "conflict": 0},
        "indexes": [], "sources": sources, "sample_errors": [],
    }, ensure_ascii=False), encoding="utf-8")


class DiscoveryTests(unittest.TestCase):
    def test_homepage_department_and_repeated_schedule_slots_are_preserved(self) -> None:
        homepage = '<a class="faculty-card" href="./fs/index.html">繊維学部</a>'
        departments = parse_homepage(homepage)
        self.assertEqual(departments[0]["department"], "fs")
        html = """<details class="semester"><summary>前期</summary>
          <details class="day"><summary>月曜日</summary>
            <details class="period"><summary>1時限</summary>
              <a href="FS000001.pdf"><span class="code-tag">(FS000001)</span> 構造化学特論</a>
            </details>
            <details class="period"><summary>2時限</summary>
              <a href="FS000001.pdf"><span class="code-tag">(FS000001)</span> 構造化学特論</a>
            </details>
          </details>
        </details><a href="https://example.com/evil.pdf">external</a>"""
        records = parse_department(html, departments[0])
        self.assertEqual(len(records), 1)
        self.assertEqual([(slot["day"], slot["period"]) for slot in records[0]["slots"]], [(1, 1), (1, 2)])
        self.assertEqual(records[0]["anchor_codes"], ["FS000001"])
        self.assertTrue(records[0]["url"].endswith("/fs/FS000001.pdf"))

    def test_pdf_url_allowlist_rejects_other_authorities_and_query_variants(self) -> None:
        good = "https://lms.ealps.shinshu-u.ac.jp/syllabus/fs/course.pdf"
        self.assertEqual(require_pdf_url(good), good)
        for url in (
            "http://lms.ealps.shinshu-u.ac.jp/syllabus/fs/course.pdf",
            "https://example.com/syllabus/fs/course.pdf",
            "https://lms.ealps.shinshu-u.ac.jp/other/course.pdf",
            "https://lms.ealps.shinshu-u.ac.jp/syllabus/fs/course.pdf?next=https://example.com",
            "https://user@lms.ealps.shinshu-u.ac.jp/syllabus/fs/course.pdf",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                require_pdf_url(url)


class HttpRetryTests(unittest.TestCase):
    def test_long_server_retry_after_defers_without_early_retry(self) -> None:
        client = PublicHttpClient(delay=0, retries=3)
        client.session.cookies.set("session", "must-not-be-sent")
        response = requests.Response()
        response.status_code = 429
        response.headers["Retry-After"] = str(int(MAX_SERVER_RETRY_WAIT + 30))
        response.close = mock.Mock()
        request = mock.Mock(return_value=response)
        client.session.get = request
        with self.assertRaisesRegex(RuntimeError, "deferred without retry"):
            client.get("https://lms.ealps.shinshu-u.ac.jp/syllabus/fs/index.html")
        request.assert_called_once()
        self.assertEqual(list(client.session.cookies), [])


class NormalizationTests(unittest.TestCase):
    def test_teacher_and_room_aliases_require_exact_field_or_delimited_item(self) -> None:
        aliases = {"田中": "田中 太郎", "工101": "工学部101"}
        self.assertEqual(alias_search("田中", aliases), "田中 田中太郎")
        self.assertEqual(alias_search("山田 / 田中", aliases), "山田/田中 田中太郎")
        self.assertEqual(alias_search("田中山", aliases), "田中山")
        self.assertEqual(alias_search("工1010", aliases), "工1010")
        self.assertEqual(alias_search("工101・工202", aliases), "工101・工202 工学部101")

    def test_prep_video_is_not_a_delivery_modality_and_explicit_in_person_is(self) -> None:
        modalities, _, _ = classify_modalities([
            "事前学習として15分程度の動画を配信します。講義は演習を含む対面の講義で行います。"
        ])
        self.assertIn("in_person", modalities)
        self.assertNotIn("on_demand", modalities)

    def test_blank_remote_header_is_not_remote_delivery_evidence(self) -> None:
        modalities, evidence, _ = classify_modalities(["遠隔授業科目                  授業形態 講義"])
        self.assertEqual(modalities, ["unknown"])
        self.assertEqual(evidence[0]["source"], "pdf:no-explicit-delivery-evidence")

    def test_conditional_in_person_statement_is_unknown_not_positive(self) -> None:
        modalities, evidence, warnings = classify_modalities(["必要な場合は対面講義を行います。"])
        self.assertIn("unknown", modalities)
        self.assertNotIn("in_person", modalities)
        self.assertTrue(warnings)
        self.assertTrue(any(item["modality"] == "unknown" for item in evidence))

    def test_representative_public_syllabus_delivery_evidence(self) -> None:
        cases = {
            "com-BS107500": (
                "本授業はオンデマンド式の授業方式を採用する。",
                {"on_demand"},
            ),
            "fs-FSE15500": (
                "事前学習として15分程度の動画を配信します。"
                "演習を含む対面の講義で行います。",
                {"in_person"},
            ),
            "hs-HS900100": (
                "ZOOM形式によるオンライン授業とする。"
                "対面講義を行う場合も会場はeALPSに掲載する。",
                {"remote_unspecified", "unknown"},
            ),
            "hb-HB800100": (
                "ハイブリッド方式またはZoomによるオンライン開催。"
                "This year's lectures will be online live lectures on Zoom.",
                {"in_person", "live_online"},
            ),
        }
        for source_id, (text, expected) in cases.items():
            with self.subTest(source=source_id):
                modalities, _, _ = classify_modalities([text])
                self.assertTrue(expected <= set(modalities), modalities)
        fs_modalities, _, _ = classify_modalities([cases["fs-FSE15500"][0]])
        self.assertNotIn("on_demand", fs_modalities)


class ExtractionTests(unittest.TestCase):
    def test_alternate_header_labels_multiline_teachers_and_slots(self) -> None:
        source = make_source()
        course = make_course(source)
        self.assertEqual(course["registration_code"], "FS000001")
        self.assertEqual(course["title"], "多様な日本語の授業")
        self.assertEqual(course["teacher_text"], "山田 太郎 佐藤 花子・鈴木 次郎")
        self.assertEqual(course["room_text"], "工学部 101講義室")
        self.assertTrue(any(slot["source_kind"] == "html" and slot["period"] == 3 for slot in course["slots"]))
        self.assertTrue(any(slot["source_kind"] == "pdf" and slot["day"] == 2 and slot["period"] == 3 for slot in course["slots"]))
        self.assertEqual(set(course), set(COURSE_KEYS))

    def test_index_title_and_wrapped_code_compare_after_nfkc(self) -> None:
        source = make_source()
        source["anchor_codes"] = ["(FS000001)"]
        source["anchor_titles"] = ["📄 多様な日本語の授業"]
        course = make_course(source)
        self.assertFalse(any("registration code differs" in warning or "title differs" in warning
                             for warning in course["parse_warnings"]))

    def test_wrapped_primary_name_continuation_remains_searchable_across_sub_label(self) -> None:
        pages = ["""登録コード ASL00500 開講年度 2026
授業科目 植物資源生産学特論Ⅰ 担当教員 松島 憲一
根本 和洋・鈴木 香奈子・阿久津 雅子・大迫 祐
英文授業名 Advanced Lecture in Plant Science Ⅰ 副担当 太朗・近藤 文哉
単位数 2 講義期間 前期 曜日・時限 月曜･２時限
講義室 農学部１１番講義室 授業形態 講義
信大コンピテンシー 該当
授業の達成目標
"""]
        source = make_source(department="as", code="ASL00500")
        source["anchor_titles"] = ["📄 植物資源生産学特論Ⅰ (ASL00500)"]
        course = parse_course(pages, source=source, source_sha256="b" * 64, aliases=ALIASES)
        self.assertIn("大迫 祐 太朗", course["teacher_text"])
        self.assertNotIn("/", course["teacher_text"])
        self.assertIn("大迫祐太朗", course["teacher_search"])
        self.assertIn("近藤文哉", course["teacher_search"])
        self.assertTrue(any("boundary may be visually ambiguous" in warning for warning in course["parse_warnings"]))
        self.assertIn("大迫 祐", course["raw_metadata"]["teacher_primary"])
        self.assertIn("太朗", course["raw_metadata"]["teacher_sub"])

    def test_conflicting_natural_identity_is_rejected(self) -> None:
        first = make_course(make_source(suffix="-first"))
        second_source = make_source(suffix="-second")
        second = copy.deepcopy(first)
        second.update({"source_id": second_source["id"], "source_url": second_source["url"]})
        with self.assertRaisesRegex(ValueError, "natural key"):
            _validate_natural_identity(second, {first["source_id"]: first}, {})

    def test_failed_refresh_keeps_last_valid_course(self) -> None:
        source = make_source(department="test", code="FS000001")
        course = make_course(source)
        manifest_source = {**source, "status": "ready", "last_attempt_status": "ready"}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / "data"
            write_output(output, [course], [manifest_source])
            old_manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            old_manifest["indexes"] = [{"department": "test", "department_name": "テスト", "url": "https://lms.ealps.shinshu-u.ac.jp/syllabus/test/index.html", "status": "ready"}]
            (output / "manifest.json").write_text(json.dumps(old_manifest, ensure_ascii=False), encoding="utf-8")
            samples = root / "samples"
            samples.mkdir()
            (samples / "test-FS000001.pdf").write_bytes(b"%PDF-not-used-by-mocked-failure")
            with mock.patch("scripts.ingest.main._get_pdf", side_effect=RuntimeError("temporary network failure")):
                result = _run_ingestion(output, delay=0, limit=None, offline_samples=samples,
                                        refresh=False, aliases_path=ROOT / "config" / "aliases.json")
            persisted = course_from_jsonl(output / "courses.jsonl")
            self.assertEqual(len(persisted), 1)
            self.assertEqual(persisted[0]["content_revision"], course["content_revision"])
            self.assertEqual(result["sources"][0]["status"], "ready")
            self.assertEqual(result["sources"][0]["last_attempt_status"], "failed")

    def test_disappeared_index_url_keeps_valid_course_and_validates(self) -> None:
        source = make_source()
        course = make_course(source)
        old_source = {**source, "status": "ready", "last_attempt_status": "ready"}
        old_manifest = {"sources": [old_source]}
        indexes = [{"department": source["department"], "status": "ready"}]
        merged = _merge_discovery([], indexes, old_manifest, [course])
        self.assertEqual(merged[0]["status"], "ready")
        self.assertEqual(merged[0]["last_attempt_status"], "missing")
        self.assertIn("absent", merged[0]["last_error"])
        self.assertIn("source URL is absent from the latest index", course["parse_warnings"])
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            _write_run(output, merged, indexes, [course], run_id="missing-source", mode="discover",
                       started_at="2026-10-15T00:00:00Z", discovered_count=0)
            errors, report = validate_output(output / "manifest.json", output / "samples", strict=False)
            self.assertEqual(errors, [])
            self.assertEqual(report["courses"], 1)
            self.assertEqual(report["source_statuses"], {"ready": 1})


class ExportTests(unittest.TestCase):
    def test_import_sql_handles_contract_derived_json_columns(self) -> None:
        source = make_source()
        course = make_course(source)
        manifest = {"run": {"id": "test", "status": "completed"}, "counts": {"discovered": 1, "ready": 1, "failed": 0, "conflict": 0}, "sources": [source]}
        sql = build_import_sql([course], manifest)
        self.assertIn("raw_metadata_json", sql)
        self.assertIn("course_search", sql)

    def test_export_and_sqlite_apply_are_idempotent_and_course_rollback_is_atomic(self) -> None:
        source = make_source()
        course = make_course(source)
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            write_output(output, [course], [source])
            sql = build_import_sql([course], json.loads((output / "manifest.json").read_text(encoding="utf-8")))
            self.assertTrue(sql.endswith("\n"))
            for statement in sql.split(";\n"):
                if statement.strip() and not statement.lstrip().startswith("--"):
                    self.assertLessEqual(len((statement + ";").encode("utf-8")), MAX_D1_SQL_BYTES)
            apply_sqlite(output, output / "syllabus.sqlite")
            apply_sqlite(output, output / "syllabus.sqlite")
            import sqlite3
            connection = sqlite3.connect(output / "syllabus.sqlite")
            self.assertEqual(connection.execute("SELECT count(*) FROM courses").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT count(*) FROM course_slots").fetchone()[0], len(course["slots"]))
            self.assertEqual(connection.execute("SELECT count(*) FROM course_search WHERE course_search MATCH 'policy'").fetchone()[0], 1)
            connection.close()

            changed = copy.deepcopy(course)
            changed["body_search"] = "changed body that must roll back"
            changed["pages"] = [{"page_number": 1, "raw_text": "changed body that must roll back"}]
            changed["modalities"] = ["invalid_modality"]
            write_output(output, [changed], [source])
            with self.assertRaises(Exception):
                apply_sqlite(output, output / "syllabus.sqlite")
            connection = sqlite3.connect(output / "syllabus.sqlite")
            self.assertEqual(connection.execute("SELECT body_search FROM courses").fetchone()[0], course["body_search"])
            self.assertEqual(connection.execute("SELECT count(*) FROM course_search WHERE course_search MATCH 'policy'").fetchone()[0], 1)
            connection.close()

    def test_oversize_page_statement_is_rejected_instead_of_truncated(self) -> None:
        course = make_course()
        course["pages"] = [{"page_number": 1, "raw_text": "x" * (MAX_D1_SQL_BYTES + 100)}]
        with self.assertRaisesRegex(ValueError, "SQL statement limit"):
            validate_course_export_limits(course)

    def test_oversize_source_statement_is_rejected(self) -> None:
        source = make_source()
        source["last_error"] = "x" * (MAX_D1_SQL_BYTES + 1)
        manifest = {"run": {"id": "test", "status": "partial"},
                    "counts": {"discovered": 1, "ready": 0, "failed": 1, "conflict": 0},
                    "sources": [source]}
        with self.assertRaisesRegex(ValueError, "SQL statement limit"):
            build_import_sql([], manifest)


if __name__ == "__main__":
    unittest.main()
