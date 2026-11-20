// 자동 시험: 비밀번호 없는 방 만들기와 서버 보호 장치.
//  ① TEACHER_PASSWORD 가 비어 있으면 비밀번호 없이 방을 만들 수 있고, 선생님 페이지에 비밀번호 칸이 없다.
//  ② 방 만들기 제한: 연타(1초에 1번) · 같은 주소 동시 방 수 · 같은 주소 1시간 횟수 · 서버 전체 방 수.
//  ③ 방 자동 정리: 선생님이 끊긴 채 오래 / 아무 활동 없이 오래 지나면 닫고 학생에게 알린다. 그 전에 돌아오면 이어받는다.
// 시간은 TEST_OVERRIDES 로 줄이고, 주소(IP)는 TRUST_PROXY + X-Forwarded-For 로 바꿔 가며 시험한다.
import WebSocket from 'ws';
import { makeChecker, startServer, client, joinAs, sleep, NO_ROOM_LIMITS_ENV } from './testkit.js';
import { CHARACTERS } from '../shared/config.js';

const t = makeChecker('방 만들기 제한·자동 정리');
const { check } = t;
const PORT_LIMIT = 3193;
const PORT_CLEAN = 3194;
const GAP_MS = 300;
const WINDOW_MS = 2500;

// 방 만들기를 한 번 시도한다. { result: 'created' 또는 오류 코드, msg, ws, code, token }
async function tryCreate(port, xff, extra = {}) {
  const headers = xff === undefined ? {} : { 'X-Forwarded-For': xff };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  const reply = new Promise((res) => {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'created') res({ result: 'created', code: m.code, token: m.token });
      else if (m.t === 'error') res({ result: m.code, msg: m.msg });
    });
    setTimeout(() => res({ result: 'timeout' }), 3000);
  });
  ws.send(JSON.stringify({ t: 'create', ...extra }));
  const r = await reply;
  r.ws = ws;
  r.send = (m) => ws.send(JSON.stringify(m));
  r.close = () => new Promise((res) => (ws.readyState === 3 ? res() : (ws.once('close', res), ws.close())));
  return r;
}
const get = async (port, p) => {
  const r = await fetch(`http://127.0.0.1:${port}${p}`);
  return { status: r.status, body: await r.text() };
};

const timeout = setTimeout(() => {
  console.log('실패  전체 시간 초과');
  process.exit(1);
}, 60_000);

