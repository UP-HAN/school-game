// 자동 시험: 주소 앞부분(BASE_PATH) — 수업용 https://학교주소/lantern/ 와 개발용 http://localhost:포트/ 가 둘 다 동작하는지.
// ① 리버스 프록시가 /lantern 을 그대로 넘기는 경우: /lantern/, /lantern/app.js, ws /lantern/ws …
// ② 프록시가 /lantern 을 떼고 넘기는 경우: /, /app.js, ws /ws … (같은 서버가 둘 다 받아야 한다)
// ③ 화면 코드에 '/'로 시작하는 절대 주소가 남아 있지 않은지 (남아 있으면 /lantern 아래에서 깨진다)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeChecker, startServer, client, PASSWORD, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = makeChecker('주소 앞부분');
const { check } = t;
const BASE = '/lantern';
const PORT = 3986;
const PORT_PLAIN = 3987;

// 경로를 그대로 보내는 GET (fetch 는 '..' 를 미리 정리해 버려서 직접 보낸다)
function get(port, rawPath) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e) }));
    req.end();
  });
}
// 웹소켓이 열리는가
async function wsOpens(port, wsPath) {
  const c = client(port, wsPath);
  try {
    await c.open();
    await c.close();
    return true;
  } catch {
    return false;
  }
}

async function staticFiles(prefix) {
  const label = prefix || '(앞부분 없음)';
  const page = await get(PORT, prefix + '/');
  check(`${label}/ 첫 화면 200`, page.status === 200 && /<html/i.test(page.body), `상태 ${page.status}`);
  check(`${label}/ 화면이 상대 주소로 app.js·style.css 를 부른다`, page.body.includes('src="./app.js"') && page.body.includes('href="./style.css"'));
  const invite = await get(PORT, prefix + '/?room=1234');
  check(`${label}/?room=1234 초대 주소 200`, invite.status === 200 && /<html/i.test(invite.body), `상태 ${invite.status}`);
  for (const [file, type] of [
    ['/app.js', 'javascript'],
    ['/style.css', 'css'],
    ['/shared/config.js', 'javascript'],
    ['/shared/mapgrid.js', 'javascript'],
  ]) {
    const r = await get(PORT, prefix + file);
    check(`${label}${file} 200 (${type})`, r.status === 200 && String(r.headers['content-type']).includes(type), `상태 ${r.status}`);
  }
  const map = await get(PORT, prefix + '/maps/monster-gym.json');
  let ok = false;
  try {
    ok = map.status === 200 && !!JSON.parse(map.body).size;
  } catch {
    /* 실패 */
  }
  check(`${label}/maps/monster-gym.json 200 (맵 자료)`, ok, `상태 ${map.status}`);
}

