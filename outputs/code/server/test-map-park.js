// 한밤의 놀이공원(night-park) 맵 자동 시험. 실행: node server/test-map-park.js
// 1) 맵 검사(validateMap)·보급 상자 가구·안개 후보·장치/구역/아이템 데이터 형식을 코드로 확인
// 2) 두 모드(잠귀신 술래잡기·꿈도둑을 찾아라)로 실제 판을 열어 봇이 길을 찾아 걸어가
//    랜턴 8개를 모두 켜 보고, 대왕 미끄럼틀·회전목마·담장 밑 개구멍을 탄다
// 3) 안개 후보 3곳마다 판을 열어 서버가 고른 중심·맵의 반지름(fog.radii)을 쓰는지 본다
// (줄 서기 solo·회전목마 규칙 자체의 시험은 server/test-park-rules.js 가 맡는다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME, LOOT, FOG, MAPS } from '../shared/config.js';
import { buildGrid, validateMap, lootFurniture, walkMap, canStand, roomAt } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, split, sleep, solve, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', 'night-park.json'), 'utf8'));
const G = buildGrid(MAP);
const T = makeChecker('한밤의 놀이공원 맵');
const { check } = T;
const NO_FOG = { stages: [{ at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] };
const NAMES = ['가', '나', '다', '라'];
const dev = (id) => MAP.devices.find((d) => d.id === id);

// ───── 길 찾기: 발 반지름 14px 로 설 수 있는 10px 점들 위에서 BFS ─────
const WALK = walkMap(MAP, G, GAME.radius);
const { step, W, H, ok } = WALK;
function nearestOk(x, y) {
  let best = -1;
  let bd = Infinity;
  const i0 = Math.round(x / step);
  const j0 = Math.round(y / step);
  for (let j = j0 - 3; j <= j0 + 3; j++) {
    for (let i = i0 - 3; i <= i0 + 3; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H || !ok[j * W + i]) continue;
      const d = Math.hypot(i * step - x, j * step - y);
      if (d < bd) (bd = d), (best = j * W + i);
    }
  }
  return best;
}
// (sx,sy) 에서 목표 (tx,ty) 의 within px 안 점까지 가는 길 [[x,y], ...]
function findPath(sx, sy, tx, ty, within) {
  const s = nearestOk(sx, sy);
  if (s < 0) return null;
  const prev = new Int32Array(W * H).fill(-2);
  prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const i = k % W;
    const j = (k - i) / W;
    if (Math.hypot(i * step - tx, j * step - ty) <= within) {
      const out = [];
      for (let n = k; n >= 0; n = prev[n]) out.push([(n % W) * step, Math.floor(n / W) * step]);
      return out.reverse();
    }
    for (const n of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, j > 0 ? k - W : -1, j < H - 1 ? k + W : -1]) {
      if (n >= 0 && ok[n] && prev[n] === -2) (prev[n] = k), q.push(n);
    }
  }
  return null;
}
// 길을 따라 20px씩 걸어간다. 서버가 되돌리면(fix) false
async function goTo(c, tx, ty, within) {
  const p = findPath(c.x, c.y, tx, ty, within);
  if (!p) return false;
  const f0 = c.fixes;
  for (let k = 1; k < p.length; k += 2) {
    const [x, y] = p[Math.min(k, p.length - 1)];
    c.x = x;
    c.y = y;
    c.send({ t: 'pos', x, y, f: 1, m: 1 });
    await sleep(70);
    if (c.fixes !== f0) return false;
  }
  const [x, y] = p[p.length - 1];
  if (c.x !== x || c.y !== y) {
    c.x = x;
    c.y = y;
    c.send({ t: 'pos', x, y, f: 1, m: 1 });
  }
  await sleep(120);
  return c.fixes === f0;
}
// 장치를 타고 ride 알림을 기다린다. 돌려주는 값: ride 알림(없으면 null). 다 탈 때까지 기다리고 봇 위치를 도착점으로 옮긴다
async function ride(teacher, c, d) {
  if (!(await goTo(c, d.from[0], d.from[1], 40))) return 'walk';
  c.send({ t: 'use', device: d.id });
  const m = await teacher.next((x) => x.t === 'event' && x.kind === 'ride' && x.id === c.id && x.device === d.id, 4000).catch(() => null);
  if (!m) return null;
  await sleep((d.duration || 1.5) * 1000 + 300);
  [c.x, c.y] = m.to;
  return m;
}

