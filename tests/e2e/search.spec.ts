import { expect, test } from '@playwright/test';

test('public search renders its data state and keeps query conditions in the URL', async ({ page }) => {
  const health = await page.request.get('/healthz');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });

  const initial = await page.request.get('/');
  expect(initial.status()).toBe(200);
  expect(initial.headers()['cache-control']).toBe('no-store');
  const vary = initial.headers().vary?.split(',').map((value) => value.trim().toLowerCase()) ?? [];
  expect(vary).toContain('accept');
  expect(vary.filter((value) => value === 'x-inertia')).toHaveLength(1);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'シラバスを検索', exact: true })).toBeVisible();
  const databaseEmpty = await page.getByRole('heading', { name: '検索データを準備しています' }).isVisible();

  await page.getByRole('textbox', { name: 'キーワード' }).fill('存在しない試験用科目検索');
  await page.getByRole('button', { name: '検索する' }).click();
  await expect(page).toHaveURL(/q=%E5%AD%98%E5%9C%A8%E3%81%97%E3%81%AA%E3%81%84%E8%A9%A6%E9%A8%93%E7%94%A8%E7%A7%91%E7%9B%AE%E6%A4%9C%E7%B4%A2/);
  if (databaseEmpty) {
    await expect(page.getByRole('heading', { name: '検索データを準備しています' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: '条件に合う講義が見つかりませんでした' })).toBeVisible();
  }
});
