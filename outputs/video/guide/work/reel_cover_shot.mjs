// 릴스 커버 찍기: node work/reel_cover_shot.mjs  → outputs/promo/instagram/ 에 세로·가로 커버 jpg
import path from 'path';
import fs from 'fs';
import { open, HERE } from '../_common.mjs';
const OUT = path.resolve(HERE, '../../promo/instagram');
fs.mkdirSync(OUT, { recursive: true });
for (const [q, vp, name] of [['o=v', { width: 1080, height: 1920 }, '랜턴_릴스_커버_세로.jpg'], ['', { width: 1920, height: 1080 }, '랜턴_커버_가로.jpg']]) {
  const { browser, page } = await open('reel_cover', q, vp);
  const f = path.join(OUT, name);
  await page.screenshot({ path: f, type: 'jpeg', quality: 95 });
  await browser.close();
  console.log(f);
}
