// 잠 안개 + 패배 끝 화면 (시간을 줄인 판: 5분 = 60초). 안개 중심은 중앙 광장(1600,1240).
// 사용: node fog.mjs
import * as L from './lib.mjs';
const { sleep, log, shot, seq } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3704);
const CX = 1600;
const CY = 1240;
const srv = await L.server(PORT, {
  minuteMs: 12000, // 게임 1분 = 12초 → 5분 판이 60초
  fog: {
    warnMs: 5000,
    stages: [
      { at: 0.25, shrinkMs: 6000 },
      { at: 0.48, shrinkMs: 6000 },
      { at: 0.7, shrinkMs: 6000 },
    ],
  },
  fogCenter: 0,
  loot: { dropsAt: [0.95] }, // 상자는 사실상 안 나오게
});
await L.launch();
const page = await L.newPage();
const fails = [];
try {
  const { T, bots, myId, chasers, students } = await L.studentGame({
    port: PORT,
    page,
    map: MAP,
    settings: { mode: 'sleep-tag', chasers: 1, missions: 8, minutes: 5 },
  });
  const t0 = Date.now(); // 대략 게임 시작 시각
  const el = () => Date.now() - t0;
  const [mx, my] = await L.myPos(page);
  bots.forEach((b, i) => (b.anchor = [CX - 380 + (i % 3) * 60, CY - 120 + i * 35, 140]));
  // 서쪽으로 (빛 구역 가장자리 쪽)
  await L.waitIntroGone(page);
  const ME = [CX - 470, CY + 10];
  await L.walkPage(page, MAP, ME[0], ME[1], 12);
  log('at', await L.myPos(page), 'elapsed', el());
  // 안개 예고 (1단계 15초 - 5초)
  const fogNow = () => T.room.fog;
  let warnShot = 0;
  for (;;) {
    const f = fogNow();
    if (f && f.stage >= 1) break;
    if (el() > 16000) break;
    await sleep(200);
  }
  log('fog1', JSON.stringify(fogNow()), el());
  // 2단계 끝(r=950)~3단계: 3단계 시작을 기다린다
  for (;;) {
    const f = fogNow();
    if (f && f.stage >= 3) break;
    if (el() > 52000) break;
    // 3단계 예고 큰 글씨("곧 마지막 밤" 등)가 뜨면 한 장
    if (!warnShot && f && f.stage === 2) {
      const big = await page.evaluate(() => (document.getElementById('g-big').hidden ? '' : document.getElementById('g-big').textContent));
      if (big) {
        warnShot = 1;
        await sleep(300);
        await shot(page, 's_fog_warn');
      }
    }
    await sleep(150);
  }
  log('fog3', JSON.stringify(fogNow()), el());
  await L.setView(page, 1280, 720);
  await seq(page, 'fog', 4, 12);
  await L.setView(page, 1600, 900);
  await sleep(500);
  log('fog after seq', JSON.stringify(fogNow()));
  await shot(page, 's_fog');
  // 한 걸음 안쪽에서 한 장 더 (경계가 화면 왼쪽에)
  await L.walkPage(page, MAP, CX - 380, CY, 12);
  await sleep(600);
  await shot(page, 's_fog_2');
  // 시간이 끝나면 잠귀신 승리 → 패배 끝 화면
  await page.waitForSelector('#g-ending:not([hidden])', { timeout: 30000 });
  await sleep(1300);
  await shot(page, 's_lose');
  await page.waitForSelector('#g-over:not([hidden])', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  await shot(page, 's_lose_over');
  for (const b of bots) b.dead = true;
} catch (e) {
  log('FATAL', e.stack || e.message);
  fails.push(e.message);
  await shot(page, '_fatal_fog').catch(() => {});
} finally {
  log('FAILS', JSON.stringify(fails));
  await L.closeBrowser();
  await srv.stop();
  process.exit(0);
}
