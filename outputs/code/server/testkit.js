// 자동 시험 공용 도구 (test-fog.js · test-loot.js · test-streak.js 가 같이 쓴다).
// 서버를 임시 포트에 켜고(시험용 시간 설정 TEST_OVERRIDES), 가짜 화면(웹소켓)으로 메시지를 주고받는다.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PASSWORD = crypto.randomBytes(9).toString('base64url'); // 시험용 임시 비밀번호 (매번 새로 만듦)
export const SPAWN = [1400, 920];
export const BELL = [1400, 640];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeChecker(title) {
  const t = { passed: 0, failed: 0 };
  t.check = (name, ok, detail = '') => {
    if (ok) t.passed++;
    else t.failed++;
    console.log(`${ok ? '통과' : '실패'}  ${name}${ok || !detail ? '' : '  → ' + detail}`);
  };
  t.finish = () => {
    console.log(`\n결과(${title}): 통과 ${t.passed} · 실패 ${t.failed}`);
    setTimeout(() => process.exit(t.failed ? 1 : 0), 100);
  };
  return t;
}

// extraEnv: 더 넣을 환경변수 (예: { BASE_PATH: '/lantern' })
export function startServer(port, overrides, extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(here, 'index.js')], {
    env: { ...process.env, BASE_PATH: '', PORT: String(port), TEACHER_PASSWORD: PASSWORD, TEST_OVERRIDES: JSON.stringify(overrides), ...extraEnv },
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

// wsPath: 웹소켓 주소 (기본 '/ws'. 예: '/lantern/ws')
export function client(port, wsPath = '/ws') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  const c = { ws, raw: [], inbox: [], waiters: [], room: null, state: null, meMsg: null, crates: null, x: 0, y: 0, fixes: 0, mes: [] };
  ws.on('message', (data) => {
    const text = data.toString();
    const m = JSON.parse(text);
    Object.defineProperty(m, '_at', { value: Date.now() }); // 받은 때 (JSON 에는 안 들어감)
    if (m.t !== 'state') c.raw.push(text);
    if (m.t === 'room') c.room = m;
    if (m.t === 'state') c.state = m;
    if (m.t === 'me') (c.meMsg = m), c.mes.push({ at: Date.now(), m });
    if (m.t === 'crates') c.crates = m.crates;
    if (m.t === 'fix') (c.fixes++, (c.x = m.x), (c.y = m.y));
    const i = c.waiters.findIndex((w) => w.test(m));
    if (i >= 0) c.waiters.splice(i, 1)[0].resolve(m);
    else if (m.t !== 'state') c.inbox.push(m);
  });
  Object.assign(c, {
    open: () => new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej))),
    send: (m) => ws.send(JSON.stringify(m)),
    next(test, ms = 3000) {
      const i = c.inbox.findIndex(test);
      if (i >= 0) return Promise.resolve(c.inbox.splice(i, 1)[0]);
      return c.wait(test, ms);
    },
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
    event: (kind, ms) => c.next((m) => m.t === 'event' && m.kind === kind, ms),
    error: (ms = 2000) => c.next((m) => m.t === 'error', ms).then((m) => m.code, () => 'none'),
    clear: () => (c.inbox.length = 0),
    close: () => new Promise((res) => (ws.once('close', res), ws.close())),
    see: (who) => c.room && c.room.players.find((p) => p.id === (who.id || who)),
    sync() {
      const p = c.see(c.id);
      c.x = p.x;
      c.y = p.y;
    },
  });
  return c;
}
export async function teacherOf(port) {
  const t = client(port);
  await t.open();
  t.send({ t: 'create', password: PASSWORD });
  const created = await t.type('created');
  await t.type('room');
  t.code = created.code;
  return t;
}
export async function joinAs(port, code, name) {
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
export async function walk(c, tx, ty) {
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
export async function route(c, points) {
  for (const [x, y] of points) if (!(await walk(c, x, y))) return false;
  return true;
}
// 문제 세트: 정답은 모두 '2' (주관식 1개 + 선다 2개)
export const QSET = {
  title: '시험 세트',
  questions: [
    { q: '1 더하기 1은?', a: '2', wrong: ['1', '3', '4'] },
    { q: '4 빼기 2는?', a: '2' },
    { q: '3 빼기 1은?', a: '2', wrong: ['5', '6', '7'] },
  ],
};
export const rightAnswer = (q) => (q.kind === 'short' ? '2' : q.choices.indexOf('2'));
export const wrongAnswer = (q) => (q.kind === 'short' ? '9' : q.choices.findIndex((c, i) => c !== '2' && !(q.removed || []).includes(i)));
// 퀴즈를 열고 (맞히거나 틀린다). 결과 메시지를 돌려준다. 열리지 않으면 error 메시지.
export async function openQuiz(c, terminal) {
  c.send({ t: 'open', terminal });
  return c.next((m) => m.t === 'question' || m.t === 'error');
}
export async function answer(c, q, right) {
  c.send({ t: 'answer', value: right ? rightAnswer(q) : wrongAnswer(q) });
  return c.next((m) => m.t === 'result');
}
export async function solve(c, terminal) {
  const q = await openQuiz(c, terminal);
  if (q.t === 'error') return q.code;
  const r = await answer(c, q, true);
  return r.ok ? 'ok' : 'wrong';
}
export async function setup(port, names, settings) {
  const teacher = await teacherOf(port);
  teacher.send({ t: 'questions', set: QSET });
  await teacher.next((m) => m.t === 'room' && m.qset);
  const P = [];
  for (const n of names) P.push(await joinAs(port, teacher.code, n));
  if (settings) {
    teacher.send({ t: 'settings', ...settings });
    await teacher.next((m) => m.t === 'room' && Object.entries(settings).every(([k, v]) => m.settings[k] === v));
  }
  return { teacher, P };
}
export async function startGame(teacher, players) {
  for (const c of [teacher, ...players]) c.clear();
  teacher.send({ t: 'start' });
  const v = await teacher.next((m) => (m.t === 'room' && m.phase === 'game') || m.t === 'error');
  if (v.t === 'error') throw new Error('시작 실패 ' + v.code);
  await Promise.all(players.map((c) => c.next((m) => m.t === 'room' && m.phase === 'game')));
  await sleep(100);
  for (const c of players) c.sync();
  v.startedAt = Date.now();
  return v;
}
export async function endGame(teacher, players) {
  teacher.send({ t: 'end' });
  await teacher.next((m) => m.t === 'room' && m.phase === 'lobby');
  await sleep(100);
  for (const c of [teacher, ...players]) c.clear();
}
export const roleOf = (v, c) => v.players.find((p) => p.id === c.id).role;
// 역할에 따라 나누기
export function split(v, P) {
  return { C: P.filter((c) => roleOf(v, c) === 'chaser'), S: P.filter((c) => roleOf(v, c) === 'student') };
}
export function runAll(t, runs, limitMs) {
  const timeout = setTimeout(() => {
    console.log('실패  전체 시간 초과');
    process.exit(1);
  }, limitMs);
  return (async () => {
    for (const run of runs) {
      try {
        await run();
      } catch (e) {
        t.failed++;
        console.log('실패  시험 도중 오류 →', e.stack || e.message);
      }
    }
    clearTimeout(timeout);
    t.finish();
  })();
}