const opened = [];
try {
  // ───────── ①② 비밀번호 없음 + 방 만들기 제한 ─────────
  const a = await startServer(
    PORT_LIMIT,
    { createGapMs: GAP_MS, createWindowMs: WINDOW_MS },
    { TEACHER_PASSWORD: '', TRUST_PROXY: '1', HOST: '127.0.0.1', MAX_ROOMS: '6', MAX_ROOMS_PER_IP: '2', ROOM_CREATE_PER_HOUR: '3' },
  );
  await sleep(300); // 시작 안내 줄을 다 적을 때까지
  try {
    check('시작 안내: 비밀번호 없음', a.log().includes('TEACHER_PASSWORD): 없음'), a.log());
    check('시작 안내: 제한 값 (전체 6 · 같은 주소 2 · 1시간 3)', a.log().includes('전체 6개') && a.log().includes('동시 2개') && a.log().includes('1시간 3개'));

    const tp = await get(a.port, '/teacher/');
    check('선생님 페이지: 방 만들기 버튼은 있고 비밀번호 칸은 없다', tp.status === 200 && tp.body.includes('id="create-form"') && !tp.body.includes('create-password') && !tp.body.includes('pw:start'));
    check('선생님 페이지: 오류 문구 자리가 있다', tp.body.includes('id="create-msg"'));
    check('선생님 페이지: 이름 칸은 없다', !/id="create-name"|teacher-name/.test(tp.body));
    const sp = await get(a.port, '/');
    check('학생 페이지는 그대로 (입장 칸만)', sp.body.includes('id="join-form"') && !sp.body.includes('create-form'));

    // 비밀번호 없이 만들기 (오류 no_password_set 이 나오지 않는다)
    const r1 = await tryCreate(a.port, '10.0.0.1');
    opened.push(r1);
    check('비밀번호 없이 방 만들기 → 4자리 방 번호', r1.result === 'created' && /^\d{4}$/.test(r1.code), r1.result);
    // 연타: 같은 주소에서 1초(시험은 0.3초) 안에 또 만들면 막힌다
    const r2 = await tryCreate(a.port, '10.0.0.1');
    opened.push(r2);
    check('연타 방지: 바로 또 만들면 too_fast', r2.result === 'too_fast', r2.result);
    check('연타 방지: 쉬운 안내 문구', /천천히/.test(r2.msg || ''), r2.msg);
    // 다른 주소는 연타 제한과 무관
    const other = await tryCreate(a.port, '10.0.0.9');
    opened.push(other);
    check('다른 주소는 바로 만들 수 있다', other.result === 'created', other.result);
    await sleep(GAP_MS + 80);
    const r3 = await tryCreate(a.port, '10.0.0.1', { password: '아무거나' });
    opened.push(r3);
    check('잠시 뒤에는 다시 만들 수 있다 (비밀번호를 보내도 무시)', r3.result === 'created', r3.result);
    await sleep(GAP_MS + 80);
    // 같은 주소 동시 방 수 (2개)
    const r4 = await tryCreate(a.port, '10.0.0.1');
    opened.push(r4);
    check('같은 주소가 방 2개를 가지면 too_many_rooms', r4.result === 'too_many_rooms', r4.result);
    check('같은 주소 제한: 쉬운 안내 문구', /안 쓰는 방을 닫고/.test(r4.msg || ''), r4.msg);
    // 방을 닫으면 다시 만들 수 있다 (1시간 횟수는 아직 2번)
    r1.send({ t: 'close' });
    await sleep(GAP_MS + 80);
    const r5 = await tryCreate(a.port, '10.0.0.1');
    opened.push(r5);
    check('방 하나를 닫으면 다시 만들 수 있다 (1시간 3번째)', r5.result === 'created', r5.result);
    // 1시간 횟수 (3번): 방을 닫아도 4번째는 막힌다
    r3.send({ t: 'close' });
    await sleep(GAP_MS + 80);
    const r6 = await tryCreate(a.port, '10.0.0.1');
    opened.push(r6);
    check('같은 주소 1시간 4번째는 too_many_creates', r6.result === 'too_many_creates', r6.result);
    check('횟수 제한: "분 뒤에 다시" 안내', /분 뒤에 다시 해 주세요/.test(r6.msg || ''), r6.msg);
    const r6b = await tryCreate(a.port, '10.0.0.2');
    opened.push(r6b);
    check('횟수 제한은 주소마다 따로 (다른 주소는 됨)', r6b.result === 'created', r6b.result);
    // '1시간'(시험은 2.5초)이 지나면 다시 된다
    await sleep(WINDOW_MS + 100);
    const r7 = await tryCreate(a.port, '10.0.0.1');
    opened.push(r7);
    check('시간이 지나면 횟수가 풀린다', r7.result === 'created', r7.result);

    // 서버 전체 방 수 (6개): 지금 열린 방 = other, r5, r6b, r7 → 4개
    const fill = [];
    for (let i = 0; i < 2; i++) fill.push(await tryCreate(a.port, '10.0.1.' + i));
    opened.push(...fill);
    check('전체 6개까지는 만들어진다', fill.every((r) => r.result === 'created'), fill.map((r) => r.result).join(','));
    const full = await tryCreate(a.port, '10.0.2.1');
    opened.push(full);
    check('전체 방이 꽉 차면 server_full', full.result === 'server_full', full.result);
    check('꽉 참: "지금은 방이 꽉 찼어요. 잠시 뒤 다시 해 주세요"', (full.msg || '').includes('지금은 방이 꽉 찼어요. 잠시 뒤 다시 해 주세요'), full.msg);
    fill[0].send({ t: 'close' });
    await sleep(100);
    const after = await tryCreate(a.port, '10.0.2.1');
    opened.push(after);
    check('방이 닫혀 자리가 나면 다시 만들 수 있다', after.result === 'created', after.result);
  } finally {
    for (const r of opened.splice(0)) await r.close();
    await a.stop();
  }

  // ───────── ③ 방 자동 정리 ─────────
  const b = await startServer(
    PORT_CLEAN,
    { cleanupMs: 100, teacherGoneMs: 700, idleMs: 1600, rejoinMs: 60_000 },
    { TEACHER_PASSWORD: '', ...NO_ROOM_LIMITS_ENV },
  );
  try {
    const newTeacher = async () => {
      const c = client(b.port);
      await c.open();
      c.send({ t: 'create' });
      const created = await c.type('created');
      await c.type('room');
      c.code = created.code;
      c.token = created.token;
      return c;
    };

    // (1) 선생님이 끊긴 채 오래 지나면 닫힌다
    const t1 = await newTeacher();
    const s1 = await joinAs(b.port, t1.code, '가람');
    await t1.close();
    const c1 = await s1.next((m) => m.t === 'closed', 3000).catch(() => null);
    check('선생님이 오래 끊기면 학생에게 방 닫힘 안내 (teacher_gone)', c1 && c1.reason === 'teacher_gone', JSON.stringify(c1));
    const late = client(b.port);
    await late.open();
    late.send({ t: 'resume', code: t1.code, token: t1.token });
    check('닫힌 뒤에는 선생님도 이어받지 못한다', (await late.error()) === 'resume_failed');

    // (2) 그 전에 선생님이 돌아오면(새로고침) 방을 그대로 이어받는다
    const t2 = await newTeacher();
    const s2 = await joinAs(b.port, t2.code, '나래');
    await t2.close();
    await sleep(300);
    const back = client(b.port);
    await back.open();
    back.send({ t: 'resume', code: t2.code, token: t2.token });
    const res = await back.type('resumed');
    check('새로고침한 선생님이 방을 이어받는다', res.role === 'teacher' && res.code === t2.code);
    await sleep(900); // 끊김 기준(0.7초)보다 오래
    s2.send({ t: 'character', character: CHARACTERS[1].id }); // 활동
    await sleep(200);
    check('이어받은 방은 끊김 기준이 지나도 닫히지 않는다', !s2.inbox.some((m) => m.t === 'closed'));

    // (3) 활동이 이어지면 닫히지 않는다 (활동 없음 기준 1.6초보다 오래 지켜본다)
    for (let i = 0; i < 6; i++) {
      await sleep(400);
      s2.send({ t: 'character', character: CHARACTERS[i % 2].id });
    }
    check('계속 활동하는 방은 오래 지나도 닫히지 않는다', !s2.inbox.some((m) => m.t === 'closed') && !back.inbox.some((m) => m.t === 'closed'));

    // (4) 아무 활동 없이 오래 지나면 닫힌다 (선생님이 연결된 채여도)
    const c4 = await s2.next((m) => m.t === 'closed', 4000).catch(() => null);
    check('아무 활동이 없으면 방이 닫히고 학생에게 안내 (idle)', c4 && c4.reason === 'idle', JSON.stringify(c4));
    const ct = await back.next((m) => m.t === 'closed', 1000).catch(() => null);
    check('선생님 화면에도 닫힘 안내 (idle)', ct && ct.reason === 'idle');
    const again = client(b.port);
    await again.open();
    again.send({ t: 'join', code: t2.code, name: '다온' });
    check('닫힌 방에는 들어갈 수 없다', (await again.error()) === 'no_room');
    for (const c of [s1, late, s2, back, again]) await c.close();
  } finally {
    await b.stop();
  }
} catch (e) {
  t.failed++;
  console.log('실패  시험 도중 오류 →', e.stack || e.message);
}
clearTimeout(timeout);
t.finish();
