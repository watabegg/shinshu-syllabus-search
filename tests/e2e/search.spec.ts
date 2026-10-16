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
  await expect(page.getByRole('heading', { name: '検索条件', exact: true })).toBeVisible();
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

test('multiple filters persist in URL, reload, detail navigation, and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('form', { name: '講義を検索' }).getByRole('combobox')).toHaveCount(2);
  await expect(page.locator('select:not([aria-hidden="true"])')).toHaveCount(0);
  await page.getByRole('combobox', { name: '学部・研究科' }).click();
  await page.getByRole('option', { name: '工学部', exact: true }).click();
  const choose = async (label: string, options: string[]) => {
    await page.getByRole('button', { name: `${label}を選択`, exact: true }).click();
    for (const name of options) await page.getByRole('checkbox', { name, exact: true }).check();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '完了', exact: true }).click();
  };
  await choose('学期', ['前期', '後期', '集中以外']);
  await choose('曜日', ['月', '水']);
  await choose('時限', ['1限', '2限']);
  await choose('授業形式', ['対面', 'オンデマンド']);
  await page.getByRole('button', { name: '検索する', exact: true }).click();
  await expect(page).toHaveURL(/department=t/);
  const params = new URL(page.url()).searchParams;
  expect(params.get('term')).toBe('前期,後期');
  expect(params.get('intensive')).toBe('no');
  expect(params.get('day')).toBe('1,3');
  expect(params.get('period')).toBe('1,2');
  expect(params.get('modality')).toBe('in_person,on_demand');
  await expect(page.locator('.result-card-link').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '曜日を選択' })).toContainText('月・水');
  await page.locator('.result-card-link').first().click();
  await expect(page.getByRole('link', { name: '大学の原本PDFを開く' })).toBeVisible();
  await page.getByRole('link', { name: '← 検索結果に戻る' }).click();
  await expect(page.getByRole('button', { name: '時限を選択' })).toContainText('1限・2限');
  await expect(page.getByRole('button', { name: '学期を選択' })).toContainText('前期・後期・集中以外');
  await page.getByRole('button', { name: '次のページ', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'ページを選択' })).toHaveText(/^2\//);
  expect(new URL(page.url()).searchParams.get('day')).toBe('1,3');
  await page.getByRole('link', { name: '条件をクリア' }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const label of ['学期', '曜日', '時限', '授業形式']) {
    await expect(page.getByRole('button', { name: `${label}を選択`, exact: true })).toContainText('すべて');
  }
  expect(errors).toEqual([]);
});

