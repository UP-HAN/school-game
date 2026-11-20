// 잠 안개 자동 시험 (06 명세 15절 5~14번). 실행: npm test
// 시험용 짧은 판: 게임 "1분" = 4초 → 5분 판 = 20초. 안개 1·2·3단계 = 6초·11초·16초, 예고 1.5초 전.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOG, CHASE, MAFIA, GAME, stageValue } from '../shared/config.js';
import { buildGrid, validateMap, inspectMap, inspectDeviceMarks, canStand, drawnRect } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, split, walk, route, openQuiz, answer, solve, sleep, SPAWN, BELL, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = makeChecker('잠 안개');
const { check } = T;
const STAGE_AT = [6000, 11000, 16000];
const RADII = [600, 560, 320];
const OVERRIDES = {
  minuteMs: 4000,
  fog: {
    warnMs: 1500,
    stages: [
      { at: 0.3, shrinkMs: 2000 },
      { at: 0.55, shrinkMs: 1000 },
      { at: 0.8, shrinkMs: 1000 },
    ],
    radii: RADII,
    drowsyMs: 2500,
  },
  fogCenter: 0, // 큰 체육관 가운데 (1400, 920)
  loot: { dropsAt: [] }, // 보급은 test-loot.js 에서
  chase: { graceMs: 500 },
  mafia: { freezeGraceMs: 500, sabotageGraceMs: 500, buttonGraceMs: 500, meetingIntroMs: 200, discussMs: 1500, voteMs: 1500, resultMs: 200 },
};
const until = (v, ms) => sleep(Math.max(0, v.startedAt + ms - Date.now()));
const fogStageNow = (t) => (t.room && t.room.fog ? t.room.fog.stage : 0);