// ════ 1. 맵 데이터 검사 ════
function runStatic() {
  const problems = validateMap(MAP, G, GAME.radius);
  check('맵 검사(validateMap) 문제 없음 — 방·문·랜턴·장치·안개 후보·보급 가구 모두 걸어서 닿음', problems.length === 0, problems.join(' / '));
  check('맵 목록(MAPS)에 night-park 가 있다', MAPS.some((m) => m.id === 'night-park' && m.name === MAP.name));
  check('크기 3200×2200, 랜턴 8개, 방 10곳(광장 + 구역 9)', MAP.size.join() === '3200,2200' && MAP.terminals.length === 8 && MAP.rooms.length === 10);
  const ids = new Set(MAP.terminals.map((t) => t.id));
  check('랜턴 id 가 서로 다르고 모두 다른 구역에 있다', ids.size === 8 && new Set(MAP.terminals.map((t) => roomAt(MAP, ...t.pos).id)).size === 8);
  const loot = lootFurniture(MAP, G, LOOT.openReach, GAME.radius);
  const rooms = new Set(loot.map((l) => l.room));
  check(`보급 상자를 숨길 가구가 넉넉하다 (${loot.length}개, 방 ${rooms.size}곳)`, loot.length >= 40 && rooms.size >= 10, `${loot.length} / ${rooms.size}`);
  const lastR = MAP.fog.radii.at(-1);
  const fogOk = MAP.fog.centers.length === 3 && MAP.fog.centers.every((c) => canStand(G, c.pos[0], c.pos[1], GAME.radius) && c.bonus.length >= FOG.bonusCount && c.bonus.every((b) => Math.hypot(b[0] - c.pos[0], b[1] - c.pos[1]) <= lastR));
  check(`안개 후보 3곳: 중심에 설 수 있고 임시 랜턴은 마지막 반지름(${lastR}) 안`, fogOk);
  check('맵 전용 반지름 fog.radii = 1450·950·600 (점점 작아짐)', MAP.fog.radii.join() === '1450,950,600');
  check('로딩 TIP 3개 (줄 서기·킥보드·유령의 집)', MAP.tips.length === 3 && /줄/.test(MAP.tips[0]) && /킥보드/.test(MAP.tips[1]) && /유령의 집/.test(MAP.tips[2]));
  check('맵 아이템: items.extra = kickboard, extraWeight 3', MAP.items && MAP.items.extra.join() === 'kickboard' && MAP.items.extraWeight === 3);
  // 줄 서는 미끄럼틀 2개
  const solo = MAP.devices.filter((d) => d.type === 'slide' && d.solo);
  check(
    '줄 서는 미끄럼틀 2개 (solo, 3초, 학교 미끄럼틀과 같은 who)',
    solo.length === 2 && solo.every((d) => d.duration === 3 && d.who['sleep-tag'].join() === 'student' && d.who.mafia.join() === 'student,chaser' && !d.style),
  );
  const big = dev('slide-big');
  check('대왕 미끄럼틀: 탑 구역에서 타서 광장 건너 간식 거리에 내린다', roomAt(MAP, ...big.from).id === 'tower' && roomAt(MAP, ...big.to).id === 'candy' && Math.hypot(big.to[0] - big.from[0], big.to[1] - big.from[1]) > 1000);
  // 회전목마 2개
  const car = MAP.furniture.find((f) => f.kind === 'pkCarousel');
  const cx = car.rect[0] + car.rect[2] / 2;
  const cy = car.rect[1] + car.rect[3] / 2;
  const carousels = MAP.devices.filter((d) => d.style === 'carousel');
  const round = (d) => d.path.length >= 8 && d.path.every((p) => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - 200) <= 2);
  check(
    '회전목마 2개: 동쪽 입구→서쪽 출구, 서쪽 입구→동쪽 출구, 가구 가운데를 도는 원 둘레 path',
    carousels.length === 2 &&
      carousels.every((d) => d.type === 'slide' && !d.solo && round(d) && d.duration === 3 && Math.sign(d.from[0] - cx) === -Math.sign(d.to[0] - cx)) &&
      carousels.some((d) => d.from[0] > cx) && carousels.some((d) => d.from[0] < cx),
  );
  check(
    '회전목마 규칙: 두 모드 모두 학생·술래, 6초 그룹 쿨다운, 내린 뒤 1초 보호',
    carousels.every((d) => ['sleep-tag', 'mafia'].every((m) => d.who[m].join() === 'student,chaser') && d.cooldown.scope === 'player' && d.cooldown.seconds === 6 && d.cooldown.group === 'carousel' && d.protectAfter === 1),
  );
  const hole = MAP.devices.find((d) => d.type === 'teleport');
  check('개구멍 1개 (출구 3곳, 출구는 서로 다른 구역)', hole && hole.exits.length === 3 && new Set(hole.exits.map((e) => roomAt(MAP, ...e).id)).size === 3);
  // 구역
  const dark = MAP.zones.find((z) => z.type === 'dark');
  const ghost = MAP.rooms.find((r) => r.id === 'ghost');
  check(
    '유령의 집 안 전체가 어두운 구역(amount 0.55), 유령의 집 문은 2개',
    dark && dark.id === 'ghost-dark' && dark.amount === 0.55 && dark.rect[0] <= ghost.rect[0] + 20 && dark.rect[1] <= ghost.rect[1] + 20 && dark.rect[0] + dark.rect[2] >= ghost.rect[0] + ghost.rect[2] - 20 && dark.rect[1] + dark.rect[3] >= ghost.rect[1] + ghost.rect[3] - 20 &&
      MAP.doors.filter((d) => d.id.startsWith('d-ghost')).length === 2,
  );
  const slow = MAP.zones.find((z) => z.type === 'slow');
  check('솜사탕 바닥: 간식 거리 안의 느린 구역(0.6)', slow && slow.name === '솜사탕 바닥' && slow.amount === 0.6 && roomAt(MAP, slow.rect[0] + slow.rect[2] / 2, slow.rect[1] + slow.rect[3] / 2).id === 'candy');
}