test('multiple dropdowns support keyboard, group clearing, mobile and legacy URLs', async ({ page }, testInfo) => {
  await page.goto('/?term=前期(隔週A)&day=1&period=1&modality=unknown');
  await expect(page.getByRole('button', { name: '学期を選択' })).toContainText('前期');
  await expect(page.getByRole('button', { name: '授業形式を選択' })).toContainText('対面');
  const day = page.getByRole('button', { name: '曜日を選択' });
  await day.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  const wed = page.getByRole('checkbox', { name: '水', exact: true });
  await wed.focus();
  await page.keyboard.press('Space');
  await expect(wed).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(day).toBeFocused();
  await expect(day).toContainText('月・水');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '学期を選択' }).click();
  await page.getByRole('checkbox', { name: '集中', exact: true }).check();
  await page.getByRole('checkbox', { name: '集中以外', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: '集中', exact: true })).toBeChecked();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('multi-select-mobile.png') });
  await page.getByRole('button', { name: 'クリア', exact: true }).click();
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await page.getByRole('button', { name: '完了', exact: true }).click();
  await expect(day).toContainText('月・水');
  await expect(page.getByRole('button', { name: '学期を選択' })).toContainText('すべて');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('shadcn dropdown stays visible and usable on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('combobox', { name: '学部・研究科' });
  await trigger.click();
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('mobile-shadcn-select.png') });
  await page.getByRole('option', { name: '工学部', exact: true }).click();
  await expect(trigger).toContainText('工学部');
  await page.getByRole('button', { name: '検索する', exact: true }).click();
  await expect(page).toHaveURL(/department=t/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('whole result cards navigate and syllabus content is structured', async ({ page }) => {
  await page.goto('/?title=コロイド');
  await expect(page.getByText('記載から判定できず', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'データの対象と取得状況' })).toHaveCount(0);
  await expect(page.getByText('出典について', { exact: true })).toHaveCount(0);
  const card = page.locator('.result-card-link').filter({ hasText: 'T1AB3300' }).first();
  await expect(card).toHaveAttribute('href', /courses/);
  const searchWidth = await page.locator('main').evaluate((element) => element.getBoundingClientRect().width);
  // Click metadata rather than the heading: the entire card must be the link.
  await card.getByText('T1AB3300', { exact: true }).click();
  await expect(page.locator('main')).toHaveClass(/detail-main/);
  expect(await page.locator('main').evaluate((element) => element.getBoundingClientRect().width)).toBe(searchWidth);
  await expect(page.getByRole('heading', { name: '授業の概要', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '成績評価の方法', exact: true })).toBeVisible();
  for (const text of ['資料の照合情報', 'PDF識別用ハッシュ', '抽出時の注意', '原文の記載：']) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  }
  await expect(page.locator('.source-caveat')).toHaveCount(0);
  const pdfButton = page.getByRole('link', { name: '大学の原本PDFを開く' });
  const textColor = await pdfButton.evaluate(element => getComputedStyle(element).color);
  expect(textColor).toBe('rgb(250, 250, 250)');
  await pdfButton.hover();
  expect(await pdfButton.evaluate(element => getComputedStyle(element).color)).toBe(textColor);
  const toc = page.getByRole('navigation', { name: 'シラバスの目次' });
  await expect(toc.getByRole('list')).toBeVisible();
  const planLink = toc.getByRole('link', { name: '授業計画', exact: true });
  const target = await planLink.getAttribute('href');
  await planLink.click();
  expect(new URL(page.url()).hash).toBe(target);
  await expect(page.locator(target!)).toBeInViewport();

  const plan = page.getByRole('region', { name: '授業計画', exact: true });
  await expect(plan.getByRole('table')).toBeVisible();
  await expect(plan.getByRole('cell', { name: '第1回', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '原文 · 1ページ' })).toHaveCount(0);
  await page.getByRole('button', { name: '抽出原文を確認' }).click();
  await expect(page.getByRole('heading', { name: '原文 · 1ページ' })).toBeVisible();
  await page.getByRole('link', { name: '← 検索結果に戻る' }).click();
  await expect(page.getByRole('textbox', { name: '科目名', exact: true })).toHaveValue('コロイド');
  await page.locator('.result-card-link').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '授業の概要', exact: true })).toBeVisible();
});

test('pagination selects pages, preserves filters, and disables boundary arrows', async ({ page }, testInfo) => {
  await page.goto('/?year=2026');
  await expect(page.getByText('SHINSHU UNIVERSITY · SYLLABUS', { exact: true })).toHaveCount(0);
  await expect(page.getByText('SEARCH', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1〜5語・各40文字以内。2文字以下も検索できます。', { exact: true })).toHaveCount(0);
  const selector = page.getByRole('combobox', { name: 'ページを選択' });
  await expect(selector).toHaveText('1/323');
  await expect(page.getByRole('heading', { name: '検索結果 6,460件' })).toBeVisible();
  await expect(page.locator('.results-heading').getByRole('navigation', { name: '検索結果のページ' })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: '検索結果のページ' })).toHaveCount(1);
  await expect(page.getByText('このページに', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '前のページ', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '次のページ', exact: true }).click();
  await expect(selector).toHaveText('2/323');
  expect(new URL(page.url()).searchParams.get('year')).toBe('2026');
  await selector.click();
  await page.getByRole('option', { name: '3/323', exact: true }).click();
  await expect(selector).toHaveText('3/323');
  await selector.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pagination-desktop.png') });
  await selector.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(selector).toHaveText('323/323');
  await expect(page.getByRole('button', { name: '次のページ', exact: true })).toBeDisabled();
  await expect(page.locator('.result-card-link')).toHaveCount(20);
  await page.setViewportSize({ width: 390, height: 844 });
  await selector.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pagination-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/?title=ドイツ言語文化発展演習&year=2026');
  await page.getByRole('link', { name: 'ドイツ言語文化発展演習VII', exact: true }).click();
  await expect(page.getByRole('heading', { name: '授業の概要', exact: true })).toBeVisible();
});
