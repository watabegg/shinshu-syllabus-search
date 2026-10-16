import { describe, expect, it, vi } from 'vitest';
import { DataCache, DETAIL_TTL, SEARCH_TTL, searchCacheKey } from '../src/lib/data-cache';
import { parseSearchFilters } from '../src/lib/search';

function harness() {
  const entries = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  const storage = {
    match: vi.fn(async (request: RequestInfo | URL) => entries.get((request as Request).url)?.clone()),
    put: vi.fn(async (request: RequestInfo | URL, response: Response) => { entries.set((request as Request).url, response); }),
  };
  return {
    entries, storage,
    cache: (version = 'one') => new DataCache(storage, 'https://example.com', version, promise => { pending.push(promise); }),
    flush: () => Promise.all(pending),
  };
}
const filters = (query: string) => parseSearchFilters(new URLSearchParams(query), { years: [2026], departments: [{ id: 't', name: '工学' }], terms: ['前期'] });

describe('public data cache', () => {
  it('shares equivalent conditions but separates pages, fields and data versions', async () => {
    expect(searchCacheKey(filters('day=1,3&q=Ａ 情報'))).toBe(searchCacheKey(filters('q=情報 a&day[]=3&day[]=1')));
    expect(searchCacheKey(filters('page=1'), false)).toBe(searchCacheKey(filters('page=2'), false));
    expect(searchCacheKey(filters('page=1'))).not.toBe(searchCacheKey(filters('page=2')));
    expect(searchCacheKey(filters('title=情報'))).not.toBe(searchCacheKey(filters('q=情報')));
    const h = harness();
    const load = vi.fn(async () => ({ total: 6 }));
    await h.cache().read('search', SEARCH_TTL, load);
    await h.flush();
    expect(await h.cache().read('search', SEARCH_TTL, load)).toEqual({ total: 6 });
    expect(load).toHaveBeenCalledTimes(1);
    await h.cache('two').read('search', SEARCH_TTL, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('sets per-data expiry, caches zero counts, and loads again after eviction', async () => {
    const h = harness();
    h.cache().put('count', 0, SEARCH_TTL);
    h.cache().put('detail', { title: '講義' }, DETAIL_TTL);
    await h.flush();
    expect([...h.entries.values()].map(r => r.headers.get('Cache-Control'))).toEqual(['public, max-age=3600', 'public, max-age=86400']);
    expect(await h.cache().get('count')).toBe(0);
    h.entries.clear();
    const load = vi.fn(async () => 12);
    expect(await h.cache().read('count', SEARCH_TTL, load)).toBe(12);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache missing data or failures and survives cache outages', async () => {
    const h = harness();
    await expect(h.cache().read('failed', SEARCH_TTL, async () => { throw new Error('DB unavailable'); })).rejects.toThrow('DB unavailable');
    expect(await h.cache().read('missing', DETAIL_TTL, async () => null)).toBeNull();
    expect(h.storage.put).not.toHaveBeenCalled();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.storage.match.mockRejectedValueOnce(new Error('cache unavailable'));
    h.storage.put.mockRejectedValueOnce(new Error('cache unavailable'));
    expect(await h.cache().read('ok', SEARCH_TTL, async () => 42)).toBe(42);
    await h.flush();
    expect(warning).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });
});
