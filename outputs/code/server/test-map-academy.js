// 한밤의 별빛 학원(star-academy, 3층 건물) 자동 시험. 실행: node server/test-map-academy.js (npm test 에 포함)
// 맵 검사(층·층 안개·장치로 이어진 도달 가능성) + 두 모드 봇 판(계단·엘리베이터·미끄럼틀·개구멍) + 층 단위 잠 안개.
// 포트 3280~3289 만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOG, LOOT, GAME } from '../shared/config.js';
import { buildGrid, validateMap, lootFurniture, floorAt, floorPanels, walkMap, deviceMarks, FLOOR_GAP } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, split, route, sleep, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = makeChecker('별빛 학원');
const { check } = T;
const MAP = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', 'star-academy.json'), 'utf8'));
const G = buildGrid(MAP);
const flOf = (p) => (floorAt(MAP, p[0], p[1]) || { id: 0 }).id;
const clone = () => JSON.parse(JSON.stringify(MAP));

// 맵 좌표 (층 안 좌표 → 맵 좌표: 1층 x+140, 2층 x+3340, 3층 x+6540, y+200)
const LOBBY = [960, 900]; // 1층 접수 로비 (시작 자리 근처)
const HALL1 = [960, 700]; // 1층 복도
const ST1 = [260, 590]; // 1층 왼쪽 계단 (▲ 2층) 앞
const ST1R = [1620, 590]; // 1층 오른쪽 계단 (▲ 2층) 앞
const LIFT1 = [860, 580]; // 1층 엘리베이터 2층행 앞
const ARR2_UP = [3460, 760]; // 2층 왼쪽 계단으로 올라와 도착하는 곳
const ST2_DOWN = [3460, 820]; // 2층 왼쪽 ▼ 1층 계단 앞
const ST2_UP = [3460, 590]; // 2층 왼쪽 ▲ 3층 계단 앞

// ── 맵 검사 ──
function mapChecks() {
  const probs = validateMap(MAP, G, GAME.radius);
  check('맵 검사: 별빛 학원은 문제가 없다 (층·층 안개·장치·팻말 포함)', probs.length === 0, probs.join(' / '));
  check('층 3개, 서로 1500px 넘게 떨어져 있다', MAP.floors.length === 3 && MAP.floors.every((f, i) => !i || f.rect[0] - (MAP.floors[i - 1].rect[0] + MAP.floors[i - 1].rect[2]) >= FLOOR_GAP));
  check('floorAt: 시작 자리는 1층, 층 사이 하늘은 어느 층도 아니다', flOf(MAP.spawn.pos) === 1 && floorAt(MAP, 2500, 700) === null);
  const perFloor = [1, 2, 3].map((id) => MAP.terminals.filter((t) => flOf(t.pos) === id).length);
  check('랜턴 1층 3 · 2층 3 · 3층 2', perFloor.join(',') === '3,3,2', perFloor.join(','));
  const names = MAP.rooms.every((r) => /^[123]층 /.test(r.name) && Number(r.name[0]) === flOf([r.rect[0] + 40, r.rect[1] + 40]));
  check('방 이름에 층이 들어 있다 (힌트 "상자: 2층 수학 교실")', names);
  const loot = lootFurniture(MAP, G, LOOT.openReach, GAME.radius);
  const lootPer = [1, 2, 3].map((id) => loot.filter((f) => flOf([f.x, f.y]) === id).length);
  check('보급 상자 가구가 층마다 있다', lootPer.every((n) => n > 0), lootPer.join(','));
  check('층 안개: 마지막 밤 임시 랜턴 2자리가 1층', MAP.fog.mode === 'floors' && MAP.fog.bonus.length >= FOG.bonusCount && MAP.fog.bonus.every((b) => flOf(b) === 1));
  const st = MAP.devices.filter((d) => /^stairs-/.test(d.id));
  check('계단 8개: 모두(두 역할) 탈 수 있다', st.length === 8 && st.every((d) => ['sleep-tag', 'mafia'].every((m) => d.who[m].includes('student') && d.who[m].includes('chaser'))));
  const lifts = MAP.devices.filter((d) => d.style === 'elevator');
  check('엘리베이터 문 6개: 잠귀신 술래잡기는 학생만, 대기 10초를 같이 센다', lifts.length === 6 && lifts.every((d) => d.who['sleep-tag'].join() === 'student' && d.cooldown.group === 'elevator' && d.cooldown.seconds === 10 && d.duration === 1.5));
  check('계단·엘리베이터는 출구 그림·글씨가 없고, 엘리베이터 팻말은 층마다 하나', lifts.every((d) => deviceMarks(d).every((m) => !m.what.startsWith('출구'))) && lifts.filter((d) => deviceMarks(d).some((m) => m.kind === 'sign')).length === 3);

  // 장치가 길: 장치를 모두 빼면 2·3층에 갈 수 없다고 걸린다
  const noDev = clone();
  noDev.devices = [];
  const p1 = validateMap(noDev, buildGrid(noDev));
  check('맵 검사: 층을 잇는 장치가 없으면 2·3층 랜턴·방이 "걸어서 갈 수 없다"로 걸린다', p1.some((p) => p.includes('랜턴 t4') && p.includes('걸어서 갈 수 없다')) && p1.some((p) => p.includes('랜턴 t8')), p1.slice(0, 4).join(' / '));
  const w = walkMap(MAP, G, GAME.radius);
  check('walkMap: 장치로 이어진 3층 옥상까지 걸어서 갈 수 있다', w.near(7300, 1000, 20));
  // 잘못된 층·층 안개 자료
  const bad = clone();
  bad.floors[1].rect[0] = bad.floors[0].rect[0] + bad.floors[0].rect[2] + 600; // 너무 가깝다
  bad.fog.safe = [[1], [9], [1, 2]]; // 모르는 층 · 다시 안전해짐
  bad.fog.bonus[0] = [7000, 700]; // 3층 (마지막에 어두운 층)
  const p2 = validateMap(bad, buildGrid(bad));
  check(
    '맵 검사: 층이 가깝거나 층 안개 자료가 틀리면 걸린다',
    p2.some((p) => p.includes('떨어져야')) && p2.some((p) => p.includes('모르는 층')) && p2.some((p) => p.includes('다시 안전')) && p2.some((p) => p.includes('임시 랜턴 1') && p2.join().includes('안전한 층 밖')),
    p2.slice(0, 6).join(' / '),
  );
  // 화면 칸 나누기: 넓은 화면은 한 줄 3칸, 좁고 긴 화면은 세로 3칸(3층이 위)
  const wide = floorPanels(MAP, 1800, 400, { gap: 10 });
  const tall = floorPanels(MAP, 400, 1400, { gap: 10 });
  check('floorPanels: 넓은 화면은 가로, 좁은 화면은 세로(높은 층 위)', new Set(wide.map((p) => Math.round(p.y))).size === 1 && tall[0].floor.id === 3 && tall[0].y < tall[2].y);
  const one = floorPanels({ size: [2800, 1900] }, 560, 380);
  check('floorPanels: 층이 없는 맵은 맵 전체 한 칸 (예전 작은 지도와 같은 배율)', one.length === 1 && Math.abs(one[0].k - Math.min(560 / 2800, 380 / 1900)) < 1e-9);
}

