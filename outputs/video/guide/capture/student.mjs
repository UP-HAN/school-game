// 학생 화면 캡처 (한밤의 놀이공원 · 잠귀신 술래잡기 · 8명 판: 브라우저 "하늘" + 봇 7)
// 사용: node student.mjs [장면 이름 ...]   (비우면 전부)
import * as L from './lib.mjs';
const { sleep, log, shot, seq } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3702);
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const fails = [];

const srv = await L.server(PORT, {
  testGive: true,
  itemSeq: ['kickboard'], // 보급 상자에서 킥보드가 나오게
  energy: { 'sleep-tag': { start: 5 } }, // 잠귀신 꿈 구슬 넉넉히
  loot: { dropsAt: [0.1, 0.3, 0.5, 0.7] }, // 첫 부엉이 택배를 72초에
  fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] }, // 안개는 늦게
  fogCenter: 0,
  lootFurniture: [36, 42, 45, 60, 61], // 상자는 밝은 곳(광장 분수·벤치·풍선 수레, 간식 거리 수레)에만
});
await L.launch();
const page = await L.newPage();
const BASE = `http://127.0.0.1:${PORT}/`;
let T;
let bots = [];
let C = null; // 잠귀신 봇
let S = []; // 학생 봇
const W = (x, y, within = 20, opt) => L.walkPage(page, MAP, x, y, within, opt);
const setView = (w, h) => L.setView(page, w, h);
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
const info = () => page.evaluate(() => window.__info);
const myRole = () => T.room.players.find((p) => p.id === myId).role;
let myId = null;
const near = (n, x, y, r) => n.forEach((b, i) => (b.anchor = [x + Math.cos(i * 2.1) * r * 0.4, y + Math.sin(i * 2.1) * r * 0.4, r]));

