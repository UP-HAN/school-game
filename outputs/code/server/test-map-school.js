// 한밤의 학교(night-school) 맵 자동 시험. 실행: node server/test-map-school.js
// 1) 맵 검사(validateMap)·보급 상자 가구·안개 후보를 코드로 확인
// 2) 두 모드(잠귀신 술래잡기·꿈도둑을 찾아라)로 실제 판을 열어 봇이 길을 찾아 걸어가
//    랜턴 10개를 모두 켜 보고, 놀이터 미끄럼틀·담장 밑 개구멍을 탄다
// 3) 안개 후보 3곳마다 판을 열어 서버가 고른 중심·맵의 반지름(fog.radii)을 쓰는지 본다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME, LOOT, FOG } from '../shared/config.js';
import { buildGrid, validateMap, lootFurniture, walkMap, canStand } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, split, sleep, solve, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', 'night-school.json'), 'utf8'));
const G = buildGrid(MAP);
const T = makeChecker('한밤의 학교 맵');
const { check } = T;
const NO_FOG = { stages: [{ at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] };
const NAMES = ['가', '나', '다', '라'];

// ───── 길 찾기: 발 반지름 14px 로 설 수 있는 10px 점들 위에서 BFS ─────
const WALK = walkMap(MAP, G, GAME.radius);
const { step, W, H, ok } = WALK;
const idx = (x, y) => Math.round(y / step) * W + Math.round(x / step);
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

// ════ 1. 맵 데이터 검사 ════
function runStatic() {
  const problems = validateMap(MAP, G, GAME.radius);
  check('맵 검사(validateMap) 문제 없음 — 방·문·랜턴·장치·안개 후보·보급 가구 모두 걸어서 닿음', problems.length === 0, problems.join(' / '));
  check('크기 3600×2400, 랜턴 10개 (선생님 설정 최대 8개보다 많다)', MAP.size.join() === '3600,2400' && MAP.terminals.length === 10 && MAP.terminals.length >= 8);
  const ids = new Set(MAP.terminals.map((t) => t.id));
  check('랜턴 id 가 서로 다르다', ids.size === MAP.terminals.length);
  const loot = lootFurniture(MAP, G, LOOT.openReach, GAME.radius);
  const rooms = new Set(loot.map((l) => l.room));
  check(`보급 상자를 숨길 가구가 넉넉하다 (${loot.length}개, 방 ${rooms.size}곳)`, loot.length >= 40 && rooms.size >= 10, `${loot.length} / ${rooms.size}`);
  const lastR = MAP.fog.radii.at(-1);
  const fogOk = MAP.fog.centers.length === 3 && MAP.fog.centers.every((c) => canStand(G, c.pos[0], c.pos[1], GAME.radius) && c.bonus.length >= FOG.bonusCount && c.bonus.every((b) => Math.hypot(b[0] - c.pos[0], b[1] - c.pos[1]) <= lastR));
  check(`안개 후보 3곳: 중심에 설 수 있고 임시 랜턴은 마지막 반지름(${lastR}) 안`, fogOk);
  check('맵 전용 반지름 fog.radii = 1600·1050·650 (점점 작아짐)', MAP.fog.radii.join() === '1600,1050,650');
  check('로딩 TIP 2~3개', Array.isArray(MAP.tips) && MAP.tips.length >= 2 && MAP.tips.length <= 3);
  const slide = MAP.devices.find((d) => d.type === 'slide');
  const hole = MAP.devices.find((d) => d.type === 'teleport');
  check('장치: 미끄럼틀 1·개구멍 1(출구 3곳), 두 모드 who 규칙', slide && hole && hole.exits.length === 3 && ['sleep-tag', 'mafia'].every((m) => slide.who[m] && hole.who[m]));
}

// ════ 2. 실제 판: 걷기·랜턴 10개·미끄럼틀·개구멍 ════
async function runGame(mode, port) {
  const srv = await startServer(port, { fog: NO_FOG });
  try {
    check(`[${mode}] 서버가 맵 문제를 알리지 않는다`, !srv.log().includes('night-school 에 문제'), srv.log());
    const { teacher, P } = await setup(srv.port, NAMES, { map: 'night-school', mode, minutes: 10, missions: 8 });
    const v = await startGame(teacher, P);
    check(`[${mode}] 한밤의 학교로 판이 시작된다`, v.settings.map === 'night-school');
    const [sx, sy] = MAP.spawn.pos;
    check(`[${mode}] 모두 운동장 가운데(시작 자리 둘레)에서 시작`, P.every((c) => Math.hypot(c.x - sx, c.y - sy) <= MAP.spawn.radius + 2), JSON.stringify(P.map((c) => [c.x, c.y])));
    const { S } = split(v, P);
    const rider = S[0];
    // 랜턴을 네 명에게 나눠 준다 (가까운 것끼리)
    const plan = { 0: ['t10', 't9'], 1: ['t8', 't5', 't1'], 2: ['t2', 't3', 't6'], 3: ['t4', 't7'] };
    const T_ = Object.fromEntries(MAP.terminals.map((t) => [t.id, t]));
    const opened = {};
    const fails = [];
    let slideOk = null;
    let holeOk = null;
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
        // 미끄럼틀
        const slide = MAP.devices.find((d) => d.id === 'slide-1');
        if (!(await goTo(c, slide.from[0], slide.from[1], 40))) return void (slideOk = 'walk');
        c.send({ t: 'use', device: slide.id });
        const ride = await teacher.next((m) => m.t === 'event' && m.kind === 'ride' && m.id === c.id && m.device === slide.id, 3000).catch(() => null);
        slideOk = !!ride && ride.to.join() === slide.to.join();
        await sleep(1700);
        [c.x, c.y] = slide.to;
        // 개구멍
        const hole = MAP.devices.find((d) => d.id === 'hole-1');
        if (!(await goTo(c, hole.from[0], hole.from[1], 40))) return void (holeOk = 'walk');
        c.send({ t: 'use', device: hole.id });
        const ride2 = await teacher.next((m) => m.t === 'event' && m.kind === 'ride' && m.id === c.id && m.device === hole.id, 3000).catch(() => null);
        holeOk = !!ride2 && hole.exits.some((e) => e.join() === ride2.to.join());
        if (ride2) {
          await sleep(1700);
          [c.x, c.y] = ride2.to;
          // 출구에서 조금 걸어 본다 (출구가 막힌 곳이 아님)
          const moved = await goTo(c, ride2.to[0], ride2.to[1] + 60, 30);
          if (!moved) holeOk = 'stuck at exit ' + ride2.to;
        }
      }),
    );
    const all = MAP.terminals.every((t) => opened[t.id] === 'ok');
    check(`[${mode}] 봇이 길을 찾아 걸어가 랜턴 10개를 모두 켠다`, all && !fails.length, fails.join(' / ') + ' ' + JSON.stringify(opened));
    check(`[${mode}] 놀이터 미끄럼틀을 타면 현관 앞에 내린다`, slideOk === true, String(slideOk));
    check(`[${mode}] 담장 밑 개구멍을 타면 출구 3곳 중 하나로 나오고 걸어 나갈 수 있다`, holeOk === true, String(holeOk));
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
    const { teacher, P } = await setup(srv.port, NAMES, { map: 'night-school', minutes: 5 });
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
runAll(T, [() => runGame('sleep-tag', 3270), () => runGame('mafia', 3271), () => runFog(0, 3272), () => runFog(1, 3273), () => runFog(2, 3274)], 240000);
