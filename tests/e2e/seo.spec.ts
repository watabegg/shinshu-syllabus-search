import { test, expect } from '@playwright/test';

test('metadata is present before JavaScript and stays unique after Inertia navigation', async ({ page, request }) => {
  const response = await request.get('/');
  const html = await response.text();
  expect(html).toContain('property="og:image"');
  expect(html).toContain('信州大学のシラバス検索（非公式）');
  expect(html).toContain('rel="canonical"');
  await page.goto('/');
  await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
  const courseLink = page.locator('a[href^="/courses/"]').first();
  const href = await courseLink.getAttribute('href');
  await courseLink.click();
  await expect(page).toHaveURL(`http://127.0.0.1:4173${href}`);
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', `https://shinshu-syllabus-search.shinshu-syllabus.workers.dev${new URL(href!, 'http://localhost').pathname}`);
  await expect(page.locator('head meta[property="og:title"]')).toHaveCount(1);
  await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute('content', await page.title());
  await page.goBack();
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://shinshu-syllabus-search.shinshu-syllabus.workers.dev/');
  await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
});