// ════ 2. 실제 판: 걷기·랜턴 8개·대왕 미끄럼틀·회전목마·개구멍 ════
async function runGame(mode, port) {
  const srv = await startServer(port, { fog: NO_FOG });
  try {
    check(`[${mode}] 서버가 맵 문제를 알리지 않는다`, !srv.log().includes('night-park 에 문제'), srv.log());
    const { teacher, P } = await setup(srv.port, NAMES, { map: 'night-park', mode, minutes: 10, missions: 8 });
    const v = await startGame(teacher, P);
    check(`[${mode}] 한밤의 놀이공원으로 판이 시작된다`, v.settings.map === 'night-park');
    const [sx, sy] = MAP.spawn.pos;
    check(`[${mode}] 모두 중앙 광장(시작 자리 둘레)에서 시작`, P.every((c) => Math.hypot(c.x - sx, c.y - sy) <= MAP.spawn.radius + 2), JSON.stringify(P.map((c) => [c.x, c.y])));
    const { S } = split(v, P);
    const rider = S[0];
    // 랜턴을 네 명에게 나눠 준다 (가까운 것끼리)
    const plan = { 0: ['t2', 't3'], 1: ['t4', 't6'], 2: ['t1'], 3: ['t5', 't8', 't7'] };
    const T_ = Object.fromEntries(MAP.terminals.map((t) => [t.id, t]));
    const opened = {};
    const fails = [];
    const rides = {};
    await Promise.all(
      P.map(async (c, i) => {
        for (const id of plan[i]) {
          const t = T_[id];
          const walked = await goTo(c, t.pos[0], t.pos[1], 50);
          if (!walked) {
            fails.push(`${c.name}: ${id} 까지 못 걸어감 (${c.x},${c.y})`);
            continue;
          }
          const r = await solve(c, id);
          opened[id] = r;
          if (r !== 'ok') fails.push(`${c.name}: ${id} → ${r}`);
        }
        if (c !== rider) return;
        // 대왕 미끄럼틀 (탑 → 간식 거리)
        const big = dev('slide-big');
        const r1 = await ride(teacher, c, big);
        rides.big = r1 && r1 !== 'walk' ? r1.to.join() === big.to.join() : String(r1);
        // 회전목마 (동쪽 타는 곳 → 서쪽에 내림)
        const ce = dev('carousel-east');
        const r2 = await ride(teacher, c, ce);
        rides.carousel = r2 && r2 !== 'walk' ? r2.to.join() === ce.to.join() : String(r2);
        // 내린 곳에서 걸어 나갈 수 있다
        if (rides.carousel === true && !(await goTo(c, ce.to[0], ce.to[1] + 60, 30))) rides.carousel = 'stuck at carousel exit';
        // 개구멍
        const hole = dev('hole-1');
        const r3 = await ride(teacher, c, hole);
        rides.hole = r3 && r3 !== 'walk' ? hole.exits.some((e) => e.join() === r3.to.join()) : String(r3);
        if (rides.hole === true && !(await goTo(c, r3.to[0], r3.to[1] + 60, 30))) rides.hole = 'stuck at exit ' + r3.to;
      }),
    );
    const all = MAP.terminals.every((t) => opened[t.id] === 'ok');
    check(`[${mode}] 봇이 길을 찾아 걸어가 랜턴 8개를 모두 켠다`, all && !fails.length, fails.join(' / ') + ' ' + JSON.stringify(opened));
    check(`[${mode}] 대왕 미끄럼틀을 타면 광장 건너 간식 거리에 내린다`, rides.big === true, String(rides.big));
    check(`[${mode}] 회전목마(동쪽)를 타면 서쪽에 내리고 걸어 나갈 수 있다`, rides.carousel === true, String(rides.carousel));
    check(`[${mode}] 담장 밑 개구멍을 타면 출구 3곳 중 하나로 나오고 걸어 나갈 수 있다`, rides.hole === true, String(rides.hole));
    const st = teacher.room;
    check(`[${mode}] 서버 기록: 켠 랜턴 수가 진행도에 들어간다`, st && st.progress && st.progress.solved >= 1, JSON.stringify(st && st.progress));
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

// ════ 3. 안개 후보마다: 서버가 맵의 radii 를 쓴다 ════
async function runFog(ci, port) {
  const srv = await startServer(port, {
    minuteMs: 6000,
    fogCenter: ci,
    fog: { stages: [{ at: 0.02, shrinkMs: 300 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] },
  });
  try {
    const { teacher, P } = await setup(srv.port, NAMES, { map: 'night-park', minutes: 5 });
    await startGame(teacher, P);
    const c = MAP.fog.centers[ci].pos;
    const m = await teacher.next((x) => x.t === 'room' && x.fog && x.fog.stage >= 1, 6000).catch(() => null);
    check(`안개 후보 ${ci + 1} (${c}): 중심이 맞고 첫 빛 구역이 맵 값 ${MAP.fog.radii[0]} 으로 줄어든다`, m && m.fog.cx === c[0] && m.fog.cy === c[1] && m.fog.toR === MAP.fog.radii[0], JSON.stringify(m && m.fog));
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

runStatic();
runAll(T, [() => runGame('sleep-tag', 3290), () => runGame('mafia', 3291), () => runFog(0, 3292), () => runFog(1, 3293), () => runFog(2, 3294)], 240000);
