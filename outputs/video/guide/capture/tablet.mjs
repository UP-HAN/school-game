// 태블릿 화면 (1180×820, 터치 기기 흉내: 키 글자 숨김, 화면 조이스틱). 한밤의 놀이공원 · 잠귀신 술래잡기 · 8명 판.
// 사용: node tablet.mjs
import * as L from './lib.mjs';
const { sleep, log, shot } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3707);
const srv = await L.server(PORT, { fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] }, fogCenter: 0, loot: { dropsAt: [0.9] } });
await L.launch();
const page = await L.newPage({ w: 1180, h: 820, touch: true });
const fails = [];
let bots = [];
try {
  const g = await L.studentGame({ port: PORT, page, map: MAP, settings: { mode: 'sleep-tag', chasers: 1, missions: 3, minutes: 10 } });
  bots = g.bots;
  log('touch-only?', await page.evaluate(() => document.documentElement.className));
  const [mx, my] = await L.myPos(page);
  bots.forEach((b, i) => (b.anchor = [mx - 120 + (i % 3) * 110, my - 120 + Math.floor(i / 3) * 110, 160]));
  await L.waitIntroGone(page);
  await sleep(1000);
  // 조이스틱을 누른 채 걷는 중
  await L.walkPage(page, MAP, mx + 120, my - 140, 15, { stick: true, keep: true, at: [260, 600] });
  await page.evaluate(() => window.__stickMove(40, -45));
  await sleep(250);
  await L.waitClear(page, 4000);
  await shot(page, 's_tablet_play');
  await page.evaluate(() => window.__stickUp());
  await sleep(300);
  await shot(page, 's_tablet_play_still');
  // 랜턴 t2 로 가서 버튼을 손가락으로 눌러 퀴즈 열기 (객관식이 나올 때까지)
  await L.walkPage(page, MAP, 1760, 742, 8, { stick: true, at: [260, 600], timeout: 30000, tol: 10 });
  await sleep(300);
  log('at', await L.myPos(page));
  await page.waitForSelector('#g-action:not([hidden])', { timeout: 5000 });
  await sleep(500);
  await shot(page, 's_tablet_lantern');
  for (let k = 0; k < 8; k++) {
    await page.evaluate(() => (window.__q = null));
    await page.tap('#g-action', { force: true });
    await page.waitForFunction(() => window.__q, null, { timeout: 4000 });
    await sleep(700);
    const q = await page.evaluate(() => window.__q);
    if (q.kind === 'choice') {
      await shot(page, 's_tablet_quiz');
      break;
    }
    if (k === 0) await shot(page, 's_tablet_quiz_short');
    await page.tap('#m-close', { force: true });
    await sleep(500);
  }
} catch (e) {
  log('FATAL', e.stack || e.message);
  fails.push(e.message);
  await shot(page, '_fatal_tablet').catch(() => {});
} finally {
  log('FAILS', JSON.stringify(fails));
  for (const b of bots) b.dead = true;
  await L.closeBrowser();
  await srv.stop();
  process.exit(0);
}
