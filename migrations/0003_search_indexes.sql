-- Ordered browsing without scanning/sorting the full course table.
CREATE INDEX courses_year_title_id ON courses(year, title_search COLLATE BINARY, id COLLATE BINARY);
CREATE INDEX courses_title_id ON courses(title_search COLLATE BINARY, id COLLATE BINARY);
-- Metadata selection reads narrow covering indexes rather than PDF-sized course rows.
CREATE INDEX courses_department_name ON courses(department, department_name);
CREATE INDEX slots_term ON course_slots(term_label COLLATE NOCASE);
PRAGMA optimize;