async function main() {
  const srv = await startServer(PORT, {}, { BASE_PATH: BASE + '/' }); // 끝 슬래시를 붙여도 '/lantern' 으로 정리되는지
  try {
    check('서버 안내 글에 /lantern/ 주소', srv.log().includes(`localhost:${PORT}${BASE}/`), srv.log());

    // ── ① 프록시가 /lantern 을 그대로 넘기는 경우 ──
    await staticFiles(BASE);
    // 끝 슬래시 없는 주소 → 슬래시 붙은 주소로 (Location 은 상대 주소. 브라우저가 요청 주소 기준으로 푼다)
    for (const [from, to] of [
      [BASE, BASE + '/'],
      [BASE + '?room=1234', BASE + '/?room=1234'],
      [BASE + '/teacher', BASE + '/teacher/'],
      ['/teacher', '/teacher/'], // 프록시가 /lantern 을 떼고 넘긴 경우 (브라우저 주소는 /lantern/teacher → /lantern/teacher/ 로 풀린다)
    ]) {
      const r = await get(PORT, from);
      const loc = r.headers.location ? new URL(r.headers.location, 'http://h' + from).pathname + new URL(r.headers.location, 'http://h' + from).search : '';
      check(`${from} → ${to} 로 보낸다(301)`, r.status === 301 && loc === to, `${r.status} ${r.headers.location}`);
    }
    const viaProxy = await get(PORT, '/teacher');
    check('프록시가 떼고 넘겨도 /lantern/teacher → /lantern/teacher/', new URL(viaProxy.headers.location || '', 'http://h' + BASE + '/teacher').pathname === BASE + '/teacher/');

    // ── 선생님 페이지 / 학생 페이지 나눔 ──
    for (const prefix of [BASE, '']) {
      const label = prefix || '(앞부분 없음)';
      const tp = await get(PORT, prefix + '/teacher/');
      check(`${label}/teacher/ 선생님 페이지 200`, tp.status === 200 && /<html/i.test(tp.body), `상태 ${tp.status}`);
      check(`${label}/teacher/ 에 비밀번호 칸·방 만들기가 있다 (비밀번호 설정 시)`, tp.body.includes('id="create-form"') && tp.body.includes('id="create-password"'));
      check(`${label}/teacher/ 에 학생 입장 칸이 없다`, !tp.body.includes('id="join-form"') && !tp.body.includes('id="join-code"'));
      check(`${label}/teacher/ 는 data-role="teacher" + <base href="../">`, tp.body.includes('<body data-role="teacher">') && tp.body.includes('<base href="../">'));
    }
    const sp = await get(PORT, BASE + '/');
    check('학생 페이지에 방 만들기·비밀번호 칸이 없다', !sp.body.includes('create-form') && !sp.body.includes('create-password') && !sp.body.includes('open-teacher'));
    check('학생 페이지에 선생님 페이지 링크가 없다', !/(?:href|src|action)\s*=\s*["'][^"']*teacher/i.test(sp.body) && !sp.body.includes('teacher/'));
    check('학생 페이지에 방 번호·이름 입장 칸이 있다', sp.body.includes('id="join-code"') && sp.body.includes('id="join-name"'));
    check('제목에 (가칭) 이 없다', !sp.body.includes('가칭') && !(await get(PORT, BASE + '/teacher/')).body.includes('가칭'));
    check('페이지 조각 파일은 따로 내려 주지 않는다', (await get(PORT, BASE + '/teacher-home.part.html')).status === 404);
    // 선생님 페이지의 <base href="../"> 로 풀리는 주소가 실제로 있는가
    const base = new URL('../', `http://127.0.0.1:${PORT}${BASE}/teacher/`);
    check('선생님 페이지 기준 ../app.js = /lantern/app.js', base.pathname + 'app.js' === BASE + '/app.js' && (await get(PORT, base.pathname + 'app.js')).status === 200);

    // ── ② 프록시가 /lantern 을 떼고 넘기는 경우 (개발용 루트 접근도 같음) ──
    await staticFiles('');

    // ── 막혀야 하는 곳 ──
    for (const p of [BASE + '/../server/index.js', BASE + '/%2e%2e/server/index.js', BASE + '/.env', '/../.env', BASE + '/server/index.js']) {
      const r = await get(PORT, p);
      check(`${p} 는 내려 주지 않는다`, r.status === 404 || r.status === 400, `상태 ${r.status}`);
    }
    check('/lanternx 같은 비슷한 주소는 앞부분으로 보지 않는다', (await get(PORT, '/lanternx/app.js')).status === 404);

    // ── 웹소켓: /lantern/ws 와 /ws 둘 다, 같은 방에서 만난다 ──
    const teacher = client(PORT, BASE + '/ws');
    await teacher.open();
    teacher.send({ t: 'create', password: PASSWORD });
    const created = await teacher.type('created');
    check('ws /lantern/ws 로 방 만들기', !!created.code);
    const student = client(PORT, '/ws');
    await student.open();
    student.send({ t: 'join', code: created.code, name: '앞부분없음' });
    const joined = await student.type('joined');
    check('ws /ws (프록시가 떼고 넘김) 로 같은 방에 입장', joined.code === created.code);
    const student2 = client(PORT, BASE + '/ws');
    await student2.open();
    student2.send({ t: 'join', code: created.code, name: '앞부분있음' });
    check('ws /lantern/ws 로 같은 방에 입장', (await student2.type('joined')).code === created.code);
    const seen = await teacher.next((m) => m.t === 'room' && m.players.length === 2);
    check('선생님 화면에 두 학생이 모두 보인다', seen.players.length === 2);
    await Promise.all([teacher.close(), student.close(), student2.close()]);
    check('엉뚱한 웹소켓 주소(/lantern/nope)는 거절', !(await wsOpens(PORT, BASE + '/nope')));
  } finally {
    await srv.stop();
  }

  // ── BASE_PATH 를 비운 개발용 서버: 지금처럼 루트에서만 ──
  const plain = await startServer(PORT_PLAIN, {});
  try {
    check('BASE_PATH 없음: / 200', (await get(PORT_PLAIN, '/')).status === 200);
    check('BASE_PATH 없음: /app.js 200', (await get(PORT_PLAIN, '/app.js')).status === 200);
    check('BASE_PATH 없음: ws /ws 열림', await wsOpens(PORT_PLAIN, '/ws'));
    check('BASE_PATH 없음: /lantern/ 은 없는 주소(404)', (await get(PORT_PLAIN, BASE + '/')).status === 404);
  } finally {
    await plain.stop();
  }

  // ── ③ 화면 코드에 절대 주소가 남아 있지 않은가 ──
  const dir = path.join(here, '..', 'client');
  const bad = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(js|html|css)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const patterns = [
      /\bfrom\s+['"]\/[^/]/g, // import … from '/x.js'
      /\bimport\s*\(\s*['"`]\/[^/]/g, // import('/x.js')
      /\bfetch\s*\(\s*['"`]\/[^/]/g, // fetch('/maps/…')
      /\b(?:src|href)\s*=\s*["']\/[^/]/g, // <script src="/app.js">
      /url\(\s*['"]?\/[^/]/g, // url('/img.png')
      /\$\{location\.(?:host|origin)\}\//g, // `${location.host}/ws`
    ];
    for (const re of patterns) for (const m of text.matchAll(re)) bad.push(`${f}: ${m[0]}`);
  }
  check('화면 코드(client/*)에 / 로 시작하는 절대 주소가 없다', bad.length === 0, bad.join(' | '));
}

runAll(t, [main], 60_000);
