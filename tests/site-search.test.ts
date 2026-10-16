import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeName, parseSearchFilters, readCourseDetail, searchCourses, type AvailableFilters } from '../src/lib/search';

const available: AvailableFilters = {
  years: [2026],
  departments: [{ id: 'dept-a', name: '総合学部' }],
  terms: ['前期', '後期'],
};

let sqlite: DatabaseSync;
let d1: D1Database;

function makeD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...values: (string | number | null)[]) {
          return {
            async all<T>() {
              return { success: true, results: database.prepare(sql).all(...values) as T[] };
            },
            async first<T>() {
              return (database.prepare(sql).get(...values) as T | undefined) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function addCourse(input: {
  id: string;
  title: string;
  titleSearch?: string;
  teacher?: string;
  teacherSearch?: string;
  room?: string;
  roomSearch?: string;
  code?: string;
  body?: string;
  department?: string;
  departmentName?: string;
  sourceUrl?: string;
  slots?: Array<{ term: string; day: number | null; period: number | null; dayLabel: string; periodLabel: string; source?: 'html' | 'pdf' }>;
  modalities?: string[];
  pages?: Array<{ page: number; text: string }>;
}) {
  const sourceId = `source-${input.id}`;
  const titleSearch = input.titleSearch ?? input.title.toLowerCase();
  const teacher = input.teacher ?? '';
  const teacherSearch = input.teacherSearch ?? teacher.toLowerCase().replace(/\s+/gu, '');
  const room = input.room ?? '';
  const roomSearch = input.roomSearch ?? room.toLowerCase().replace(/\s+/gu, '');
  const code = input.code ?? input.id;
  const body = input.body ?? '';
  sqlite.prepare('INSERT INTO source_documents (id, url, sha256, fetched_at, status) VALUES (?, ?, ?, ?, ?)').run(
    sourceId,
    input.sourceUrl ?? `https://lms.ealps.shinshu-u.ac.jp/syllabus/faculty/${input.id}.pdf`,
    `sha-${input.id}`,
    '2026-10-15T03:00:00.000Z',
    'ready',
  );
  sqlite.prepare(`INSERT INTO courses (
    id, source_id, year, department, department_name, registration_code, variant_key,
    title, teacher_text, room_text, credits, term_text, title_search, teacher_search,
    room_search, code_search, body_search, raw_metadata_json, parse_warnings_json,
    modality_evidence_json, content_revision
  ) VALUES (?, ?, 2026, ?, ?, ?, '', ?, ?, ?, '2', '', ?, ?, ?, ?, ?, '{}', '[]', ?, 'test-revision')`).run(
    input.id,
    sourceId,
    input.department ?? 'dept-a',
    input.departmentName ?? '総合学部',
    code,
    input.title,
    teacher,
    room,
    titleSearch,
    teacherSearch,
    roomSearch,
    code.toLowerCase(),
    body,
    JSON.stringify((input.modalities ?? []).map((modality) => ({ modality, text: '授業形態の記載', source: 'PDF 1ページ' }))),
  );
  const { lastInsertRowid } = sqlite.prepare('SELECT rowid AS lastInsertRowid FROM courses WHERE id = ?').get(input.id) as { lastInsertRowid: number };
  sqlite.prepare('INSERT INTO course_search (rowid, title, teacher, code, body) VALUES (?, ?, ?, ?, ?)').run(lastInsertRowid, titleSearch, teacherSearch, code.toLowerCase(), body);
  for (const slot of input.slots ?? []) {
    sqlite.prepare('INSERT INTO course_slots (course_id, term_label, day_label, period_label, day, period, source_kind) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      input.id, slot.term, slot.dayLabel, slot.periodLabel, slot.day, slot.period, slot.source ?? 'html',
    );
  }
  for (const modality of input.modalities ?? []) {
    sqlite.prepare('INSERT INTO course_modalities (course_id, modality) VALUES (?, ?)').run(input.id, modality);
  }
  for (const page of input.pages ?? []) {
    sqlite.prepare('INSERT INTO course_pages (course_id, page_number, raw_text) VALUES (?, ?, ?)').run(input.id, page.page, page.text);
  }
}

function filters(search: string): ReturnType<typeof parseSearchFilters> {
  return parseSearchFilters(new URLSearchParams(search), available);
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_search.sql', import.meta.url), 'utf8'));
  sqlite.prepare("INSERT INTO imports (id, started_at, finished_at, status, discovered_count, ready_count, failed_count, conflict_count, parser_version) VALUES ('import-1', '2026-10-15T02:00:00Z', '2026-10-15T03:00:00Z', 'completed', 25, 25, 0, 0, 'test')").run();
  d1 = makeD1(sqlite);
  addCourse({
    id: 'course-info',
    title: 'Information Systems',
    teacher: 'Ada Lovelace',
    teacherSearch: 'adalovelace',
    room: 'B-101',
    roomSearch: 'b-101',
    code: 'IS-101',
    body: '情報リテラシー information systems fundamentals and science or practice',
    modalities: ['unknown'],
    slots: [
      { term: '前期', day: 1, period: 1, dayLabel: '月曜日', periodLabel: '1限', source: 'html' },
      { term: '前期', day: 1, period: 1, dayLabel: '月曜', periodLabel: '１時限', source: 'pdf' },
      { term: '後期', day: 2, period: 2, dayLabel: '火曜日', periodLabel: '2限', source: 'pdf' },
    ],
    pages: [{ page: 1, text: '<script>alert("raw text")</script> 情報システムの基礎' }],
  });
  addCourse({ id: 'course-science', title: 'Science and Design', body: 'science systems' });
  for (let index = 0; index < 22; index += 1) {
    addCourse({ id: `tie-${String(index).padStart(2, '0')}`, title: `Same Title ${index}`, titleSearch: 'same title', code: `T-${index}` });
  }
});

afterEach(() => sqlite.close());

describe('public syllabus search', () => {
  it('uses quoted FTS terms as literal AND search and keeps short tokens searchable', async () => {
    const literalOperator = await searchCourses(d1, filters('q=information+OR'));
    expect(literalOperator.items.map((item) => item.id)).toEqual(['course-info']);

    const shortJapanese = await searchCourses(d1, filters('q=%E6%83%85'));
    expect(shortJapanese.items.map((item) => item.id)).toContain('course-info');

    const twoTerms = await searchCourses(d1, filters('q=information+systems'));
    expect(twoTerms.items.map((item) => item.id)).toContain('course-info');
    expect(twoTerms.items.map((item) => item.id)).not.toContain('course-science');
  });

  it('combines schedule filters against one slot and deduplicates HTML/PDF slot copies', async () => {
    const crossSlot = await searchCourses(d1, filters('term=%E5%89%8D%E6%9C%9F&day=2&period=2'));
    expect(crossSlot.items.map((item) => item.id)).not.toContain('course-info');

    const sameSlot = await searchCourses(d1, filters('term=%E5%89%8D%E6%9C%9F&day=1&period=1'));
    const found = sameSlot.items.find((item) => item.id === 'course-info');
    expect(found?.slots).toHaveLength(2);
  });

  it('combines separate fields and applies whitespace and hyphen normalization', async () => {
    const match = await searchCourses(d1, filters('teacher=Ada+Lovelace&room=B%E2%80%90101&title=information&modality=unknown'));
    expect(match.items.map((item) => item.id)).toContain('course-info');

    const missing = await searchCourses(d1, filters('teacher=missing+teacher&room=B-101'));
    expect(missing.items).toHaveLength(0);
    expect(missing.total).toBe(0);
    expect(missing.totalPages).toBe(0);
  });

  it('keeps pagination stable with a 20+1 probe and a deterministic title/id order', async () => {
    const firstPage = await searchCourses(d1, filters(''));
    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.hasNext).toBe(true);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.total).toBeGreaterThan(20);

    const secondPage = await searchCourses(d1, filters('page=2'));
    expect(secondPage.items[0]?.id).toBe('tie-19');
    expect(secondPage.hasNext).toBe(false);
    expect(secondPage.total).toBe(firstPage.total);
    expect(secondPage.totalPages).toBe(2);
    const beyondLast = await searchCourses(d1, filters('page=999'));
    expect(beyondLast.page).toBe(2);
    expect(beyondLast.items).toEqual(secondPage.items);
    const empty = await searchCourses(d1, filters('title=no-matching-course&page=999'));
    expect(empty.page).toBe(1);
    expect(empty.total).toBe(0);
  });

  it('loads escaped page text and only exposes an official HTTPS PDF URL', async () => {
    const detail = await readCourseDetail(d1, 'course-info');
    expect(detail?.sourceUrl).toBe('https://lms.ealps.shinshu-u.ac.jp/syllabus/faculty/course-info.pdf');
    expect(detail?.pages[0]?.raw_text).toContain('<script>');

    addCourse({ id: 'unsafe-source', title: 'Unsafe', sourceUrl: 'javascript:alert(1)' });
    const unsafe = await readCourseDetail(d1, 'unsafe-source');
    expect(unsafe?.sourceUrl).toBe('');
  });

  it('rejects malformed limits and enum values with friendly validation errors', () => {
    expect(normalizeName('A\u2013\u2212 B')).toBe('a--b');
    expect(() => filters(`q=${'あ'.repeat(101)}`)).toThrow('100文字以内');
    expect(() => filters('q=one+two+three+four+five+six')).toThrow('5語以内');
    expect(() => filters(`q=${'word'.repeat(11)}`)).toThrow('40文字以内');
    expect(() => filters('year=2027')).toThrow('年度の選択');
    expect(() => filters('day=8')).toThrow('曜日の選択');
    expect(() => filters('modality=forged')).toThrow('授業形式の選択');
    expect(() => filters('page=1001')).toThrow('ページ番号');
  });
});

