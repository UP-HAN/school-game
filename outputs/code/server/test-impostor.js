// 방해꾼 찾기 자동 시험 (05 명세 8절 28항목). 실행: npm test (test-lobby.js 다음에 돈다)
// 서버를 임시 포트에 켜고, 시험용으로 시간 규칙을 줄인다 (환경변수 TEST_OVERRIDES).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { chaserCount, maxChasers, IMPOSTOR } from '../shared/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = crypto.randomBytes(9).toString('base64url'); // 시험용 임시 비밀번호 (매번 새로 만듦)
const SPAWN = [1400, 920]; // 몬스터 체육관 시작 자리 = 긴급회의 버튼

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '통과' : '실패'}  ${name}${ok || !detail ? '' : '  → ' + detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= d;

// ───────── 서버 켜기 ─────────
function startServer(port, overrides) {
  const proc = spawn(process.execPath, [path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), TEACHER_PASSWORD: PASSWORD, TEST_OVERRIDES: JSON.stringify(overrides) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (log.includes('켜졌어요')) {
        clearInterval(timer);
        resolve({ port, log: () => log, stop: () => new Promise((r) => (proc.once('exit', r), proc.kill())) });
      }
    }, 50);
  });
}

// ───────── 가짜 화면 ─────────
function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, raw: [], inbox: [], waiters: [], room: null, state: null, me: null, x: 0, y: 0, fixes: 0 };
  ws.on('message', (data) => {
    const text = data.toString();
    const m = JSON.parse(text);
    if (m.t !== 'state') c.raw.push(text);
    if (m.t === 'room') c.room = m;
    if (m.t === 'state') c.state = m;
    if (m.t === 'me') c.meMsg = m;
    if (m.t === 'fix') (c.fixes++, (c.x = m.x), (c.y = m.y));
    const i = c.waiters.findIndex((w) => w.test(m));
    if (i >= 0) c.waiters.splice(i, 1)[0].resolve(m);
    else if (m.t !== 'state') c.inbox.push(m);
  });
  Object.assign(c, {
    open: () => new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej))),
    send: (m) => ws.send(JSON.stringify(m)),
    // 받은 것 중에서 먼저 찾고, 없으면 올 때까지 기다린다
    next(test, ms = 3000) {
      const i = c.inbox.findIndex(test);
      if (i >= 0) return Promise.resolve(c.inbox.splice(i, 1)[0]);
      return c.wait(test, ms);
    },
    // 앞으로 올 메시지만 기다린다
    wait(test, ms = 3000) {
      return new Promise((resolve, reject) => {
        const w = { test, resolve };
        c.waiters.push(w);
        setTimeout(() => {
          const k = c.waiters.indexOf(w);
          if (k >= 0) (c.waiters.splice(k, 1), reject(new Error('시간 초과')));
        }, ms);
      });
    },
    type: (t, ms) => c.next((m) => m.t === t, ms),
    error: (ms = 2000) => c.next((m) => m.t === 'error', ms).then((m) => m.code, () => 'none'),
    clear: () => (c.inbox.length = 0),
    close: () => new Promise((res) => (ws.once('close', res), ws.close())),
    // 지금 받은 방 정보에서 사람 찾기
    see: (who) => c.room && c.room.players.find((p) => p.id === (who.id || who)),
    sync() {
      const p = c.see(c.id);
      c.x = p.x;
      c.y = p.y;
    },
  });
  return c;
}
async function teacherOf(port) {
  const t = client(port);
  await t.open();
  t.send({ t: 'create', password: PASSWORD });
  const created = await t.type('created');
  await t.type('room');
  t.code = created.code;
  return t;
}
async function joinAs(port, code, name) {
  const c = client(port);
  await c.open();
  c.send({ t: 'join', code, name });
  const j = await c.type('joined');
  c.id = j.id;
  c.name = name;
  return c;
}
const step = (d) => Math.max(-20, Math.min(20, d));
// 20px씩 걸어간다. 서버가 되돌리면(fix) false
async function walk(c, tx, ty) {
  const f0 = c.fixes;
  while (c.x !== tx || c.y !== ty) {
    c.x += step(tx - c.x);
    c.y += step(ty - c.y);
    c.send({ t: 'pos', x: c.x, y: c.y, f: 1, m: 1 });
    await sleep(70);
    if (c.fixes !== f0) return false;
  }
  await sleep(80);
  return c.fixes === f0;
}
async function route(c, points) {
  for (const [x, y] of points) if (!(await walk(c, x, y))) return false;
  return true;
}
const QSET = {
  title: '방해꾼 시험 세트',
  questions: [
    { q: '1 더하기 1은?', a: '2', wrong: ['1', '3', '4'] },
    { q: '4 빼기 2는?', a: '2' },
  ],
};
// 단말기에서 문제를 열고 바로 맞힌다
async function solve(c, terminal) {
  c.send({ t: 'open', terminal });
  const q = await c.next((m) => m.t === 'question' || m.t === 'error');
  if (q.t === 'error') return q.code;
  c.send({ t: 'answer', value: q.kind === 'short' ? '2' : q.choices.indexOf('2') });
  const r = await c.next((m) => m.t === 'result');
  return r.ok ? 'ok' : 'wrong';
}
async function startGame(teacher, players) {
  for (const c of [teacher, ...players]) c.clear();
  teacher.send({ t: 'start' });
  const v = await teacher.next((m) => (m.t === 'room' && m.phase === 'game') || m.t === 'error');
  if (v.t === 'error') return v;
  await Promise.all(players.map((c) => c.next((m) => m.t === 'room' && m.phase === 'game')));
  await sleep(100);
  for (const c of players) c.sync();
  return v;
}
async function endGame(teacher, players) {
  teacher.send({ t: 'end' });
  await teacher.next((m) => m.t === 'room' && m.phase === 'lobby');
  await sleep(100);
  for (const c of [teacher, ...players]) c.clear();
}
const roleOf = (v, c) => v.players.find((p) => p.id === c.id).role;
const lastMeeting = (c) => c.room && c.room.meeting;
// 지금 받은 방 정보가 이미 그 단계면 그것을, 아니면 앞으로 올 것을 기다린다
const waitStage = (c, stage, ms = 6000) =>
  c.room && c.room.meeting && c.room.meeting.stage === stage ? Promise.resolve(c.room) : c.wait((m) => m.t === 'room' && m.meeting && m.meeting.stage === stage, ms);
