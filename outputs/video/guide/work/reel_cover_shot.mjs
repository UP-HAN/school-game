// 릴스 커버 찍기: node work/reel_cover_shot.mjs  → outputs/promo/instagram/ 에 세로·가로 커버 jpg
import path from 'path';
import fs from 'fs';
import { open, HERE } from '../_common.mjs';
const OUT = path.resolve(HERE, '../../promo/instagram');
fs.mkdirSync(OUT, { recursive: true });
// 인자로 v / h / s 를 주면 그 판만 찍는다 (기존 파일을 덮어쓰지 않으려면 골라 찍기). 없으면 셋 다.
const ONLY = process.argv[2];
for (const [k, q, vp, name] of [['v', 'o=v', { width: 1080, height: 1920 }, '랜턴_릴스_커버_세로.jpg'], ['h', '', { width: 1920, height: 1080 }, '랜턴_커버_가로.jpg'], ['s', 'o=s', { width: 1080, height: 1080 }, '랜턴_커버_정사각.jpg']]) {
  if (ONLY && ONLY !== k) continue;
  const { browser, page } = await open('reel_cover', q, vp);
  const f = path.join(OUT, name);
  await page.screenshot({ path: f, type: 'jpeg', quality: 95 });
  await browser.close();
  console.log(f);
}
