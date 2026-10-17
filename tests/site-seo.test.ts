import { expect, it } from 'vitest';
import { pageMetadata, SITE_ORIGIN, sitemapXml } from '../src/lib/seo';

it('indexes the homepage but not arbitrary search combinations or error pages', () => {
  expect(pageMetadata({ component: 'Index', url: '/', props: {} }).robots).toContain('index, follow');
  expect(pageMetadata({ component: 'Index', url: '/?q=情報', props: {} }).robots).toBe('noindex, follow');
  expect(pageMetadata({ component: 'Error', url: '/missing', props: {} }).robots).toBe('noindex, follow');
});
it('builds course-specific metadata with a canonical URL independent of query strings', () => {
  const meta = pageMetadata({ component: 'Courses/Show', url: '/courses/test?from=search', props: { course: { id: 'test', title: '情報科学', year: 2026, department_name: '工学部', teacher_text: '信州 太郎', room_text: '101' } } });
  expect(meta.title).toBe('情報科学 | シラバスアルプス');
  expect(meta.description).toContain('信州 太郎');
  expect(meta.canonical).toBe(`${SITE_ORIGIN}/courses/test`);
});
it('generates only canonical course URLs and the homepage in the sitemap', () => {
  const xml = sitemapXml(['course_1', 'course_2']);
  expect(xml.match(/<loc>/g)).toHaveLength(3);
  expect(xml).toContain(`${SITE_ORIGIN}/courses/course_1`);
  expect(xml).not.toContain('lastmod');
});