const waitNoMeeting = (c, ms = 8000) => c.wait((m) => m.t === 'room' && !m.meeting, ms);

// ════════════ 서버 A: 역할·정체 숨기기·얼리기·방해·회의·투표·복구 ════════════
async function runA() {
  const srv = await startServer(3978, {
    impostor: {
      freezeGraceMs: 1500,
      freezeCooldownMs: 2500,
      freezeAfterMeetingMs: 1500,
      sabotageGraceMs: 1500,
      blackoutMs: 1500,
      blackoutCooldownMs: 6000,
      lockMs: 2000,
      lockCooldownMs: 6000,
      disguiseMs: 1000,
      buttonGraceMs: 1500,
      meetingIntroMs: 200,
      discussMs: 3000,
      voteMs: 4000,
      resultMs: 300,
      extendMs: 500,
    },
  });
  const port = srv.port;
  try {
    const teacher = await teacherOf(port);
    const code = teacher.code;
    check('긴급회의 횟수 기본 3회, 정체 공개 기본 켜기', teacher.room.settings.meetings === 3 && teacher.room.settings.reveal === true);
    teacher.send({ t: 'questions', set: QSET });
    await teacher.next((m) => m.t === 'room' && m.qset);
    teacher.send({ t: 'settings', mode: 'impostor', missions: 3, meetings: 9, reveal: 'yes' });
    let v = await teacher.next((m) => m.t === 'room' && m.settings.mode === 'impostor');
    check('긴급회의 횟수·정체 공개는 정해진 값만 받는다', v.settings.meetings === 3 && v.settings.reveal === true);

    const names = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아라'];
    let P = [];
    for (const n of names) P.push(await joinAs(port, code, n));

    // ── 2. 인원별 방해꾼 수 ──
    v = await startGame(teacher, P);
    check('1. 방해꾼 찾기 모드로 시작이 된다 (mode_not_ready 없음)', v.t === 'room' && v.phase === 'game');
    let ch = P.filter((c) => roleOf(v, c) === 'chaser');
    check('2. 8명이면 방해꾼 2명', ch.length === 2);
    // ── 4. 정체 숨기기 ──
    const [ca, cb] = ch;
    const st = P.find((c) => roleOf(v, c) === 'student');
    const other = P.find((c) => c !== st && c !== ca && c !== cb);
    const meA = await ca.next((m) => m.t === 'me');
    check('4. 방해꾼은 동료의 역할을 받는다 (me.mates · room)', meA.mates.length === 1 && meA.mates[0] === cb.id && ca.see(cb).role === 'chaser' && ca.see(other).role === undefined);
    check('4. 학생이 받는 room 에 다른 사람의 role·solved 가 없다', P.every((c) => c === st || (st.see(c).role === undefined && st.see(c).solved === undefined)) && st.see(st).role === 'student');
    check('4. 선생님은 모든 역할·진행 수를 받는다', v.players.every((p) => (p.role === 'student' || p.role === 'chaser') && Number.isFinite(p.solved)));
    const stMe = await st.next((m) => m.t === 'me');
    check('4. 학생의 me 에는 동료 목록이 없다', stMe.mates === undefined && stMe.ghost === false && stMe.freezeMs !== undefined);
    await endGame(teacher, P);

    // 6명 + 선생님이 3명으로 정해도 2명으로 줄어든다
    for (const c of P.splice(6)) (c.send({ t: 'leave' }), await c.type('left'));
    teacher.send({ t: 'settings', chasers: 3 });
    await teacher.next((m) => m.t === 'room' && m.settings.chasers === 3 && m.players.length === 6);
    v = await startGame(teacher, P);
    check('2. 선생님이 3명으로 정해도 6명이면 2명', v.players.filter((p) => p.role === 'chaser').length === 2 && chaserCount({ mode: 'impostor', chasers: 3 }, 6) === 2 && maxChasers('impostor', 4) === 1);
    await endGame(teacher, P);
    teacher.send({ t: 'settings', chasers: 'auto' });

    // ── 3. 선생님 지정 ──
    teacher.send({ t: 'pickChasers', ids: [P[0].id, P[1].id, P[2].id] });
    let picked = await teacher.type('picked');
    check('3. 선생님은 고른 목록을 돌려받는다', picked.ids.length === 3);
    teacher.send({ t: 'start' });
    check('3. 인원보다 너무 많이 고르면 시작을 막는다', (await teacher.error()) === 'too_many_chasers');
    P[3].send({ t: 'pickChasers', ids: [P[3].id] }); // 학생이 보내면 무시
    P.push(await joinAs(port, code, '바다2'));
    teacher.send({ t: 'pickChasers', ids: [P[0].id, P[1].id, 'no-such'] });
    picked = await teacher.next((m) => m.t === 'picked' && m.ids.length === 2);
    teacher.send({ t: 'settings', meetings: 2, missions: 3, reveal: true });
    await teacher.next((m) => m.t === 'room' && m.settings.meetings === 2);

    // ════ G1: 7명 (C1·C2 방해꾼, S1~S5 학생) ════
    const [C1, C2, S1, S2, S3, S4, S5] = P;
    v = await startGame(teacher, P);
    const startAt = Date.now();
    check('3. 지정한 학생만 방해꾼이 된다', roleOf(v, C1) === 'chaser' && roleOf(v, C2) === 'chaser' && v.players.filter((p) => p.role === 'chaser').length === 2);

    // 6. 얼리기: 시작 직후에는 안 됨, 학생의 tag 는 아무 일 없음
    for (const c of P) c.clear();
    C1.send({ t: 'tag' });
    S1.send({ t: 'tag' });
    C1.send({ t: 'sabotage', kind: 'blackout' });
    check('11. 시작 직후에는 방해를 못 쓴다', (await C1.error()) === 'too_early');
    await sleep(200);
    check('6. 시작 뒤 대기 시간 전에는 얼리지 못하고, 학생의 tag 는 아무 일 없다', teacher.room.players.every((p) => !p.ghost));

    // 자리 잡기: S1·S2 는 큰 체육관 단말기 t8 옆으로, C1 은 가운데, C2 는 C1 옆
    await Promise.all([
      route(S1, [SPAWN, [1780, 1200]]),
      route(S2, [SPAWN, [1780, 1160]]),
      walk(C1, ...SPAWN),
      walk(C2, 1440, 920),
    ]);
    await sleep(Math.max(0, startAt + 1700 - Date.now()));
    C1.clear();
    C1.send({ t: 'tag' }); // 둘레 100 안에는 방해꾼 C2 뿐, 학생은 모두 130 밖
    let miss = await C1.type('me');
    check('6. 거리 100 밖은 못 얼리고, 방해꾼은 얼려지지 않는다 (헛손질)', miss.freezeMs > 0 && miss.freezeMs <= 800 && teacher.room.players.every((p) => !p.ghost));

    // S1 이 문제를 열어 둔 채로 얼려진다
    S1.send({ t: 'open', terminal: 't8' });
    await S1.type('question');
    await route(C1, [[1740, 1200]]);
    await sleep(900);
    for (const c of [teacher, ...P]) c.clear();
    const frozeAt = Date.now();
    C1.send({ t: 'tag' });
    const frEv = await C2.next((m) => m.t === 'event' && m.kind === 'freeze');
    const s1Closed = await S1.next((m) => m.t === 'closeq').then(() => true, () => false);
    const s1Me = await S1.next((m) => m.t === 'me' && m.ghost === true).catch(() => null);
    await sleep(250);
    check('7. 얼려지면 ghost·얼음 흔적, 열린 문제 창이 닫힌다', frEv.id === S1.id && s1Closed && !!s1Me && teacher.see(S1).ghost === true && teacher.room.marks.some((k) => k.id === S1.id));
    const s2Ev = S2.raw.some((t) => t.includes('"freeze"'));
    check('7. 다른 살아 있는 학생은 freeze 를 받지 않고 그 사람의 ghost 도 모른다', !s2Ev && S2.see(S1).ghost === undefined && S2.see(S1).x === undefined);
    await sleep(200);
    check('8. 살아 있는 학생의 state 에 유령 위치가 없다', !S2.state.p.some((r) => r[0] === S1.id) && S2.state.p.length === 6);
    check('8. 유령·방해꾼·선생님은 모두의 위치를 받는다', S1.state.p.length === 7 && C2.state.p.length === 7 && teacher.state.p.length === 7);
    // 6. 쿨타임: 바로 다시 얼리기 → S2(57 거리)도 안 얼려진다
    C1.send({ t: 'tag' });
    await sleep(300);
    check('6. 얼린 직후에는 쿨타임 동안 다시 못 얼린다', !teacher.see(S2).ghost && C1.meMsg.freezeMs > 1500);

    // 9. 유령 학생이 문제를 맞히면 복구율이 오른다
    const before = teacher.room.progress.solved;
    check('9. 유령 학생이 문제를 맞힌다', (await solve(S1, 't8')) === 'ok');
    await sleep(200);
    check('9. 유령이 맞혀도 복구율이 오른다', teacher.room.progress.solved === before + 1);
    // 10. 방해꾼 가짜 미션
    check('10. 방해꾼도 단말기 문제를 푼다', (await solve(C1, 't8')) === 'ok');
    await sleep(200);
    teacher.send({ t: 'report' });
    const rep = await teacher.type('report');
    const lastRec = rep.records[rep.records.length - 1];
    check('10. 방해꾼이 맞히면 본인 solved 는 오르고 복구율은 그대로, 기록에 role chaser', C1.meMsg.solved === 1 && teacher.room.progress.solved === before + 1 && lastRec.role === 'chaser' && rep.records.some((r) => r.ghost === true && r.role === 'student'));
    check('10. 다른 학생은 방해꾼의 진행 수를 모른다', S2.see(C1).solved === undefined);

    // 6. 유령은 얼려지지 않는다 (S2 는 비켜 준다)
    await route(S2, [[1780, 1000]]);
    await sleep(Math.max(0, frozeAt + 2700 - Date.now()));
    C1.clear();
    C1.send({ t: 'tag' });
    miss = await C1.type('me');
    check('6. 유령은 다시 얼리지 못한다 (헛손질)', miss.freezeMs <= 800 && !teacher.see(S2).ghost);

    // ── 11. 정전 ──
    for (const c of [teacher, ...P]) c.clear();
    C1.send({ t: 'sabotage', kind: 'blackout' });
    const bo = await S3.next((m) => m.t === 'event' && m.kind === 'blackout');
    await sleep(150);
    check('11. 정전: 모두에게 이벤트·blackoutMs, 쓴 사람 id 는 없다', !JSON.stringify(bo).includes(C1.id) && bo.by === undefined && S3.room.sabo.blackoutMs > 0 && teacher.room.sabo.blackoutMs > 0);
    C2.send({ t: 'sabotage', kind: 'blackout' });
    check('11. 정전 쿨타임은 방해꾼 팀이 같이 쓴다', (await C2.error()) === 'sabo_cooldown' && C2.meMsg.saboMs.blackout > 4000);
    await sleep(1600);
    check('11. 정전은 시간이 지나면 풀린다', teacher.room.sabo.blackoutMs === 0);

    // ── 13. 위장 ──
    const realColor = teacher.see(C2).color;
    const studentColors = [S2, S3, S4, S5].map((c) => teacher.see(c).color);
    C2.send({ t: 'sabotage', kind: 'disguise' });
    await sleep(200);
    const look = S3.see(C2);
    check('13. 위장: 다른 학생이 받는 그 방해꾼의 색이 살아 있는 학생 중 하나로 바뀐다', look.color !== realColor && studentColors.includes(look.color) && look.disguise === undefined);
    check('13. 선생님·방해꾼은 진짜 모습 + 위장 정보를 받는다', teacher.see(C2).color === realColor && !!teacher.see(C2).disguise && C1.see(C2).color === realColor && !!C1.see(C2).disguise);
    C2.send({ t: 'sabotage', kind: 'disguise' });
    check('13. 위장 중에는 다시 위장할 수 없다', (await C2.error()) === 'already_disguised');
    await sleep(1100);
    check('13. 위장은 시간이 지나면 돌아온다', S3.see(C2).color === realColor);
    C2.send({ t: 'sabotage', kind: 'disguise' });
    await sleep(1200);
    C2.send({ t: 'sabotage', kind: 'disguise' });
    check('13. 3번째 위장은 거부', (await C2.error()) === 'no_disguise' && C2.meMsg.disguiseLeft === 0);

    // ── 12. 문 잠금 (무대 문 d-stage: 1360,500 80×40) ──
    C2.send({ t: 'sabotage', kind: 'lock' });
    check('12. 300 안에 잠글 문이 없으면 거부', (await C2.error()) === 'no_door');
    await sleep(150);
    check('12. 그때는 쿨타임을 쓰지 않는다', C2.meMsg.saboMs.lock === 0);
    await Promise.all([route(S3, [SPAWN, [1400, 520]]), route(S4, [SPAWN, [1400, 600]]), route(C2, [[1400, 880], [1400, 700]])]);
    for (const c of [teacher, ...P]) c.clear();
    C2.send({ t: 'sabotage', kind: 'lock' });
    const lockEv = await S5.next((m) => m.t === 'event' && m.kind === 'lock');
    await sleep(150);
    check('12. 가장 가까운 잠글 수 있는 문이 잠긴다', lockEv.door === 'd-stage' && teacher.room.sabo.lockedDoor === 'd-stage' && !JSON.stringify(lockEv).includes(C2.id));
    check('12. 문 칸 안에 있던 사람은 빠져나올 수 있다', await walk(S3, 1400, 560));
    check('12. 잠긴 문을 지나가려는 pos 는 되돌린다', !(await walk(S4, 1400, 520)) && S4.y > 540);
    await sleep(2100);
    check('12. 잠금은 시간이 지나면 풀린다', teacher.room.sabo.lockedDoor === null && (await walk(S4, 1400, 520)));

    // ── 14. 신고 ──
    await route(S2, [[1780, 1160]]);
    S2.send({ t: 'open', terminal: 't8' });
    await S2.type('question');
    teacher.send({ t: 'report' });
    const recBefore = (await teacher.type('report')).records.length;
    S1.send({ t: 'alarm', mark: S1.id });
    check('14. 유령은 신고할 수 없다', (await S1.error()) === 'ghost');
    C2.send({ t: 'alarm', mark: S1.id });
    check('14. 얼음 흔적에서 110 밖이면 신고할 수 없다', (await C2.error()) === 'too_far');
    const timeBefore = teacher.room.timeLeft;
    for (const c of [teacher, ...P]) c.clear();
    C1.send({ t: 'alarm', mark: S1.id }); // 방해꾼도 신고할 수 있다
    const mEv = await S3.next((m) => m.t === 'event' && m.kind === 'meeting');
    let mv = await teacher.next((m) => m.t === 'room' && m.meeting);
    const paused1 = mv.timeLeft;
    check('14. 방해꾼도 신고할 수 있고, 회의가 열리고 흔적이 사라진다', mEv.reason === 'report' && mEv.found === S1.id && mv.meeting.reporter === C1.id && mv.marks.length === 0);
    const s2Closeq = await S2.next((m) => m.t === 'closeq').then(() => true, () => false);

    // ── 25. 회의 중 도중 입장 ──
    const L = await joinAs(port, code, '늦은이');
    const lMe = await L.type('me');
    await sleep(150);
    check('25. 도중 입장: 학생·살아 있음, 그 회의에서는 투표 불가', lMe.role === 'student' && lMe.ghost === false && L.room.meeting.canVote === false);

    // ── 16. 회의 중 ──
    S3.clear();
    S3.send({ t: 'pos', x: S3.x, y: S3.y + 10, f: 1, m: 1 });
    const s3fix = await S3.type('fix').then(() => true, () => false);
    S4.send({ t: 'open', terminal: 't1' });
    C1.send({ t: 'tag' });
    C1.send({ t: 'sabotage', kind: 'blackout' });
    await sleep(400);
    const tl1 = teacher.room.timeLeft;
    await sleep(500);
    const tl2 = teacher.room.timeLeft;
    teacher.send({ t: 'report' });
    const recDuring = (await teacher.type('report')).records.length;
    check('16. 회의 중: 시계가 멈춘다', tl1 === tl2 && tl1 === paused1 && paused1 <= timeBefore, JSON.stringify({ tl1, tl2, paused1, timeBefore }));
    check('16. 회의 중: pos 는 되돌리고 open·tag·sabotage 는 무시', s3fix && !S4.inbox.some((m) => m.t === 'question') && !C1.inbox.some((m) => m.t === 'error') && teacher.room.players.filter((p) => p.ghost).length === 1);
    check('16. 회의 중: 열린 문제는 기록 없이 닫힌다', s2Closeq && recDuring === recBefore);

    // ── 28. 선생님 meetingCtl ──
    await waitStage(teacher, 'discuss');
    S2.send({ t: 'meetingCtl', action: 'vote' }); // 학생이 보내면 무시
    S2.send({ t: 'meetingCtl', action: 'extend' });
    await sleep(200);
    check('28. 학생이 보낸 meetingCtl 은 무시', teacher.room.meeting.stage === 'discuss' && teacher.room.meeting.extended === 0);
    teacher.send({ t: 'meetingCtl', action: 'extend' });
    const ext1 = (await teacher.wait((m) => m.t === 'room')).meeting;
    teacher.send({ t: 'meetingCtl', action: 'extend' });
    const ext2 = (await teacher.wait((m) => m.t === 'room')).meeting;
    teacher.send({ t: 'meetingCtl', action: 'extend' });
    await sleep(200);
    check('28. 토론 연장은 2번까지 (한 번에 시험값 0.5초씩)', ext1.extended === 1 && ext2.extended === 2 && ext2.msLeft > ext1.msLeft + 300 && teacher.room.meeting.extended === 2, JSON.stringify({ ext1, ext2 }));
    teacher.send({ t: 'meetingCtl', action: 'vote' });
    mv = await waitStage(teacher, 'vote', 2000);
    check('28. "바로 투표로" 가 동작한다', mv.meeting.stage === 'vote' && mv.meeting.msLeft > 3000);

    // ── 17·18. 투표 ──
    for (const c of P) c.clear();
    S1.send({ t: 'vote', target: C2.id });
    check('17. 유령은 투표할 수 없다', (await S1.error()) === 'cannot_vote');
    L.send({ t: 'vote', target: C2.id });
    check('17. 회의 중 도중 입장자는 투표할 수 없다', (await L.error()) === 'cannot_vote');
    S2.send({ t: 'vote', target: S2.id });
    check('17. 자기 자신에게는 투표할 수 없다', (await S2.error()) === 'bad_vote');
    S2.send({ t: 'vote', target: C2.id });
    await sleep(100);
    S2.send({ t: 'vote', target: S3.id });
    check('17. 두 번째 투표는 거부', (await S2.error()) === 'already_voted');
    S3.send({ t: 'vote', target: C2.id });
    S4.send({ t: 'vote', target: C2.id });
    C2.send({ t: 'vote', target: S2.id });
    C1.send({ t: 'vote', target: 'skip' });
    await sleep(200);
    check('18. 내 투표(myVote)는 나만 받고, 누가 투표했는지만 보인다', S3.room.meeting.myVote === C2.id && S4.room.meeting.myVote === C2.id && S5.room.meeting.myVote === undefined && S5.room.meeting.voted.length === 5);
    const tLast = Date.now();
    S5.send({ t: 'vote', target: 'skip' });
    mv = await waitStage(teacher, 'result', 2000);
    const res1 = mv.meeting.result;
    check('17. 모두 투표하면 투표 시간을 기다리지 않고 바로 결과', Date.now() - tLast < 1000);
    check('18. 단독 최다 + 건너뛰기보다 많음 → 제외', res1.ejected === C2.id && res1.tie === false && res1.counts[C2.id] === 3 && res1.counts[S2.id] === 1 && res1.counts.skip === 2, JSON.stringify(res1));
    check('19. 정체 공개 켜짐이면 결과에 role 이 있다', res1.role === 'chaser');
    const ejEv = await S3.next((m) => m.t === 'event' && m.kind === 'eject');
    check('18. 제외 이벤트가 모두에게 간다', ejEv.id === C2.id && ejEv.role === 'chaser');

    // ── 24. 회의 뒤 ──
    await waitNoMeeting(teacher);
    const endAt = Date.now();
    await sleep(200);
    const allBack = teacher.room.players.every((p) => near([p.x, p.y], SPAWN, 140));
    check('24. 회의가 끝나면 모두 시작 자리 둘레로', allBack && S3.fixes > 0);
    check('24. 회의 뒤 얼리기 쿨타임 (시험값 1.5초)', C1.meMsg.freezeMs > 1000 && C1.meMsg.freezeMs <= 1500);
    check('16. 회의 뒤 남은 시간이 회의 전과 같다', Math.abs(teacher.room.timeLeft - (paused1 - (Date.now() - endAt))) < 500);
    check('18. 제외된 사람은 모두에게 유령(제외됨)으로 보인다', S3.see(C2).ghost === true && S3.see(C2).ejected === true && S3.see(S1).ghost === true);
    for (const c of P) c.sync();
    L.sync();

    // ── 15. 긴급회의 ──
    const Q = [...P, L];
    for (const c of Q) c.clear();
    C1.send({ t: 'emergency' });
    check('15. 방해꾼은 긴급회의를 열 수 없다', (await C1.error()) === 'not_now');
    S2.send({ t: 'emergency' });
    check('15. 버튼 90 밖은 거부', (await S2.error()) === 'too_far');
    await walk(S2, ...SPAWN);
    S2.send({ t: 'emergency' });
    check('15. 회의가 끝난 뒤 대기 시간 안은 거부', (await S2.error()) === 'too_early');
    await sleep(Math.max(0, endAt + 1600 - Date.now()));
    S2.send({ t: 'emergency' });
    mv = await teacher.wait((m) => m.t === 'room' && m.meeting);
    check('15. 학생은 긴급회의를 연다 (연 사람은 보내지 않는다)', mv.meeting.reason === 'button' && mv.meeting.reporter === undefined && mv.meetingsLeft === 1, JSON.stringify(mv.meeting) + mv.meetingsLeft);
    // 동점 → 아무도 제외 안 됨
    await waitStage(teacher, 'discuss');
    teacher.send({ t: 'meetingCtl', action: 'vote' });
    await waitStage(teacher, 'vote');
    S3.send({ t: 'vote', target: S4.id });
    S4.send({ t: 'vote', target: S3.id });
    for (const c of [C1, S2, S5, L]) c.send({ t: 'vote', target: 'skip' });
    mv = await waitStage(teacher, 'result', 2000);
    check('18. 동점이면 아무도 제외되지 않는다', mv.meeting.result.ejected === null && mv.meeting.result.tie === true);
    await waitNoMeeting(teacher);
    let end2 = Date.now();
    await sleep(150);
    for (const c of Q) (c.sync(), c.clear());
    S2.send({ t: 'emergency' });
    check('15. 긴급회의는 1인 1회', (await S2.error()) === 'button_used');

    // 최다가 건너뛰기와 같으면 제외 없음
    await walk(S3, ...SPAWN);
    await sleep(Math.max(0, end2 + 1600 - Date.now()));
    S3.send({ t: 'emergency' });
    mv = await teacher.wait((m) => m.t === 'room' && m.meeting);
    await waitStage(teacher, 'discuss');
    teacher.send({ t: 'meetingCtl', action: 'vote' });
    await waitStage(teacher, 'vote');
    C1.send({ t: 'vote', target: S5.id });
    S2.send({ t: 'vote', target: 'skip' });
    mv = await waitStage(teacher, 'result', 6000);
    check('18. 최다 득표가 건너뛰기와 같으면 제외 없음', mv.meeting.result.ejected === null && mv.meeting.result.tie === false && mv.meeting.result.counts[S5.id] === 1 && mv.meeting.result.counts.skip === 1);
    await waitNoMeeting(teacher);
    end2 = Date.now();
    await sleep(150);
    for (const c of Q) (c.sync(), c.clear());
    await walk(S4, ...SPAWN);
    S4.send({ t: 'emergency' });
    check('15. 긴급회의 총 횟수를 넘으면 거부', (await S4.error()) === 'no_meetings' && teacher.room.meetingsLeft === 0);

    // ── 20. 마지막 방해꾼 제외 → 학생 승리 ──
    await walk(C1, ...SPAWN);
    await sleep(Math.max(0, end2 + 1600 - Date.now()));
    C1.send({ t: 'tag' });
    await sleep(250);
    check('7. 회의 뒤 다시 얼릴 수 있다', teacher.see(S4).ghost === true);
    await walk(S3, ...SPAWN);
    S3.send({ t: 'alarm', mark: S4.id });
    await waitStage(teacher, 'discuss');
    teacher.send({ t: 'meetingCtl', action: 'vote' });
    await waitStage(teacher, 'vote');
    for (const c of [S2, S3, S5, L]) c.send({ t: 'vote', target: C1.id });
    C1.send({ t: 'vote', target: 'skip' });
    v = await teacher.next((m) => m.t === 'room' && m.over, 5000);
    check('20. 마지막 방해꾼을 제외하면 학생 승리 all_found', v.over.winner === 'students' && v.over.reason === 'all_found');
    await sleep(150);
    const s2View = S2.room;
    check('27. 게임이 끝나면 모두가 모든 역할을 받는다', s2View.players.every((p) => p.role === 'student' || p.role === 'chaser') && S2.see(C1).role === 'chaser' && S2.see(C2).role === 'chaser');
    const allRaw = Q.flatMap((c) => c.raw);
    check('3. 학생 화면 어떤 메시지에도 지정 목록이 없다', !allRaw.some((t) => t.includes('"picked'))&& teacher.raw.some((t) => t.includes('"picked"')));
    check('18. 누가 누구를 찍었는지는 어떤 메시지에도 없다', ![...allRaw, ...teacher.raw].some((t) => t.includes('"votes"')));
    await endGame(teacher, Q);

    // ════ G2: 4명, 정체 공개 끄기, 복구율 100% ════
    for (const c of [S3, S4, S5, L]) (c.send({ t: 'leave' }), await c.type('left'));
    const G = [C1, C2, S1, S2];
    teacher.send({ t: 'pickChasers', ids: [] });
    await teacher.next((m) => m.t === 'picked' && m.ids.length === 0);
    teacher.send({ t: 'settings', reveal: false });
    await teacher.next((m) => m.t === 'room' && m.settings.reveal === false);
    v = await startGame(teacher, G);
    const g2Start = Date.now();
    const gc = G.filter((c) => roleOf(v, c) === 'chaser');
    check('2. 4명이면 방해꾼 1명', gc.length === 1);
    const [A, B, D] = G.filter((c) => roleOf(v, c) === 'student');
    await walk(D, ...SPAWN);
    await sleep(Math.max(0, g2Start + 1600 - Date.now()));
    D.send({ t: 'emergency' });
    await waitStage(teacher, 'discuss');
    teacher.send({ t: 'meetingCtl', action: 'vote' });
    await waitStage(teacher, 'vote');
    for (const c of [gc[0], A, B]) c.send({ t: 'vote', target: D.id });
    D.send({ t: 'vote', target: 'skip' });
    mv = await waitStage(teacher, 'result', 2000);
    const ej2 = await A.next((m) => m.t === 'event' && m.kind === 'eject');
    check('19. 정체 공개 꺼짐이면 결과·이벤트에 role 이 없다', mv.meeting.result.ejected === D.id && !('role' in mv.meeting.result) && !('role' in ej2));
    await waitNoMeeting(teacher);
    D.send({ t: 'leave' });
    await D.type('left');
    await sleep(150);
    for (const c of [A, B]) c.sync();
    check('21. (준비) 학생 2명 × 미션 3 = 목표 6', teacher.room.progress.goal === 6 && !teacher.room.over);
    const tour = async (c) => {
      const r = [];
      await route(c, [SPAWN, [1780, 1200]]);
      r.push(await solve(c, 't8'));
      await route(c, [SPAWN, [1400, 330]]);
      r.push(await solve(c, 't1'));
      await route(c, [SPAWN, [1890, 920], [2000, 920], [2000, 1060], [2500, 1060]]);
      r.push(await solve(c, 't6'));
      return r;
    };
    const tours = await Promise.all([tour(A), tour(B)]);
    v = await teacher.next((m) => m.t === 'room' && m.over, 3000).catch(() => teacher.room);
    check('21. 복구율 100% → 학생 승리 restored', tours.flat().every((r) => r === 'ok') && v.over && v.over.reason === 'restored' && v.over.winner === 'students', JSON.stringify(tours));
    check('맵 검사에서 문제가 나오지 않는다 (who 역할 이름)', !srv.log().includes('문제가 있어요'), srv.log());
  } finally {
    await srv.stop();
  }
}

