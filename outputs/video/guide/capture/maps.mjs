// 맵 5개 깨끗한 전체 그림 (검사 칠 없이). 게임의 client/maprender.js 를 그대로 불러 캔버스에 그린 뒤 가로 1920px 로 줄인다.
// 랜턴(꺼진 모습)은 renderMap 이 함께 그린다. 사용: node maps.mjs
import fs from 'node:fs';
import * as L from './lib.mjs';
const PORT = 3703;
const srv = await L.server(PORT, {});
await L.launch();
const page = await L.newPage({ w: 1920, h: 1400 });
const html = fs.readFileSync(new URL('./maprender.html', import.meta.url), 'utf8');
await page.route('**/__cap/map.html*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
const { MAPS } = await import(L.CODE.replace(/^C:/, 'file:///C:') + 'shared/config.js');
try {
  for (const m of MAPS) {
    await page.goto(`http://127.0.0.1:${PORT}/__cap/map.html?map=${m.id}&w=1920`);
    await page.waitForFunction(() => window.__done, null, { timeout: 30000 });
    const [w, h] = await page.evaluate(() => [window.__w, window.__h]);
    await L.setView(page, w, h);
    await L.sleep(300);
    await L.shot(page, 'map_' + m.id, { clip: { x: 0, y: 0, width: w, height: h } });
  }
  // 여러 층 맵은 층을 가로로 이은 원래 모양도 한 장 더
  await page.goto(`http://127.0.0.1:${PORT}/__cap/map.html?map=star-academy&w=1920&strip=1`);
  await page.waitForFunction(() => window.__done, null, { timeout: 30000 });
  const [w, h] = await page.evaluate(() => [window.__w, window.__h]);
  await L.shot(page, 'map_star-academy_strip', { clip: { x: 0, y: 0, width: w, height: h } });
} finally {
  await L.closeBrowser();
  await srv.stop();
  process.exit(0);
}