// ── 14. 맵 검사 ──
function mapChecks() {
  const map = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', 'monster-gym.json'), 'utf8'));
  const g = buildGrid(map);
  check('14. 몬스터 체육관: 안개 후보 3곳·임시 랜턴 자리 검사 통과', map.fog.centers.length === 3 && validateMap(map, g).length === 0, validateMap(map, g).join(' / '));
  const bad = JSON.parse(JSON.stringify(map));
  bad.fog.centers[0].pos = [380, 350]; // 뜀틀 가구 속 (막힌 곳)
  bad.fog.centers[1].bonus[0] = [40, 40]; // 건물 밖
  bad.fog.centers[2].bonus[1] = [2540, 1300]; // 걸을 수 있지만 반지름 550 밖
  const probs = validateMap(bad, buildGrid(bad));
  check('14. 잘못된 안개 중심·임시 랜턴 자리는 맵 검사에서 걸린다', probs.some((p) => p.includes('안개 후보 1') && p.includes('중심')) && probs.some((p) => p.includes('안개 후보 2 임시 랜턴 1')) && probs.some((p) => p.includes('안개 후보 3 임시 랜턴 2') && p.includes('밖')), probs.join(' / '));
  const badWho = JSON.parse(JSON.stringify(map));
  badWho.devices[0].who = { 'old-mode': ['student'] };
  check('장치 who 에 모르는 모드 id 가 있으면 맵 검사에서 걸린다', validateMap(badWho, buildGrid(badWho)).some((p) => p.includes('모르는 모드')));

  // ── 맵 충돌: 가구는 그림의 아랫부분만 막고, 도달 가능성·끼는 틈·보이지 않는 벽을 검사한다 ──
  check('맵 충돌: 몬스터 체육관에 끼는 틈·보이지 않는 벽이 없다', inspectMap(map, g, GAME.radius).length === 0, inspectMap(map, g, GAME.radius).map((p) => p.text).join(' / '));
  const teddy = map.furniture.find((f) => f.kind === 'teddy');
  const [tx, ty, tw, th] = teddy.rect;
  check('맵 충돌: 곰 인형 그림 옆 빈 바닥(예전엔 보이지 않는 벽)에 설 수 있다', canStand(g, tx + tw + 2, ty + th / 2, GAME.radius) && canStand(g, tx - 2, ty + th / 2, GAME.radius));
  check('맵 충돌: 곰 인형 몸통 아랫부분에는 설 수 없다', !canStand(g, tx + tw / 2, ty + th - 10, GAME.radius));
  check('맵 충돌: 가구 막힘 영역은 모두 그림 영역보다 같거나 작다', map.furniture.every((f, i) => {
    const d = drawnRect(f);
    const b = g.foots[i];
    return b[2] * b[3] <= d[2] * d[3] && b[0] >= d[0] && b[0] + b[2] <= d[0] + d[2] && b[1] + b[3] <= d[1] + d[3];
  }));
  const blockDoor = JSON.parse(JSON.stringify(map));
  blockDoor.furniture.push({ kind: 'crates', name: '시험 상자', rect: [700, 400, 60, 120], foot: [700, 400, 60, 120] }); // 체육 창고 문 앞을 막는다
  const doorProbs = validateMap(blockDoor, buildGrid(blockDoor));
  check('맵 충돌: 문 앞을 가구로 막으면 문·방 안 랜턴에 갈 수 없다고 걸린다', doorProbs.some((p) => p.includes('문 d-storage')) && doorProbs.some((p) => p.includes('랜턴 t2') && p.includes('걸어서 갈 수 없다')), doorProbs.join(' / '));
  const gaps = JSON.parse(JSON.stringify(map));
  gaps.furniture.push({ kind: 'crates', name: '시험 상자1', rect: [1000, 700, 40, 40], foot: [1000, 700, 40, 40] });
  gaps.furniture.push({ kind: 'crates', name: '시험 상자2', rect: [1070, 700, 40, 40], foot: [1070, 700, 40, 40] }); // 30px 틈: 지나가지만 끼기 쉬움
  gaps.furniture.push({ kind: 'plant', name: '시험 화분1', rect: [1000, 1000, 40, 40], foot: [990, 990, 80, 60] }); // 그림보다 큰 막힘
  gaps.furniture.push({ kind: 'plant', name: '시험 화분2', rect: [1080, 1000, 40, 40] });
  const gapProbs = validateMap(gaps, buildGrid(gaps));
  check('맵 충돌: 좁은 틈·보이지 않는 벽은 맵 검사에서 걸린다', gapProbs.some((p) => p.startsWith('좁은 틈') && p.includes('시험 상자')) && gapProbs.some((p) => p.startsWith('보이지 않는 벽') && p.includes('시험 화분')), gapProbs.join(' / '));
  const lonely = JSON.parse(JSON.stringify(map));
  lonely.furniture.push({ kind: 'crates', name: '시험 벽', rect: [2120, 260, 460, 580], foot: [2120, 260, 460, 580] }); // 놀이방을 통째로 메운다
  const lonelyProbs = validateMap(lonely, buildGrid(lonely));
  check('맵 충돌: 방 하나가 가구로 메워지면 그 방 랜턴·장치·문이 걸린다', ['랜턴 t5', '장치 slide-1 입구', '문 d-climb'].every((w) => lonelyProbs.some((p) => p.includes(w))), lonelyProbs.join(' / '));

  // ── 장치 팻말·글씨 자리: 가구·벽·다른 글씨와 겹치면 맵 검사에서 걸린다 ──
  check('장치 팻말: 몬스터 체육관의 장치 팻말·글씨가 아무것과도 겹치지 않는다', inspectDeviceMarks(map, g).length === 0, inspectDeviceMarks(map, g).join(' / '));
  const signs = JSON.parse(JSON.stringify(map));
  delete signs.devices.find((d) => d.id === 'hole-1').marks; // 예전 자리 (팻말이 상자 더미 쪽, 글씨가 벽 위)
  signs.furniture.find((f) => f.name === '상자 더미').rect = [360, 560, 100, 80];
  signs.devices.find((d) => d.id === 'slide-1').marks = { sign: [-100, 34] }; // 정글짐 위
  const signProbs = validateMap(signs, buildGrid(signs));
  check('장치 팻말: 팻말이 가구에 겹치거나 글씨가 벽에 걸리면 맵 검사에서 걸린다', signProbs.some((p) => p.includes('hole-1 팻말') && p.includes('상자 더미')) && signProbs.some((p) => p.includes('hole-1 입구 글씨') && p.includes('벽')) && signProbs.some((p) => p.includes('slide-1 팻말') && p.includes('정글짐')), signProbs.join(' / '));
  const lantern = JSON.parse(JSON.stringify(map));
  lantern.terminals.find((t) => t.id === 't5').pos = [2540, 300]; // 미끄럼틀 길 위
  check('장치 팻말: 미끄럼틀 길이 랜턴을 덮으면 맵 검사에서 걸린다', validateMap(lantern, buildGrid(lantern)).some((p) => p.includes('길') && p.includes('랜턴 t5')));
}

