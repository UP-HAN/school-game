// 대기방 자동 시험. 실행: npm test  (서버를 임시 포트에 켜고 끝나면 끈다)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import fs from 'node:fs';
import { recommendChasers, chaserCount } from '../shared/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3977;
// 예전 모드 id (거부되는지 확인용. 코드 검색에 걸리지 않게 나눠 적는다)
const OLD_TAG = ['freeze', 'tag'].join('-');
const OLD_MAFIA = ['impos', 'tor'].join('');
const PASSWORD = crypto.randomBytes(9).toString('base64url'); // 시험용 임시 비밀번호 (매번 새로 만듦)
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;
const URL_HTTP = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '통과' : '실패'}  ${name}${ok || !detail ? '' : '  → ' + detail}`);
}

function client() {
  const ws = new WebSocket(URL_WS);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'report') ws.__gotReport = true;
    const i = waiters.findIndex((w) => w.test(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
    else inbox.push(m);
  });
  return {
    ws,
    open: () => new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej))),
    send: (m) => ws.send(JSON.stringify(m)),
    // 조건에 맞는 메시지가 올 때까지 기다린다
    next(test, ms = 2000) {
      const i = inbox.findIndex(test);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { test, resolve };
        waiters.push(w);
        setTimeout(() => {
          const k = waiters.indexOf(w);
          if (k >= 0) {
            waiters.splice(k, 1);
            reject(new Error('시간 초과'));
          }
        }, ms);
      });
    },
    type: function (t, ms) {
      return this.next((m) => m.t === t, ms);
    },
    clear: () => (inbox.length = 0),
    close: () => new Promise((res) => (ws.once('close', res), ws.close())),
  };
}

async function run() {
  // 화면 파일 제공
  const home = await fetch(URL_HTTP + '/');
  check('첫 화면이 열린다', home.status === 200 && (await home.text()).includes('view-home'));
  check('공용 설정 파일이 열린다', (await fetch(URL_HTTP + '/shared/config.js')).status === 200);
  check('맵 파일이 열린다', (await fetch(URL_HTTP + '/maps/monster-gym.json')).status === 200);
  for (const bad of ['/server/index.js', '/package.json', '/.env', '/..%2f.env', '/shared/..%2fserver/index.js', '/%2e%2e/%2e%2e/HANDOFF.md']) {
    check(`내려 주면 안 되는 파일 차단: ${bad}`, (await fetch(URL_HTTP + bad)).status === 404);
  }

  // 방 만들기
  const teacher = client();
  await teacher.open();
  teacher.send({ t: 'create', password: 'wrong-' + PASSWORD });
  check('틀린 비밀번호는 거절', (await teacher.type('error')).code === 'bad_password');
  teacher.send({ t: 'create', password: PASSWORD });
  const created = await teacher.type('created');
  check('맞는 비밀번호로 4자리 방 번호 발급', /^\d{4}$/.test(created.code));
  await teacher.type('room');
  const code = created.code;

  // 학생 입장
  const stranger = client();
  await stranger.open();
  stranger.send({ t: 'join', code: '0000', name: '길동' });
  check('없는 방 번호는 거절', (await stranger.type('error')).code === 'no_room');
  stranger.send({ t: 'join', code, name: '' });
  check('빈 이름은 거절', (await stranger.type('error')).code === 'bad_name');
  stranger.send({ t: 'join', code, name: '아홉글자가넘는이름' });
  check('긴 이름은 거절', (await stranger.type('error')).code === 'bad_name');
  stranger.send({ t: 'settings', mode: 'mafia' });
  stranger.send({ t: 'kick', id: 'x' });
  stranger.send({ t: 'start' });

  const students = [];
  for (const name of ['가람', '나래', '다온', '라온']) {
    const s = client();
    await s.open();
    s.send({ t: 'join', code, name });
    s.me = await s.type('joined');
    students.push(s);
  }
  stranger.send({ t: 'join', code, name: '가람' });
  check('같은 이름은 거절', (await stranger.type('error')).code === 'name_taken');

  teacher.clear();
  students[0].send({ t: 'character', character: 'slime' });
  let view = await teacher.next((m) => m.t === 'room' && m.players.some((p) => p.character === 'slime'));
  check('학생 4명이 보인다', view.players.length === 4);
  check('색이 서로 겹치지 않는다', new Set(view.players.map((p) => p.color)).size === 4);
  check('캐릭터를 바꾸면 반영된다', view.players.find((p) => p.id === students[0].me.id).character === 'slime');
  check('학생의 설정 변경은 무시된다', view.settings.mode === 'sleep-tag');
  check('안개·보급과 퀴즈 수첩은 처음에 켜져 있다', view.settings.fogLoot === true && view.settings.notebook === true);
  check('비밀 값(토큰)이 방 정보에 섞여 나가지 않는다', !JSON.stringify(view).includes(students[1].me.token) && !JSON.stringify(view).includes(created.token));

  students[0].send({ t: 'character', character: 'no-such' });
  teacher.send({ t: 'settings', mode: OLD_TAG });
  teacher.send({ t: 'settings', mode: OLD_MAFIA });
  teacher.send({ t: 'settings', mode: 'mafia', map: 'no-such-map' });
  view = await teacher.next((m) => m.t === 'room' && m.settings.mode === 'mafia');
  check('선생님은 게임 방식을 바꿀 수 있다 (꿈도둑을 찾아라 = mafia)', view.settings.mode === 'mafia' && view.settings.map === 'monster-gym');
  teacher.send({ t: 'settings', mode: OLD_TAG });
  teacher.send({ t: 'settings', mode: OLD_MAFIA, missions: 4 });
  view = await teacher.next((m) => m.t === 'room' && m.settings.missions === 4);
  check('15-1. 옛 모드 id는 대기방 설정에서 거부된다', view.settings.mode === 'mafia');
  check('술래 수는 처음에 자동(추천)이다', view.settings.chasers === 'auto');
  teacher.send({ t: 'settings', chasers: 9 });
  teacher.send({ t: 'settings', chasers: 2 });
  view = await teacher.next((m) => m.t === 'room' && m.settings.chasers === 2);
  check('선생님은 술래 수를 직접 정할 수 있다 (1~3명)', view.settings.chasers === 2);
  check('인원별 추천: 잠귀신 술래잡기 6명→1, 7명→2', recommendChasers('sleep-tag', 6) === 1 && recommendChasers('sleep-tag', 7) === 2);
  check('인원별 추천: 꿈도둑을 찾아라 7명→1, 8명→2', recommendChasers('mafia', 7) === 1 && recommendChasers('mafia', 8) === 2);
  check('학생이 1명은 남도록 잠귀신 수를 줄인다', chaserCount({ mode: 'sleep-tag', chasers: 3 }, 3) === 2);
  check('없는 캐릭터는 무시된다', view.players.find((p) => p.id === students[0].me.id).character === 'slime');

  // 재접속
  teacher.clear();
  await students[1].close();
  view = await teacher.next((m) => m.t === 'room' && m.players.some((p) => !p.connected));
  check('연결이 끊긴 학생은 끊김으로 표시', view.players.length === 4);
  const back = client();
  await back.open();
  back.send({ t: 'resume', code, token: 'not-a-real-token' });
  check('틀린 토큰으로는 못 돌아온다', (await back.type('error')).code === 'resume_failed');
  back.send({ t: 'resume', code, token: students[1].me.token });
  const resumed = await back.type('resumed');
  check('맞는 토큰으로 같은 학생으로 돌아온다', resumed.id === students[1].me.id);
  view = await teacher.next((m) => m.t === 'room' && m.players.every((p) => p.connected));
  check('돌아오면 다시 연결됨으로 표시', view.players.length === 4);

  // 게임 시작 → 이동 → 끝내기
  students[1] = Object.assign(back, { me: students[1].me });
  students[0].send({ t: 'start' });
  students[0].send({ t: 'pos', x: 1400, y: 920 });
  teacher.clear();
  students[0].clear();

  // 미션 문제 올리기
  teacher.send({ t: 'start' });
  check('문제 세트가 없으면 시작할 수 없다', (await teacher.type('error')).code === 'need_questions');
  teacher.send({ t: 'questions', set: { title: '엉터리', questions: [{ q: '', a: '' }, { q: '오답이 정답과 같음', a: '가', wrong: ['가'] }] } });
  check('쓸 수 있는 문제가 없는 세트는 거절', (await teacher.type('error')).code === 'bad_questions');
  students[0].send({ t: 'questions', set: { title: '학생이 보냄', questions: [{ q: '1+1', a: '2' }] } });
  const QSET = {
    title: '시험 세트',
    questions: [
      { q: '우리나라의 수도는?', a: '서울', wrong: [], alts: ['서울특별시'] },
      { q: '1 더하기 1은?', a: '2', wrong: ['1', '3', '4'] },
      { q: '빈 문제는 빠진다', a: '' },
    ],
  };
  teacher.send({ t: 'questions', set: QSET });
  view = await teacher.next((m) => m.t === 'room' && m.qset);
  check('문제 세트를 올리면 쓸 수 있는 문제만 센다', view.qset.title === '시험 세트' && view.qset.count === 2);
  check('방 정보에 문제 내용·정답이 섞여 나가지 않는다', !JSON.stringify(view).includes('서울'));
  teacher.send({ t: 'settings', missions: 3 });
  await teacher.next((m) => m.t === 'room' && m.settings.missions === 3);
  teacher.clear();

  teacher.send({ t: 'settings', mode: 'mafia', fogLoot: false });
  await teacher.next((m) => m.t === 'room' && m.settings.mode === 'mafia' && m.settings.fogLoot === false);
  teacher.send({ t: 'start' });
  // 꿈도둑을 찾아라도 시작된다 (자세한 시험은 test-mafia.js). 확인 뒤 대기방으로 돌아가 잠귀신 술래잡기 시험을 이어 간다.
  const impView = await teacher.next((m) => m.t === 'room' && m.phase === 'game' || m.t === 'error');
  check('15-1. 새 모드 id mafia 로 시작이 된다', impView.t === 'room' && impView.settings.mode === 'mafia');
  teacher.send({ t: 'end' });
  await teacher.next((m) => m.t === 'room' && m.phase === 'lobby');
  for (const c of students) c.clear(); // 꿈도둑을 찾아라 판에서 받은 알림은 지운다
  // 안개·보급은 test-fog.js·test-loot.js 에서 따로 본다 (여기서는 끄고 예전 규칙만 확인)
  teacher.send({ t: 'settings', mode: 'sleep-tag', chasers: 'auto', minutes: 5, fogLoot: false });
  await teacher.next((m) => m.t === 'room' && m.settings.mode === 'sleep-tag' && m.settings.minutes === 5);
  teacher.clear();

  teacher.send({ t: 'start' });
  view = await teacher.next((m) => m.t === 'room' && m.phase === 'game');
  const startedAt = Date.now();
  // 잠귀신이 누구로 뽑혔는지 보고, students[0] 은 학생·chaser 는 술래가 되도록 맞춘다
  const roleOf = (v, c) => v.players.find((p) => p.id === c.me.id).role;
  check('15-1. sleep-tag 로 시작된다', view.settings.mode === 'sleep-tag');
  check('4명이면 잠귀신 1명·학생 3명으로 나뉜다', view.players.filter((p) => p.role === 'chaser').length === 1 && view.players.filter((p) => p.role === 'student').length === 3);
  if (roleOf(view, students[0]) === 'chaser') [students[0], students[2]] = [students[2], students[0]];
  const chaser = students.find((c) => roleOf(view, c) === 'chaser');
  const helper = students.find((c) => c !== students[0] && c !== chaser && c !== students[3]) || students[3];
  const meInfo = await students[0].type('me');
  check('시작하면 내 역할과 켤 랜턴 수를 알려 준다', meInfo.role === 'student' && meInfo.solved === 0 && meInfo.missions === 3 && view.progress.goal === 9);
  check('남은 시간을 알려 준다', view.timeLeft > 4 * 60_000 && view.timeLeft <= 5 * 60_000);
  const p0 = view.players.find((p) => p.id === students[0].me.id);
  check('시작하면 모든 학생에게 시작 자리가 정해진다', view.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  check('시작 자리가 서로 겹치지 않는다', new Set(view.players.map((p) => `${p.x},${p.y}`)).size === 4);
  // 게임 도중 입장
  const late = client();
  await late.open();
  late.send({ t: 'join', code, name: '늦은친구' });
  late.me = await late.type('joined');
  view = await late.next((m) => m.t === 'room' && m.phase === 'game');
  const lateP = view.players.find((p) => p.id === late.me.id);
  check('게임 중인 방에도 들어올 수 있고 자리가 정해진다', view.players.length === 5 && Number.isFinite(lateP.x));
  late.send({ t: 'pos', x: lateP.x + 10, y: lateP.y, f: 1, m: 1 });
  let lateSt = await teacher.next((m) => m.t === 'state' && m.p.some((r) => r[0] === late.me.id && r[1] === lateP.x + 10));
  check('도중에 들어온 학생도 움직일 수 있다', !!lateSt);
  await late.close();
  const again = client();
  await again.open();
  again.send({ t: 'join', code, name: '늦은친구' });
  again.me = await again.type('joined');
  check('연결이 끊긴 학생은 같은 이름으로 다시 들어와 이어 한다', again.me.id === late.me.id);
  again.send({ t: 'leave' });
  await again.type('left');
  teacher.clear();
  students[0].send({ t: 'pos', x: p0.x + 12, y: p0.y, f: 1, m: 1 });
  const at = (m, id) => m.p.find((r) => r[0] === id);
  let st = await teacher.next((m) => m.t === 'state' && at(m, students[0].me.id)[1] === p0.x + 12);
  check('움직이면 다른 화면에 위치가 전달된다', at(st, students[0].me.id)[4] === 1);
  students[0].send({ t: 'pos', x: p0.x + 900, y: p0.y, f: 1, m: 1 });
  const fix = await students[0].type('fix');
  check('순간이동처럼 멀리 뛰면 되돌린다', fix.x === p0.x + 12 && fix.y === p0.y);
  await new Promise((r) => setTimeout(r, 1100));
  students[0].send({ t: 'pos', x: 60, y: 60, f: 1, m: 1 });
  students[0].send({ t: 'pos', x: 'abc', y: null });
  teacher.send({ t: 'pos', x: 1, y: 1 });
  await new Promise((r) => setTimeout(r, 250));
  teacher.clear();
  st = await teacher.type('state');
  check('건물 밖·벽 속 위치는 받아 주지 않는다', at(st, students[0].me.id)[1] === p0.x + 12);
  // 문을 지나 체육관 밖 복도까지 걸어가 본다 (서버가 벽으로 막지 않는지)
  let wx = p0.x + 12;
  let wy = p0.y;
  let blocked = false;
  const onFix = () => (blocked = true);
  students[0].ws.on('message', (raw) => JSON.parse(raw.toString()).t === 'fix' && onFix());
  const walkTo = async (tx, ty) => {
    while (wx !== tx || wy !== ty) {
      wx += Math.max(-20, Math.min(20, tx - wx));
      wy += Math.max(-20, Math.min(20, ty - wy));
      students[0].send({ t: 'pos', x: wx, y: wy, f: 1, m: 1 });
      await new Promise((r) => setTimeout(r, 70));
    }
  };
  await walkTo(1400, 920);

  // 랜턴에서 퀴즈 풀기 (t8 은 큰 체육관 오른쪽 아래 1820,1240)
  students[0].clear();
  students[0].send({ t: 'open', terminal: 't8' });
  check('랜턴에서 멀면 퀴즈가 열리지 않는다', (await students[0].type('error')).code === 'too_far');
  await walkTo(1780, 1200);
  await new Promise((r) => setTimeout(r, 150));
  const solveOnce = async (terminal) => {
    students[0].send({ t: 'open', terminal });
    const q = await students[0].type('question');
    const answerOf = (wrong) => {
      if (q.kind === 'short') return wrong ? '부산' : ' 서울특별시 ';
      const right = q.choices.indexOf('2');
      return wrong ? (right + 1) % q.choices.length : right;
    };
    return { q, answerOf };
  };
  let cur = await solveOnce('t8');
  check('문제에는 정답 표시가 없다', !('a' in cur.q) && !('answer' in cur.q) && (cur.q.kind === 'short' ? !cur.q.choices : cur.q.choices.length === 4));
  students[0].send({ t: 'answer', value: cur.answerOf(true) });
  let res = await students[0].type('result');
  check('틀리면 오답 알림과 5초 잠금', res.ok === false && res.attempts === 1 && res.lockMs === 5000);
  students[0].send({ t: 'answer', value: cur.answerOf(false) });
  await new Promise((r) => setTimeout(r, 300));
  students[0].send({ t: 'open', terminal: 't8' });
  const reopened = await students[0].type('question');
  check('잠금 중에는 정답을 내도 받지 않는다 (같은 문제가 그대로 열려 있다)', reopened.text === cur.q.text && reopened.attempts === 1 && reopened.lockMs > 3000);
  await new Promise((r) => setTimeout(r, 4900));
  students[0].send({ t: 'answer', value: cur.answerOf(true) });
  res = await students[0].type('result');
  const helped = cur.q.kind === 'short' ? res.help && res.help.length === 2 : res.removed.length === 1;
  check('두 번 틀리면 도움을 준다 (글자 수 / 보기 하나 지우기)', res.ok === false && res.attempts === 2 && helped, JSON.stringify(res));
  await new Promise((r) => setTimeout(r, 5100));
  students[0].clear();
  teacher.clear();
  students[0].send({ t: 'answer', value: cur.answerOf(false) });
  res = await students[0].type('result');
  const meAfter = await students[0].type('me');
  check('맞히면 내 랜턴 수가 오른다', res.ok === true && meAfter.solved === 1 && meAfter.done.includes('t8'));
  view = await teacher.next((m) => m.t === 'room' && m.progress && m.progress.solved === 1);
  check('맞히면 새벽빛이 오른다', view.progress.goal === 9 &&view.players.find((p) => p.id === students[0].me.id).solved === 1);
  students[0].send({ t: 'open', terminal: 't8' });
  check('이미 켠 랜턴은 다시 열 수 없다', (await students[0].type('error')).code === 'terminal_done');

  // ── 잠귀신 술래잡기: 꿈 걸기와 깨우기 ── (students[0] 은 지금 1780,1200 에 서 있다)
  const walker = (c, v) => {
    const start = v.players.find((p) => p.id === c.me.id);
    let x = start.x;
    let y = start.y;
    return async (tx, ty) => {
      while (x !== tx || y !== ty) {
        x += Math.max(-20, Math.min(20, tx - x));
        y += Math.max(-20, Math.min(20, ty - y));
        c.send({ t: 'pos', x, y, f: 1, m: 1 });
        await new Promise((r) => setTimeout(r, 70));
      }
    };
  };
  const frozenOf = (v, c) => v.players.find((p) => p.id === c.me.id).frozen;
  await new Promise((r) => setTimeout(r, Math.max(0, 10200 - (Date.now() - startedAt)))); // 시작 뒤 10초는 꿈을 못 건다
  teacher.clear();
  students[0].send({ t: 'tag' }); // 학생은 꿈 걸기를 쓸 수 없다
  chaser.clear();
  chaser.send({ t: 'tag' }); // 멀리서 헛손질
  const miss = await chaser.type('me');
  check('멀리서는 꿈에 빠지지 않는다 (헛손질 뒤 잠깐 쉼)', miss.role === 'chaser' && miss.tagMs > 0 && miss.tagMs <= 800);
  const chaserWalk = walker(chaser, view);
  await chaserWalk(1400, 920);
  await chaserWalk(1740, 1200);
  await new Promise((r) => setTimeout(r, 900));
  teacher.clear();
  students[0].clear();
  chaser.send({ t: 'tag' });
  const tagEv = await teacher.next((m) => m.t === 'event' && m.kind === 'tag');
  view = await teacher.next((m) => m.t === 'room' && m.players.some((p) => p.frozen));
  check('잠귀신이 가까이에서 꿈을 걸면 학생이 꿈에 빠진다', tagEv.id === students[0].me.id && tagEv.by === chaser.me.id && frozenOf(view, students[0]));
  students[0].send({ t: 'pos', x: 1790, y: 1200, f: 1, m: 1 });
  check('꿈에 빠지면 움직일 수 없다', (await students[0].type('fix')).x === 1780);
  students[0].send({ t: 'open', terminal: 't1' });
  const helperWalk = walker(helper, view);
  await helperWalk(1400, 920);
  await helperWalk(1780, 1150);
  await new Promise((r) => setTimeout(r, 200));
  helper.send({ t: 'thawStart', id: students[0].me.id });
  helper.send({ t: 'thawEnd' }); // 너무 빨리 뗌
  await new Promise((r) => setTimeout(r, 300));
  teacher.clear();
  helper.send({ t: 'thawStart', id: students[0].me.id });
  await new Promise((r) => setTimeout(r, 1300));
  helper.send({ t: 'thawEnd' });
  const thawEv = await teacher.next((m) => m.t === 'event' && (m.kind === 'thaw' || m.kind === 'tag'));
  view = await teacher.next((m) => m.t === 'room' && !frozenOf(m, students[0]));
  const freed = view.players.find((p) => p.id === students[0].me.id);
  check('깨우기는 1.2초를 다 눌러야 깨어난다 (바로 떼면 안 깨어남)', thawEv.kind === 'thaw' && thawEv.by === helper.me.id);
  check('깨어난 뒤에는 잠깐 보호된다', !freed.frozen && freed.protMs > 2500);
  teacher.clear();
  chaser.send({ t: 'tag' }); // 쿨타임 중 + 보호 중
  await new Promise((r) => setTimeout(r, 400));
  teacher.send({ t: 'settings', missions: 8 }); // 게임 중 설정 변경은 무시된다
  students[0].clear();
  students[0].send({ t: 'pos', x: 1790, y: 1200, f: 1, m: 0 }); // 얼지 않았다면 움직임이 받아들여진다
  const st2 = await teacher.next((m) => m.t === 'state' && at(m, students[0].me.id)[1] === 1790);
  wx = 1790;
  check('꿈을 건 직후(6초)와 보호 중에는 다시 걸지 못한다', !!st2);
  await helperWalk(1700, 1000); // 도와준 친구는 비켜 준다
  blocked = false; // 얼었을 때 받은 되돌림 알림은 여기서부터 세지 않는다

  await walkTo(1400, 920);
  await walkTo(1000, 920);
  await walkTo(800, 920);
  await new Promise((r) => setTimeout(r, 250));
  teacher.clear();
  st = await teacher.type('state');
  check('문을 지나 복도까지 걸어갈 수 있다', !blocked && at(st, students[0].me.id)[1] === 800);
  await new Promise((r) => setTimeout(r, 600));
  students[0].clear(); // 앞에서 받은 되돌림 알림은 지운다
  students[0].send({ t: 'pos', x: 690, y: 800, f: 1, m: 1 }); // 매점 벽 속 (거리는 충분히 가깝다)
  const wallFix = await students[0].type('fix');
  check('가까워도 벽 속으로는 못 들어간다', wallFix.x === 800 && wallFix.y === 920);
  check('맵 검사에서 문제가 나오지 않는다', !serverLog.includes('문제가 있어요'), serverLog);
  // 15-4. 코드 폴더 어디에도 참고 게임을 가리키는 낱말이 없다 (node_modules 제외)
  const WORD = '\uCC38\uACE0\uC791';
  const found = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) scan(f);
      else if (/\.(js|json|html|css|md)$/.test(e.name) && fs.readFileSync(f, 'utf8').includes(WORD)) found.push(path.relative(path.join(here, '..'), f));
    }
  };
  scan(path.join(here, '..'));
  check('15-4. 코드 폴더에 참고 게임 언급이 없다', found.length === 0, found.join(', '));

  // ── 장치: 개구멍 (체육 창고 260,600 → 출구 3곳 중 하나) ──
  chaser.clear();
  chaser.send({ t: 'use', device: 'hole-1' });
  const notAllowed = await chaser.type('error');
  check('잠귀신은 장치를 탈 수 없다', notAllowed.code === 'not_allowed');
  check('15-3. 장치 거절 문구에 모드의 역할 이름이 들어간다', notAllowed.msg === '개구멍: 잠귀신은 탈 수 없어요!', notAllowed.msg);
  students[0].clear();
  students[0].send({ t: 'use', device: 'hole-1' });
  check('입구에서 멀면 탈 수 없다', (await students[0].type('error')).code === 'too_far');
  await walkTo(800, 460);
  await walkTo(300, 460);
  await walkTo(300, 580);
  await new Promise((r) => setTimeout(r, 200));
  teacher.clear();
  students[0].send({ t: 'use', device: 'hole-1' });
  const ride = await teacher.next((m) => m.t === 'event' && m.kind === 'ride');
  const exits = ['1000,1240', '2540,1560', '1500,1540'];
  check('개구멍에 들어가면 출구 3곳 중 한 곳으로 나온다', ride.id === students[0].me.id && exits.includes(ride.to.join(',')) && ride.ms === 1500);
  view = await teacher.next((m) => m.t === 'room' && m.players.some((p) => p.id === students[0].me.id && p.protMs > 0));
  const rider = view.players.find((p) => p.id === students[0].me.id);
  check('타는 동안과 도착 뒤 1초는 보호된다', rider.x === ride.to[0] && rider.protMs > 2000 && rider.protMs <= 2500);
  students[0].send({ t: 'pos', x: 300, y: 580, f: 1, m: 1 }); // 타는 중의 위치 알림은 무시된다
  await new Promise((r) => setTimeout(r, 1700));
  students[0].clear();
  students[0].send({ t: 'pos', x: ride.to[0] + 10, y: ride.to[1], f: 1, m: 1 });
  st = await teacher.next((m) => m.t === 'state' && at(m, students[0].me.id)[1] === ride.to[0] + 10);
  check('도착한 곳에서 이어서 움직인다', !!st);
  students[0].send({ t: 'use', device: 'hole-1' });
  const exitErr = await students[0].type('error');
  check('15-3. 출구 근처에서 타려 하면 not_entrance (입구가 있는 방 이름)', exitErr.code === 'not_entrance' && exitErr.msg.includes('체육 창고'), JSON.stringify(exitErr));
  students[0].send({ t: 'use', device: 'slide-1' });
  check('다른 장치도 멀면 탈 수 없다', (await students[0].type('error')).code === 'too_far');
  // ── 학습 기록 ──
  teacher.clear();
  students[0].clear();
  students[0].send({ t: 'report' }); // 학생은 전체 기록을 볼 수 없다
  teacher.send({ t: 'report' });
  const report = await teacher.type('report');
  const rec0 = report.records.find((r) => r.name === students[0].me.name || r.result === 'retry');
  check('선생님은 퀴즈 리포트를 받는다 (두 번 틀리고 푼 문제 = 다시 도전해 해결)', report.records.length >= 1 && rec0.source === 'lantern' && rec0.result === 'retry' && rec0.wrong === 2 && !!rec0.answer && rec0.ms > 9000);
  check('기록에 내부 식별값이 섞여 나가지 않는다', !JSON.stringify(report).includes(students[0].me.id));
  students[0].send({ t: 'myreport' });
  let mine = await students[0].type('myreport');
  check('학생은 자기 기록만 받고, 게임 중에는 정답이 없다', mine.records.length >= 1 && mine.finished === false && mine.records.every((r) => r.answer === undefined));
  check('학생에게는 전체 기록이 가지 않는다', !students[0].ws.__gotReport);

  students[0].send({ t: 'end' });
  teacher.send({ t: 'end' });
  view = await teacher.next((m) => m.t === 'room' && m.phase === 'lobby');
  check('끝내면 대기방으로 돌아온다', view.players.length === 4 && view.players[0].x === undefined);
  check('대기방에서도 지난 게임 기록 수를 알려 준다', view.recordCount >= 1);
  students[0].send({ t: 'myreport' });
  mine = await students[0].type('myreport');
  check('게임이 끝난 뒤에는 나의 기록에 정답이 함께 나온다', mine.finished === true && mine.records.every((r) => typeof r.answer === 'string'));

  // 내보내기, 시작, 방 닫기
  teacher.clear();
  teacher.send({ t: 'kick', id: students[3].me.id });
  check('내보낸 학생에게 알림이 간다', (await students[3].type('closed')).reason === 'kicked');
  teacher.send({ t: 'start' });
  check('4명 미만이면 시작할 수 없다', (await teacher.type('error')).code === 'need_players');
  teacher.send({ t: 'close' });
  check('방을 닫으면 학생에게 알림이 간다', (await students[0].type('closed')).reason === 'teacher_closed');
  stranger.send({ t: 'join', code, name: '마루' });
  check('닫힌 방에는 못 들어간다', (await stranger.type('error')).code === 'no_room');

  // 비밀번호 잠금
  const guesser = client();
  await guesser.open();
  for (let i = 0; i < 5; i++) {
    guesser.send({ t: 'create', password: 'guess' + i });
    await guesser.type('error');
  }
  guesser.send({ t: 'create', password: PASSWORD });
  check('5번 틀리면 맞는 비밀번호도 잠시 막힌다', (await guesser.type('error')).code === 'locked');
}

const server = spawn(process.execPath, [path.join(here, 'index.js')], {
  // 비밀번호를 설정한 경우의 시험 (비밀번호 없음 경로·방 제한·자동 정리는 test-rooms.js)
  env: { ...process.env, PORT: String(PORT), TEACHER_PASSWORD: PASSWORD, MAX_ROOMS: '1000', MAX_ROOMS_PER_IP: '1000', ROOM_CREATE_PER_HOUR: '1000', TEST_OVERRIDES: JSON.stringify({ createGapMs: 0 }) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const timeout = setTimeout(() => {
  console.log('실패  전체 시간 초과');
  server.kill();
  process.exit(1);
}, 90_000);

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
const ready = () =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      if (serverLog.includes('켜졌어요')) (clearInterval(timer), resolve());
    }, 50);
  });
ready().then(async () => {
  try {
    await run();
  } catch (e) {
    failed++;
    console.log('실패  시험 도중 오류 →', e.message);
  }
  clearTimeout(timeout);
  console.log(`\n결과: 통과 ${passed} · 실패 ${failed}`);
  server.once('exit', () => setTimeout(() => process.exit(failed ? 1 : 0), 100));
  server.kill();
});
