CREATE TABLE imports (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','completed','partial','failed')),
 discovered_count INTEGER NOT NULL DEFAULT 0, ready_count INTEGER NOT NULL DEFAULT 0,
 failed_count INTEGER NOT NULL DEFAULT 0, conflict_count INTEGER NOT NULL DEFAULT 0,
 parser_version TEXT NOT NULL
);
CREATE TABLE source_documents (
 id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, sha256 TEXT, fetched_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','ready','failed','conflict','missing')),
 last_error TEXT, import_id TEXT REFERENCES imports(id), last_attempt_at TEXT,
 last_attempt_status TEXT
);
CREATE TABLE courses (
 rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
 source_id TEXT NOT NULL UNIQUE REFERENCES source_documents(id),
 year INTEGER NOT NULL, department TEXT NOT NULL, department_name TEXT NOT NULL,
 registration_code TEXT NOT NULL, variant_key TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL, teacher_text TEXT NOT NULL DEFAULT '', room_text TEXT NOT NULL DEFAULT '',
 credits TEXT NOT NULL DEFAULT '', term_text TEXT NOT NULL DEFAULT '',
 title_search TEXT NOT NULL, teacher_search TEXT NOT NULL, room_search TEXT NOT NULL,
 code_search TEXT NOT NULL, body_search TEXT NOT NULL,
 raw_metadata_json TEXT NOT NULL DEFAULT '{}', parse_warnings_json TEXT NOT NULL DEFAULT '[]',
 modality_evidence_json TEXT NOT NULL DEFAULT '[]', content_revision TEXT NOT NULL,
 UNIQUE(year,department,registration_code,variant_key)
);
CREATE INDEX courses_department_year ON courses(department,year);
CREATE TABLE course_slots (
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 term_label TEXT NOT NULL DEFAULT '', day_label TEXT NOT NULL DEFAULT '',
 period_label TEXT NOT NULL DEFAULT '', day INTEGER, period INTEGER,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('html','pdf')),
 UNIQUE(course_id,term_label,day_label,period_label,source_kind)
);
CREATE INDEX slots_lookup ON course_slots(day,period,term_label,course_id);
CREATE TABLE course_modalities (
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 modality TEXT NOT NULL CHECK(modality IN ('in_person','on_demand','live_online','remote_unspecified','unknown')),
 PRIMARY KEY(course_id,modality)
);
CREATE TABLE course_pages (
 course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 page_number INTEGER NOT NULL, raw_text TEXT NOT NULL,
 PRIMARY KEY(course_id,page_number)
);