it('defaults unspecified modalities to in-person in both search and details without changing remote-only courses', async () => {
  addCourse({ id: 'online-only', title: 'Online only', modalities: ['on_demand'] });
  addCourse({ id: 'mixed-default', title: 'Mixed default', modalities: ['unknown', 'in_person', 'live_online'] });
  const results = await searchCourses(d1, filters('modality=in_person'));
  expect(results.items.find((course) => course.id === 'course-info')?.modalities).toEqual(['in_person']);
  expect((await searchCourses(d1, filters('modality=in_person&title=science'))).items.map((course) => course.id)).toContain('course-science');
  expect((await searchCourses(d1, filters('modality=in_person&title=online'))).items).toHaveLength(0);
  expect((await readCourseDetail(d1, 'mixed-default'))?.course.modalities).toEqual(['in_person', 'live_online']);
  expect((await readCourseDetail(d1, 'online-only'))?.course.modalities).toEqual(['on_demand']);
  expect(filters('modality=unknown').modality).toEqual(['in_person']);
});

it('accepts repeated, comma-separated, and bracket array parameters and rejects invalid members', () => {
  expect(filters('day=1,3&day=3&day[]=5').day).toEqual(['1', '3', '5']);
  expect(filters('term=前期,後期&period=1,2&modality=unknown,on_demand').modality).toEqual(['in_person', 'on_demand']);
  expect(() => filters('day=1,8')).toThrow('曜日');
  expect(() => filters('period=1,11')).toThrow('時限');
  expect(() => filters('term=前期,偽造')).toThrow('学期');
  expect(() => filters('intensive=maybe')).toThrow('集中授業');
});

