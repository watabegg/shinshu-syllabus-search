import { describe, expect, it } from 'vitest';
import { decodeLibrary } from '../src/lib/local-library';

describe('saved search conditions', () => {
  it('migrates an old result snapshot to its search condition without retaining rows or pagination', () => {
    const library = decodeLibrary(JSON.stringify({ favorites: [], results: { items: [{ id: 'obsolete snapshot' }], url: '/?title=数学&day=1,3&page=8&view=saved', savedAt: '2026-10-16T00:00:00Z', total: 99, page: 8 } }));
    expect(library).not.toHaveProperty('results');
    const params = new URL(library.condition!.url, 'https://local.invalid').searchParams;
    expect(params.get('title')).toBe('数学');
    expect(params.get('day')).toBe('1,3');
    expect(params.has('page')).toBe(false);
    expect(params.has('view')).toBe(false);
  });
  it('rejects foreign or non-search destinations in browser storage', () => {
    for (const url of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', '/courses/example']) {
      expect(() => decodeLibrary(JSON.stringify({ favorites: [], condition: { url, label: 'test', savedAt: '2026-10-16' } }))).toThrow();
    }
  });
});
