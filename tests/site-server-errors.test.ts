import { afterEach, expect, it, vi } from 'vitest';

// Exercise the actual Hono/Inertia handlers; the HTML template is irrelevant to JSON responses.
vi.mock('../app/root-view', () => ({ rootView: () => '' }));
import app from '../src/server';

const quota = "Your account has exceeded D1's free tier daily row read limit.";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(['/', '/courses/example'])('returns the reset date for quota errors on %s, but not for other outages', async (path) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T02:00:00Z'));
  const put = vi.fn();
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) });
  for (const isQuota of [true, false]) {
    const failure = new Error('D1_ERROR', { cause: new Error(isQuota ? quota : 'network unavailable') });
    const env = { DATA_VERSION: 'test', DB: { batch: async () => { throw failure; }, prepare: () => { throw failure; } } };
    const response = await app.request(path, { headers: { 'X-Inertia': 'true' } }, env);
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const page = await response.json() as { component: string; props: { message: string } };
    expect(page.component).toBe('Error');
    if (isQuota) {
      expect(page.props.message).toContain('10月18日の午前9時（日本時間）');
      expect(response.headers.get('Retry-After')).toBe('Sun, 18 Oct 2026 00:00:00 GMT');
    } else {
      expect(page.props.message).toContain('しばらくしてから');
      expect(response.headers.has('Retry-After')).toBe(false);
    }
    expect(put).not.toHaveBeenCalled();
  }
});
