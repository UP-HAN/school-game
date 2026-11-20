// 자동 시험: 프록시(nginx) 뒤 접속 주소(TRUST_PROXY)와 여는 주소(HOST).
//  - TRUST_PROXY=1 이면 X-Forwarded-For 첫 값마다 비밀번호 잠금이 따로 걸린다 (한 학생이 틀려도 다른 사람은 안 잠김).
//  - TRUST_PROXY 가 없으면 헤더를 무시하고 연결 주소로만 센다 (헤더를 바꿔도 잠금을 피할 수 없음).
//  - HOST=127.0.0.1 로 열면 그 주소로 열렸다고 알려 준다.
import WebSocket from 'ws';
import { makeChecker, startServer, PASSWORD } from './testkit.js';

const t = makeChecker('프록시·HOST');
const { check } = t;
const PORT_PROXY = 3191;
const PORT_PLAIN = 3192;

// 비밀번호로 방 만들기를 한 번 시도하고 결과 코드('created' 또는 오류 코드)를 돌려준다
async function tryCreate(port, password, xff) {
  const headers = xff === undefined ? {} : { 'X-Forwarded-For': xff };
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  const reply = new Promise((res) => {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === 'created') res('created');
      else if (m.t === 'error') res(m.code);
    });
    setTimeout(() => res('timeout'), 3000);
  });
  ws.send(JSON.stringify({ t: 'create', password }));
  const code = await reply;
  await new Promise((r) => (ws.once('close', r), ws.close()));
  return code;
}
async function failTimes(port, n, xff) {
  const codes = [];
  for (let i = 0; i < n; i++) codes.push(await tryCreate(port, 'wrong-' + i, xff));
  return codes;
}

const timeout = setTimeout(() => {
  console.log('실패  전체 시간 초과');
  process.exit(1);
}, 30_000);

try {
  // ── TRUST_PROXY=1, HOST=127.0.0.1 (학교 서버 설정) ──
  const a = await startServer(PORT_PROXY, {}, { TRUST_PROXY: '1', HOST: '127.0.0.1' });
  await new Promise((r) => setTimeout(r, 400)); // 서버가 시작 안내 줄을 모두 적을 때까지 잠깐 기다린다
  try {
    check('HOST=127.0.0.1 로 열렸다고 알림', a.log().includes('여는 주소(HOST): 127.0.0.1:' + PORT_PROXY), a.log());
    check('TRUST_PROXY 켜짐 알림', a.log().includes('TRUST_PROXY): 켜짐'));
    check('127.0.0.1 이면 경고 없음', !a.log().includes('주의: TRUST_PROXY'));
    const codes = await failTimes(a.port, 5, '10.0.0.1');
    check('학생 A: 5번 틀리면 마지막까지 bad_password', codes.every((c) => c === 'bad_password'), codes.join(','));
    check('학생 A: 6번째는 잠김(locked)', (await tryCreate(a.port, 'wrong', '10.0.0.1')) === 'locked');
    check('학생 A: 잠긴 동안은 맞는 비밀번호도 잠김', (await tryCreate(a.port, PASSWORD, '10.0.0.1')) === 'locked');
    check('학생 B(다른 주소): 잠기지 않음 → 맞는 비밀번호로 방 만들기', (await tryCreate(a.port, PASSWORD, '10.0.0.2')) === 'created');
    check('첫 값만 씀: "10.0.0.1, 1.2.3.4" 는 A 로 보고 잠김', (await tryCreate(a.port, PASSWORD, '10.0.0.1, 1.2.3.4')) === 'locked');
    check('헤더가 없으면 연결 주소로 셈 (잠기지 않음)', (await tryCreate(a.port, PASSWORD)) === 'created');
  } finally {
    await a.stop();
  }

  // ── 기본(TRUST_PROXY 없음, HOST 없음) ──
  const b = await startServer(PORT_PLAIN, {}, { TRUST_PROXY: '', HOST: '' });
  await new Promise((r) => setTimeout(r, 400));
  try {
    check('HOST 없음: 0.0.0.0 으로 열림', b.log().includes('여는 주소(HOST): 0.0.0.0:' + PORT_PLAIN), b.log());
    check('TRUST_PROXY 없음: 켜짐 알림 없음', !b.log().includes('TRUST_PROXY): 켜짐'));
    await failTimes(b.port, 5, '10.0.0.1');
    check('헤더를 바꿔도 같은 연결 주소라 잠김', (await tryCreate(b.port, PASSWORD, '10.0.0.99')) === 'locked');
  } finally {
    await b.stop();
  }
} catch (e) {
  t.failed++;
  console.log('실패  시험 도중 오류 →', e.stack || e.message);
}
clearTimeout(timeout);
t.finish();
