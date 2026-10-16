import { Hono } from 'hono';
import { inertia } from '@hono/inertia';
import { rootView } from '../app/root-view';
import { SearchInputError, parseSearchFilters, readSearchMetadata, readCourseDetail, readSearchPage } from './lib/search';
import type { ErrorPageProps } from '../app/pages/Error';
import type {} from '../app/pages.gen';

type Bindings = { Bindings: Env };

const app = new Hono<Bindings>();

app.use('*', async (c, next) => {
  const started = performance.now();
  await next();
  c.header('Server-Timing', `app;dur=${(performance.now() - started).toFixed(1)}`);
  c.header('Cache-Control', 'no-store');
  const vary = (c.res.headers.get('Vary') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!vary.some((value) => value.toLowerCase() === 'x-inertia')) vary.push('X-Inertia');
  c.header('Vary', [...new Set(vary)].join(', '));
});

app.use('*', inertia({ rootView }));

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
    const metadata = await readSearchMetadata(c.env.DB);
    const filters = parseSearchFilters(new URL(c.req.url).searchParams, metadata.availableFilters);
    const props = await readSearchPage(c.env.DB, filters, metadata);
    return c.render('Index', props);
  } catch (error) {
    if (error instanceof SearchInputError) {
      c.status(400);
      return c.render('Error', { status: 400, message: error.message } satisfies ErrorPageProps);
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
    const detail = await readCourseDetail(c.env.DB, c.req.param('id'));
    if (!detail) {
      c.status(404);
      return c.render('Error', { status: 404, message: '指定された講義は登録されていないか、公開されていません。' } satisfies ErrorPageProps);
    }
    return c.render('Courses/Show', detail);
  } catch {
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
