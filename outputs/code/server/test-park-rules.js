// 놀이공원 규칙 4가지 자동 시험 (06 명세 12-7절). 실행: node server/test-park-rules.js (npm test 에 포함)
// ① 줄 서는 장치(solo) ② 킥보드 아이템·맵 전용 상자 목록(items.extra) ③ 회전목마(slide + style carousel) ④ 어두운 구역(zones type dark)
// 놀이공원 맵(night-park)이 없어도 돌도록, 몬스터 체육관에 시험용 장치·구역을 덧붙여(TEST_OVERRIDES.mapPatch) 시험한다.
// maps/night-park.json 이 있으면 그 맵 자료가 약속한 형식인지도 본다 (없으면 건너뜀). 포트 3295~3296 만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, ITEM_POOLS, GAME, LOOT, lootPool } from '../shared/config.js';
import { buildGrid, validateMap, walkMap, zoneAt, darkVisionAt, distToRect } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, route, sleep, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = makeChecker('놀이공원 규칙');
const { check } = T;
const GYM = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', 'monster-gym.json'), 'utf8'));
const PARK_FILE = path.join(here, '..', 'maps', 'night-park.json');
const NO_FOG = { stages: [{ at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] };

// ── 시험용으로 체육관에 덧붙이는 것 (큰 체육관 900~1900 × 520~1320 안) ──
const SOLO_FROM = [1400, 1150];
const SOLO = {
  id: 'solo-test', type: 'slide', name: '시험 줄 미끄럼틀', from: SOLO_FROM, to: [1700, 1050], path: [[1550, 1150]],
  duration: 1.5, solo: true, soloGap: 0.5, when: 'press',
  who: { 'sleep-tag': ['student', 'chaser'], mafia: ['student', 'chaser'] }, cooldown: { scope: 'player', seconds: 0 },
  marks: { sign: [0, -60], toLabel: [0, -56] },
};
// 회전목마: 가운데 (1700, 800) 반지름 100. 왼쪽에서 타서 한 바퀴 반 돌고 오른쪽에서 내린다
const C0 = [1700, 800];
const ring = Array.from({ length: 8 }, (_, i) => {
  const a = ((240 + i * 60) * Math.PI) / 180;
  return [Math.round(C0[0] + Math.cos(a) * 100), Math.round(C0[1] + Math.sin(a) * 100)];
});
const CAROUSEL = {
  id: 'carousel-test', type: 'slide', style: 'carousel', name: '시험 회전목마', from: [1600, 800], to: [1800, 800], path: ring,
  duration: 3, when: 'press', who: { 'sleep-tag': ['student', 'chaser'], mafia: ['student', 'chaser'] }, cooldown: { scope: 'player', seconds: 5 },
  marks: { sign: [-150, 40] },
};
const DARK = { id: 'ghost-test', type: 'dark', name: '유령의 집', rect: [1100, 940, 240, 140], amount: 0.55 };
const PATCH = {
  'monster-gym': {
    devices: [...GYM.devices, SOLO, CAROUSEL],
    zones: [...GYM.zones, DARK],
    items: { extra: ['kickboard'], extraWeight: 3 },
  },
};
const patched = () => ({ ...JSON.parse(JSON.stringify(GYM)), ...JSON.parse(JSON.stringify(PATCH['monster-gym'])) });

// ── 1. 자료·계산 (서버 없이) ──
function pureChecks() {
  check('킥보드: 8초 · 1.6배, 기본 상자 목록(ITEM_POOLS)에는 없다', ITEMS.kickboard && ITEMS.kickboard.ms === 8000 && ITEMS.kickboard.speed === 1.6 && Object.values(ITEM_POOLS).every((m) => Object.values(m).every((l) => !l.includes('kickboard'))));
  const items = { extra: ['kickboard'], extraWeight: 3 };
  const n = (l) => l.filter((k) => k === 'kickboard').length;
  check('맵 items.extra: 잠귀신 술래잡기 학생 목록에 킥보드가 3번 더 들어간다', n(lootPool('sleep-tag', 'student', items)) === 3 && lootPool('sleep-tag', 'student', items).length === ITEM_POOLS['sleep-tag'].student.length + 3);
  check('맵 items.extra: 잠귀신은 받지 않는다', n(lootPool('sleep-tag', 'chaser', items)) === 0 && lootPool('sleep-tag', 'chaser', items).join() === ITEM_POOLS['sleep-tag'].chaser.join());
  check('맵 items.extra: 꿈도둑을 찾아라는 학생·꿈도둑 모두 같은 목록', n(lootPool('mafia', 'student', items)) === 3 && lootPool('mafia', 'chaser', items).join() === lootPool('mafia', 'student', items).join());
  check('items 가 없는 맵은 예전 목록 그대로 (모르는 아이템 이름은 무시)', lootPool('sleep-tag', 'student', undefined).join() === ITEM_POOLS['sleep-tag'].student.join() && lootPool('mafia', 'student', { extra: ['nothing'] }).join() === ITEM_POOLS.mafia.student.join() && n(lootPool('mafia', 'chaser', { extra: ['kickboard'] })) === 1);

  const M = patched();
  // 느린 바닥과 어두운 구역이 겹쳐도 각각 찾는다
  const both = { zones: [DARK, { id: 's', type: 'slow', rect: [1100, 940, 100, 100], amount: 0.6 }] };
  check('zoneAt(type): 겹친 구역에서 slow·dark 를 따로 찾는다 (type 없이 부르면 예전처럼 첫 구역)', zoneAt(both, 1150, 990, 'slow').id === 's' && zoneAt(both, 1150, 990, 'dark').id === 'ghost-test' && zoneAt(both, 1150, 990).id === 'ghost-test' && zoneAt(M, 2200, 700, 'slow').id === 'mat-zone' && zoneAt(M, 2200, 700, 'dark') === null);
  check('darkVisionAt: 유령의 집 안 0.55배, 밖 1배', darkVisionAt(M, 1220, 1000) === 0.55 && darkVisionAt(M, 1600, 780) === 1 && darkVisionAt(GYM, 1220, 1000) === 1);

  // 회전목마·줄 서는 장치가 맵 검사를 통과한다 (덧붙이기 전과 문제 수가 같다)
  const G = buildGrid(M);
  const before = validateMap(GYM, buildGrid(GYM), GAME.radius);
  const after = validateMap(M, G, GAME.radius);
  const mine = after.filter((p) => p.includes('carousel-test') || p.includes('solo-test') || p.includes('ghost-test'));
  check('맵 검사: 회전목마(둥근 path 8점)·줄 미끄럼틀·유령의 집을 받아들인다', mine.length === 0 && after.length === before.length, mine.concat(after.filter((p) => !before.includes(p))).join(' / '));
  const w = walkMap(M, G, GAME.radius);
  check('walkMap: 회전목마 내리는 곳에 걸어서 갈 수 있다', w.near(1800, 800, 10));
}

// ── 2. 놀이공원 맵 자료 (있을 때만) ──
function parkChecks() {
  if (!fs.existsSync(PARK_FILE)) {
    console.log('(maps/night-park.json 없음 — 놀이공원 맵 자료 시험은 건너뜀)');
    return;
  }
  const P = JSON.parse(fs.readFileSync(PARK_FILE, 'utf8'));
  const devs = P.devices || [];
  const solo = devs.filter((d) => d.solo);
  const car = devs.filter((d) => d.style === 'carousel');
  const dark = (P.zones || []).filter((z) => z.type === 'dark');
  check('놀이공원: 줄 서는 미끄럼틀이 있다 (solo: true)', solo.length >= 1 && solo.every((d) => d.type === 'slide' || d.type === 'teleport'), solo.map((d) => d.id).join());
  check('놀이공원: 회전목마는 slide 장치 + 둥근 path (점 3개 이상)', car.length >= 1 && car.every((d) => d.type === 'slide' && Array.isArray(d.path) && d.path.length >= 3), car.map((d) => d.id).join());
  check('놀이공원: 유령의 집(dark 구역) amount 가 0~1 사이', dark.length >= 1 && dark.every((z) => Array.isArray(z.rect) && z.rect.length === 4 && z.amount > 0 && z.amount < 1));
  check('놀이공원: items.extra 는 아는 아이템 (킥보드)', !!P.items && Array.isArray(P.items.extra) && P.items.extra.includes('kickboard') && P.items.extra.every((k) => ITEMS[k]));
  // 회전목마 타는 곳·내리는 곳에 걸어서 갈 수 있는가 (팻말·글씨 자리는 맵 작업 쪽 검사 map-check 가 본다)
  const probs = validateMap(P, buildGrid(P), GAME.radius).filter((p) => car.some((d) => p.includes(`장치 ${d.id} `)) && /막힌 곳|걸어서 갈 수 없다/.test(p));
  check('놀이공원: 회전목마 타는 곳·내리는 곳에 걸어서 갈 수 있다', probs.length === 0, probs.join(' / '));
}

// 장치 타기: 성공하면 ride 이벤트, 아니면 error 메시지
async function use(c, device) {
  c.send({ t: 'use', device });
  return c.next((x) => (x.t === 'event' && x.kind === 'ride' && x.id === c.id) || x.t === 'error', 3000);
}

// ════ R1: 줄 서는 장치 · 회전목마 · 킥보드 속도 ════
async function runR1() {
  const srv = await startServer(3295, { minuteMs: 60000, fog: NO_FOG, testGive: true, chase: { graceMs: 600000 }, mapPatch: PATCH });
  try {
    const { teacher, P } = await setup(srv.port, ['가', '나', '다', '라'], { minutes: 5 });
    await startGame(teacher, P);
    const [A, B, C, D] = P;
    await Promise.all([route(A, [[1380, 1150]]), route(B, [[1420, 1150]]), route(C, [[1590, 810]]), route(D, [[1610, 790]])]);
    for (const c of [teacher, ...P]) c.clear();

    // ① 줄 서는 장치
    const r1 = await use(A, 'solo-test');
    check('줄 미끄럼틀: 첫 사람은 탄다', r1.t === 'event' && r1.ms === 1500, JSON.stringify(r1));
    const r2 = await use(B, 'solo-test');
    check('줄 미끄럼틀: 앞사람이 타는 중이면 거부 (device_busy, "N초 뒤")', r2.t === 'error' && r2.code === 'device_busy' && /앞사람이 타고 있어요\. \d초 뒤에 탈 수 있어요\./.test(r2.msg), JSON.stringify(r2));
    await sleep(1500 + 500 + 150);
    const r3 = await use(B, 'solo-test');
    check('줄 미끄럼틀: 타는 시간 + 0.5초가 지나면 다음 사람이 탄다', r3.t === 'event', JSON.stringify(r3));

    // ③ 회전목마: 여럿이 같이 탄다 (solo 가 아님), 3초
    const [c1, c2] = await Promise.all([use(C, 'carousel-test'), use(D, 'carousel-test')]);
    check('회전목마: 두 사람이 같이 탄다 · 3초 · 도착점은 반대편', c1.t === 'event' && c2.t === 'event' && c1.ms === 3000 && c1.to.join() === '1800,800', JSON.stringify([c1, c2]));

    // ② 킥보드: 쓰기 전에는 0.1초에 74px 이 거부, 쓰고 나면 받아들인다 (1.6배 → 허용 약 78px)
    await sleep(500);
    [A.x, A.y] = SOLO.to;
    A.send({ t: 'testGive', item: 'kickboard' });
    await A.next((m) => m.t === 'me' && m.item === 'kickboard');
    const jump = async () => {
      const f0 = A.fixes;
      A.send({ t: 'pos', x: A.x, y: A.y, f: 1, m: 1 });
      await sleep(100);
      A.send({ t: 'pos', x: A.x + 74, y: A.y, f: 1, m: 1 });
      await sleep(200);
      return A.fixes === f0;
    };
    const before = await jump();
    teacher.clear();
    A.send({ t: 'useItem' });
    const me = await A.next((m) => m.t === 'me' && !m.item && m.effects && m.effects.kickboard > 0);
    const ev = await teacher.next((m) => m.t === 'event' && m.kind === 'item' && m.item === 'kickboard', 2000).catch(() => null);
    const after = await jump();
    check('킥보드: 쓰기 전 74px 거부 → 쓴 뒤 허용 (서버 속도 검사 1.6배)', !before && after, JSON.stringify({ before, after }));
    check('킥보드: 효과 8초가 me.effects 에, 쓰는 모습이 item 알림으로', me.effects.kickboard > 7000 && me.effects.kickboard <= 8000 && !!ev);
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

// ════ R2: 어두운 구역 — 같은 거리라도 유령의 집 안에서는 상자가 안 보인다 ════
async function runR2() {
  const srv = await startServer(3296, { minuteMs: 6000, fog: NO_FOG, loot: { dropsAt: [0.1] }, lootFurniture: [12], mapPatch: PATCH });
  try {
    const { teacher, P } = await setup(srv.port, ['일', '이', '삼', '사'], { minutes: 5 });
    await startGame(teacher, P);
    const IN = [1220, 1000]; // 유령의 집 안: 상자(고깔)까지 약 402px
    const OUT = [1600, 780]; // 밖: 약 400px
    const X = P[3];
    const Y = P[1];
    await Promise.all([route(X, [IN]), route(Y, [OUT])]);
    const crate = (await teacher.next((m) => m.t === 'crates' && m.crates.length === 1, 6000)).crates[0];
    await sleep(400);
    const dIn = distToRect(...IN, crate.rect);
    const dOut = distToRect(...OUT, crate.rect);
    const normal = GAME.vision + LOOT.seeExtra;
    const dark = GAME.vision * 0.55 + LOOT.seeExtra;
    check('유령의 집 시험 자리: 두 사람 모두 보통 시야 안, 어두운 시야 밖', dIn < normal && dOut < normal && dIn > dark && dOut > dark, JSON.stringify({ dIn, dOut, normal, dark }));
    const seenOut = !!(Y.crates && Y.crates.some((k) => k.id === crate.id));
    const seenIn = !!(X.crates && X.crates.some((k) => k.id === crate.id));
    check('어두운 구역: 밖에 있는 사람은 상자를 보고, 같은 거리의 유령의 집 안 사람은 못 본다 (시야 × 0.55)', seenOut && !seenIn, JSON.stringify({ seenOut, seenIn, X: X.crates, Y: Y.crates }));
    // 구역 밖으로 나오면 (어두운 시야로는 안 닿는 거리 약 340px) 다시 보인다
    const EXIT = [1360, 920];
    await route(X, [EXIT]);
    await sleep(400);
    const seenAfter = !!(X.crates && X.crates.some((k) => k.id === crate.id));
    const dExit = distToRect(...EXIT, crate.rect);
    check('어두운 구역: 밖으로 나오면 다시 보통 시야', seenAfter && dExit > dark, JSON.stringify({ X: X.crates, dExit }));
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

pureChecks();
parkChecks();
runAll(T, [runR1, runR2], 90000);
