import { Hono } from 'hono';
import { inertia } from '@hono/inertia';
import { rootView } from '../app/root-view';
import { SearchInputError, parseSearchFilters, readSearchMetadata, readCourseDetail, searchCourses } from './lib/search';
import { DataCache, SEARCH_TTL, DETAIL_TTL, searchCacheKey } from './lib/data-cache';
import { dailyReadLimitNotice, isDailyReadLimit } from './lib/d1-errors';
import { sitemapXml } from './lib/seo';
import type { ErrorPageProps } from '../app/pages/Error';
import type {} from '../app/pages.gen';

type Bindings = { Bindings: Env; Variables: { dataCache: DataCache } };

const app = new Hono<Bindings>();

app.use('*', async (c, next) => {
  const started = performance.now();
  const dataCache = new DataCache(await caches.open('syllabus-data'), new URL(c.req.url).origin, c.env.DATA_VERSION, promise => c.executionCtx.waitUntil(promise));
  c.set('dataCache', dataCache);
  await next();
  c.header('Server-Timing', `app;dur=${(performance.now() - started).toFixed(1)}`);
  c.header('Cache-Control', 'no-store');
  c.header('X-Data-Cache', `hit=${dataCache.hits}; miss=${dataCache.misses}`);
  const vary = (c.res.headers.get('Vary') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!vary.some((value) => value.toLowerCase() === 'x-inertia')) vary.push('X-Inertia');
  c.header('Vary', [...new Set(vary)].join(', '));
});

app.use('*', inertia({ rootView }));

app.get('/sitemap.xml', async (c) => {
  try {
    const xml = await c.get('dataCache').read('sitemap:v1', DETAIL_TTL, async () => {
      const rows = await c.env.DB.prepare('SELECT id FROM courses ORDER BY id').all<{ id: string }>();
      if (!rows.success) throw new Error('Sitemap query failed');
      return sitemapXml(rows.results.map(row => row.id));
    });
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
  } catch {
    return c.text('Sitemap temporarily unavailable', 503);
  }
});

app.get('/healthz', async (c) => {
  try {
    await c.env.DB.prepare('SELECT id FROM courses LIMIT 1').first<{ id: string }>();
    return c.json({ status: 'ok' as const });
  } catch {
    return c.json({ status: 'unavailable' as const }, 503);
  }
});

app.get('/', async (c) => {
  try {
    const cache = c.get('dataCache');
    const metadata = await cache.read('metadata', DETAIL_TTL, () => readSearchMetadata(c.env.DB));
    const filters = parseSearchFilters(new URL(c.req.url).searchParams, metadata.availableFilters);
    const result = await cache.read(`search:${searchCacheKey(filters)}`, SEARCH_TTL, async () => {
      const countKey = `count:${searchCacheKey(filters, false)}`;
      const total = await cache.get<number>(countKey);
      const result = await searchCourses(c.env.DB, filters, total);
      if (total === undefined) cache.put(countKey, result.total, SEARCH_TTL);
      return result;
    });
    const props = { ...result, ...metadata, filters: { ...filters, page: result.page } };
    return c.render('Index', props);
  } catch (error) {
    if (error instanceof SearchInputError) {
      c.status(400);
      return c.render('Error', { status: 400, message: error.message } satisfies ErrorPageProps);
    }
    if (isDailyReadLimit(error)) {
      const notice = dailyReadLimitNotice();
      c.header('Retry-After', notice.retryAfter);
      c.status(503);
      return c.render('Error', { status: 503, message: notice.message } satisfies ErrorPageProps);
    }
    c.status(503);
    return c.render('Error', {
      status: 503,
      message: '検索データを読み込めませんでした。しばらくしてからもう一度お試しください。',
    } satisfies ErrorPageProps);
  }
});

app.get('/courses/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const detail = await c.get('dataCache').read(`detail:${id}`, DETAIL_TTL, () => readCourseDetail(c.env.DB, id));
    if (!detail) {
      c.status(404);
      return c.render('Error', { status: 404, message: '指定された講義は登録されていないか、公開されていません。' } satisfies ErrorPageProps);
    }
    return c.render('Courses/Show', detail);
  } catch (error) {
    if (isDailyReadLimit(error)) {
      const notice = dailyReadLimitNotice();
      c.header('Retry-After', notice.retryAfter);
      c.status(503);
      return c.render('Error', { status: 503, message: notice.message } satisfies ErrorPageProps);
    }
    c.status(503);
    return c.render('Error', {
      status: 503,
      message: '講義の詳細を読み込めませんでした。しばらくしてからもう一度お試しください。',
    } satisfies ErrorPageProps);
  }
});

app.get('*', (c) => {
  c.status(404);
  return c.render('Error', { status: 404, message: 'お探しのページは見つかりませんでした。' } satisfies ErrorPageProps);
});

export type SearchApp = typeof app;
export default app;
