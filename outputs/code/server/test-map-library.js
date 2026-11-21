// 달빛 대도서관(moon-library) 맵 자동 시험. 실행: node server/test-map-library.js
// 1) 맵 검사(validateMap·inspectMap·inspectDeviceMarks)와 보급 상자 가구 수
// 2) 실제 서버에 봇을 붙여 두 모드(잠귀신 술래잡기·꿈도둑을 찾아라)로 한 판씩:
//    걸어서 랜턴 켜기, 비밀 통로(개구멍) 타기, 책 반납 미끄럼틀 타기, 보급 상자 떨어짐, 안개 중심 확인
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME, LOOT } from '../shared/config.js';
import { buildGrid, validateMap, inspectMap, inspectDeviceMarks, lootFurniture, canStand, spawnPoint } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, split, sleep, openQuiz, answer, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAP_ID = 'moon-library';
const MAP = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', MAP_ID + '.json'), 'utf8'));
const G = buildGrid(MAP);
const ROOM_IDS = new Set(MAP.rooms.map((r) => r.id));
const T = makeChecker('달빛 대도서관');
const { check } = T;
const PORT = 3261;
const NO_FOG = { stages: [{ at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] };

// ── 길 찾기: 20px 격자 위에서 발 반지름 14(서버 검사 10보다 넉넉)로 설 수 있는 점만 잇는다 ──
const STEP = 20;
const CW = Math.floor(MAP.size[0] / STEP) + 1;
const CH = Math.floor(MAP.size[1] / STEP) + 1;
const OK = new Uint8Array(CW * CH);
for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) OK[j * CW + i] = canStand(G, i * STEP, j * STEP, GAME.radius) ? 1 : 0;
function findPath(from, to) {
  const near = (p) => {
    let best = -1;
    let bd = Infinity;
    for (let j = Math.floor(p[1] / STEP) - 2; j <= Math.ceil(p[1] / STEP) + 2; j++) {
      for (let i = Math.floor(p[0] / STEP) - 2; i <= Math.ceil(p[0] / STEP) + 2; i++) {
        if (i < 0 || j < 0 || i >= CW || j >= CH || !OK[j * CW + i]) continue;
        const d = Math.hypot(i * STEP - p[0], j * STEP - p[1]);
        if (d < bd) (bd = d), (best = j * CW + i);
      }
    }
    return best;
  };
  const s = near(from);
  const e = near(to);
  if (s < 0 || e < 0) return null;
  const prev = new Int32Array(CW * CH).fill(-2);
  prev[s] = -1;
  const q = [s];
  for (let h = 0; h < q.length && prev[e] === -2; h++) {
    const k = q[h];
    const i = k % CW;
    for (const n of [k - 1, k + 1, k - CW, k + CW]) {
      if (n < 0 || n >= CW * CH || prev[n] !== -2 || !OK[n]) continue;
      if ((n === k - 1 && i === 0) || (n === k + 1 && i === CW - 1)) continue;
      prev[n] = k;
      q.push(n);
    }
  }
  if (prev[e] === -2) return null;
  const pts = [];
  for (let k = e; k !== -1; k = prev[k]) pts.push([(k % CW) * STEP, Math.floor(k / CW) * STEP]);
  return pts.reverse();
}
// 봇을 (x, y) 까지 걷게 한다 (가까운 격자점에서 출발 → 격자 길 → 목표점)
async function goTo(c, target) {
  const pts = findPath([c.x, c.y], target);
  if (!pts) return false;
  const f0 = c.fixes;
  const clamp = (d) => Math.max(-20, Math.min(20, d));
  for (const [tx, ty] of pts) {
    while (c.x !== tx || c.y !== ty) {
      c.x += clamp(tx - c.x);
      c.y += clamp(ty - c.y);
      c.send({ t: 'pos', x: c.x, y: c.y, f: 1, m: 1 });
      await sleep(45); // testkit walk(70ms)보다 빠르게. 서버 허용 거리(속도×1.25×시간 + 24px) 안이다
      if (c.fixes !== f0) return false;
    }
  }
  await sleep(120);
  return c.fixes === f0;
}

