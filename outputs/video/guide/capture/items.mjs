// 아이템 9종을 쓰는 모습 (연속 장면 seq/item_<id> 1280×720 12fps + 대표 정지 화면 item_<id>.png 1600×900)
// + 보급 상자 여는 연속 장면 seq/crate_open.
// 한밤의 놀이공원 · 잠귀신 술래잡기 · 8명 판 (브라우저 "하늘" = 학생, 봇 7: 잠귀신 1 + 학생 6).
// 학생 아이템(운동화·우산·손전등·찬스 카드·기상 나팔·킥보드)은 내가 쓰고,
// 잠귀신 아이템(바람 망토·안개 망토·긴 베개)은 잠귀신 봇이 쓰는 모습을 학생 눈으로 본다 (안개 망토는 학생 눈에만 흐려 보인다).
// 사용: node items.mjs [장면 ...]  (crate shoes kickboard flashlight chance umbrella bugle windcape fogcape pillow)
import * as L from './lib.mjs';
const { sleep, log } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3708);
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const fails = [];
const srv = await L.server(PORT, {
  testGive: true,
  itemSeq: ['shoes'], // 상자에서는 운동화가 나온다 (상자 장면 → 운동화 장면으로 이어진다)
  energy: { 'sleep-tag': { start: 5 } },
  loot: { dropsAt: [0.035, 0.5, 0.7, 0.9] }, // 첫 택배를 약 25초에
  lootFurniture: [36, 42, 45], // 광장(분수·벤치·풍선 수레)에만
  fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] },
  fogCenter: 0,
});
await L.launch();
const page = await L.newPage();
const W = (x, y, within = 12, opt) => L.walkPage(page, MAP, x, y, within, opt);
const give = (item) => page.evaluate((it) => window.__ws.send(JSON.stringify({ t: 'testGive', item: it })), item);
const useBag = async () => {
  await L.press(page, 'KeyB');
  await sleep(160);
  await L.press(page, 'Space');
};
const key = (c, on) => page.evaluate(([c, on]) => window.__key(c, on), [c, on]);
async function scene(name, fn) {
  if (!want(name)) return;
  try {
    log('▶', name);
    await fn();
  } catch (e) {
    log('✖', name, e.stack || e.message);
    fails.push(name + ': ' + e.message);
    await page.evaluate(() => window.__release && window.__release()).catch(() => {});
  }
}
let bots = [];
try {
  const g = await L.studentGame({ port: PORT, page, map: MAP, settings: { mode: 'sleep-tag', chasers: 1, missions: 3, minutes: 12 } });
  const { T } = g;
  bots = g.bots;
  const C = g.chasers[0];
  const S = g.students;
  const P = [1600, 1250]; // 광장 가운데 기준점
  const [sx, sy] = await L.myPos(page);
  S.forEach((b, i) => (b.anchor = [sx - 150 + (i % 3) * 150, sy - 120 + Math.floor(i / 3) * 140, 110]));
  C.anchor = null;
  await C.task(async (b) => b.goTo(P[0] + 500, P[1] - 150, 20));
  await L.waitIntroGone(page);
  const frozenIds = () => T.room.players.filter((p) => p.frozen).map((p) => p.id);
  const westFriends = (r = 90) => S.forEach((b, i) => (b.anchor = [P[0] - 330 + (i % 2) * 80, P[1] - 100 + i * 40, r]));

  // ── 보급 상자 열기 ──
  await scene('crate', async () => {
    for (let k = 0; k < 60 && !(T.crates && T.crates.length); k++) await sleep(1000);
    if (!T.crates || !T.crates.length) throw new Error('no crates');
    const [mx, my] = await L.myPos(page);
    const cr = [...T.crates].sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my))[0];
    log('crate', JSON.stringify(cr));
    await W(cr.x, cr.y, 55, { timeout: 30000 });
    await sleep(1500);
    await L.waitClear(page, 8000);
    await L.seqStill(
      page,
      'crate_open',
      2.9,
      async () => {
        await sleep(300);
        await key('Space', true);
        await sleep(1750);
        await key('Space', false);
      },
      { stillName: 'crate_open', stillAt: 1.1 },
    );
    await sleep(800);
    log('bag', (await page.evaluate(() => window.__info)).item);
  });

  // ── 반짝 운동화: 나란히 서 있다가 신고 친구를 앞질러 달린다 ──
  await scene('shoes', async () => {
    const it = (await page.evaluate(() => window.__info)).item;
    if (it !== 'shoes') await give('shoes');
    await C.task(async (b) => b.goTo(2700, 1750, 30)); // 잠귀신은 화면 밖으로
    const F = S[0];
    F.anchor = null;
    await F.task(async (b) => b.goTo(2060, 1110, 10));
    F.faceTo(0);
    await W(2060, 1175, 8);
    await sleep(1200);
    await L.seqStill(
      page,
      'item_shoes',
      2.8,
      async () => {
        await sleep(300);
        await useBag();
        await sleep(80);
        F.task(async (b) => {
          b.speed = 1;
          await b.goTo(1200, 1110, 10);
        });
        await key('ArrowLeft', true);
        await sleep(2300);
        await key('ArrowLeft', false);
      },
      { stillName: 'item_shoes', stillAt: 1.9 },
    );
    F.anchor = [P[0], P[1] - 60, 150];
    await sleep(4500); // 운동화 끝
  });

  // ── 킥보드: 친구들 사이를 신나게 달린다 (부딪히지 않게) ──
  await scene('kickboard', async () => {
    S.forEach((b, i) => (b.anchor = [1300 + i * 130, i % 2 ? 1080 : 1250, 60]));
    await C.task(async (b) => b.goTo(2700, 1750, 30));
    await give('kickboard');
    await W(2080, 1170, 8, { timeout: 30000 });
    await sleep(1500);
    await L.seqStill(
      page,
      'item_kickboard',
      2.6,
      async () => {
        await sleep(300);
        await useBag();
        await sleep(100);
        await key('ArrowLeft', true);
        await sleep(1900);
        await key('ArrowLeft', false);
      },
      { stillName: 'item_kickboard', stillAt: 1.5 },
    );
    await sleep(7000);
  });

  // ── 손전등: 시야가 넓어지고 랜턴 쪽 화살표 ──
  await scene('flashlight', async () => {
    S.forEach((b, i) => (b.anchor = [P[0] - 380 + (i % 3) * 380, P[1] - 250 + Math.floor(i / 3) * 330, 80]));
    await give('flashlight');
    await W(P[0], P[1] - 20, 8, { timeout: 30000 });
    await sleep(1800);
    await L.seqStill(page, 'item_flashlight', 2.6, async () => {
      await sleep(400);
      await useBag();
    }, { stillName: 'item_flashlight', stillAt: 2.0 });
    await sleep(8500);
  });

  // ── 찬스 카드: 퀴즈 창에서 틀린 보기 2개가 지워진다 ──
  await scene('chance', async () => {
    await give('chance');
    await W(1760, 742, 8, { timeout: 30000 });
    await sleep(500);
    let ok = false;
    for (let k = 0; k < 10 && !ok; k++) {
      await page.evaluate(() => (window.__q = null));
      await L.press(page, 'Space');
      await page.waitForFunction(() => window.__q, null, { timeout: 4000 });
      await sleep(600);
      const q = await page.evaluate(() => window.__q);
      if (q.kind === 'choice' && (await page.isVisible('#m-chance'))) ok = true;
      else {
        await L.press(page, 'Escape');
        await sleep(500);
      }
    }
    if (!ok) throw new Error('no choice quiz with chance button');
    await sleep(500);
    await L.seqStill(page, 'item_chance', 2.6, async () => {
      await sleep(450);
      await page.click('#m-chance');
    }, { stillName: 'item_chance', stillAt: 1.6 });
    await sleep(500);
    await L.press(page, 'Escape');
    await sleep(500);
  });

  // ── 꿈막이 우산: 잠귀신이 닿아도 "펑!" 하고 막힌다 ──
  await scene('umbrella', async () => {
    westFriends();
    await give('umbrella');
    await W(P[0], P[1], 8, { timeout: 30000 });
    await C.task(async (b) => b.goTo(P[0] + 280, P[1] + 10, 10));
    C.faceTo(0);
    await sleep(1500);
    await L.seqStill(
      page,
      'item_umbrella',
      2.9,
      async () => {
        await sleep(300);
        await useBag();
        await sleep(300);
        await C.task(async (b) => {
          b.speed = 1.1;
          await b.goTo(P[0] + 50, P[1], 8);
          b.speed = 1;
          b.send({ t: 'tag' });
          await sleep(500);
          await b.goTo(P[0] + 150, P[1] + 20, 10);
        });
      },
      { stillName: 'item_umbrella', stillAt: 1.15 },
    );
    const me = T.room.players.find((p) => p.id === g.myId);
    log('after umbrella, me frozen?', me.frozen);
    await C.task(async (b) => b.goTo(P[0] + 500, P[1] - 150, 20));
  });

  // ── 기상 나팔: 둘레의 잠든 친구들이 한꺼번에 깨어난다 ──
  await scene('bugle', async () => {
    await W(P[0], P[1], 8, { timeout: 30000 });
    const spots = [
      [P[0] - 170, P[1] - 40],
      [P[0] + 170, P[1] - 40],
      [P[0] - 20, P[1] - 170],
    ];
    const outer = [
      [-55, 0],
      [55, 0],
      [0, -55],
    ];
    const F = S.slice(0, 3);
    S.slice(3).forEach((b, i) => (b.anchor = [P[0] - 120 + i * 120, P[1] + 140, 40]));
    await Promise.all(F.map((b, i) => (b.anchor = null) || b.task(async (bb) => bb.goTo(spots[i][0], spots[i][1], 8))));
    for (let i = 0; i < 3; i++) {
      await C.task(async (b) => {
        await b.goTo(spots[i][0] + outer[i][0], spots[i][1] + outer[i][1], 8);
        for (let k = 0; k < 20; k++) {
          b.send({ t: 'tag' });
          await sleep(400);
          if (T.room.players.find((p) => p.id === F[i].id).frozen) break;
          await sleep(500);
        }
      });
    }
    await C.task(async (b) => b.goTo(P[0] + 520, P[1] - 160, 20));
    log('asleep friends', frozenIds().length);
    await give('bugle');
    await sleep(1500);
    await L.waitClear(page, 6000);
    await L.seqStill(page, 'item_bugle', 2.6, async () => {
      await sleep(400);
      await useBag();
    }, { stillName: 'item_bugle', stillAt: 0.95 });
    log('asleep after bugle', frozenIds().length);
    F.forEach((b, i) => (b.anchor = [P[0] - 330 + i * 70, P[1] - 100, 80]));
    await sleep(1000);
  });

  // ── 바람 망토 (잠귀신): 쓰자마자 빠르게 내 앞을 지나간다 ──
  await scene('windcape', async () => {
    S.forEach((b, i) => (b.anchor = [P[0] - 250 + i * 90, P[1] + 150, 40]));
    await W(P[0], P[1] + 60, 8, { timeout: 30000 });
    await C.task(async (b) => b.goTo(P[0] - 190, P[1] - 70, 10));
    C.faceTo(P[0] + 500);
    await sleep(1500);
    await L.seqStill(
      page,
      'item_windcape',
      2.8,
      async () => {
        await sleep(300);
        C.send({ t: 'testGive', item: 'windcape' });
        await sleep(60);
        C.send({ t: 'useItem' });
        await sleep(250);
        await C.task(async (b) => {
          b.speed = 1.28;
          await b.goTo(P[0] + 620, P[1] - 70, 10);
          b.speed = 1;
        });
      },
      { stillName: 'item_windcape', stillAt: 1.3 },
    );
    await sleep(3000);
  });

  // ── 안개 망토 (잠귀신): 학생 눈에는 흐릿해지고 "잠귀신" 이름표가 사라진다 ──
  await scene('fogcape', async () => {
    westFriends(60);
    await W(P[0], P[1], 8, { timeout: 30000 });
    await C.task(async (b) => b.goTo(P[0] + 210, P[1] - 50, 10));
    C.faceTo(0);
    await sleep(1500);
    await L.seqStill(
      page,
      'item_fogcape',
      2.8,
      async () => {
        await sleep(300);
        C.send({ t: 'testGive', item: 'fogcape' });
        await sleep(60);
        C.send({ t: 'useItem' });
        await sleep(500);
        await C.task(async (b) => {
          b.speed = 0.55;
          await b.goTo(P[0] + 120, P[1] - 10, 8);
          b.speed = 1;
        });
      },
      { stillName: 'item_fogcape', stillAt: 1.9 },
    );
    await sleep(500);
    await C.task(async (b) => b.goTo(P[0] + 520, P[1] - 160, 20));
    await sleep(7000); // 안개 망토 끝
  });

  // ── 긴 베개 (잠귀신): 평소보다 먼 곳(약 105px)에서 나를 재운다 ──
  await scene('pillow', async () => {
    westFriends(60);
    await W(P[0], P[1], 8, { timeout: 30000 });
    const [mx, my] = await L.myPos(page);
    await C.task(async (b) => b.goTo(mx + 105, my, 6));
    C.faceTo(0);
    await sleep(1500);
    log('chaser dist', Math.hypot(C.x - mx, C.y - my));
    await L.seqStill(
      page,
      'item_pillow',
      2.8,
      async () => {
        await sleep(300);
        C.send({ t: 'testGive', item: 'pillow' });
        await sleep(60);
        C.send({ t: 'useItem' });
        await sleep(650);
        C.send({ t: 'tag' });
      },
      { stillName: 'item_pillow', stillAt: 1.45 },
    );
    const me = T.room.players.find((p) => p.id === g.myId);
    log('after pillow, me frozen?', me.frozen);
  });
} catch (e) {
  log('FATAL', e.stack || e.message);
  fails.push('fatal: ' + e.message);
} finally {
  log('FAILS', JSON.stringify(fails));
  for (const b of bots) b.dead = true;
  await L.closeBrowser();
  await srv.stop();
  process.exit(0);
}
