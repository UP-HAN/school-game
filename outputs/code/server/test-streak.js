// 꿈 구슬·퀴즈 수첩·연속 정답 자동 시험 (06 명세 15절 22~28번). 실행: npm test
// 시험용 짧은 판: 게임 "1분" = 6초 → 5분 판 = 30초. 보급은 15초(50%)에 큰 체육관 고깔 한 곳에만.
import { ENERGY, STREAK } from '../shared/config.js';
import { makeChecker, startServer, setup, startGame, endGame, split, walk, route, sleep, openQuiz, answer, SPAWN, runAll } from './testkit.js';

const T = makeChecker('꿈 구슬·수첩·연속 정답');
const { check } = T;
const OVERRIDES = {
  minuteMs: 6000,
  fog: { stages: [{ at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] },
  loot: { dropsAt: [0.5] },
  lootFurniture: [9, 12],
  chase: { graceMs: 500, cooldownMs: 300 },
  mafia: { freezeGraceMs: 500, freezeCooldownMs: 300 },
  energy: { chaserLanternCooldownMs: 3000 },
};
// 수첩 퀴즈 하나: 열고 맞히거나(right) 틀린다. 결과 메시지
async function nb(c, right) {
  const q = await openQuiz(c, 'notebook');
  if (q.t === 'error') return q;
  return answer(c, q, right);
}
// 수첩으로 n 개를 연속 첫 시도 정답
async function nbRun(c, n) {
  for (let i = 0; i < n; i++) {
    const r = await nb(c, true);
    if (!r.ok) return false;
  }
  await sleep(100);
  return true;
}

async function runS(port) {
  const { teacher, P } = await setup(port, ['가람', '나래', '다온', '라온', '마루'], { minutes: 5 });
  const v = await startGame(teacher, P);
  const { C: [C], S: [S1, S2, S3, S4] } = split(v, P);
  const cMe = await C.next((m) => m.t === 'me');
  check('22. 잠귀신 시작 꿈 구슬 3 · 최대 5, 학생은 0', cMe.energy === 3 && cMe.energyMax === 5 && S1.meMsg.energy === 0 && S1.meMsg.energyMax === 0);
  await sleep(Math.max(0, v.startedAt + 600 - Date.now()));
  C.clear();
  C.send({ t: 'tag' }); // 둘레에 아무도 없음 (모두 반지름 130 둘레)
  const miss = await C.next((m) => m.t === 'me');
  check('22. 헛손질은 구슬을 쓰지 않는다', miss.energy === 3 && miss.tagMs <= 800);

  // S3 는 깨어 있는 채로 수첩 연속 2개, 세 번째 수첩을 열어 둔 채 꿈에 빠진다
  check('25. 수첩은 랜턴이 없는 곳에서도 열린다', await nbRun(S3, 2));
  check('26. 첫 시도 정답마다 연속 +1', S3.meMsg.streak === 2);
  const q3 = await openQuiz(S3, 'notebook');
  S3.send({ t: 'pos', x: S3.x + 10, y: S3.y, f: 1, m: 1 });
  check('8-2. 수첩을 여는 동안은 움직일 수 없다', q3.t === 'question' && q3.source === 'notebook' && (await S3.next((m) => m.t === 'fix', 1500).then(() => true, () => false)));
  // 모두 가운데로: C(1400,960) 둘레 83 안에 S1·S2·S3, S4 는 멀리
  await Promise.all([route(S1, [[1400, 920]]), route(S2, [[1440, 960]]), route(S4, [[1400, 1200]]), route(C, [SPAWN, [1400, 960]])]);
  // S3 은 수첩 때문에 못 움직이므로 C 가 S3 쪽으로 간다 → 먼저 S1·S2 를 재운 뒤
  for (const c of [teacher, ...P]) c.clear();
  C.send({ t: 'tag' });
  await teacher.event('tag', 2000);
  await sleep(400);
  C.send({ t: 'tag' });
  await teacher.event('tag', 2000);
  await sleep(150);
  const e1 = C.meMsg.energy;
  await route(C, [[S3.x, S3.y + 40]]);
  await sleep(250);
  C.send({ t: 'tag' });
  const tagS3 = await teacher.event('tag', 2000);
  const closed = await S3.next((m) => m.t === 'closeq', 1500).then(() => true, () => false);
  await sleep(200);
  check('22. 꿈을 걸 때마다 구슬 −1', e1 === 1 && C.meMsg.energy === 0 && tagS3.id === S3.id);
  check('26. 수첩을 열어 둔 채 꿈에 빠지면 연속 정답이 0', closed && S3.meMsg.streak === 0);
  await sleep(400);
  C.clear();
  await route(C, [[S4.x, S4.y - 40]]);
  C.send({ t: 'tag' });
  check('22. 구슬이 0 이면 꿈을 걸 수 없다 (no_energy)', (await C.error()) === 'no_energy' && !teacher.see(S4).frozen);

  // 25·26·27: S1(꿈에 빠짐)이 수첩으로 연속 정답 — 상자가 아직 없으므로 힌트는 모아 둔다
  check('25. 꿈에 빠진 학생도 수첩을 쓸 수 있다', teacher.see(S1).frozen && (await nbRun(S1, 2)));
  for (const c of P) c.clear();
  await nbRun(S1, 1);
  const st3 = await S1.event('streak', 1500);
  check('27. 연속 3 에 상자가 없으면 방 힌트를 모아 둔다', st3.n === 3 && st3.reward === 'room' && st3.banked === true && S1.meMsg.hintBank === 1 && S1.meMsg.hint === null);
  await nbRun(S1, 2);
  const st5 = await S1.next((m) => m.t === 'event' && m.kind === 'streak' && m.n === 5, 1500);
  check('27. 연속 5 의 가구 힌트도 모아 두되 1개까지 (가구 힌트가 남는다)', st5.reward === 'exact' && st5.banked === true && S1.meMsg.hintBank === 1);
  const before = teacher.room.progress.solved;
  const wq = await openQuiz(S1, 'notebook');
  const wr = await answer(S1, wq, false);
  await sleep(150);
  check('25. 수첩 오답 잠금 3초', wr.lockMs === STREAK.notebookWrongLockMs && wr.lockMs === 3000);
  check('26. 오답이면 연속 정답이 0', S1.meMsg.streak === 0);
  await sleep(3050);
  await answer(S1, wq, true);
  await sleep(150);
  check('26. 다시 도전해 맞히면 연속 정답은 오르지 않는다', S1.meMsg.streak === 0);
  await nbRun(S1, 1);
  await openQuiz(S1, 'notebook');
  S1.send({ t: 'closeq' });
  await sleep(150);
  check('26. 못 풀고 닫으면 연속 정답이 0', S1.meMsg.streak === 0);
  check('25. 수첩은 새벽빛을 올리지 않는다', teacher.room.progress.solved === before && before === 0 && S1.meMsg.solved === 0);

  // 22·23. 잠귀신의 수첩 +1, 랜턴 +2 (새벽빛 그대로), 같은 랜턴은 시험값 3초 뒤 다시
  const r1 = await nb(C, true);
  await sleep(150);
  check('22. 잠귀신 수첩 정답 +1', r1.ok && C.meMsg.energy === 1);
  await route(C, [[1400, 1100], [1780, 1100], [1780, 1200]]);
  C.clear();
  const ql = await openQuiz(C, 't8');
  const rl = await answer(C, ql, true);
  await sleep(150);
  check('22. 잠귀신 랜턴 정답 +2', ql.t === 'question' && rl.ok && C.meMsg.energy === 3);
  check('23. 잠귀신 랜턴 정답은 새벽빛을 올리지 않는다', teacher.room.progress.solved === 0 && teacher.see(C).solved === 1);
  const again = await openQuiz(C, 't8');
  check('23. 같은 랜턴은 바로 다시 못 연다 (lantern_cooldown)', again.t === 'error' && again.code === 'lantern_cooldown');
  await nb(C, true);
  await sleep(3000);
  const ql2 = await openQuiz(C, 't8');
  const rl2 = await answer(C, ql2, true);
  await sleep(150);
  check('23. 시간(시험값 3초)이 지나면 같은 랜턴을 다시 켤 수 있다', ql2.t === 'question' && rl2.ok);
  check('22. 꿈 구슬은 최대 5', C.meMsg.energy === 5 && ENERGY['sleep-tag'].max === 5);

  // 27. 보급(15초)이 오면 모아 둔 힌트가 바로 온다
  await teacher.event('drop', Math.max(1000, v.startedAt + 16000 - Date.now()));
  const hinted = await S1.next((m) => m.t === 'me' && m.hint, 2000).catch(() => null);
  check('27. 모아 둔 힌트는 다음 보급 때 온다 (가구 힌트)', !!hinted && hinted.hint.exact === true && hinted.hint.room === '큰 체육관' && hinted.hintBank === 0 && hinted.hint.msLeft > 15000);
  // 26. 상자가 있을 때: 3 → 방 힌트, 5 → 가구 힌트, 10 → 다시
  for (const c of [teacher, ...P]) c.clear();
  await nbRun(S2, 3);
  const h3 = await S2.event('streak', 1500).then(() => S2.meMsg);
  check('26. 연속 3 → 가장 가까운 상자의 방 이름 힌트 (10초)', h3.hint && h3.hint.exact === false && h3.hint.room === '큰 체육관' && h3.hint.msLeft <= 10000 && h3.hint.msLeft > 9000);
  await nbRun(S2, 2);
  const h5 = S2.meMsg;
  check('26. 연속 5 → 가구 자리 힌트 (20초)', h5.streak === 5 && h5.hint.exact === true && Number.isFinite(h5.hint.x) && h5.hint.msLeft > 19000);
  await nbRun(S2, 5);
  const ev10 = S2.inbox.filter((m) => m.t === 'event' && m.kind === 'streak');
  check('26. 연속 10 → 가구 힌트를 다시', S2.meMsg.streak === 10 && ev10.some((e) => e.n === 10 && e.reward === 'exact') && ev10.filter((e) => e.reward).length === 3);
  // S2 만 연속 6 이상이 된다 → 다른 사람에게 n≥6 알림이 가면 새어 나간 것. 선생님·깨어 있는 S4 는 힌트를 받은 적이 없다
  const others = [teacher, S1, S3, S4, C].flatMap((c) => c.raw.map((x) => JSON.parse(x)));
  const leaked = others.some((m) => m.t === 'event' && m.kind === 'streak' && m.n >= 6) || [teacher, S4].some((c) => c.raw.some((x) => x.includes('"hint":{')));
  check('26. 힌트·연속 정답 알림은 본인 외 누구에게도 가지 않는다', !leaked);

  // 28. 기록 출처
  teacher.send({ t: 'report' });
  const rep = await teacher.type('report');
  S1.send({ t: 'myreport' });
  const mine = await S1.type('myreport');
  check('28. 퀴즈 리포트 기록에 source 가 붙는다 (수첩·랜턴)', rep.records.some((r) => r.source === 'notebook') && rep.records.some((r) => r.source === 'lantern' && r.role === 'chaser') && rep.records.every((r) => r.source === 'notebook' || r.source === 'lantern'));
  check('28. 내 퀴즈 노트에도 source 가 있다', mine.records.length > 0 && mine.records.every((r) => r.source === 'notebook'));
  // 끝 화면: 잠귀신이 맞힌 수
  const over = await teacher.next((m) => m.t === 'room' && m.over, 20000);
  const cs = over.over.chaserSolved;
  check('8-1. 끝나면 room.over.chaserSolved 에 잠귀신별 맞힌 랜턴 수', Array.isArray(cs) && cs.length === 1 && cs[0].id === C.id && cs[0].solved === 2, JSON.stringify(cs));
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

// 24. 꿈도둑을 찾아라: 시작 1 · 최대 2 · 정답 +1, 25. 수첩 꺼짐
async function runM(port) {
  const { teacher, P } = await setup(port, ['하나', '두리', '세찬', '네오'], { mode: 'mafia', minutes: 5, notebook: false });
  teacher.send({ t: 'pickChasers', ids: [P[0].id] });
  await teacher.type('picked');
  const v = await startGame(teacher, P);
  const [M, S1] = P;
  const mMe = await M.next((m) => m.t === 'me');
  check('24. 꿈도둑 시작 구슬 1 · 최대 2', mMe.energy === 1 && mMe.energyMax === 2);
  M.clear();
  M.send({ t: 'open', terminal: 'notebook' });
  check('25. 수첩 꺼짐이면 거부 (notebook_off)', (await M.error()) === 'notebook_off');
  await route(M, [SPAWN, [1780, 1100], [1780, 1200]]);
  const q = await openQuiz(M, 't8');
  await answer(M, q, true);
  await sleep(150);
  check('24. 꿈도둑 랜턴 정답 +1 (새벽빛은 그대로)', M.meMsg.energy === 2 && teacher.room.progress.solved === 0);
  await route(S1, [SPAWN, [1780, 1100], [1780, 1160]]);
  M.send({ t: 'tag' });
  await teacher.event('freeze', 2000);
  await sleep(150);
  check('24. 꿈도둑이 꿈을 걸면 구슬 −1', M.meMsg.energy === 1 && teacher.see(S1).ghost === true);
  await endGame(teacher, P);
  for (const c of [teacher, ...P]) c.ws.close();
}

runAll(T, [
  async () => {
    const srv = await startServer(3985, OVERRIDES);
    try {
      for (const run of [runS, runM]) {
        try {
          await run(srv.port);
        } catch (e) {
          T.failed++;
          console.log('실패  시험 도중 오류 →', e.stack || e.message);
        }
      }
    } finally {
      await srv.stop();
    }
  },
], 150_000);
