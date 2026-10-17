import type { CourseSummary } from './contracts';

export const SITE_ORIGIN = 'https://shinshu-syllabus-search.shinshu-syllabus.workers.dev';
export const SITE_NAME = 'シラバスアルプス';
export const SITE_DESCRIPTION = '信州大学の授業を、科目名・担当教員・曜日・時限・学期・教室・授業形式から検索。気になる授業をお気に入りに保存できる、非公式のシラバス検索サイトです。';
export function pageMetadata(page: { component: string; url: string; props: Record<string, unknown> }) {
  const url = new URL(page.url, SITE_ORIGIN);
  const course = page.component === 'Courses/Show' ? page.props.course as CourseSummary | undefined : undefined;
  const title = course ? `${course.title} | ${SITE_NAME}` : page.component === 'Error' ? `ページを表示できません | ${SITE_NAME}` : `${SITE_NAME} | 信州大学のシラバス検索（非公式）`;
  const description = course
    ? `${course.year}年度・${course.department_name}「${course.title}」のシラバス。${course.teacher_text ? `担当：${course.teacher_text}。` : ''}${course.room_text ? `教室：${course.room_text}。` : ''}授業内容や時間割を確認できます。信州大学の非公式シラバス検索サイト。`
    : SITE_DESCRIPTION;
  const canonical = course ? `${SITE_ORIGIN}/courses/${encodeURIComponent(course.id)}` : `${SITE_ORIGIN}${url.pathname}${page.component === 'Index' ? url.search : ''}`;
  return { title, description, canonical, robots: page.component === 'Error' || (page.component === 'Index' && !!url.search) ? 'noindex, follow' : 'index, follow, max-image-preview:large' };
}

export function sitemapXml(ids: string[]): string {
  const urls = [`${SITE_ORIGIN}/`, ...ids.map(id => `${SITE_ORIGIN}/courses/${encodeURIComponent(id)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
}
