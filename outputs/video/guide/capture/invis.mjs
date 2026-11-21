// 투명 망토(invis) 장면 두 개. 한밤의 놀이공원 · 잠귀신 술래잡기 · 8명 판.
// 1) seq/item_invis + item_invis.png : 학생("나") 화면 — 다가오던 잠귀신이 나를 못 보고 지나친다
// 2) seq/item_invis_chaser + item_invis_chaser.png : 잠귀신("나") 화면 — 눈앞 학생 봇이 망토를 쓰자 사라진다
// 사용: node invis.mjs [student] [chaser]
import * as L from './lib.mjs';
const { sleep, log, shot } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3709);
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const fails = [];
const srv = await L.server(PORT, {
  testGive: true,
  loot: { dropsAt: [0.95] },
  fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] },
  fogCenter: 0,
});
await L.launch();
const P = [1600, 1250];
const SETTINGS = { mode: 'sleep-tag', chasers: 1, missions: 3, minutes: 12 };

async function run(name, wantRole, fn) {
  if (!want(name)) return;
  const page = await L.newPage();
  let bots = [];
  try {
    const g = await L.studentGame({ port: PORT, page, map: MAP, settings: SETTINGS, wantRole });
    bots = g.bots;
    await L.waitIntroGone(page);
    await fn(page, g);
  } catch (e) {
    log('✖', name, e.stack || e.message);
    fails.push(name + ': ' + e.message);
  } finally {
    for (const b of bots) {
      b.dead = true;
      b.ws.close();
    }
    await page.context().close();
  }
}

// ── 1) 학생 화면 ──
await run('student', 'student', async (page, { T, chasers, students, myId }) => {
  const C = chasers[0];
  C.anchor = null;
  students.forEach((b, i) => (b.anchor = [P[0] - 330 + (i % 2) * 90, P[1] - 120 + i * 45, 50]));
  await L.walkPage(page, MAP, P[0], P[1], 8, { timeout: 30000 });
  await C.task(async (b) => b.goTo(P[0] + 330, P[1] - 20, 10));
  C.faceTo(0);
  await page.evaluate(() => window.__ws.send(JSON.stringify({ t: 'testGive', item: 'invis' })));
  await sleep(2500); // 잠귀신 꿈 걸기 대기(시작 10초)도 지나게
  await L.waitClear(page, 6000);
  await L.seqStill(
    page,
    'item_invis',
    2.9,
    async () => {
      const walk = C.task(async (b) => {
        b.speed = 0.9;
        await b.goTo(P[0] + 160, P[1] - 10, 8); // 나에게 다가오다가
        await b.goTo(P[0] + 20, P[1] - 120, 8); // 나를 못 보고 옆(위쪽)으로 지나쳐
        await b.goTo(P[0] - 220, P[1] - 150, 8);
        b.speed = 1;
      });
      await sleep(300);
      await L.press(page, 'KeyB');
      await sleep(160);
      await L.press(page, 'Space');
      await walk;
    },
    { stillName: 'item_invis', stillAt: 1.6 },
  );
  const me = T.room.players.find((p) => p.id === myId);
  log('me frozen?', me.frozen);
});

// ── 2) 잠귀신 화면 ──
await run('chaser', 'chaser', async (page, { T, students, myId }) => {
  const V = students[0];
  V.anchor = null;
  students.slice(1).forEach((b, i) => (b.anchor = [P[0] - 260 + i * 110, P[1] + 140 + (i % 2) * 40, 30]));
  await L.walkPage(page, MAP, P[0], P[1] - 40, 8, { timeout: 30000 });
  await V.task(async (b) => b.goTo(P[0] + 150, P[1] - 60, 8));
  V.faceTo(0);
  await sleep(2000);
  await L.waitClear(page, 6000);
  await L.seqStill(
    page,
    'item_invis_chaser',
    3.0,
    async () => {
      await sleep(400);
      V.send({ t: 'testGive', item: 'invis' });
      await sleep(60);
      V.send({ t: 'useItem' });
      await sleep(300);
      await V.task(async (b) => {
        b.speed = 0.8;
        await b.goTo(P[0] - 230, P[1] - 60, 8); // 다른 자리(내 왼쪽)로 몰래 이동
        b.speed = 1;
      });
    },
    { stillName: 'item_invis_chaser', stillAt: 1.3 },
  );
  // 망토가 켜진 동안 작은 지도·버튼에 드러나는지 (망토 4초 안)
  await L.press(page, 'KeyM');
  await sleep(500);
  await shot(page, 'extra/item_invis_chaser_minimap');
  await L.press(page, 'Escape');
  // 4초가 지나 다시 나타나는 모습
  for (let k = 0; k < 30; k++) {
    const v = T.room.players.find((p) => p.id === V.id);
    if (!v.hide) break;
    await sleep(150);
  }
  await sleep(500);
  log('V bot pos', V.x, V.y, 'server', JSON.stringify(T.room.players.find((p) => p.id === V.id)));
  await shot(page, 'extra/item_invis_chaser_back');
  // 시험(영상용 아님): 망토를 쓴 학생 옆에서 꿈에 빠뜨리기를 누르면 잡히는가
  await sleep(500);
  V.send({ t: 'testGive', item: 'invis' });
  await sleep(60);
  V.send({ t: 'useItem' });
  await sleep(400);
  await L.walkPage(page, MAP, V.x + 45, V.y, 6, { timeout: 15000 });
  const hidden = T.room.players.find((p) => p.id === V.id).hide;
  log('me', await L.myPos(page), 'V', V.x, V.y, 'V hidden?', hidden, 'action', await page.textContent('#g-action-label'));
  await L.press(page, 'Space');
  await sleep(700);
  log('TAG TEST: V frozen after tag?', T.room.players.find((p) => p.id === V.id).frozen);
});

log('FAILS', JSON.stringify(fails));
await L.closeBrowser();
await srv.stop();
process.exit(0);