it('ORs values within each filter, ANDs fields, and keeps day and period on the same slot', async () => {
  addCourse({ id: 'remote', title: 'Remote', modalities: ['on_demand'], slots: [{term:'後期',day:3,period:3,dayLabel:'水',periodLabel:'3'}] });
  const found = await searchCourses(d1, filters('term=前期,後期&day=1,3&period=1,3&modality=in_person,on_demand'));
  expect(found.items.map(item => item.id).sort()).toEqual(['course-info', 'remote']);
  expect((await searchCourses(d1, filters('day=1,3&period=2'))).items).toEqual([]);
});

it('groups half-term and alternate-week labels while keeping intensive independent and preserving raw labels', async () => {
  const slot = (term: string, dayLabel = '月') => ({term,day:1,period:1,dayLabel,periodLabel:'1'});
  addCourse({id:'alternate',title:'Alternate',slots:[slot('前期(隔週A)')]});
  addCourse({id:'half',title:'Half',slots:[slot('後期(前半)')]});
  addCourse({id:'intensive',title:'Intensive',slots:[slot('通年(集中)'),slot('通年')]});
  addCourse({id:'intensive-day',title:'Intensive day',slots:[slot('前期','集中')]});
  addCourse({id:'ambiguous',title:'Ambiguous',slots:[{...slot('前期(随時)'),day:null,period:null,dayLabel:'',periodLabel:'集中・不定期'}]});
  const first = await searchCourses(d1, filters('term=前期&intensive=no'));
  expect(first.items.map(item=>item.id).sort()).toEqual(['alternate','ambiguous','course-info']);
  expect(first.items.find(item=>item.id==='alternate')?.slots[0].term_label).toBe('前期(隔週A)');
  expect((await searchCourses(d1, filters('term=後期'))).items.map(item=>item.id)).toContain('half');
  expect((await searchCourses(d1, filters('term=前期&intensive=yes'))).items.map(item=>item.id)).toEqual(['intensive-day']);
  expect((await searchCourses(d1, filters('term=通年&intensive=no'))).total).toBe(0);
  expect((await searchCourses(d1, filters('term=通年&intensive=yes'))).items.map(item=>item.id)).toEqual(['intensive']);
  expect((await searchCourses(d1, filters('intensive=yes,no'))).total).toBe((await searchCourses(d1, filters(''))).total);
});