// ════ 1. 맵 검사 ════
function mapChecks() {
  const probs = validateMap(MAP, G, GAME.radius);
  check('맵 검사(validateMap): 문제 없음', probs.length === 0, probs.join(' / '));
  const gaps = inspectMap(MAP, G, GAME.radius);
  check('끼는 틈·보이지 않는 벽(inspectMap): 없음', gaps.length === 0, gaps.map((p) => p.text).join(' / '));
  const marks = inspectDeviceMarks(MAP, G);
  check('장치 팻말·글씨(inspectDeviceMarks): 겹침 없음', marks.length === 0, marks.join(' / '));
  check('방 8개 이상·랜턴 8개·장치 2개(미끄럼틀·비밀 통로)', MAP.rooms.length >= 8 && MAP.terminals.length === 8 && MAP.devices.some((d) => d.type === 'slide') && MAP.devices.some((d) => d.type === 'teleport' && d.exits.length === 3));
  check('랜턴의 room 이 실제 방 id 이고 좌표가 그 방 안', MAP.terminals.every((t) => {
    const r = MAP.rooms.find((x) => x.id === t.room);
    return r && t.pos[0] > r.rect[0] && t.pos[0] < r.rect[0] + r.rect[2] && t.pos[1] > r.rect[1] && t.pos[1] < r.rect[1] + r.rect[3];
  }));
  const loot = lootFurniture(MAP, G, LOOT.openReach, GAME.radius);
  const lootRooms = new Set(loot.map((f) => f.room));
  check(`보급 상자 가구 ${loot.length}개, ${lootRooms.size}개 방에 있다`, loot.length >= 20 && lootRooms.size === MAP.rooms.length, `${loot.length}개 / ${[...lootRooms]}`);
  const ring = Array.from({ length: 12 }, (_, i) => spawnPoint(MAP, i, 12));
  check('시작 자리 12곳 모두 설 수 있다', ring.every(([x, y]) => canStand(G, x, y, GAME.radius)), JSON.stringify(ring));
  check('안개 후보 3곳, 각 임시 랜턴 2자리', MAP.fog.centers.length === 3 && MAP.fog.centers.every((c) => c.bonus.length === 2));
  // test-fog.js 는 마지막 반지름을 320 으로 줄여서 서버를 켠다 → 그때도 맵 검사가 통과하도록 임시 랜턴은 중심에서 320 안
  check('임시 랜턴 자리는 중심에서 320px 안 (시험용 짧은 반지름에서도 통과)', MAP.fog.centers.every((c) => c.bonus.every((b) => Math.hypot(b[0] - c.pos[0], b[1] - c.pos[1]) <= 320)));
  const coords = [
    ...MAP.rooms.map((r) => r.rect), ...MAP.corridors.map((r) => r.rect), ...MAP.doors.map((r) => r.rect), ...MAP.furniture.map((f) => f.rect),
  ].flat();
  check('방·복도·문·가구 좌표가 모두 20의 배수', coords.every((v) => v % 20 === 0));
  check('로딩 TIP 2~3개', Array.isArray(MAP.tips) && MAP.tips.length >= 2 && MAP.tips.length <= 3);
  for (const t of MAP.terminals) {
    if (!findPath(MAP.spawn.pos, t.pos)) check(`랜턴 ${t.id} 까지 길이 있다`, false);
  }
}