// 장치 타기: 성공하면 ride 이벤트, 아니면 error 메시지
async function ride(c, device) {
  c.clear();
  c.send({ t: 'use', device });
  const m = await c.next((x) => (x.t === 'event' && x.kind === 'ride' && x.id === c.id) || x.t === 'error', 3000);
  if (m.t === 'error') return m;
  [c.x, c.y] = m.to;
  await sleep(m.ms + 150);
  return m;
}
const devById = (id) => MAP.devices.find((d) => d.id === id);

// ════ A1: 잠귀신 술래잡기 — 계단 위아래, 엘리베이터(학생만·대기 10초), 미끄럼틀 3→1, 개구멍 ════
async function runA1(port) {
  const { teacher, P } = await setup(port, ['가람', '나래', '다온', '라온'], { map: 'star-academy', minutes: 10, fogLoot: false });
  const v = await startGame(teacher, P);
  const { C: [C], S: [A, B, D] } = split(v, P);
  check('시작 자리는 모두 1층 접수 로비', v.players.every((p) => flOf([p.x, p.y]) === 1));
  // 1) 계단: A 가 1층 왼쪽 ▲ → 2층, 다시 ▼ → 1층
  await Promise.all([route(A, [LOBBY, HALL1, [260, 700], ST1]), route(C, [LOBBY, HALL1, LIFT1]), route(B, [LOBBY, HALL1, [900, 640]])]);
  const up = await ride(A, 'stairs-l-1up');
  check('계단 ▲: 1층 → 2층 (0.6초)', up.t === 'event' && flOf(up.to) === 2 && up.ms === 600 && flOf([teacher.see(A).x, teacher.see(A).y]) === 2, JSON.stringify(up));
  await sleep(1100); // 계단은 1초 쉬고 다시 (계단끼리 같이 센다)
  const okWalk = await route(A, [ST2_DOWN]);
  const down = await ride(A, 'stairs-l-2down');
  check('계단 ▼: 2층 → 1층', okWalk && down.t === 'event' && flOf(down.to) === 1, JSON.stringify(down));
  // 2) 잠귀신은 엘리베이터를 못 타고 계단은 탄다
  const no = await ride(C, 'lift-1to2');
  check('잠귀신은 엘리베이터를 못 탄다 (not_allowed)', no.t === 'error' && no.code === 'not_allowed', JSON.stringify(no));
  await route(C, [HALL1, [1620, 700], ST1R]);
  const cUp = await ride(C, 'stairs-r-1up');
  check('잠귀신도 계단은 탄다', cUp.t === 'event' && flOf(cUp.to) === 2, JSON.stringify(cUp));
  // 3) 학생 B: 엘리베이터 1층 → 2층 (1.5초), 바로 3층행 문은 대기 10초 (문 여러 개를 같이 센다)
  await route(B, [LIFT1]);
  const lift = await ride(B, 'lift-1to2');
  check('엘리베이터: 학생은 1층 → 2층 (1.5초), 도착 뒤 잠깐 보호', lift.t === 'event' && flOf(lift.to) === 2 && lift.ms === 1500, JSON.stringify(lift));
  await route(B, [[4220, 670], [4220, 580]]);
  const again = await ride(B, 'lift-2to3');
  check('엘리베이터: 다른 층 문이어도 10초 대기를 같이 센다 (device_cooldown)', again.t === 'error' && again.code === 'device_cooldown', JSON.stringify(again));
  // 4) 2층 → 3층 계단 → 옥상 미끄럼틀 → 1층 로비
  await route(B, [[4220, 700], [3460, 700], ST2_UP]);
  const up3 = await ride(B, 'stairs-l-2up');
  const walked = await route(B, [[6660, 700], [7540, 700], [7540, 880], [7720, 880], [7720, 1020]]);
  const sl = await ride(B, 'slide-roof');
  check('미끄럼틀: 3층 옥상 → 1층 접수 로비 (아래로만)', up3.t === 'event' && flOf(up3.to) === 3 && walked && sl.t === 'event' && flOf(sl.to) === 1 && devById('slide-roof').exits.every((e) => flOf(e) === 1), JSON.stringify([up3, sl]));
  // 5) 개구멍: D 가 엘리베이터로 2층 → 자습실 책상 밑 → 1·2·3층 중 한 곳
  await route(D, [LOBBY, HALL1, LIFT1]);
  await ride(D, 'lift-1to2');
  const toHole = await route(D, [[4340, 670], [4340, 860], [4280, 860], [4280, 1100]]);
  const hole = await ride(D, 'hole-study');
  const exits = devById('hole-study').exits;
  check('개구멍: 출구 3곳이 서로 다른 층이고, 그중 한 곳으로 나온다', toHole && hole.t === 'event' && exits.some((e) => e[0] === hole.to[0] && e[1] === hole.to[1]) && new Set(exits.map(flOf)).size === 3, JSON.stringify(hole));
  // 6) 층을 넘는 꿈 걸기 없음: 잠귀신(2층)은 1층 학생에게 닿지 않는다 (헛손질)
  await sleep(200);
  C.clear();
  C.send({ t: 'tag' });
  await sleep(300);
  check('다른 층 학생에게는 꿈을 걸 수 없다', !teacher.room.players.some((p) => p.frozen));
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

// ════ A2: 꿈도둑을 찾아라 — 꿈도둑도 엘리베이터를 탄다 ════
async function runA2(port) {
  const { teacher, P } = await setup(port, ['하나', '두리', '세찬', '네오'], { map: 'star-academy', mode: 'mafia', minutes: 10, fogLoot: false });
  teacher.send({ t: 'pickChasers', ids: [P[0].id] });
  await teacher.type('picked');
  await startGame(teacher, P);
  const M = P[0];
  await route(M, [LOBBY, HALL1, LIFT1]);
  const r = await ride(M, 'lift-1to2');
  check('꿈도둑을 찾아라: 꿈도둑도 엘리베이터를 탄다', r.t === 'event' && flOf(r.to) === 2, JSON.stringify(r));
  await route(P[1], [LOBBY, HALL1, [260, 700], ST1]);
  const s = await ride(P[1], 'stairs-l-1up');
  check('꿈도둑을 찾아라: 학생 계단', s.t === 'event' && flOf(s.to) === 2);
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

// ════ F: 층 단위 잠 안개 (시험용 짧은 판: 1분 = 4초 → 20초. 1·2·3단계 = 6·11·16초) ════
const FOG_OVR = {
  minuteMs: 4000,
  fog: { warnMs: 1500, stages: [{ at: 0.3, shrinkMs: 2000 }, { at: 0.55, shrinkMs: 1000 }, { at: 0.8, shrinkMs: 1000 }], drowsyMs: 2500 },
  loot: { dropsAt: [] },
  chase: { graceMs: 500 },
};
async function runFog(port) {
  const { teacher, P } = await setup(port, ['일', '이', '삼', '사'], { map: 'star-academy', minutes: 5 });
  const v = await startGame(teacher, P);
  const { S: [S1, S2, S3] } = split(v, P);
  check('층 안개: 시작 때 room.fog 는 층 모드, 아직 모두 안전 (safe null, nextSafe [1,2])', v.fog && v.fog.mode === 'floors' && v.fog.stage === 0 && v.fog.safe === null && JSON.stringify(v.fog.nextSafe) === '[1,2]', JSON.stringify(v.fog));
  // S2 는 3층으로, S3 는 2층으로, S1 은 1층 로비에 남는다
  const goUp = async (c, floors) => {
    await route(c, [LOBBY, HALL1, [260, 700], ST1]);
    await ride(c, 'stairs-l-1up');
    if (floors < 3) return;
    await sleep(1000); // 계단은 1초 쉬고 다시
    await route(c, [ST2_UP]);
    await ride(c, 'stairs-l-2up');
  };
  await Promise.all([goUp(S2, 3), goUp(S3, 2), route(S1, [LOBBY])]);
  const warn1 = teacher.raw.map((s) => JSON.parse(s)).find((m) => m.t === 'event' && m.kind === 'fogWarn' && m.stage === 1) || (await teacher.event('fogWarn', 6000));
  check('층 안개 예고: "곧 3층" (dark 3층, safe 1층·2층)', JSON.stringify(warn1.dark) === '["3층"]' && JSON.stringify(warn1.safe) === '["1층","2층"]', JSON.stringify(warn1));
  await teacher.next((m) => m.t === 'event' && m.kind === 'fogStart' && m.stage === 1, 6000);
  await sleep(400);
  check('1단계: 3층이 어두워진다 (safe [1,2])', JSON.stringify(teacher.room.fog.safe) === '[1,2]' && teacher.room.fog.r === null);
  check('1단계: 3층 학생은 안개 속, 1·2층 학생은 아니다', S2.meMsg.inFog === true && S1.meMsg.inFog === false && S3.meMsg.inFog === false, JSON.stringify([S2.meMsg.inFog, S1.meMsg.inFog, S3.meMsg.inFog, teacher.see(S2)]));
  const slept = await teacher.next((m) => m.t === 'event' && m.kind === 'tag' && m.id === S2.id, 4000).catch(() => null);
  check('3층에 남은 학생은 졸음이 차서 꿈에 빠진다 (by fog)', !!slept && slept.by === 'fog');
  check('1층 학생은 졸음이 없다', S1.meMsg.drowsy === 0 && !teacher.see(S1).frozen);
  const start2 = await teacher.next((m) => m.t === 'event' && m.kind === 'fogStart' && m.stage === 2, 6000);
  await sleep(400);
  check('2단계: 2층도 어두워진다 (dark 2층, safe [1])', JSON.stringify(start2.dark) === '["2층"]' && JSON.stringify(teacher.room.fog.safe) === '[1]' && S3.meMsg.inFog === true && S1.meMsg.inFog === false, JSON.stringify(start2));
  const start3 = await teacher.next((m) => m.t === 'event' && m.kind === 'fogStart' && m.stage === 3, 7000);
  await sleep(300);
  const bt = teacher.room.bonusTerminals;
  check('마지막 밤: 1층만 안전 · 임시 랜턴 2개는 1층', start3.dark.length === 0 && JSON.stringify(start3.safe) === '["1층"]' && bt.length === 2 && bt.every((b) => flOf(b.pos) === 1), JSON.stringify([start3, bt]));
  check('마지막 밤까지 1층 학생은 깨어 있다', !teacher.see(S1).frozen && S1.meMsg.inFog === false);
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

const srvRuns = async () => {
  const a = await startServer(3280, { chase: { graceMs: 300 }, mafia: { freezeGraceMs: 300, sabotageGraceMs: 300, buttonGraceMs: 300 } });
  try {
    for (const run of [runA1, runA2]) {
      try {
        await run(a.port);
      } catch (e) {
        T.failed++;
        console.log('실패  시험 도중 오류 →', e.stack || e.message);
      }
    }
    check('서버 맵 검사에서 star-academy 문제가 나오지 않는다', !/맵 star-academy 에 문제/.test(a.log()), a.log());
  } finally {
    await a.stop();
  }
  const b = await startServer(3281, FOG_OVR);
  try {
    await runFog(b.port);
  } catch (e) {
    T.failed++;
    console.log('실패  시험 도중 오류 →', e.stack || e.message);
  } finally {
    await b.stop();
  }
};
runAll(T, [async () => mapChecks(), srvRuns], 150_000);
