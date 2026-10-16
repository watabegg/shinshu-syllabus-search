import type { SearchFilters } from './contracts';
import { normalizeName, normalizeText } from './search';

export const SEARCH_TTL = 60 * 60;
export const DETAIL_TTL = 24 * 60 * 60;

// Use only validated filters. Preserve the user's original spelling in the UI,
// while equivalent conditions share cached data.
export function searchCacheKey(filters: SearchFilters, includePage = true): string {
  const { page, ...conditions } = filters;
  return JSON.stringify({
    ...conditions,
    q: [...new Set(normalizeText(filters.q).split(' ').filter(Boolean))].sort().join(' '),
    title: normalizeText(filters.title),
    teacher: normalizeName(filters.teacher),
    room: normalizeName(filters.room),
    department: [...filters.department].sort(),
    term: [...filters.term].sort(),
    intensive: [...filters.intensive].sort(),
    day: [...filters.day].sort(),
    period: [...filters.period].sort(),
    modality: [...filters.modality].sort(),
    ...(includePage ? { page } : {}),
  });
}

export class DataCache {
  hits = 0;
  misses = 0;
  constructor(
    private cache: Pick<Cache, 'match' | 'put'>,
    private origin: string,
    private version: string,
    private waitUntil: (promise: Promise<unknown>) => void,
  ) {}

  private async request(key: string): Promise<Request> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    return new Request(`${this.origin}/__data-cache/v1/${encodeURIComponent(this.version)}/${digest}`);
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const response = await this.cache.match(await this.request(key));
      if (response) {
        const value = await response.json() as T;
        this.hits++;
        return value;
      }
    } catch {
      console.warn('Data cache read failed; falling back to D1');
    }
    this.misses++;
    return undefined;
  }

  put<T>(key: string, value: T, ttl: number): void {
    this.waitUntil((async () => {
      const request = await this.request(key);
      await this.cache.put(request, Response.json(value, { headers: { 'Cache-Control': `public, max-age=${ttl}` } }));
    })().catch(() => { console.warn('Data cache write failed'); }));
  }

  async read<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await load();
    // Missing courses and failed queries must not poison the cache.
    if (value !== null && value !== undefined) this.put(key, value, ttl);
    return value;
  }
}