// ── 10. 단계별 보정 표 (06 명세 6-4절) ──
function tableChecks() {
  const row = (key, base) => [0, 1, 2, 3].map((s) => stageValue(key, s, base)).join(',');
  check(
    '10. 단계 표: 꿈 걸기 쿨타임·깨우기 시간·보호·오답 잠금·도움·꿈도둑 쿨타임',
    row('chaseCooldownMs', CHASE.cooldownMs) === '6000,8000,10000,12000' &&
      row('wakeHoldMs', CHASE.thawHoldMs) === '1200,1200,1000,800' &&
      row('wakeProtectMs', CHASE.thawProtectMs) === '4000,4000,5000,5000' &&
      row('innerWrongLockMs') === '5000,5000,4000,3000' &&
      row('helpAfter') === '2,2,1,1' &&
      row('mafiaCooldownMs', MAFIA.freezeCooldownMs) === '30000,35000,40000,45000' &&
      FOG.wrongLockMs === 8000 && FOG.drowsyMs === 12000 && FOG.drowsyRecover === 2 && FOG.lastNightChaserSpeed === 1.1,
  );
}

// ════ F1: 잠귀신 술래잡기 — 단계·반지름·졸음 회복·단계별 보정·안개 속 오답 잠금·임시 랜턴 ════
async function runF1(port) {
  const { teacher, P } = await setup(port, ['가람', '나래', '다온', '라온'], { minutes: 5 });
  const v = await startGame(teacher, P);
  const { C: [C], S: [A, B, D] } = split(v, P);
  check('12-1. 시작하면 room.fog 가 오고 아직 안개가 없다 (stage 0, r null)', v.fog && v.fog.stage === 0 && v.fog.r === null && v.fog.nextR === RADII[0] && v.fog.cx === 1400);
  check('12-1. 안개·보급 값: bonusTerminals 빈 목록, cratesLeft 0', Array.isArray(v.bonusTerminals) && v.bonusTerminals.length === 0 && v.cratesLeft === 0);
  // 자리 잡기: A 는 서쪽 복도 (안개에 들어갈 곳), B·C·D 는 가운데 (C 가 B 에게 꿈을 걸고 D 가 깨운다)
  await Promise.all([route(A, [SPAWN, [780, 920]]), route(B, [SPAWN, [1400, 960]]), route(C, [SPAWN, [1400, 1000]]), route(D, [SPAWN, [1380, 920]])]);

  const warn1 = await teacher.event('fogWarn', 6000);
  check('5. 1단계 1.5초 전(시험값) fogWarn {stage:1, inMs}', warn1.stage === 1 && warn1.inMs > 1000 && warn1.inMs <= 1500 && Math.abs(warn1._at - v.startedAt - 4500) < 500, JSON.stringify(warn1));
  // 6. 좁혀지는 동안 고르게 (오는 room 을 모두 모은다)
  const samples = [];
  const collect = (m) => m.t === 'room' && m.fog && m.fog.stage === 1 && (samples.push(m.fog), false);
  teacher.waiters.push({ test: collect, resolve: () => {} });
  const start1 = await teacher.event('fogStart', 3000);
  const t1 = start1._at - v.startedAt;
  await sleep(150);
  check('5. 30% 때 room.fog.stage 1', start1.stage === 1 && Math.abs(t1 - STAGE_AT[0]) < 500 && teacher.room.fog.stage === 1, `${t1}ms`);

  // 10. 1단계 보정: 꿈 걸기 쿨타임 8초, 깨우기 1.2초, 보호 4초
  C.clear();
  C.send({ t: 'tag' });
  const tagEv = await teacher.next((m) => m.t === 'event' && m.kind === 'tag', 2000);
  await sleep(150);
  check('10. 1단계 꿈 걸기 쿨타임 8초', tagEv.by === C.id && tagEv.id === B.id && C.meMsg.tagMs > 7000 && C.meMsg.tagMs <= 8000, JSON.stringify([tagEv, C.meMsg.tagMs]));
  D.send({ t: 'thawStart', id: B.id });
  await sleep(1250);
  D.send({ t: 'thawEnd' });
  const thawEv = await teacher.next((m) => m.t === 'event' && m.kind === 'thaw', 2000).catch(() => null);
  await sleep(150);
  const bView = teacher.see(B);
  check('10. 1단계 깨우기 1.2초, 깨운 뒤 보호 4초', !!thawEv && fogStageNow(teacher) === 1 && !bView.frozen && bView.protMs > 3000 && bView.protMs <= 4000, JSON.stringify(bView));

  await until(v, STAGE_AT[0] + 2300);
  teacher.waiters.splice(teacher.waiters.findIndex((w) => w.test === collect), 1);
  const mid = samples.filter((f) => f.shrinkMsLeft > 100 && f.shrinkMsLeft < 1900);
  const even = mid.every((f) => Math.abs(f.r - (f.toR + ((f.fromR - f.toR) * f.shrinkMsLeft) / 2000)) <= 4);
  const last = teacher.room.fog;
  check('6. 반지름이 좁히는 동안 고르게 줄고(직선) 끝나면 radii 값', mid.length >= 1 && even && last.r === RADII[0] && last.shrinkMsLeft === 0 && last.nextR === RADII[1], JSON.stringify({ mid, last }));

  // 8. 졸음: A 는 안개 속 (780,920 = 가운데에서 620) → 1.2초 뒤 빛 구역 (820,920 = 580) 으로
  const inFogMe = await A.next((m) => m.t === 'me' && m.inFog === true, 2000).catch(() => null);
  const fogAt = Date.now();
  check('12-3. 안개에 들어가면 me.inFog', !!inFogMe);
  await sleep(1200);
  const dUp = A.meMsg.drowsy;
  A.send({ t: 'pos', x: 800, y: 920, f: 1, m: 1 });
  await sleep(40);
  A.send({ t: 'pos', x: 820, y: 920, f: 1, m: 1 });
  A.x = 820;
  const inAt = Date.now();
  await A.next((m) => m.t === 'me' && m.inFog === false, 1000).catch(() => null);
  await sleep(300);
  const dDown = A.meMsg.drowsy;
  const upRate = dUp / ((inAt - fogAt) / 1000);
  const downRate = (dUp - dDown) / ((Date.now() - inAt) / 1000);
  check('8. 안개 속에서 졸음이 차오르고 빛 구역에서는 2배 빠르기로 줄어든다', dUp > 0.3 && dDown < dUp && downRate / upRate > 1.4 && downRate / upRate < 2.8 && !teacher.see(A).frozen, JSON.stringify({ dUp, dDown, upRate, downRate }));

  // 11. 안개 속에서 연 퀴즈 오답 잠금 8초: A 가 무대 랜턴 t1 옆 (1400,310 = 가운데에서 610) 으로
  const bTask = route(B, [[1780, 1100], [1780, 1200]]); // B 는 큰 체육관 랜턴 t8 옆 (가운데에서 470)
  const dTask = route(D, [[1580, 1010]]); // D 는 임시 랜턴 b2 옆
  await route(A, [[920, 920], [1400, 700], [1400, 330], [1400, 310]]);
  const qA = await openQuiz(A, 't1');
  if (qA.t === 'error') console.log('   (A 의 t1 열기 실패:', qA.code, A.x, A.y, teacher.see(A).x, teacher.see(A).y, JSON.stringify(teacher.see(A)), JSON.stringify(A.meMsg), A.inbox.filter(m=>m.t==='event'||m.t==='error').map(m=>JSON.stringify(m)).join(' '), ')');
  const rA = await answer(A, qA, false);
  check('11. 안개 속 퀴즈 오답 잠금 8초', qA.t === 'question' && rA.ok === false && rA.lockMs === 8000 && A.meMsg.inFog === true, JSON.stringify(rA));
  A.send({ t: 'closeq' });
  // 11. 안개 속에서는 느리게(속도 0.75) 걸어도 되돌리지 않는다
  const f0 = A.fixes;
  for (let i = 0; i < 4; i++) {
    A.x += 15;
    A.send({ t: 'pos', x: A.x, y: A.y, f: 1, m: 1 });
    await sleep(80);
  }
  check('11. 안개 속에서 느려진 걸음은 되돌리지 않는다', A.fixes === f0);
  const aTask = route(A, [[1400, 330], [1400, 560], [1200, 830]]); // 임시 랜턴 b1 옆으로
  await Promise.all([bTask, dTask]);


  // 5·6. 2단계 (55%) — 반지름 560
  const start2 = await teacher.next((m) => m.t === 'event' && m.kind === 'fogStart' && m.stage === 2, 6000);
  const t2 = start2._at - v.startedAt;
  check('5. 55% 때 2단계 + 예고가 먼저 왔다', start2.stage === 2 && Math.abs(t2 - STAGE_AT[1]) < 500 && teacher.raw.some((s) => s.includes('"fogWarn"') && s.includes('"stage":2')), `${t2}ms`);
  await until(v, STAGE_AT[1] + 1150);
  check('6. 2단계가 끝나면 반지름 560', teacher.room.fog.stage === 2 && teacher.room.fog.r === RADII[1]);
  // 10. 빛 구역 안 2단계: 오답 잠금 4초, 첫 오답부터 도움 (B 는 t8 옆 1780,1200 = 가운데에서 470)
  const qB = await openQuiz(B, 't8');
  if (qB.t === 'error') console.log('   (B 열기 실패', JSON.stringify(qB), B.x, B.y, B.fixes, ')');
  const rB = await answer(B, qB, false);
  const helped = qB.kind === 'short' ? rB.help && rB.help.length === 1 : rB.removed.length === 1;
  check('10. 2단계 빛 구역 안 오답 잠금 4초 · 1번째 오답부터 도움', rB.lockMs === 4000 && helped, JSON.stringify(rB));
  B.send({ t: 'closeq' });
  await route(B, [[1400, 960]]);
  await aTask;

  // 12. 마지막 밤 (80%) — 임시 랜턴 2개
  const bonusEv = await teacher.event('bonusLanterns', 6000);
  const start3 = teacher.raw.find((s) => s.includes('"fogStart"') && s.includes('"stage":3'));
  await sleep(150);
  const bt = teacher.room.bonusTerminals;
  check('12. 마지막 밤에 임시 랜턴 2개가 room.bonusTerminals 로 온다 (학생도 받는다)', !!bonusEv && !!start3 && bt.length === 2 && bt[0].id === 'b1' && A.room.bonusTerminals.length === 2 && teacher.room.fog.stage === 3);
  await until(v, STAGE_AT[2] + 1100);
  check('6. 3단계가 끝나면 반지름 320', teacher.room.fog.r === RADII[2]);
  const qD2 = await openQuiz(D, 'b2');
  const rD2 = await answer(D, qD2, false);
  check('10. 3단계 빛 구역 안 오답 잠금 3초', qD2.t === 'question' && rD2.lockMs === 3000, JSON.stringify(rD2));
  const before = teacher.room.progress.solved;
  const res = await solve(A, 'b1');
  await sleep(200);
  check('12. 임시 랜턴을 열어 맞히면 새벽빛이 오른다', res === 'ok' && teacher.room.progress.solved === before + 1 && A.meMsg.done.includes('b1'));
  check('12. 같은 임시 랜턴은 한 번만', (await solve(A, 'b1')) === 'terminal_done');
  const over = await teacher.next((m) => m.t === 'room' && m.over, 5000);
  check('12. 임시 랜턴은 끝날 때까지 남아 있다 · 시간 끝은 time_up', over.bonusTerminals.length === 2 && over.over.reason === 'time_up');
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

// ════ F2: 꿈도둑을 찾아라 — 회의 중 안개 멈춤, 졸음 없음, 마지막 밤 안개 뿌리기 금지 ════
async function runF2(port) {
  const { teacher, P } = await setup(port, ['하나', '두리', '세찬', '네오'], { mode: 'mafia', minutes: 5 });
  teacher.send({ t: 'pickChasers', ids: [P[0].id] });
  await teacher.type('picked');
  const v = await startGame(teacher, P);
  const [M, S1, S2, S3] = P;
  await Promise.all([route(S1, [SPAWN, [780, 920]]), route(S2, [SPAWN, BELL])]);
  await teacher.event('fogStart', 8000);
  await until(v, STAGE_AT[0] + 900); // 좁혀지는 중간
  S2.send({ t: 'emergency' });
  await teacher.wait((m) => m.t === 'room' && m.meeting, 2000);
  await sleep(300);
  const f1 = { ...teacher.room.fog };
  await sleep(700);
  const f2 = teacher.room.fog;
  check('7. 회의 중에는 안개 단계·반지름·다음 단계까지 남은 시간이 멈춘다', f1.stage === 1 && f1.shrinkMsLeft > 0 && f1.r === f2.r && f1.shrinkMsLeft === f2.shrinkMsLeft && f1.nextMsLeft === f2.nextMsLeft, JSON.stringify({ f1, f2 }));
  if (teacher.room.meeting.stage !== 'discuss') await teacher.wait((m) => m.t === 'room' && m.meeting && m.meeting.stage === 'discuss', 3000);
  teacher.send({ t: 'meetingCtl', action: 'vote' });
  await teacher.wait((m) => m.t === 'room' && m.meeting && m.meeting.stage === 'vote', 2000);
  for (const c of P) c.send({ t: 'vote', target: 'skip' });
  await teacher.wait((m) => m.t === 'room' && !m.meeting, 4000);
  await sleep(1300);
  check('7. 회의가 끝나면 안개가 이어서 좁혀진다', teacher.room.fog.r < f2.r || teacher.room.fog.shrinkMsLeft < f2.shrinkMsLeft);
  for (const c of P) c.sync();
  await route(S1, [SPAWN, [780, 920]]);
  await S1.next((m) => m.t === 'me' && m.inFog === true, 4000).catch(() => null);
  await sleep(3000); // 졸음 시간(2.5초)보다 오래 안개 속에
  check('8. 꿈도둑을 찾아라에서는 안개 속에 오래 있어도 꿈에 빠지지 않는다 (졸음 없음)', S1.meMsg.inFog === true && S1.meMsg.drowsy === 0 && S1.meMsg.ghost === false && !teacher.room.over);
  await route(S1, [[1000, 920]]);
  // 마지막 밤: 안개 뿌리기 금지
  await teacher.next((m) => m.t === 'event' && m.kind === 'fogStart' && m.stage === 3, 12000);
  M.clear();
  M.send({ t: 'sabotage', kind: 'blackout' });
  check('10. 마지막 밤(3단계)에는 안개 뿌리기를 못 쓴다 (fog_night)', (await M.error()) === 'fog_night');
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

// ════ F3: 졸음으로 모두 꿈에 빠지면 잠귀신 승리 ════
async function runF3(port) {
  const { teacher, P } = await setup(port, ['일', '이', '삼', '사'], { minutes: 5 });
  const v = await startGame(teacher, P);
  const { S } = split(v, P);
  await Promise.all(S.map((c, i) => route(c, [SPAWN, [1000, 860 + i * 60], [780, 860 + i * 60]])));
  const evs = [];
  for (let i = 0; i < 3; i++) evs.push(await teacher.next((m) => m.t === 'event' && m.kind === 'tag', 12000));
  const firstAt = evs[0]._at - v.startedAt;
  const drowsyEv = await S[0].event('drowsySleep', 2000).catch(() => null);
  const over = await teacher.next((m) => m.t === 'room' && m.over, 3000);
  check('8. 안개 밖 학생은 졸음 시간(시험값 2.5초) 뒤 꿈에 빠진다 (event tag by fog)', evs.every((e) => e.by === 'fog') && firstAt > STAGE_AT[0] + 2500 && !!drowsyEv, `${firstAt}ms`);
  check('9. 졸음으로 모두 꿈에 빠지면 잠귀신 승리 all_asleep', over.over.winner === 'chasers' && over.over.reason === 'all_asleep');
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

// ════ F4: 안개·보급 꺼짐 ════
async function runF4(port) {
  const { teacher, P } = await setup(port, ['갑', '을', '병', '정'], { minutes: 5, fogLoot: false });
  const v = await startGame(teacher, P);
  const { S } = split(v, P);
  await route(S[0], [SPAWN, [780, 920]]);
  await until(v, STAGE_AT[0] + 2500);
  const evs = teacher.raw.filter((s) => /"kind":"(fogWarn|fogStart|drop|bonusLanterns)"/.test(s));
  check('13. fogLoot 꺼짐이면 안개가 없다 (room.fog 없음, 안개 알림 없음, inFog 아님)', teacher.room.fog === undefined && evs.length === 0 && S[0].meMsg.inFog === false && S[0].meMsg.drowsy === 0 && !teacher.room.over);
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

const srvRuns = async () => {
  const srv = await startServer(3981, OVERRIDES);
  try {
    for (const run of [runF1, runF2, runF3, runF4]) {
      try {
        await run(srv.port);
      } catch (e) {
        T.failed++;
        console.log('실패  시험 도중 오류 →', e.stack || e.message);
      }
    }
    check('맵 검사에서 문제가 나오지 않는다', !srv.log().includes('문제가 있어요'), srv.log());
  } finally {
    await srv.stop();
  }
};
runAll(T, [async () => (mapChecks(), tableChecks()), srvRuns], 150_000);