// ════ 2. 실제 판 ════
async function playMode(srv, mode) {
  const label = mode === 'mafia' ? '[꿈도둑]' : '[술래잡기]';
  const { teacher, P } = await setup(srv.port, ['가', '나', '다', '라', '마'], { map: MAP_ID, mode, minutes: 5, fogLoot: true });
  check(`${label} 선생님 설정에서 맵이 moon-library`, teacher.room.settings.map === MAP_ID);
  const v = await startGame(teacher, P);
  const { C, S } = split(v, P);
  check(`${label} 시작: 모두 설 수 있는 자리에서 시작`, v.players.every((p) => canStand(G, p.x, p.y, GAME.radius)), JSON.stringify(v.players.map((p) => [p.x, p.y])));
  const fog = teacher.room.fog;
  check(`${label} 안개 중심이 맵의 후보 3곳 중 하나`, !!fog && MAP.fog.centers.some((c) => c.pos[0] === fog.cx && c.pos[1] === fog.cy), JSON.stringify(fog));

  const s = S[0];
  // 랜턴 켜기: 열람홀 t8 까지 걸어가서 정답
  const t8 = MAP.terminals.find((t) => t.id === 't8');
  const walked = await goTo(s, [t8.pos[0] + 40, t8.pos[1] + 20]);
  check(`${label} 학생이 열람홀 랜턴 t8 까지 걸어간다 (서버가 막지 않음)`, walked, `${s.x},${s.y}`);
  const q = await openQuiz(s, 't8');
  check(`${label} 랜턴 t8 퀴즈가 열린다`, q.t === 'question', JSON.stringify(q));
  if (q.t === 'question') {
    const r = await answer(s, q, true);
    check(`${label} 정답이면 랜턴이 켜진다`, r.ok === true, JSON.stringify(r));
  }

  // 비밀 통로 (사서실)
  const hole = MAP.devices.find((d) => d.type === 'teleport');
  const okHole = await goTo(s, [hole.from[0] - 40, hole.from[1] + 30]);
  check(`${label} 학생이 사서실 비밀 통로 입구까지 걸어간다`, okHole, `${s.x},${s.y}`);
  teacher.clear();
  s.send({ t: 'use', device: hole.id });
  const ride1 = await teacher.next((m) => m.t === 'event' && m.kind === 'ride' && m.device === hole.id, 3000);
  check(`${label} 비밀 통로를 타면 출구 3곳 중 한 곳으로 나온다`, ride1.id === s.id && hole.exits.some((e) => e.join() === ride1.to.join()), JSON.stringify(ride1.to));
  await sleep(ride1.ms + 250);
  [s.x, s.y] = ride1.to;

  // 책 반납 미끄럼틀 (북카페 → 고서 보관실 앞)
  const slide = MAP.devices.find((d) => d.type === 'slide');
  const okSlide = await goTo(s, [slide.from[0] - 40, slide.from[1] + 20]);
  check(`${label} 출구에서 북카페 미끄럼틀 타는 곳까지 걸어간다`, okSlide, `${s.x},${s.y}`);
  s.send({ t: 'use', device: slide.id });
  const ride2 = await teacher.next((m) => m.t === 'event' && m.kind === 'ride' && m.device === slide.id, 3000).catch(() => {
    const row = teacher.state && JSON.stringify(teacher.state).slice(0, 600);
    throw new Error('미끄럼틀 안 탐: ' + JSON.stringify({ err: s.inbox.filter((m) => m.t === 'error'), bot: [s.x, s.y], id: s.id, fixes: s.fixes, row, ride1 }));
  });
  check(`${label} 미끄럼틀을 타면 고서 보관실 앞 도착점으로`, ride2.id === s.id && ride2.to.join() === slide.to.join(), JSON.stringify(ride2.to));
  await sleep(ride2.ms + 250);
  [s.x, s.y] = ride2.to;
  const archiveDoor = MAP.doors.find((d) => d.id === 'd-archive');
  const okArchive = await goTo(s, [archiveDoor.rect[0] + 80, archiveDoor.rect[1] + 40]);
  check(`${label} 도착점에서 고서 보관실 안으로 걸어 들어간다`, okArchive, `${s.x},${s.y}`);

  // 잠귀신 술래잡기: 잠귀신은 장치를 못 탄다 / 꿈도둑 모드: 꿈도둑도 탄다(멀면 too_far)
  if (C[0]) {
    C[0].clear();
    C[0].send({ t: 'use', device: hole.id });
    const code = await C[0].error();
    check(`${label} 술래 역할의 비밀 통로: ${mode === 'mafia' ? '탈 수 있다(멀어서 too_far)' : '탈 수 없다(not_allowed)'}`, code === (mode === 'mafia' ? 'too_far' : 'not_allowed'), code);
  }

  // 보급 상자: 도서관 방 안 가구에 떨어진다
  // (teacher.crates = 선생님이 마지막으로 받은 상자 목록. 떨어지는 때는 판의 5%)
  for (let i = 0; i < 80 && !(teacher.crates && teacher.crates.length); i++) await sleep(100);
  const crates = teacher.crates && teacher.crates.length ? { crates: teacher.crates } : null;
  check(`${label} 보급 상자가 도서관 방 안 가구에 떨어진다`, !!crates && crates.crates.every((k) => ROOM_IDS.has(k.room) && MAP.furniture.some((f) => f.rect.join() === k.rect.join())), JSON.stringify(crates && crates.crates));

  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

async function runGames() {
  const srv = await startServer(PORT, { minuteMs: 24000, fog: NO_FOG, loot: { dropsAt: [0.05] }, chase: { graceMs: 60000 }, mafia: { freezeGraceMs: 60000, buttonGraceMs: 60000, sabotageGraceMs: 60000 } });
  try {
    check('서버가 moon-library 맵 문제를 알리지 않는다', !srv.log().includes(`맵 ${MAP_ID} 에 문제가 있어요`), srv.log());
    await playMode(srv, 'sleep-tag');
    await playMode(srv, 'mafia');
  } finally {
    await srv.stop();
  }
}

mapChecks();
runAll(T, [runGames], 170000);