try {
  // ── 대기방까지 ──
  T = await L.kit.teacherOf(PORT);
  T.send({ t: 'questions', set: L.QSET });
  await T.next((m) => m.t === 'room' && m.qset);
  T.send({ t: 'settings', map: MAP, mode: 'sleep-tag', chasers: 1, missions: 3, minutes: 12 });
  await T.next((m) => m.t === 'room' && m.settings.map === MAP && m.settings.minutes === 12);
  bots = await L.addBots(PORT, T.code, L.NAMES.slice(1, 5), MAP, L.CHARS.slice(1, 5));

  await page.goto(BASE);
  await sleep(1500);
  await page.fill('#join-code', T.code);
  await page.fill('#join-name', '하늘');
  await sleep(400);
  if (want('pre')) await shot(page, 's_join');
  await page.click('#join-form button[type=submit]');
  await page.waitForSelector('#view-student:not([hidden])');
  myId = await page.evaluate(() => window.__id);
  await page.click('#s-picker [data-kind="cat"]');
  bots.push(...(await L.addBots(PORT, T.code, L.NAMES.slice(5, 8), MAP, L.CHARS.slice(5, 8))));
  await sleep(1500);
  if (want('pre')) await shot(page, 's_lobby');

  // ── 시작 (내가 학생이 될 때까지) ──
  for (let tries = 0; tries < 10; tries++) {
    T.clear();
    T.send({ t: 'start' });
    await T.next((m) => m.t === 'room' && m.phase === 'game');
    await page.waitForSelector('#g-loading:not([hidden])', { timeout: 5000 });
    await sleep(1300);
    if (tries === 0 && want('pre')) await shot(page, 's_loading');
    if (myRole() === 'student') break;
    log('I am chaser, restart');
    T.send({ t: 'end' });
    await T.next((m) => m.t === 'room' && m.phase === 'lobby');
    await sleep(800);
  }
  await sleep(300);
  for (const b of bots) b.syncPos();
  C = bots.find((b) => T.room.players.find((p) => p.id === b.id).role === 'chaser');
  S = bots.filter((b) => b !== C);
  log('chaser bot', C.name);
  const [sx, sy] = await L.myPos(page);
  near(bots, sx, sy, 170);
  C.anchor = [sx + 150, sy - 60, 120];
  await page.waitForSelector('#g-intro:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('#g-intro', { state: 'hidden', timeout: 9000 }).catch(() => {});
  await sleep(1200);

  await scene('play', async () => {
    await L.waitNoToast(page);
    // 여러 장 찍어 친구가 가장 많이 보이는 것을 s_play 로 고른다
    for (let k = 1; k <= 4; k++) {
      await shot(page, 's_play_' + k);
      await sleep(1100);
    }
  });

  // ── 랜턴 (대관람차 앞 t2) ──
  await scene('lantern', async () => {
    // 친구 두 명은 먼저 대관람차 쪽으로
    S[0].anchor = [1900, 660, 110];
    S[1].anchor = [1600, 1000, 150];
    await W(1600, 1240, 20);
    await sleep(800);
    await setView(1280, 720);
    await seq(page, 'walk_lantern', 3.6, 12, async () => {
      await sleep(150);
      await W(1772, 742, 14);
    });
    await setView(1600, 900);
    await W(1775, 748, 10);
    await sleep(1200);
    await L.waitNoToast(page);
    await shot(page, 's_lantern');
  });

  // 퀴즈: 객관식·단답형을 둘 다 찍는다 (닫았다 다시 열면 다른 문제)
  let gotChoice = false;
  let gotShort = false;
  await scene('quiz', async () => {
    for (let k = 0; k < 10 && !(gotChoice && gotShort); k++) {
      await page.evaluate(() => (window.__q = null));
      await L.press(page, 'Space');
      await page.waitForFunction(() => window.__q, null, { timeout: 4000 });
      await sleep(600);
      const q = await page.evaluate(() => window.__q);
      if (q.kind === 'choice' && !gotChoice) {
        await shot(page, 's_quiz');
        gotChoice = true;
      } else if (q.kind === 'short' && !gotShort) {
        await page.fill('#m-input', '');
        await page.type('#m-input', L.answerOf(q.text), { delay: 90 });
        await sleep(300);
        await shot(page, 's_quiz_short');
        gotShort = true;
        await page.click('#m-submit');
        await sleep(250);
        await shot(page, 's_correct');
        await sleep(1500);
        await shot(page, 's_correct_after'); // 창이 닫힌 뒤 켜진 랜턴
        break;
      }
      await L.press(page, 'Escape');
      await sleep(500);
    }
  });

  await scene('minimap', async () => {
    await L.press(page, 'KeyM');
    await sleep(800);
    await shot(page, 's_minimap');
    await L.press(page, 'Escape');
    await sleep(300);
  });

  // ── 대왕 미끄럼틀 연속 장면 ──
  await scene('slide-seq', async () => {
    S[0].anchor = [1450, 620, 90];
    await W(1520, 600, 15);
    await sleep(600);
    await setView(1280, 720);
    await seq(page, 'slide', 3.8, 12, async () => {
      await sleep(350);
      await L.press(page, 'Space');
    });
    await setView(1600, 900);
    await sleep(800);
  });

  // ── 별똥별 미끄럼틀: 줄 서기 + 타는 중 ──
  await scene('queue', async () => {
    const dev = L.nav(MAP).MAP.devices.find((d) => d.id === 'slide-star');
    const [fx, fy] = dev.from;
    const A = S[2];
    const B = S[3];
    A.anchor = null;
    B.anchor = null;
    const goA = A.task(async (b) => b.goTo(fx, fy, 12));
    const goB = B.task(async (b) => b.goTo(fx + 70, fy + 40, 12));
    S[4].anchor = [fx - 160, fy - 40, 80];
    await W(fx - 75, fy + 30, 15);
    await Promise.all([goA, goB]);
    await sleep(800);
    // A 가 타기 시작 → 입구 위에 "사용 중"
    A.send({ t: 'use', device: dev.id });
    await sleep(700);
    await shot(page, 's_queue');
    await L.press(page, 'Space'); // 타 보려 하면 "앞사람이 타고 있어요" 안내
    await sleep(500);
    await shot(page, 's_queue_toast');
    // A 의 자리 갱신
    A.x = dev.to[0];
    A.y = dev.to[1];
    A.anchor = [dev.to[0], dev.to[1] + 40, 100];
    await sleep(3200);
    await W(fx, fy, 12);
    await sleep(300);
    await L.press(page, 'Space');
    await sleep(1300);
    await shot(page, 's_slide');
    await sleep(2500);
    B.anchor = [fx + 80, fy - 60, 120];
  });

  // ── 회전목마 ──
  await scene('carousel', async () => {
    const dev = L.nav(MAP).MAP.devices.find((d) => d.id === 'carousel-east');
    const dw = L.nav(MAP).MAP.devices.find((d) => d.id === 'carousel-west');
    // 친구 둘이 먼저 회전목마 쪽으로
    S[0].anchor = null;
    S[1].anchor = null;
    const f1 = S[0].task(async (b) => b.goTo(dw.from[0], dw.from[1], 15));
    const f2 = S[1].task(async (b) => b.goTo(560, 330, 30));
    await W(dev.from[0], dev.from[1], 12, { timeout: 30000 });
    await Promise.all([f1, f2]);
    await sleep(500);
    S[0].send({ t: 'use', device: dw.id });
    await sleep(150);
    await L.press(page, 'Space');
    // 도는 동안 여러 장 (가장 잘 보이는 것을 s_carousel 로 고른다)
    for (let k = 1; k <= 5; k++) {
      await sleep(420);
      await shot(page, 's_carousel_' + k);
    }
    await sleep(1200);
    S[0].x = dw.to[0];
    S[0].y = dw.to[1];
    S[0].anchor = [560, 450, 140];
    S[1].anchor = [560, 450, 140];
  });

  // ── 유령의 집 (어두운 구역) + 랜턴 t4 ──
  await scene('ghost', async () => {
    S[1].anchor = [330, 1000, 90];
    await W(260, 980, 15, { timeout: 30000 });
    await sleep(1500);
    await shot(page, 's_ghost_toast'); // 들어갈 때 안내 글
    await sleep(2000);
    await L.waitClear(page, 12000);
    await shot(page, 's_ghost');
    // 랜턴 t4 를 켠다 (객관식이면 정답을 눌러 '정답' 장면도 하나 더)
    await W(225, 905, 12);
    await sleep(300);
    for (let k = 0; k < 6; k++) {
      await page.evaluate(() => (window.__q = null));
      await L.press(page, 'Space');
      await page.waitForFunction(() => window.__q, null, { timeout: 4000 });
      await sleep(500);
      const q = await page.evaluate(() => window.__q);
      if (q.kind === 'choice') {
        if (!gotChoice) {
          await shot(page, 's_quiz');
          gotChoice = true;
        }
        const a = L.answerOf(q.text);
        await page.locator('#m-choices button', { hasText: a }).first().click();
        await sleep(250);
        await shot(page, 's_correct_choice');
        await sleep(1200);
        break;
      }
      await L.press(page, 'Escape');
      await sleep(400);
    }
  });

  // ── 보급 상자 (부엉이 택배가 와 있으면) ──
  async function crateScene() {
    for (let k = 0; k < 100 && !(T.crates && T.crates.length); k++) await sleep(1000);
    if (!T.crates || !T.crates.length) throw new Error('no crates');
    const [mx, my] = await L.myPos(page);
    const cr = [...T.crates].sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my))[0];
    log('crate at', cr.x, cr.y, cr.room);
    const r = await W(cr.x, cr.y, 70, { timeout: 40000 });
    log('at crate?', r, JSON.stringify(await page.evaluate(() => window.__crates)));
    await sleep(900);
    await page.evaluate(() => window.__key('Space', true));
    await sleep(750);
    await shot(page, 's_crate');
    await sleep(1000);
    await page.evaluate(() => window.__key('Space', false));
    await sleep(800);
  }
  await scene('crate', crateScene);

  // ── 가방 · 킥보드 ──
  const CR = [1450, 1300]; // 여기서 서쪽으로 달리면 광장 서쪽 가로등에 부딪힌다
  await scene('kick', async () => {
    const it = await info();
    if (!it || it.item !== 'kickboard') {
      await page.evaluate(() => window.__ws.send(JSON.stringify({ t: 'testGive', item: 'kickboard' })));
      await sleep(400);
    }
    near(S, 1600, 1150, 260);
    await W(1900, 1300, 15, { timeout: 40000 });
    await sleep(1500);
    await L.press(page, 'KeyB');
    await sleep(700);
    await shot(page, 's_bag');
    await L.press(page, 'Space'); // 가방에서 쓰기
    await sleep(300);
    // 동쪽→서쪽으로 달리는 중
    await page.evaluate(() => window.__key('ArrowLeft', true));
    await sleep(500);
    await shot(page, 's_kick');
    await sleep(250);
    await page.evaluate(() => window.__key('ArrowLeft', false));
    await sleep(6500); // 킥보드 끝
  });

  await scene('kick-spin-seq', async () => {
    await page.evaluate(() => window.__ws.send(JSON.stringify({ t: 'testGive', item: 'kickboard' })));
    await W(CR[0] + 80, CR[1], 10);
    await sleep(400);
    await L.press(page, 'KeyB');
    await sleep(300);
    await L.press(page, 'Space');
    await sleep(300);
    await setView(1280, 720);
    await seq(page, 'kick_spin', 3.6, 12, async () => {
      await sleep(250);
      await page.evaluate(() => window.__key('ArrowLeft', true));
      await sleep(2600);
      await page.evaluate(() => window.__key('ArrowLeft', false));
    });
    await setView(1600, 900);
    await sleep(5000);
  });

  await scene('spin', async () => {
    await page.evaluate(() => window.__ws.send(JSON.stringify({ t: 'testGive', item: 'kickboard' })));
    await W(CR[0] + 80, CR[1], 10);
    await sleep(400);
    await L.press(page, 'KeyB');
    await sleep(300);
    await L.press(page, 'Space');
    await sleep(300);
    await page.evaluate(() => window.__key('ArrowLeft', true));
    const t0 = Date.now();
    await page.waitForFunction(() => window.__events.some((e) => e.kind === 'spin' && e.id === window.__id && performance.now() - e._at < 3000), null, { timeout: 5000 }).catch(() => {});
    log('spin after', Date.now() - t0);
    await sleep(350);
    await shot(page, 's_spin');
    await page.evaluate(() => window.__key('ArrowLeft', false));
    await sleep(6000);
  });

  // ── 잠귀신 ──
  const SP = [1600, 1250];
  await scene('chaser', async () => {
    S.forEach((b, i) => (b.anchor = [SP[0] - 220 + (i % 2) * 40, SP[1] - 60 + i * 25, 130]));
    C.anchor = null; // 잠귀신은 이 장면 동안 제자리 (배회하면 나에게 다가와 버린다)
    // 잠귀신은 먼저 동쪽 멀리
    await C.task(async (b) => b.goTo(SP[0] + 420, SP[1], 15));
    await W(SP[0], SP[1], 10);
    await sleep(1000);
    // 다가와서 멈춤 (아직 안 건다)
    await C.task(async (b) => {
      b.speed = 0.8;
      await b.goTo(SP[0] + 115, SP[1] - 10, 10);
      b.speed = 1;
    });
    await sleep(300);
    await shot(page, 's_chaser');
    await C.task(async (b) => b.goTo(SP[0] + 430, SP[1] + 10, 15));
    await sleep(800);
    // 연속 장면: 쫓아와 재우기 (나는 서쪽으로 도망가다 멈추고, 잠귀신이 따라와 건다)
    // 친구들은 북쪽(분수 옆)에서 지켜본다 — 잠귀신이 나보다 친구에게 가깝지 않게
    S.forEach((b, i) => (b.anchor = [SP[0] - 260 + i * 90, SP[1] - 230, 50]));
    await W(SP[0] + 60, SP[1] + 20, 10);
    await C.task(async (b) => b.goTo(SP[0] + 60 + 380, SP[1] + 30, 12));
    await sleep(1500);
    await sleep(500);
    await setView(1280, 720);
    await seq(page, 'tag', 4, 12, async () => {
      await sleep(100);
      const run = (async () => {
        await page.evaluate(() => window.__key('ArrowLeft', true));
        await sleep(1150);
        await page.evaluate(() => window.__key('ArrowLeft', false));
      })();
      await C.task(async (b) => {
        b.speed = 1.2;
        for (let k = 0; k < 40; k++) {
          const [mx, my] = await L.myPos(page);
          if (Math.hypot(mx - b.x, my - b.y) < 55) break;
          const p = L.nav(MAP).path(b.x, b.y, mx + 40, my, 10);
          if (!p || p.length < 3) break;
          const [nx, ny] = p[Math.min(2, p.length - 1)];
          b.f = nx < b.x ? -1 : 1;
          b.x = nx;
          b.y = ny;
          b.send({ t: 'pos', x: b.x, y: b.y, f: b.f, m: 1 });
          await sleep(63);
        }
        b.send({ t: 'pos', x: b.x, y: b.y, f: b.f, m: 0 });
        b.send({ t: 'tag' });
        b.speed = 1;
      });
      await run;
    });
    await setView(1600, 900);
    await sleep(900);
    await shot(page, 's_asleep');
    C.anchor = [SP[0] + 350, SP[1] - 150, 100];
    // 친구가 와서 깨워 준다
    const w = S[0];
    await w.task(async (b) => {
      await b.goTo(SP[0] - 40, SP[1] + 10, 12);
      b.send({ t: 'thawStart', id: myId });
      await sleep(1400);
      b.send({ t: 'thawEnd' });
    });
    await sleep(1500);
  });

  // 친구 깨우기: 잠귀신이 친구를 재우고, 내가 깨운다
  async function sleepFriend(F, at) {
    await F.task(async (b) => b.goTo(at[0], at[1], 10));
    F.anchor = null;
    await C.task(async (b) => {
      await b.goTo(at[0] + 60, at[1] - 20, 10);
      b.send({ t: 'tag' });
      await sleep(400);
      await b.goTo(at[0] + 380, at[1] - 120, 20);
    });
    await sleep(500);
    const fr = T.room.players.find((p) => p.id === F.id);
    if (!fr.frozen) throw new Error('friend not asleep');
  }
  await scene('wake', async () => {
    const F = S[1];
    const at = [SP[0] + 10, SP[1] - 20];
    S.forEach((b, i) => b !== F && (b.anchor = [SP[0] - 330, SP[1] - 40 + i * 20, 110]));
    await W(SP[0] - 230, SP[1] + 20, 10);
    await sleepFriend(F, at);
    await sleep(1200);
    // 연속 장면: 걸어가서 꾹 눌러 깨우기
    await setView(1280, 720);
    await seq(page, 'wake', 3.8, 12, async () => {
      await sleep(150);
      await W(at[0] - 55, at[1] + 5, 12);
      await page.evaluate(() => window.__key('Space', true));
      await sleep(1450);
      await page.evaluate(() => window.__key('Space', false));
    });
    await setView(1600, 900);
    await sleep(5500); // 깨어난 친구 보호 시간
    // 정지 화면: 깨우는 중 (게이지)
    await W(SP[0] - 230, SP[1] + 20, 10);
    await sleepFriend(F, at);
    await sleep(800);
    await W(at[0] - 55, at[1] + 5, 12);
    await sleep(500);
    await page.evaluate(() => window.__key('Space', true));
    await sleep(650);
    await shot(page, 's_wake');
    await sleep(800);
    await page.evaluate(() => window.__key('Space', false));
    F.anchor = [SP[0], SP[1], 250];
    await sleep(1000);
  });

  // ── 승리: 봇 학생들이 랜턴을 모두 켜고, 내가 마지막 랜턴을 켠다 ──
  await scene('win', async () => {
    const terms = L.nav(MAP).MAP.terminals;
    C.anchor = [2700, 1700, 200];
    const jobs = S.map((b, i) =>
      b.task(async (bb) => {
        let solved = T.room.players.find((p) => p.id === bb.id).solved || 0;
        const order = [...terms].sort(() => Math.random() - 0.5);
        for (const t of order) {
          if (solved >= 3) break;
          if (!(await bb.goTo(t.pos[0], t.pos[1], 60))) continue;
          const r = await L.botSolve(bb, t.id);
          if (r === 'ok') solved++;
        }
        bb.anchor = [SP[0] + ((i % 3) - 1) * 120, SP[1] + (i > 2 ? 80 : -80), 90];
        return solved;
      }),
    );
    const res = await Promise.all(jobs);
    log('bot solved', res.join(','), 'progress', JSON.stringify(T.room.progress));
    // 내 남은 랜턴: 광장에서 가까운 간식 거리 t7
    const t7 = terms.find((t) => t.id === 't7');
    // 혹시 꿈에 빠진 친구가 있으면 봇이 깨워 둔다
    for (const p of T.room.players.filter((p) => p.frozen)) {
      const w = S.find((b) => b.id !== p.id);
      await w.task(async (b) => {
        await b.goTo(p.x - 40, p.y, 10);
        b.send({ t: 'thawStart', id: p.id });
        await sleep(1400);
        b.send({ t: 'thawEnd' });
      });
    }
    const r7 = await W(t7.pos[0] - 32, t7.pos[1] - 8, 8, { timeout: 30000 });
    log('me at', r7, 'label', await page.textContent('#g-action-label'), 'hidden', await page.evaluate(() => document.getElementById('g-action').hidden), 'info', JSON.stringify(await info()).slice(0, 200));
    near(S, t7.pos[0] - 160, t7.pos[1] - 60, 150);
    await sleep(4000);
    let done = false;
    for (let k = 0; k < 6 && !done; k++) {
      const it = await info();
      if (it.solved >= 3) break;
      await page.evaluate(() => (window.__q = null));
      await L.press(page, 'Space');
      await page.waitForFunction(() => window.__q, null, { timeout: 4000 });
      await sleep(500);
      const q = await page.evaluate(() => window.__q);
      if (q.kind === 'choice') await page.locator('#m-choices button', { hasText: L.answerOf(q.text) }).first().click();
      else {
        await page.fill('#m-input', L.answerOf(q.text));
        await page.click('#m-submit');
      }
      done = true;
    }
    await page.waitForSelector('#g-ending:not([hidden])', { timeout: 8000 });
    await sleep(1300);
    await shot(page, 's_win');
    await page.waitForSelector('#g-over:not([hidden])', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    await shot(page, 's_win_over');
  });
} catch (e) {
  log('FATAL', e.stack || e.message);
  fails.push('fatal: ' + e.message);
  await shot(page, '_fatal').catch(() => {});
} finally {
  log('FAILS', JSON.stringify(fails));
  for (const b of bots) b.dead = true;
  await L.closeBrowser();
  await srv.stop();
  process.exit(0);
}
