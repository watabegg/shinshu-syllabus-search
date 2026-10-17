import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, height, target] of [
    ['og-syllabus-alps', 1200, 630, 'og-syllabus-alps'],
    ['favicon', 180, 180, 'apple-touch-icon'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const svg = await readFile(new URL(`../public/${name}.svg`, import.meta.url), 'utf8');
    await page.setContent(`<style>body{margin:0}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`../public/${target}.png`, import.meta.url).pathname });
    await page.close();
  }
} finally {
  await browser.close();
}