// ════════════ 서버 B: 짧은 게임 시간 — 승패 ③④, 끊김 정리 ════════════
async function runB() {
  const srv = await startServer(3979, {
    impostor: {
      freezeGraceMs: 1000,
      freezeCooldownMs: 1500,
      freezeAfterMeetingMs: 1000,
      sabotageGraceMs: 1000,
      buttonGraceMs: 1000,
      meetingIntroMs: 200,
      discussMs: 3000,
      voteMs: 3000,
      resultMs: 200,
    },
    minuteMs: 1000, // 게임 "1분" = 1초
    rejoinMs: 600,
    cleanupMs: 200,
  });
  const port = srv.port;
  try {
    const teacher = await teacherOf(port);
    teacher.send({ t: 'questions', set: QSET });
    await teacher.next((m) => m.t === 'room' && m.qset);
    teacher.send({ t: 'settings', mode: 'impostor', minutes: 15 });
    await teacher.next((m) => m.t === 'room' && m.settings.minutes === 15);
    const P = [];
    for (const n of ['하나', '두리', '세찬', '네오']) P.push(await joinAs(port, teacher.code, n));
    teacher.send({ t: 'pickChasers', ids: [P[0].id] });
    await teacher.type('picked');
    const [C, S1, S2, S3] = P;

    // ── 22. 얼리기로 학생 수 ≤ 방해꾼 수 → 방해꾼 승리 ──
    let v = await startGame(teacher, P);
    const t0 = Date.now();
    await Promise.all([walk(S1, ...SPAWN), walk(S2, 1430, 920), route(C, [[C.x, 960], [1400, 960]])]);
    await sleep(Math.max(0, t0 + 1100 - Date.now()));
    C.send({ t: 'tag' });
    await sleep(1600);
    check('22. (준비) 한 명 얼린 뒤에는 게임이 이어진다', !teacher.room.over && teacher.room.players.filter((p) => p.ghost).length === 1);
    C.send({ t: 'tag' });
    v = await teacher.next((m) => m.t === 'room' && m.over, 2000);
    check('22. 얼리기로 학생 수 ≤ 방해꾼 수 → outnumbered (회의 없이 바로)', v.over.winner === 'chasers' && v.over.reason === 'outnumbered' && !v.meeting);
    await endGame(teacher, P);

    // ── 23. 시간 끝 → 방해꾼 승리, 회의 중에는 시간이 끝나지 않는다 ──
    teacher.send({ t: 'settings', minutes: 5 }); // 시험값: 5초
    await teacher.next((m) => m.t === 'room' && m.settings.minutes === 5);
    v = await startGame(teacher, P);
    const t1 = Date.now();
    await walk(S1, ...SPAWN);
    await sleep(Math.max(0, t1 + 1100 - Date.now()));
    S1.send({ t: 'emergency' });
    const mv = await teacher.wait((m) => m.t === 'room' && m.meeting);
    const paused = mv.timeLeft;
    await sleep(Math.max(0, t1 + 5600 - Date.now()));
    check('23. 회의 중에는 시간이 끝나지 않는다', !teacher.room.over && !!teacher.room.meeting && teacher.room.timeLeft === paused);
    await waitNoMeeting(teacher, 8000);
    await sleep(100);
    check('23. 회의 뒤 남은 시간이 이어진다', Math.abs(teacher.room.timeLeft - (paused - 100)) < 400);
    v = await teacher.next((m) => m.t === 'room' && m.over, paused + 2000);
    check('23. 시간 끝 → 방해꾼 승리 time_up', v.over.winner === 'chasers' && v.over.reason === 'time_up');
    await endGame(teacher, P);

    // ── 26. 방해꾼이 끊겨 정리되면 승패 확인 ──
    teacher.send({ t: 'settings', minutes: 15 });
    await teacher.next((m) => m.t === 'room' && m.settings.minutes === 15);
    v = await startGame(teacher, P);
    await C.close();
    v = await teacher.next((m) => m.t === 'room' && m.over, 3000);
    check('26. 마지막 방해꾼이 끊겨 정리되면 학생 승리 all_found', v.over.winner === 'students' && v.over.reason === 'all_found' && v.players.length === 3);
  } finally {
    await srv.stop();
  }
}

const timeout = setTimeout(() => {
  console.log('실패  전체 시간 초과');
  process.exit(1);
}, 240_000);

for (const run of [runA, runB]) {
  try {
    await run();
  } catch (e) {
    failed++;
    console.log('실패  시험 도중 오류 →', e.stack || e.message);
  }
}
clearTimeout(timeout);
console.log(`\n결과(방해꾼 찾기): 통과 ${passed} · 실패 ${failed}`);
setTimeout(() => process.exit(failed ? 1 : 0), 100);
