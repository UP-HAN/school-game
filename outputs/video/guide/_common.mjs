// 공용: 크롬 띄우기 + 구성 파일 열기 (새 모듈 설치 없이 기존 playwright-core 를 경로로 불러 쓴다)
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORK = path.join(HERE, 'work');
const PW = ['C:/Users/hanui/OneDrive/Desktop/Workspace_backup/Car_Racing/promo_video/node_modules/playwright-core'];
const CHROMES = [
  'C:/Users/hanui/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  'C:/Users/hanui/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
export const { chromium } = require(PW.find(p => fs.existsSync(p)));
export const CHROME = CHROMES.find(p => fs.existsSync(p));

// 명령줄: node x.mjs <구성이름> [--q "cut=reel&mood=promo"] [--out 경로] ...
export function args() {
  const a = process.argv.slice(2), o = { _: [] };
  for (let i = 0; i < a.length; i++) { if (a[i].startsWith('--')) { o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; } else o._.push(a[i]); }
  o.name = o._[0] || 'demo';
  o.q = o.q || '';
  o.tag = o.tag || o.name + (o.q ? '_' + o.q.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') : '');
  return o;
}

export async function open(name, q = '') {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--hide-scrollbars'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
  const url = pathToFileURL(path.join(WORK, name + '.html')).href + '?render=1' + (q ? '&' + q : '');
  await page.goto(url);
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(800);
  return { browser, page };
}

export async function info(page) {
  return page.evaluate(() => ({ events: EVENTS, total: TOTAL, bpm: BPM, mood: MOOD, sections: SECTIONS, scenes: SB }));
}
