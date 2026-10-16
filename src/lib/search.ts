import { effectiveModalities, structureSyllabus } from './syllabus';
import type {
  CourseSummary,
  Coverage,
  DetailProps,
  Modality,
  SearchFilters,
  SearchProps,
  Slot,
} from './contracts';
import { MODALITIES } from './contracts';
import aliases from '../../config/aliases.json';

export const PAGE_SIZE = 20;
export const MAX_PAGE = 1_000;

type QueryValue = string | number | null;
type DepartmentOption = { id: string; name: string };
export type AvailableFilters = {
  years: number[];
  departments: DepartmentOption[];
  terms: string[];
};

export class SearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchInputError';
  }
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function normalizeName(value: string): string {
  return normalizeText(value)
    .replace(/[\u2010-\u2015\u2212\uFF0D]/gu, '-')
    .replace(/\s+/gu, '');
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function quoteFtsLiteral(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function assertMaxLength(label: string, value: string, maximum: number): void {
  if (codePointLength(value) > maximum) {
    throw new SearchInputError(`${label}は${maximum}文字以内で入力してください。`);
  }
}

export function parseSearchFilters(params: URLSearchParams, available: AvailableFilters): SearchFilters {
  const q = (params.get('q') ?? '').trim();
  const title = (params.get('title') ?? '').trim();
  const teacher = (params.get('teacher') ?? '').trim();
  const room = (params.get('room') ?? '').trim();
  assertMaxLength('キーワード', normalizeText(q), 100);
  assertMaxLength('科目名', normalizeText(title), 100);
  assertMaxLength('担当教員', normalizeName(teacher), 100);
  assertMaxLength('教室', normalizeName(room), 100);

  const tokens = normalizeText(q).split(' ').filter(Boolean);
  if (tokens.length > 5) {
    throw new SearchInputError('キーワードは5語以内で入力してください。');
  }
  if (tokens.some((token) => codePointLength(token) > 40)) {
    throw new SearchInputError('キーワードは1語あたり40文字以内で入力してください。');
  }

  const defaultYear = String(available.years.at(-1) ?? 2026);
  const yearValue = params.get('year') ?? defaultYear;
  const multiple = (name: string) => [...new Set([...params.getAll(name), ...params.getAll(`${name}[]`)].flatMap(value => value.split(',')).filter(Boolean))];
  const department = multiple('department');
  const rawTerms = multiple('term');
  const availableTerms = new Set(available.terms);
  const term = [...new Set(rawTerms.map(value => availableTerms.has(value) ? /^(前期|後期|通年)/u.exec(value)?.[1] ?? value : value))];
  const intensive = multiple('intensive');
  const day = multiple('day');
  const period = multiple('period');
  const modality = multiple('modality');
  const rawPage = params.get('page') ?? '1';

  if (yearValue && (!/^[0-9]{4}$/u.test(yearValue) || !available.years.includes(Number(yearValue)))) {
    throw new SearchInputError('年度の選択が正しくありません。');
  }
  const departmentIds = new Set(available.departments.map(option => option.id));
  if (department.some(value => !departmentIds.has(value))) {
    throw new SearchInputError('学部・研究科の選択が正しくありません。');
  }
  if (term.some(value => !['前期', '後期', '通年'].includes(value))) {
    throw new SearchInputError('学期の選択が正しくありません。');
  }
  if (day.some(value => !/^[1-7]$/u.test(value))) {
    throw new SearchInputError('曜日の選択が正しくありません。');
  }
  if (period.some(value => !/^(?:[1-9]|10)$/u.test(value))) {
    throw new SearchInputError('時限の選択が正しくありません。');
  }
  if (modality.some(value => !MODALITIES.includes(value as Modality))) {
    throw new SearchInputError('授業形式の選択が正しくありません。');
  }
  if (intensive.some(value => !['yes', 'no'].includes(value))) {
    throw new SearchInputError('集中授業の選択が正しくありません。');
  }
  if (!/^[1-9][0-9]{0,3}$/u.test(rawPage) || Number(rawPage) > MAX_PAGE) {
    throw new SearchInputError('ページ番号の指定が正しくありません。');
  }

  return {
    q,
    title,
    teacher,
    room,
    year: yearValue,
    department,
    term,
    intensive,
    day,
    period,
    modality: [...new Set(modality.map(value => value === 'unknown' ? 'in_person' : value))],
    page: Number(rawPage),
  };
}

async function all<T>(db: D1Database, sql: string, ...values: QueryValue[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  if (!result.success) throw new Error('D1 query failed');
  return result.results ?? [];
}

async function first<T>(db: D1Database, sql: string, ...values: QueryValue[]): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

type ImportRow = { discovered_count: number; ready_count: number; failed_count: number; conflict_count: number; finished_at: string | null };
export type SearchMetadata = { availableFilters: AvailableFilters; coverage: Coverage; importedAt: string | null };
export const METADATA_TTL_MS = 5 * 60 * 1000;
// Cache completed public data only; never share request-bound promises between requests.
const metadataCache = new WeakMap<D1Database, { expires: number; value: SearchMetadata }>();

export async function readSearchMetadata(db: D1Database): Promise<SearchMetadata> {
  const cached = metadataCache.get(db);
  if (cached && cached.expires > Date.now()) return cached.value;
  const result = await db.batch([
    db.prepare('SELECT DISTINCT year FROM courses ORDER BY year').bind(),
    db.prepare('SELECT department AS id, MIN(department_name) AS name FROM courses GROUP BY department ORDER BY name COLLATE NOCASE, id').bind(),
    db.prepare("SELECT DISTINCT term_label FROM course_slots WHERE term_label <> '' ORDER BY term_label COLLATE NOCASE").bind(),
    db.prepare("SELECT discovered_count, ready_count, failed_count, conflict_count, finished_at FROM imports WHERE status IN ('completed', 'partial') ORDER BY COALESCE(finished_at, started_at) DESC, id DESC LIMIT 1").bind(),
  ]);
  if (result.some(item => !item.success)) throw new Error('D1 metadata query failed');
  const years = result[0].results as { year: number }[];
  const latest = (result[3].results as ImportRow[])[0];
  const value: SearchMetadata = {
    availableFilters: {
      years: years.length ? years.map(row => row.year) : [2026],
      departments: result[1].results as DepartmentOption[],
      terms: (result[2].results as { term_label: string }[]).map(row => row.term_label),
    },
    coverage: latest ? { discovered: latest.discovered_count, ready: latest.ready_count, failed: latest.failed_count, conflict: latest.conflict_count } : { discovered: 0, ready: 0, failed: 0, conflict: 0 },
    importedAt: latest?.finished_at ?? null,
  };
  metadataCache.set(db, { expires: Date.now() + METADATA_TTL_MS, value });
  return value;
}

type SearchRow = Omit<CourseSummary, 'slots' | 'modalities'>;

function addNamePredicate(
  clauses: string[],
  values: QueryValue[],
  column: 'teacher_search' | 'room_search',
  input: string,
  aliasesForField: Record<string, string>,
): void {
  const original = normalizeName(input);
  const canonicalDisplay = aliasesForField[original];
  const canonical = canonicalDisplay ? normalizeName(canonicalDisplay) : '';
  if (canonical && canonical !== original) {
    clauses.push(`(instr(c.${column}, ?) > 0 OR instr(c.${column}, ?) > 0)`);
    values.push(canonical, original);
  } else {
    clauses.push(`instr(c.${column}, ?) > 0`);
    values.push(original);
  }
}

function buildSearchWhere(filters: SearchFilters): { sql: string; values: QueryValue[] } {
  const clauses: string[] = [];
  const values: QueryValue[] = [];

  const tokens = normalizeText(filters.q).split(' ').filter(Boolean);
  for (const token of tokens) {
    if (codePointLength(token) >= 3) {
      clauses.push('c.rowid IN (SELECT rowid FROM course_search WHERE course_search MATCH ?)');
      values.push(quoteFtsLiteral(token));
    } else {
      clauses.push('(instr(c.title_search, ?) > 0 OR instr(c.teacher_search, ?) > 0 OR instr(c.code_search, ?) > 0 OR instr(c.body_search, ?) > 0)');
      values.push(token, token, normalizeName(token), token);
    }
  }

  if (filters.title) {
    clauses.push('instr(c.title_search, ?) > 0');
    values.push(normalizeText(filters.title));
  }
  if (filters.teacher) addNamePredicate(clauses, values, 'teacher_search', filters.teacher, aliases.teachers);
  if (filters.room) addNamePredicate(clauses, values, 'room_search', filters.room, aliases.rooms);
  if (filters.year) {
    clauses.push('c.year = ?');
    values.push(Number(filters.year));
  }
  if (filters.department.length) {
    clauses.push(`c.department IN (${filters.department.map(() => '?').join(',')})`);
    values.push(...filters.department);
  }
  if (filters.term.length || filters.day.length || filters.period.length) {
    const slotClauses = ['s.course_id = c.id'];
    if (filters.term.length) {
      slotClauses.push(`(${filters.term.map(() => 's.term_label LIKE ?').join(' OR ')})`);
      values.push(...filters.term.map(term => `${term}%`));
    }
    for (const field of ['day', 'period'] as const) {
      if (filters[field].length) {
        slotClauses.push(`s.${field} IN (${filters[field].map(() => '?').join(',')})`);
        values.push(...filters[field].map(Number));
      }
    }
    clauses.push(`EXISTS (SELECT 1 FROM course_slots s WHERE ${slotClauses.join(' AND ')})`);
  }
  if (filters.intensive.length === 1) {
    // HTML/PDF copies can disagree in detail. Any explicit intensive label wins
    // for the course; the generic PDF label "集中・不定期" alone is not evidence.
    const intensive = "EXISTS (SELECT 1 FROM course_slots si WHERE si.course_id = c.id AND (instr(si.term_label, '集中') > 0 OR instr(si.day_label, '集中') > 0 OR si.period_label = '集中'))";
    clauses.push(filters.intensive[0] === 'yes' ? intensive : `NOT ${intensive}`);
  }
  if (filters.modality.length) {
    const modalities = filters.modality.includes('in_person') ? [...filters.modality, 'unknown'] : filters.modality;
    const match = `EXISTS (SELECT 1 FROM course_modalities cm WHERE cm.course_id = c.id AND cm.modality IN (${modalities.map(() => '?').join(',')}))`;
    clauses.push(filters.modality.includes('in_person')
      ? `(${match} OR NOT EXISTS (SELECT 1 FROM course_modalities cm WHERE cm.course_id = c.id))` : match);
    values.push(...modalities);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

async function readSummaryRelations(db: D1Database, ids: string[]): Promise<Map<string, Pick<CourseSummary, 'slots' | 'modalities'>>> {
  if (ids.length === 0) return new Map();
  const markers = ids.map(() => '?').join(', ');
  const batches = await db.batch([
    db.prepare(`SELECT course_id, term_label, day_label, period_label, day, period, MIN(source_kind) AS source_kind FROM course_slots WHERE course_id IN (${markers}) GROUP BY course_id, term_label, day_label, period_label, day, period ORDER BY term_label COLLATE NOCASE, day, period, day_label, period_label`).bind(...ids),
    db.prepare(`SELECT course_id, modality FROM course_modalities WHERE course_id IN (${markers}) ORDER BY modality`).bind(...ids),
  ]);
  if (batches.some(result => !result.success)) throw new Error('D1 relation query failed');
  const slotRows = batches[0].results as (Slot & { course_id: string })[];
  const modalityRows = batches[1].results as { course_id: string; modality: Modality }[];
  const result = new Map<string, Pick<CourseSummary, 'slots' | 'modalities'>>();
  for (const id of ids) result.set(id, { slots: [], modalities: [] });
  for (const row of slotRows) {
    const slots = result.get(row.course_id)?.slots;
    if (!slots) continue;
    // HTML and PDF use different labels for the same numeric slot.
    const sameSlot = slots.some((slot) => slot.term_label === row.term_label
      && slot.day === row.day && slot.period === row.period
      && (row.day !== null || slot.day_label === row.day_label)
      && (row.period !== null || slot.period_label === row.period_label));
    if (!sameSlot) slots.push({ term_label: row.term_label, day_label: row.day_label,
      period_label: row.period_label, day: row.day, period: row.period, source_kind: row.source_kind });
  }
  for (const row of modalityRows) result.get(row.course_id)?.modalities.push(row.modality);
  for (const relation of result.values()) relation.modalities = effectiveModalities(relation.modalities);
  return result;
}

export async function searchCourses(db: D1Database, filters: SearchFilters, knownTotal?: number): Promise<Pick<SearchProps, 'items' | 'hasNext' | 'total' | 'totalPages'> & { page: number }> {
  const where = buildSearchWhere(filters);
  const listSql = `SELECT c.id, c.title, c.registration_code, c.year, c.department, c.department_name, c.teacher_text, c.room_text, c.credits FROM courses c ${where.sql} ORDER BY c.title_search COLLATE BINARY, c.id COLLATE BINARY LIMIT ? OFFSET ?`;
  const listValues = (page: number) => [...where.values, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE];
  const batches = await db.batch([
    ...(knownTotal === undefined ? [db.prepare(`SELECT COUNT(*) AS total FROM courses c ${where.sql}`).bind(...where.values)] : []),
    db.prepare(listSql).bind(...listValues(filters.page)),
  ]);
  if (batches.some(result => !result.success)) throw new Error('D1 search query failed');
  const total = knownTotal ?? (batches[0].results as { total: number }[])[0]?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const page = Math.min(filters.page, Math.max(1, totalPages));
  // A second list lookup is needed only for an out-of-range page, not normal navigation.
  const rows = total > 0 && page !== filters.page
    ? await all<SearchRow>(db, listSql, ...listValues(page))
    : batches[knownTotal === undefined ? 1 : 0].results as SearchRow[];
  const hasNext = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  const relations = await readSummaryRelations(db, pageRows.map(({ id }) => id));
  const items = pageRows.map((row): CourseSummary => ({
    ...row,
    ...(relations.get(row.id) ?? { slots: [], modalities: [] }),
  }));
  return { items, hasNext, total, totalPages, page };
}

type DetailRow = SearchRow & {
  source_url: string;
  source_sha256: string | null;
  fetched_at: string | null;
  parse_warnings_json: string;
  modality_evidence_json: string;
};

function parseJsonArray<T>(value: string, isValid: (item: unknown) => item is T): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function isModalityEvidence(value: unknown): value is { modality: Modality; text: string; source: string } {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Record<string, unknown>;
  return MODALITIES.includes(evidence.modality as Modality) && typeof evidence.text === 'string' && typeof evidence.source === 'string';
}

function allowedSourcePdf(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'lms.ealps.shinshu-u.ac.jp' &&
      parsed.pathname.startsWith('/syllabus/') &&
      parsed.pathname.toLowerCase().endsWith('.pdf') &&
      !parsed.username &&
      !parsed.password
    ) return parsed.toString();
  } catch {
    // Malformed source links are hidden instead of being rendered as anchors.
  }
  return '';
}

export async function readCourseDetail(db: D1Database, id: string): Promise<DetailProps | null> {
  const [row, relations, pageRows] = await Promise.all([
    first<DetailRow>(db,
      'SELECT c.id, c.title, c.registration_code, c.year, c.department, c.department_name, c.teacher_text, c.room_text, c.credits, c.parse_warnings_json, c.modality_evidence_json, sd.url AS source_url, sd.sha256 AS source_sha256, sd.fetched_at FROM courses c JOIN source_documents sd ON sd.id = c.source_id WHERE c.id = ? LIMIT 1', id),
    readSummaryRelations(db, [id]),
    all<{ page_number: number; raw_text: string }>(db, 'SELECT page_number, raw_text FROM course_pages WHERE course_id = ? ORDER BY page_number', id),
  ]);
  if (!row) return null;
  const warnings = parseJsonArray(row.parse_warnings_json, (item): item is string => typeof item === 'string');
  const modalityEvidence = parseJsonArray(row.modality_evidence_json, isModalityEvidence);
  return {
    course: {
      id: row.id,
      title: row.title,
      registration_code: row.registration_code,
      year: row.year,
      department: row.department,
      department_name: row.department_name,
      teacher_text: row.teacher_text,
      room_text: row.room_text,
      credits: row.credits,
      ...(relations.get(id) ?? { slots: [], modalities: [] }),
    },
    pages: pageRows,
    sections: structureSyllabus(pageRows),
    sourceUrl: allowedSourcePdf(row.source_url),
    sourceSha256: row.source_sha256 ?? '',
    fetchedAt: row.fetched_at ?? '',
    parseWarnings: warnings,
    modalityEvidence,
  };
}

export async function readSearchPage(
  db: D1Database,
  filters: SearchFilters,
  knownMetadata?: SearchMetadata,
): Promise<SearchProps> {
  const [metadata, search] = await Promise.all([
    knownMetadata ? Promise.resolve(knownMetadata) : readSearchMetadata(db),
    searchCourses(db, filters),
  ]);
  return { ...search, filters: { ...filters, page: search.page }, ...metadata };
}
