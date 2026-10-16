import { MODALITIES, type CourseSummary } from './contracts';

export const LIBRARY_KEY = 'syllabus-alps:library:v1';
export type SavedCondition = { url: string; label: string; savedAt: string };
export type LocalLibrary = { favorites: CourseSummary[]; condition: SavedCondition | null };
export const emptyLibrary = (): LocalLibrary => ({ favorites: [], condition: null });

function isCourse(value: unknown): value is CourseSummary {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return ['id', 'title', 'registration_code', 'department', 'department_name', 'teacher_text', 'room_text', 'credits'].every(key => typeof c[key] === 'string')
    && typeof c.year === 'number' && Array.isArray(c.modalities) && c.modalities.every(m => MODALITIES.includes(m))
    && Array.isArray(c.slots) && c.slots.every(s => s && typeof s === 'object' && ['term_label', 'day_label', 'period_label'].every(key => typeof s[key] === 'string'));
}

export function decodeLibrary(raw: string | null): LocalLibrary {
  if (!raw) return emptyLibrary();
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.favorites) || !parsed.favorites.every(isCourse)) throw new Error('Invalid library');
  // Preserve favorites from the earlier result-snapshot prototype.
  const r = parsed.condition ?? parsed.results;
  if (r == null) return { favorites: parsed.favorites, condition: null };
  if (typeof r.url !== 'string' || typeof r.savedAt !== 'string') throw new Error('Invalid saved condition');
  const url = new URL(r.url, 'https://local.invalid');
  if (url.origin !== 'https://local.invalid' || url.pathname !== '/') throw new Error('Invalid saved URL');
  url.searchParams.delete('page');
  url.searchParams.delete('view');
  return { favorites: parsed.favorites, condition: { url: url.pathname + url.search, label: typeof r.label === 'string' ? r.label : '以前保存した検索条件', savedAt: r.savedAt } };
}
