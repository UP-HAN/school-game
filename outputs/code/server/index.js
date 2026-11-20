// 게임 서버: 화면 파일 제공 + 실시간 통신(웹소켓) + 방 관리.
// 1단계 범위: 방 만들기, 입장, 대기방, 캐릭터 고르기, 재접속.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { COLORS, CHARACTERS, MODES, MAPS, LIMITS, GAME, TAG, MINUTES, IMPOSTOR, MEETINGS, chaserCount, maxChasers } from '../shared/config.js';
import { buildGrid, canStand, touchesRect, spawnPoint, validateMap } from '../shared/mapgrid.js';
import { sanitizeSet, isCorrect } from '../shared/questions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';

// 시험용 시간 줄이기 (자동 시험 npm test 만 쓴다. 실제 수업에서는 비워 둔다).
// 환경변수 TEST_OVERRIDES = {"impostor":{IMPOSTOR 상수 일부}, "minuteMs":게임 1분의 길이, "rejoinMs":끊긴 학생 정리 시간, "cleanupMs":정리 주기}
const OVR = (() => {
  try {
    return JSON.parse(process.env.TEST_OVERRIDES || '{}') || {};
  } catch {
    return {};
  }
})();
for (const [k, v] of Object.entries(OVR.impostor || {})) if (k in IMPOSTOR && Number.isFinite(v)) IMPOSTOR[k] = v;
const MINUTE_MS = Number(OVR.minuteMs) || 60_000;
const REJOIN_MS = Number(OVR.rejoinMs) || LIMITS.rejoinSeconds * 1000;
const CLEANUP_MS = Number(OVR.cleanupMs) || 15_000;
if (process.env.TEST_OVERRIDES) console.log('시험용 시간 설정을 쓰는 중이에요.');

// ───────────── 맵 읽기 ─────────────
const maps = new Map(); // 맵 id → { data, grid }
for (const m of MAPS) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', m.id + '.json'), 'utf8'));
  const grid = buildGrid(data);
  const problems = validateMap(data, grid, GAME.radius);
  if (problems.length) console.log(`맵 ${m.id} 에 문제가 있어요:\n - ` + problems.join('\n - '));
  maps.set(m.id, { data, grid });
}

// ───────────── 화면 파일 제공 ─────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
// 주소 앞부분 → 실제 폴더. 여기 없는 폴더(server, node_modules, .env 등)는 절대 내려 주지 않는다.
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/maps/', path.join(ROOT, 'maps')],
  ['/', path.join(ROOT, 'client')],
];

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const mount = MOUNTS.find(([prefix]) => pathname.startsWith(prefix));
  const file = path.resolve(mount[1], '.' + pathname.slice(mount[0].length - 1));
  const type = MIME[path.extname(file).toLowerCase()];
  if (!file.startsWith(mount[1] + path.sep) || !type) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// ───────────── 방 ─────────────
const rooms = new Map(); // 방 번호 → 방
const newToken = () => crypto.randomBytes(18).toString('base64url');
const newId = () => crypto.randomBytes(6).toString('base64url');

function newRoomCode() {
  for (let i = 0; i < 200; i++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!rooms.has(code)) return code;
  }
  return null;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function fail(ws, code, msg) {
  send(ws, { t: 'error', code, msg });
}

const isImpostorGame = (room) => room.phase === 'game' && room.settings.mode === 'impostor';

// 방 정보. viewer = 받는 학생(선생님이면 null). 얼음땡·대기방은 모두에게 같은 내용,
// 방해꾼 찾기 게임 중에는 받는 사람마다 보이는 값이 다르다 (05 명세 4-3절).
function roomView(room, viewer = null) {
  const imp = isImpostorGame(room);
  const now = Date.now();
  return {
    t: 'room',
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    qset: room.qset ? { title: room.qset.title, count: room.qset.questions.length } : null,
    recordCount: room.records.length,
    ...(room.phase === 'game'
      ? {
          progress: { solved: room.solvedTotal, goal: goalOf(room) },
          over: room.over,
          timeLeft: imp && room.meeting ? room.pausedLeft : Math.max(0, room.endsAt - now),
        }
      : null),
    ...(imp
      ? {
          meetingsLeft: room.meetingsLeft,
          marks: room.marks.map(({ id, x, y, color, character }) => ({ id, x, y, color, character })),
          sabo: {
            blackoutMs: Math.max(0, room.sabo.blackoutUntil - now),
            lockedDoor: room.sabo.lock ? room.sabo.lock.door : null,
            lockMs: room.sabo.lock ? Math.max(0, room.sabo.lock.until - now) : 0,
          },
          meeting: room.meeting ? meetingView(room, viewer, now) : null,
        }
      : null),
    teacherConnected: !!room.teacherWs,
    players: [...room.players.values()].map((p) =>
      imp
        ? impostorPlayerView(room, p, viewer, now)
        : {
            id: p.id,
            name: p.name,
            color: p.color,
            character: p.character,
            connected: !!p.ws,
            ...(room.phase === 'game'
              ? { x: p.x, y: p.y, solved: p.solved, role: p.role, frozen: p.frozen, protMs: Math.max(0, p.protUntil - now) }
              : null),
          },
    ),
  };
}

// 방해꾼 찾기: 한 사람(p)이 받는 사람(viewer)에게 어떻게 보이나 (05 명세 4-3절 표)
function impostorPlayerView(room, p, viewer, now) {
  const all = !viewer || !!room.over; // 선생님, 또는 게임이 끝난 뒤에는 모두 공개
  const self = !!viewer && viewer.id === p.id;
  const vChaser = !!viewer && viewer.role === 'chaser';
  const seesGhosts = all || vChaser || viewer.ghost; // 유령의 위치·상태를 모두 아는가
  const o = {
    id: p.id,
    name: p.name,
    color: p.color,
    character: p.character,
    connected: !!p.ws,
    frozen: false,
    protMs: Math.max(0, p.protUntil - now),
  };
  const trueLook = all || vChaser; // 위장의 진짜 모습을 아는가
  if (p.disguise && !trueLook) {
    o.color = p.disguise.color;
    o.character = p.disguise.character;
  }
  if (p.disguise && trueLook) {
    o.disguise = { color: p.disguise.color, character: p.disguise.character, ms: Math.max(0, p.disguise.until - now) };
  }
  if (!p.ghost || seesGhosts || self) {
    o.x = p.x;
    o.y = p.y;
  }
  if (all || self || (vChaser && p.role === 'chaser')) o.role = p.role;
  if (all || self || seesGhosts || p.ghostKnown) {
    o.ghost = p.ghost;
    o.ejected = p.ejected;
  }
  if (all || self) o.solved = p.solved;
  return o;
}

// 회의 화면에 쓸 값. 누가 누구를 찍었는지(votes)는 보내지 않는다. myVote 는 본인 것만.
function meetingView(room, viewer, now) {
  const m = room.meeting;
  return {
    stage: m.stage,
    msLeft: Math.max(0, m.stageEndsAt - now),
    reason: m.reason,
    ...(m.reason === 'report' ? { reporter: m.reporter, found: m.found } : null),
    voted: [...m.votes.keys()],
    ...(viewer && m.votes.has(viewer.id) ? { myVote: m.votes.get(viewer.id) } : null),
    canVote: !!viewer && m.voters.has(viewer.id),
    extended: m.extended,
    cards: [...room.players.values()].map((p) => ({ id: p.id, color: p.color, character: p.character, ghost: p.ghost, ejected: p.ejected })),
    ...(m.result ? { result: m.result } : null),
  };
}

// ───────────── 미션(문제) ─────────────
const WRONG_LOCK_MS = 5000; // 틀린 뒤 다시 답할 수 있을 때까지
const TERMINAL_REACH = 95; // 단말기에서 이만큼 안에 있어야 문제를 열 수 있다

// 학교를 다 고치려면 풀어야 하는 문제 수 = 학생 수 × 학생당 미션 수
function goalOf(room) {
  let students = 0;
  for (const p of room.players.values()) if (p.role !== 'chaser') students++;
  return Math.max(1, students * room.settings.missions);
}
function initPlayerGame(p, role, now, mode) {
  p.role = role; // 'student' 또는 'chaser'(얼음땡 술래 / 방해꾼 찾기 방해꾼)
  p.frozen = false;
  p.protUntil = 0; // 이때까지는 잡히지 않는다
  p.tagReadyAt = now + (mode === 'impostor' ? IMPOSTOR.freezeGraceMs : TAG.graceMs); // 다음에 잡을(얼릴) 수 있는 때
  // 방해꾼 찾기 칸 (얼음땡에서는 쓰지 않는다)
  p.ghost = false; // 유령인가 (얼려졌거나 제외됨)
  p.ghostKnown = false; // 다른 사람들이 그 사실을 아는가
  p.ejected = false; // 투표로 제외되었나
  p.usedButton = false; // 긴급회의 버튼을 이미 썼나
  p.disguise = null; // 위장 중이면 { color, character, until }
  p.disguiseLeft = IMPOSTOR.disguisePerGame;
  p.rideUntil = 0; // 미끄럼틀·개구멍을 타는 중이면 끝나는 때
  p.devReadyAt = {}; // 장치별로 다시 탈 수 있는 때
  p.thaw = null; // 땡 버튼을 누르기 시작한 기록
  p.solved = 0;
  p.done = new Set(); // 이미 푼 단말기
  p.seen = new Set(); // 이미 본 문제 번호
  p.missed = new Set(); // 보고도 못 푼 문제 번호
  p.current = null; // 지금 열어 둔 문제
}
function sendMe(room, p) {
  const now = Date.now();
  const msg = {
    t: 'me',
    role: p.role,
    solved: p.solved,
    missions: room.settings.missions,
    done: [...p.done],
    tagMs: Math.max(0, p.tagReadyAt - now),
  };
  if (isImpostorGame(room)) {
    msg.ghost = p.ghost;
    msg.freezeMs = msg.tagMs;
    msg.disguiseLeft = p.disguiseLeft;
    msg.usedButton = p.usedButton;
    msg.buttonMs = Math.max(0, room.buttonReadyAt - now);
    msg.saboMs = { blackout: 0, lock: 0 };
    if (p.role === 'chaser') {
      msg.mates = [...room.players.values()].filter((q) => q.role === 'chaser' && q.id !== p.id).map((q) => q.id);
      msg.saboMs = {
        blackout: Math.max(0, room.sabo.readyAt.blackout - now),
        lock: Math.max(0, room.sabo.readyAt.lock - now),
      };
    }
  }
  send(p.ws, msg);
}
// "방금 일어난 일"을 알린다 (잡기, 땡, 장치 타기 연출용). who(p) 를 주면 그 학생들 + 선생님에게만.
function sendEvent(room, ev, who = null) {
  const msg = JSON.stringify({ t: 'event', ...ev });
  const list = [room.teacherWs, ...[...room.players.values()].filter((p) => !who || who(p)).map((p) => p.ws)];
  for (const ws of list) {
    if (ws && ws.readyState === 1) ws.send(msg);
  }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function endGame(room, winner, reason) {
  if (room.over) return;
  room.over = { winner, reason };
  room.meeting = null;
  for (const p of room.players.values()) closeCurrent(room, p, 'unsolved');
}
// 방해꾼 찾기 승패 (05 명세 2-8절, 위에서부터). 시간 끝(④)은 stateTick 에서 따로 본다.
function checkImpostorWin(room) {
  if (room.over || !isImpostorGame(room)) return;
  let chasers = 0;
  let students = 0;
  for (const p of room.players.values()) {
    if (p.ghost) continue;
    if (p.role === 'chaser') chasers++;
    else students++;
  }
  if (chasers === 0) return endGame(room, 'students', 'all_found');
  if (room.solvedTotal >= goalOf(room)) return endGame(room, 'students', 'restored');
  if (students <= chasers) return endGame(room, 'chasers', 'outnumbered');
}
// 학생이 모두 얼었으면 술래 승리
function checkAllFrozen(room) {
  const students = [...room.players.values()].filter((p) => p.role === 'student');
  if (students.length && students.every((p) => p.frozen)) endGame(room, 'chasers', 'all_frozen');
}
// 아직 안 본 문제 → 못 풀었던 문제 → 아무 문제 순서로 고른다
function pickQuestion(room, p) {
  const all = room.qset.questions.map((_, i) => i);
  const fresh = all.filter((i) => !p.seen.has(i));
  const pool = fresh.length ? fresh : p.missed.size ? [...p.missed] : all;
  return pool[crypto.randomInt(pool.length)];
}
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function questionMessage(room, cur) {
  const q = room.qset.questions[cur.qi];
  return {
    t: 'question',
    terminal: cur.terminal,
    kind: q.kind,
    text: q.q,
    choices: q.kind === 'choice' ? cur.order : undefined,
    removed: cur.removed,
    attempts: cur.attempts,
    help: helpFor(q, cur),
    lockMs: Math.max(0, cur.lockUntil - Date.now()),
  };
}
// 오답 도움: 주관식은 2번 틀리면 글자 수, 3번 틀리면 첫 글자까지
function helpFor(q, cur) {
  if (q.kind !== 'short' || cur.attempts < 2) return null;
  const chars = [...q.a];
  return { length: chars.length, first: cur.attempts >= 3 ? chars[0] : undefined };
}
function closeCurrent(room, p, result) {
  const cur = p.current;
  if (!cur) return;
  p.current = null;
  if (result === 'cancel') {
    // 회의 때문에 닫힘: 기록하지 않고, 나중에 다시 나올 수 있게 "못 푼 문제"에만 넣는다
    p.missed.add(cur.qi);
    return;
  }
  const q = room.qset.questions[cur.qi];
  if (result === 'unsolved') p.missed.add(cur.qi);
  else p.missed.delete(cur.qi);
  room.records.push({
    pid: p.id,
    name: p.name,
    color: p.color,
    character: p.character,
    question: q.q,
    answer: q.a,
    kind: q.kind,
    result, // 'first' 첫 시도 정답 · 'retry' 다시 도전해 해결 · 'unsolved' 못 풂
    role: p.role, // 'student' · 'chaser' (방해꾼 찾기에서는 방해꾼의 가짜 미션)
    ghost: !!p.ghost, // 유령일 때 푼 문제인가
    wrong: cur.attempts,
    ms: Date.now() - cur.openedAt,
  });
}
function broadcast(room) {
  if (isImpostorGame(room)) {
    send(room.teacherWs, roomView(room, null));
    for (const p of room.players.values()) send(p.ws, roomView(room, p));
    return;
  }
  const msg = JSON.stringify(roomView(room));
  for (const ws of [room.teacherWs, ...[...room.players.values()].map((p) => p.ws)]) {
    if (ws && ws.readyState === 1) ws.send(msg);
  }
}

function closeRoom(room, reason) {
  for (const p of room.players.values()) {
    send(p.ws, { t: 'closed', reason });
    if (p.ws) p.ws.session = null;
  }
  send(room.teacherWs, { t: 'closed', reason });
  if (room.teacherWs) room.teacherWs.session = null;
  rooms.delete(room.code);
}

// 학생을 방에서 뺀다 (나가기·내보내기·오래 끊김 정리)
function removePlayer(room, p) {
  room.players.delete(p.id);
  if (room.pickedChasers.includes(p.id)) {
    room.pickedChasers = room.pickedChasers.filter((id) => id !== p.id);
    send(room.teacherWs, { t: 'picked', ids: room.pickedChasers });
  }
  if (isImpostorGame(room) && !room.over) {
    if (room.meeting) {
      room.meeting.voters.delete(p.id);
      room.meeting.votes.delete(p.id);
    }
    checkImpostorWin(room);
  }
}

// ───────────── 방해꾼 찾기: 회의 ─────────────
// 회의 시작: 시계 멈춤, 문제 창 닫기(기록 없이), 방해 효과·위장·얼음 흔적 지우기, 투표자 정하기
function startMeeting(room, reason, reporter, found) {
  const now = Date.now();
  room.pausedLeft = Math.max(0, room.endsAt - now);
  for (const p of room.players.values()) {
    if (p.current) {
      closeCurrent(room, p, 'cancel');
      send(p.ws, { t: 'closeq' });
    }
    p.thaw = null;
    p.m = 0;
    p.disguise = null;
    if (p.ghost) p.ghostKnown = true;
  }
  room.sabo.blackoutUntil = 0;
  room.sabo.lock = null;
  room.marks = [];
  room.meeting = {
    stage: 'intro',
    stageEndsAt: now + IMPOSTOR.meetingIntroMs,
    reason,
    reporter,
    found,
    voters: new Set([...room.players.values()].filter((p) => !p.ghost && p.ws).map((p) => p.id)),
    votes: new Map(),
    extended: 0,
    result: null,
  };
  sendEvent(room, { kind: 'meeting', reason, ...(reason === 'report' ? { reporter, found } : null) });
  broadcast(room);
  for (const p of room.players.values()) sendMe(room, p);
}
// 투표 결과 계산: 가장 많이 받은 사람이 한 명뿐이고, 건너뛰기 표보다 많아야 제외
function meetingResult(room, now) {
  const m = room.meeting;
  const counts = { skip: 0 };
  for (const target of m.votes.values()) counts[target] = (counts[target] || 0) + 1;
  let top = 0;
  let tops = [];
  for (const [id, n] of Object.entries(counts)) {
    if (id === 'skip') continue;
    if (n > top) (top = n), (tops = [id]);
    else if (n === top) tops.push(id);
  }
  const tie = tops.length > 1;
  const ejected = !tie && top > 0 && top > counts.skip ? tops[0] : null;
  m.result = { ejected, tie, counts };
  const out = ejected && room.players.get(ejected);
  if (out && room.settings.reveal) m.result.role = out.role;
  m.stage = 'result';
  m.stageEndsAt = now + IMPOSTOR.resultMs;
  if (ejected) sendEvent(room, { kind: 'eject', id: ejected, ...(m.result.role ? { role: m.result.role } : null) });
}
// 회의 끝: 제외 적용 → 승패 확인 → 모두 시작 자리로, 시계 다시 흐름
function endMeeting(room, now) {
  const m = room.meeting;
  room.meeting = null;
  const out = m.result && m.result.ejected && room.players.get(m.result.ejected);
  if (out) {
    out.ghost = true;
    out.ghostKnown = true;
    out.ejected = true;
    out.disguise = null;
  }
  checkImpostorWin(room);
  if (!room.over) {
    const map = maps.get(room.settings.map);
    let i = 0;
    for (const p of room.players.values()) {
      [p.x, p.y] = spawnPoint(map.data, i++, room.players.size);
      p.f = 1;
      p.m = 0;
      p.movedAt = now;
      p.rideUntil = 0;
      if (p.role === 'chaser') p.tagReadyAt = now + IMPOSTOR.freezeAfterMeetingMs;
      send(p.ws, { t: 'fix', x: p.x, y: p.y });
    }
    room.endsAt = now + room.pausedLeft;
    room.buttonReadyAt = now + IMPOSTOR.buttonGraceMs;
  }
  for (const p of room.players.values()) sendMe(room, p);
}
// 회의 단계 넘기기 (stateTick 에서 부른다). 바뀌었으면 true.
function advanceMeeting(room, now) {
  const m = room.meeting;
  if (m.stage === 'vote' && [...m.voters].every((id) => m.votes.has(id))) {
    meetingResult(room, now); // 투표할 수 있는 사람이 모두 냈으면 바로 결과
    return true;
  }
  if (now < m.stageEndsAt) return false;
  if (m.stage === 'intro') {
    m.stage = 'discuss';
    m.stageEndsAt = now + IMPOSTOR.discussMs;
  } else if (m.stage === 'discuss') {
    m.stage = 'vote';
    m.stageEndsAt = now + IMPOSTOR.voteMs;
  } else if (m.stage === 'vote') meetingResult(room, now);
  else endMeeting(room, now);
  return true;
}

// ───────────── 선생님 비밀번호 ─────────────
const passwordFails = new Map(); // IP → { count, lockedUntil }
const MAX_FAILS = 5;
const LOCK_MS = 60_000;

function passwordMatches(input) {
  if (!TEACHER_PASSWORD || typeof input !== 'string') return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(TEACHER_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ───────────── 메시지 처리 ─────────────
const cleanName = (s) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
const validCharacter = (id) => CHARACTERS.some((c) => c.id === id);

const handlers = {
  // 선생님: 방 만들기
  create(ws, m) {
    if (ws.session) return fail(ws, 'already_in_room', '이미 방에 들어와 있어요.');
    if (!TEACHER_PASSWORD) {
      return fail(ws, 'no_password_set', '서버에 선생님 비밀번호가 설정되지 않았어요. (.env 파일)');
    }
    const now = Date.now();
    const rec = passwordFails.get(ws.ip) || { count: 0, lockedUntil: 0 };
    if (rec.lockedUntil > now) {
      const sec = Math.ceil((rec.lockedUntil - now) / 1000);
      return fail(ws, 'locked', `비밀번호를 여러 번 틀렸어요. ${sec}초 뒤에 다시 해 주세요.`);
    }
    if (!passwordMatches(m.password)) {
      rec.count += 1;
      if (rec.count >= MAX_FAILS) {
        rec.count = 0;
        rec.lockedUntil = now + LOCK_MS;
      }
      passwordFails.set(ws.ip, rec);
      return fail(ws, 'bad_password', '비밀번호가 맞지 않아요.');
    }
    passwordFails.delete(ws.ip);
    if (rooms.size >= LIMITS.maxRooms) return fail(ws, 'server_full', '지금 열린 방이 너무 많아요.');
    const code = newRoomCode();
    if (!code) return fail(ws, 'server_full', '방 번호를 만들지 못했어요.');
    const room = {
      code,
      phase: 'lobby',
      settings: {
        mode: MODES[0].id,
        map: MAPS[0].id,
        chasers: 'auto',
        missions: 5,
        minutes: 10,
        meetings: IMPOSTOR.meetingsDefault, // 방해꾼 찾기: 긴급회의 총 횟수
        reveal: true, // 방해꾼 찾기: 제외된 사람의 정체 공개
      },
      pickedChasers: [], // 선생님이 직접 고른 방해꾼 (선생님에게만 보낸다. settings 에 넣지 않는다)
      meetingsLeft: 0,
      marks: [], // 얼음 흔적
      sabo: { blackoutUntil: 0, lock: null, graceUntil: 0, readyAt: { blackout: 0, lock: 0 } },
      meeting: null,
      buttonReadyAt: 0,
      pausedLeft: 0,
      endsAt: 0,
      qset: null,
      solvedTotal: 0,
      over: null,
      records: [],
      teacherToken: newToken(),
      teacherWs: ws,
      teacherLeftAt: 0,
      players: new Map(),
      createdAt: now,
    };
    rooms.set(code, room);
    ws.session = { room, role: 'teacher' };
    send(ws, { t: 'created', code, token: room.teacherToken });
    broadcast(room);
  },

  // 학생: 입장
  join(ws, m) {
    if (ws.session) return fail(ws, 'already_in_room', '이미 방에 들어와 있어요.');
    const room = rooms.get(String(m.code || '').trim());
    if (!room) return fail(ws, 'no_room', '그런 방 번호가 없어요. 번호를 다시 확인해 주세요.');
    const name = cleanName(m.name);
    if (!name || [...name].length > LIMITS.nameMax) {
      return fail(ws, 'bad_name', `이름은 1~${LIMITS.nameMax}글자로 적어 주세요.`);
    }
    const same = [...room.players.values()].find((p) => p.name === name);
    if (same) {
      // 같은 이름이 연결이 끊긴 채 남아 있으면 그 학생이 돌아온 것으로 보고 이어 준다
      if (same.ws) return fail(ws, 'name_taken', '같은 이름이 이미 있어요. 다른 이름을 써 주세요.');
      same.token = newToken();
      same.ws = ws;
      same.leftAt = 0;
      same.movedAt = Date.now();
      ws.session = { room, role: 'player', player: same };
      send(ws, { t: 'joined', code: room.code, id: same.id, token: same.token });
      broadcast(room);
      if (room.phase === 'game') sendMe(room, same);
      return;
    }
    if (room.players.size >= LIMITS.maxPlayers) return fail(ws, 'room_full', '방이 가득 찼어요.');
    const used = new Set([...room.players.values()].map((p) => p.color));
    const free = COLORS.map((_, i) => i).filter((i) => !used.has(i));
    const player = {
      id: newId(),
      token: newToken(),
      name,
      color: free[crypto.randomInt(free.length)],
      character: validCharacter(m.character)
        ? m.character
        : CHARACTERS[crypto.randomInt(CHARACTERS.length)].id,
      ws,
      leftAt: 0,
    };
    if (room.phase === 'game') {
      // 게임 도중에 들어온 학생: 시작 자리 둘레의 빈 곳에 세운다
      const map = maps.get(room.settings.map);
      [player.x, player.y] = spawnPoint(map.data, crypto.randomInt(12), 12);
      player.f = 1;
      player.m = 0;
      player.movedAt = Date.now();
      initPlayerGame(player, 'student', Date.now(), room.settings.mode); // 도중에 들어오면 학생 역할 (회의 중이면 그 회의 투표는 못 한다)
      player.protUntil = Date.now() + TAG.joinProtectMs;
    }
    room.players.set(player.id, player);
    ws.session = { room, role: 'player', player };
    send(ws, { t: 'joined', code: room.code, id: player.id, token: player.token });
    broadcast(room);
    if (room.phase === 'game') sendMe(room, player);
  },

  // 새로고침·연결 끊김 뒤 다시 들어오기
  resume(ws, m) {
    if (ws.session) return;
    const room = rooms.get(String(m.code || ''));
    const token = typeof m.token === 'string' ? m.token : '';
    if (!room || !token) return fail(ws, 'resume_failed', '이전 방을 찾지 못했어요.');
    if (token === room.teacherToken) {
      if (room.teacherWs && room.teacherWs !== ws) {
        room.teacherWs.session = null;
        room.teacherWs.close(4000, 'replaced');
      }
      room.teacherWs = ws;
      room.teacherLeftAt = 0;
      ws.session = { room, role: 'teacher' };
      send(ws, { t: 'resumed', role: 'teacher', code: room.code });
      send(ws, { t: 'picked', ids: room.pickedChasers });
      return broadcast(room);
    }
    const player = [...room.players.values()].find((p) => p.token === token);
    if (!player) return fail(ws, 'resume_failed', '이전 방을 찾지 못했어요.');
    if (player.ws && player.ws !== ws) {
      player.ws.session = null;
      player.ws.close(4000, 'replaced');
    }
    player.ws = ws;
    player.leftAt = 0;
    ws.session = { room, role: 'player', player };
    send(ws, { t: 'resumed', role: 'player', code: room.code, id: player.id });
    broadcast(room);
    if (room.phase === 'game') {
      sendMe(room, player);
      if (player.current) send(ws, questionMessage(room, player.current));
    }
  },

  // 학생: 캐릭터 바꾸기 (대기방에서만)
  character(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'lobby') return;
    if (!validCharacter(m.character)) return;
    s.player.character = m.character;
    broadcast(s.room);
  },

  // 학생: 나가기
  leave(ws) {
    const s = ws.session;
    if (!s || s.role !== 'player') return;
    removePlayer(s.room, s.player);
    ws.session = null;
    send(ws, { t: 'left' });
    broadcast(s.room);
  },

  // 선생님: 모드·맵 바꾸기
  settings(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || s.room.phase !== 'lobby') return;
    if (MODES.some((x) => x.id === m.mode)) s.room.settings.mode = m.mode;
    if (MAPS.some((x) => x.id === m.map)) s.room.settings.map = m.map;
    if (m.chasers === 'auto' || [1, 2, 3].includes(m.chasers)) s.room.settings.chasers = m.chasers;
    if ([3, 4, 5, 6, 7, 8].includes(m.missions)) s.room.settings.missions = m.missions;
    if (MINUTES.includes(m.minutes)) s.room.settings.minutes = m.minutes;
    if (MEETINGS.includes(m.meetings)) s.room.settings.meetings = m.meetings;
    if (typeof m.reveal === 'boolean') s.room.settings.reveal = m.reveal;
    broadcast(s.room);
  },

  // 선생님: 방해꾼 직접 고르기 (대기방에서만). 목록은 선생님에게만 돌려준다.
  pickChasers(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || s.room.phase !== 'lobby') return;
    const ids = Array.isArray(m.ids) ? m.ids.filter((id) => typeof id === 'string' && s.room.players.has(id)) : [];
    s.room.pickedChasers = [...new Set(ids)];
    send(ws, { t: 'picked', ids: s.room.pickedChasers });
  },

  // 선생님: 확정한 문제 세트 올리기 (대기방에서만)
  questions(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || s.room.phase !== 'lobby') return;
    const set = sanitizeSet(m.set);
    if (!set) return fail(ws, 'bad_questions', '쓸 수 있는 문제가 없어요. 문제 세트를 다시 확인해 주세요.');
    s.room.qset = set;
    broadcast(s.room);
  },

  // 학생: 단말기에서 문제 열기
  open(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return;
    const { room, player: p } = s;
    if (isImpostorGame(room)) {
      if (room.meeting) return; // 방해꾼 찾기: 방해꾼(가짜 미션)·유령도 풀 수 있다. 회의 중에는 안 된다.
    } else if (p.role !== 'student' || p.frozen) return;
    const terminal = maps.get(room.settings.map).data.terminals.find((t) => t.id === m.terminal);
    if (!terminal) return;
    if (p.current && p.current.terminal === terminal.id) return send(ws, questionMessage(room, p.current));
    if (Math.hypot(p.x - terminal.pos[0], p.y - terminal.pos[1]) > TERMINAL_REACH) {
      return fail(ws, 'too_far', '단말기에 더 가까이 가 주세요.');
    }
    if (p.solved >= room.settings.missions) return fail(ws, 'all_done', '내 미션을 모두 끝냈어요!');
    if (p.done.has(terminal.id)) return fail(ws, 'terminal_done', '이 단말기는 이미 고쳤어요. 다른 단말기를 찾아보세요.');
    closeCurrent(room, p, 'unsolved');
    const qi = pickQuestion(room, p);
    const q = room.qset.questions[qi];
    p.seen.add(qi);
    p.current = {
      terminal: terminal.id,
      qi,
      order: q.kind === 'choice' ? shuffle([q.a, ...q.wrong]) : null,
      removed: [],
      attempts: 0,
      lockUntil: 0,
      openedAt: Date.now(),
    };
    send(ws, questionMessage(room, p.current));
  },

  // 학생: 답 내기. 채점은 서버가 한다 (정답은 학생 화면으로 보내지 않는다).
  answer(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return;
    const { room, player: p } = s;
    const cur = p.current;
    if (!cur || Date.now() < cur.lockUntil) return;
    const q = room.qset.questions[cur.qi];
    let value = m.value;
    if (q.kind === 'choice') {
      if (!Number.isInteger(value) || value < 0 || value >= cur.order.length || cur.removed.includes(value)) return;
      value = cur.order[value];
    } else if (typeof value !== 'string' || !value.trim() || value.length > 100) return;

    if (isCorrect(q, value)) {
      const imp = isImpostorGame(room);
      p.solved += 1;
      p.done.add(cur.terminal);
      if (!(imp && p.role === 'chaser')) room.solvedTotal += 1; // 방해꾼의 가짜 미션은 복구율에 안 들어간다
      closeCurrent(room, p, cur.attempts === 0 ? 'first' : 'retry');
      send(ws, { t: 'result', ok: true });
      sendMe(room, p);
      if (imp) checkImpostorWin(room);
      else if (room.solvedTotal >= goalOf(room)) endGame(room, 'students', 'restored');
      return broadcast(room);
    }
    cur.attempts += 1;
    cur.lockUntil = Date.now() + WRONG_LOCK_MS;
    // 4지선다는 2번 틀리면 틀린 보기 하나를 지워 준다 (보기는 2개까지만 남긴다)
    if (q.kind === 'choice' && cur.attempts >= 2) {
      const left = cur.order.map((c, i) => i).filter((i) => !cur.removed.includes(i) && cur.order[i] !== q.a && i !== m.value);
      if (left.length && cur.order.length - cur.removed.length > 2) cur.removed.push(left[crypto.randomInt(left.length)]);
    }
    send(ws, { t: 'result', ok: false, attempts: cur.attempts, lockMs: WRONG_LOCK_MS, removed: cur.removed, help: helpFor(q, cur) });
  },

  // 학생: 문제 창 닫기 (못 푼 문제로 남는다)
  closeq(ws) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game') return;
    closeCurrent(s.room, s.player, 'unsolved');
  },

  // 선생님: 학생 내보내기
  kick(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'teacher') return;
    const p = s.room.players.get(m.id);
    if (!p) return;
    send(p.ws, { t: 'closed', reason: 'kicked' });
    if (p.ws) p.ws.session = null;
    removePlayer(s.room, p);
    broadcast(s.room);
  },

  // 선생님: 방 닫기
  close(ws) {
    const s = ws.session;
    if (!s || s.role !== 'teacher') return;
    closeRoom(s.room, 'teacher_closed');
  },

  // 선생님: 게임 시작 (2단계: 맵에서 돌아다니기까지. 역할·문제는 다음 단계)
  start(ws) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || s.room.phase !== 'lobby') return;
    const room = s.room;
    if (room.players.size < LIMITS.minPlayers) {
      return fail(ws, 'need_players', `학생이 ${LIMITS.minPlayers}명 이상 있어야 시작할 수 있어요.`);
    }
    if (!room.qset) return fail(ws, 'need_questions', '미션 문제를 먼저 올려 주세요.');
    const mode = room.settings.mode;
    const map = maps.get(room.settings.map);
    const now = Date.now();
    let chasers = null;
    if (mode === 'impostor') {
      // 선생님이 직접 고른 방해꾼이 있으면 그 학생들만 (나간 학생은 빠진다)
      room.pickedChasers = room.pickedChasers.filter((id) => room.players.has(id));
      if (room.pickedChasers.length > maxChasers(mode, room.players.size)) {
        return fail(ws, 'too_many_chasers', `방해꾼이 너무 많아요. 지금 인원이면 ${maxChasers(mode, room.players.size)}명까지 고를 수 있어요.`);
      }
      if (room.pickedChasers.length) chasers = new Set(room.pickedChasers);
    }
    if (!chasers) {
      // 술래 뽑기: 인원에 맞춘 수만큼 무작위로
      const order = shuffle([...room.players.keys()]);
      chasers = new Set(order.slice(0, chaserCount(room.settings, order.length)));
    }
    let i = 0;
    for (const p of room.players.values()) {
      [p.x, p.y] = spawnPoint(map.data, i++, room.players.size);
      p.f = 1;
      p.m = 0;
      p.movedAt = now;
      p.rideUntil = 0;
      initPlayerGame(p, chasers.has(p.id) ? 'chaser' : 'student', now, mode);
    }
    // 방해꾼 찾기 값 초기화
    room.meetingsLeft = room.settings.meetings;
    room.marks = [];
    const graceUntil = now + IMPOSTOR.sabotageGraceMs;
    room.sabo = { blackoutUntil: 0, lock: null, graceUntil, readyAt: { blackout: graceUntil, lock: graceUntil } };
    room.meeting = null;
    room.pausedLeft = 0;
    room.buttonReadyAt = now + IMPOSTOR.buttonGraceMs;
    room.endsAt = now + room.settings.minutes * MINUTE_MS;
    room.solvedTotal = 0;
    room.over = null;
    room.records = [];
    room.phase = 'game';
    broadcast(room);
    for (const p of room.players.values()) sendMe(room, p);
  },

  // 선생님: 게임 끝내고 대기방으로
  end(ws) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || s.room.phase !== 'game') return;
    s.room.phase = 'lobby';
    s.room.meeting = null;
    broadcast(s.room);
  },

  // 학생: 내 위치 알리기. 벽 속이거나 너무 멀리 뛰었으면 받아 주지 않고 되돌린다.
  pos(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game') return;
    const p = s.player;
    const { x, y } = m;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now();
    if (now < p.rideUntil) return; // 장치를 타는 중에는 서버가 정한 도착점이 위치다
    if (p.frozen) return send(ws, { t: 'fix', x: p.x, y: p.y }); // 얼면 못 움직인다
    if (s.room.meeting && isImpostorGame(s.room)) return send(ws, { t: 'fix', x: p.x, y: p.y }); // 회의 중에는 아무도 못 움직인다
    const dt = Math.min(1, (now - p.movedAt) / 1000);
    const reach = GAME.speed * 1.25 * dt + 24;
    const grid = maps.get(s.room.settings.map).grid;
    const r = GAME.radius - 4;
    // 잠긴 문은 벽처럼 막힌다. 단 이미 그 문 칸에 서 있던 사람은 빠져나올 수 있다 (끼임 방지)
    const lock = isImpostorGame(s.room) && s.room.sabo.lock;
    const lockedOut = lock && touchesRect(grid, lock.rect, x, y, r) && !touchesRect(grid, lock.rect, p.x, p.y, r);
    if (Math.hypot(x - p.x, y - p.y) > reach || !canStand(grid, x, y, r) || lockedOut) {
      p.m = 0;
      return send(ws, { t: 'fix', x: p.x, y: p.y });
    }
    p.x = Math.round(x);
    p.y = Math.round(y);
    p.f = m.f === -1 ? -1 : 1;
    p.m = m.m ? 1 : 0;
    p.movedAt = now;
  },

  // 선생님: 학습 기록 전체 (게임 중에도, 끝난 뒤 대기방에서도 볼 수 있다. 다음 게임을 시작하면 지워진다)
  report(ws) {
    const s = ws.session;
    if (!s || s.role !== 'teacher') return;
    const { room } = s;
    send(ws, {
      t: 'report',
      title: room.qset ? room.qset.title : '',
      code: room.code,
      missions: room.settings.missions,
      records: room.records.map(({ pid, ...r }) => r),
    });
  },

  // 학생: 나의 기록 (내 것만. 정답은 게임이 끝난 뒤에만 알려 준다)
  myreport(ws) {
    const s = ws.session;
    if (!s || s.role !== 'player') return;
    const { room, player: p } = s;
    const finished = room.phase !== 'game' || !!room.over;
    send(ws, {
      t: 'myreport',
      finished,
      records: room.records
        .filter((r) => r.pid === p.id)
        .map((r) => ({ question: r.question, result: r.result, wrong: r.wrong, ms: r.ms, answer: finished ? r.answer : undefined })),
    });
  },

  // 술래: 잡기. 가장 가까운 학생 한 명을 얼린다.
  tag(ws) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return;
    const { room, player: p } = s;
    if (isImpostorGame(room)) return freezeTag(room, p);
    const now = Date.now();
    if (p.role !== 'chaser' || now < p.tagReadyAt) return;
    let target = null;
    let best = TAG.reach + 8; // 화면과 서버의 위치 차이만큼 조금 넉넉하게
    for (const q of room.players.values()) {
      if (q.role !== 'student' || q.frozen || now < q.protUntil || now < q.rideUntil) continue;
      const d = dist(p, q);
      if (d <= best) (target = q), (best = d);
    }
    if (!target) {
      p.tagReadyAt = now + 800; // 헛손질: 마구 누르지 못하게 잠깐 쉰다
      return sendMe(room, p);
    }
    target.frozen = true;
    target.m = 0;
    target.thaw = null;
    closeCurrent(room, target, 'unsolved');
    send(target.ws, { t: 'closeq' });
    p.tagReadyAt = now + TAG.cooldownMs;
    sendEvent(room, { kind: 'tag', by: p.id, id: target.id });
    checkAllFrozen(room);
    broadcast(room);
    sendMe(room, p);
  },

  // 학생: 얼음 친구 옆에서 땡 버튼을 누르기 시작
  thawStart(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return;
    const { room, player: p } = s;
    const target = room.players.get(m.id);
    if (isImpostorGame(room)) return; // 방해꾼 찾기에는 땡이 없다
    if (p.role !== 'student' || p.frozen || !target || !target.frozen) return;
    if (dist(p, target) > TAG.reach + 15) return;
    p.thaw = { id: target.id, at: Date.now() };
  },
  thawCancel(ws) {
    if (ws.session && ws.session.role === 'player') ws.session.player.thaw = null;
  },
  // 학생: 충분히 오래 누르고 있었으면 친구가 풀린다
  thawEnd(ws) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return;
    const { room, player: p } = s;
    const rec = p.thaw;
    p.thaw = null;
    const now = Date.now();
    if (!rec || p.frozen || now - rec.at < TAG.thawHoldMs - 200) return;
    const target = room.players.get(rec.id);
    if (!target || !target.frozen || dist(p, target) > TAG.reach + 25) return;
    target.frozen = false;
    target.protUntil = now + TAG.thawProtectMs;
    target.movedAt = now;
    sendEvent(room, { kind: 'thaw', by: p.id, id: target.id });
    broadcast(room);
  },

  // 미끄럼틀·개구멍 타기. 누가 탈 수 있는지는 맵 데이터의 who 에 적혀 있다.
  use(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return;
    const { room, player: p } = s;
    const now = Date.now();
    const device = (maps.get(room.settings.map).data.devices || []).find((d) => d.id === m.device);
    if (!device || p.frozen || now < p.rideUntil || room.meeting) return;
    const allowed = (device.who && device.who[room.settings.mode]) || [];
    if (!allowed.includes(p.role)) return fail(ws, 'not_allowed', `${device.name}: 술래는 탈 수 없어요!`);
    if (Math.hypot(p.x - device.from[0], p.y - device.from[1]) > TAG.deviceReach + 15) {
      return fail(ws, 'too_far', '입구에 더 가까이 가 주세요.');
    }
    const ready = p.devReadyAt[device.id] || 0;
    if (now < ready) return fail(ws, 'device_cooldown', `${Math.ceil((ready - now) / 1000)}초 뒤에 다시 탈 수 있어요.`);
    const from = [p.x, p.y];
    const to = device.type === 'teleport' ? device.exits[crypto.randomInt(device.exits.length)] : device.to;
    const ms = (device.duration || 1.5) * 1000;
    closeCurrent(room, p, 'unsolved');
    p.thaw = null;
    [p.x, p.y] = to;
    p.m = 0;
    p.rideUntil = now + ms;
    p.movedAt = now + ms;
    p.protUntil = Math.max(p.protUntil, now + ms + (device.protectAfter || 0) * 1000); // 타는 동안 + 도착 뒤 잠깐은 못 잡는다
    p.devReadyAt[device.id] = now + ms + ((device.cooldown && device.cooldown.seconds) || 0) * 1000;
    // 유령이 타는 모습은 유령을 볼 수 있는 사람(선생님·방해꾼·유령)에게만 알린다
    const seesRider = isImpostorGame(room) && p.ghost ? (q) => q.role === 'chaser' || q.ghost || q.id === p.id : null;
    sendEvent(room, { kind: 'ride', id: p.id, device: device.id, from, to, ms }, seesRider);
    broadcast(room);
  },

  // ── 방해꾼 찾기 ──
  // 방해꾼: 방해 (정전 · 문 잠금 · 위장)
  sabotage(ws, m) {
    const s = impostorSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (p.role !== 'chaser' || p.ghost || room.meeting) return;
    const now = Date.now();
    const sabo = room.sabo;
    const wait = (until) => fail(ws, 'sabo_cooldown', `${Math.ceil((until - now) / 1000)}초 뒤에 쓸 수 있어요.`);
    if (!['blackout', 'lock', 'disguise'].includes(m.kind)) return;
    if (now < sabo.graceUntil) return fail(ws, 'too_early', `${Math.ceil((sabo.graceUntil - now) / 1000)}초 뒤부터 방해할 수 있어요.`);
    if (m.kind === 'blackout') {
      if (now < sabo.readyAt.blackout) return wait(sabo.readyAt.blackout);
      sabo.blackoutUntil = now + IMPOSTOR.blackoutMs;
      sabo.readyAt.blackout = now + IMPOSTOR.blackoutCooldownMs;
      sendEvent(room, { kind: 'blackout', ms: IMPOSTOR.blackoutMs }); // 누가 썼는지는 넣지 않는다
    } else if (m.kind === 'lock') {
      if (now < sabo.readyAt.lock) return wait(sabo.readyAt.lock);
      let door = null;
      let best = IMPOSTOR.lockReach;
      for (const d of maps.get(room.settings.map).data.doors || []) {
        if (!d.lockable) continue;
        const dd = Math.hypot(p.x - (d.rect[0] + d.rect[2] / 2), p.y - (d.rect[1] + d.rect[3] / 2));
        if (dd <= best) (door = d), (best = dd);
      }
      if (!door) return fail(ws, 'no_door', '근처에 잠글 문이 없어요.'); // 쿨타임은 쓰지 않는다
      sabo.lock = { door: door.id, rect: door.rect, until: now + IMPOSTOR.lockMs };
      sabo.readyAt.lock = now + IMPOSTOR.lockCooldownMs;
      sendEvent(room, { kind: 'lock', door: door.id, ms: IMPOSTOR.lockMs });
    } else {
      if (p.disguise) return fail(ws, 'already_disguised', '이미 위장 중이에요.');
      if (p.disguiseLeft <= 0) return fail(ws, 'no_disguise', `위장은 한 게임에 ${IMPOSTOR.disguisePerGame}번까지예요.`);
      const pool = [...room.players.values()].filter((q) => q.role === 'student' && !q.ghost);
      if (!pool.length) return fail(ws, 'no_target', '위장할 대상이 없어요.');
      const look = pool[crypto.randomInt(pool.length)];
      p.disguise = { color: look.color, character: look.character, until: now + IMPOSTOR.disguiseMs };
      p.disguiseLeft -= 1;
    }
    broadcast(room);
    for (const q of room.players.values()) if (q.role === 'chaser') sendMe(room, q);
  },

  // 살아 있는 사람: 얼음 흔적 신고 → 회의
  alarm(ws, m) {
    const s = impostorSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (room.meeting) return;
    if (p.ghost) return fail(ws, 'ghost', '유령은 신고할 수 없어요.');
    const mark = room.marks.find((k) => k.id === m.mark);
    if (!mark) return fail(ws, 'no_mark', '그 얼음 흔적이 없어요.');
    if (dist(p, mark) > IMPOSTOR.reportReach + 8) return fail(ws, 'too_far', '얼음 흔적에 더 가까이 가 주세요.');
    startMeeting(room, 'report', p.id, mark.id);
  },

  // 살아 있는 학생: 긴급회의 버튼
  emergency(ws) {
    const s = impostorSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (room.meeting) return;
    const now = Date.now();
    if (p.ghost) return fail(ws, 'ghost', '유령은 회의를 열 수 없어요.');
    if (p.role !== 'student') return fail(ws, 'not_now', '지금은 누를 수 없어요.');
    if (p.usedButton) return fail(ws, 'button_used', '긴급회의는 한 사람이 한 번만 열 수 있어요.');
    if (room.meetingsLeft <= 0) return fail(ws, 'no_meetings', '긴급회의를 모두 썼어요.');
    const button = maps.get(room.settings.map).data.meetingButton;
    if (!button) return;
    if (Math.hypot(p.x - button.pos[0], p.y - button.pos[1]) > IMPOSTOR.buttonReach + 8) {
      return fail(ws, 'too_far', '긴급회의 버튼에 더 가까이 가 주세요.');
    }
    if (now < room.buttonReadyAt) return fail(ws, 'too_early', `${Math.ceil((room.buttonReadyAt - now) / 1000)}초 뒤에 누를 수 있어요.`);
    p.usedButton = true;
    room.meetingsLeft -= 1;
    startMeeting(room, 'button', null, null); // 누가 열었는지는 보내지 않는다
  },

  // 투표 (투표 단계, 회의 시작 때 살아 있고 연결된 사람만)
  vote(ws, m) {
    const s = impostorSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const mt = room.meeting;
    if (!mt || mt.stage !== 'vote') return fail(ws, 'not_voting', '지금은 투표 시간이 아니에요.');
    if (!mt.voters.has(p.id)) return fail(ws, 'cannot_vote', '이번 회의는 지켜보기만 해요.');
    if (mt.votes.has(p.id)) return fail(ws, 'already_voted', '이미 투표했어요.');
    if (m.target !== 'skip') {
      const target = room.players.get(m.target);
      if (!target || target.id === p.id || target.ghost) return fail(ws, 'bad_vote', '그 사람에게는 투표할 수 없어요.');
    }
    mt.votes.set(p.id, m.target);
    if ([...mt.voters].every((id) => mt.votes.has(id))) meetingResult(room, Date.now());
    broadcast(room);
  },

  // 선생님: 회의 조작 (토론 단계에서만) — 'extend' 토론 늘리기 / 'vote' 바로 투표로
  meetingCtl(ws, m) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || !isImpostorGame(s.room) || s.room.over) return;
    const mt = s.room.meeting;
    if (!mt || mt.stage !== 'discuss') return;
    const now = Date.now();
    if (m.action === 'extend') {
      if (mt.extended >= IMPOSTOR.extendMax) return;
      mt.extended += 1;
      mt.stageEndsAt += IMPOSTOR.extendMs;
    } else if (m.action === 'vote') {
      mt.stage = 'vote';
      mt.stageEndsAt = now + IMPOSTOR.voteMs;
    } else return;
    broadcast(s.room);
  },
};

function impostorSession(ws) {
  const s = ws.session;
  if (!s || s.role !== 'player' || !isImpostorGame(s.room) || s.room.over) return null;
  return s;
}

// 방해꾼 찾기의 얼리기: 가장 가까운 살아 있는 학생을 유령으로 만든다
function freezeTag(room, p) {
  const now = Date.now();
  if (p.role !== 'chaser' || p.ghost || room.meeting || now < p.tagReadyAt) return;
  let target = null;
  let best = IMPOSTOR.freezeReach + 8; // 화면과 서버의 위치 차이만큼 조금 넉넉하게
  for (const q of room.players.values()) {
    if (q.role !== 'student' || q.ghost || now < q.protUntil || now < q.rideUntil) continue;
    const d = dist(p, q);
    if (d <= best) (target = q), (best = d);
  }
  if (!target) {
    p.tagReadyAt = now + 800; // 헛손질: 마구 누르지 못하게 잠깐 쉰다
    return sendMe(room, p);
  }
  target.ghost = true;
  target.ghostKnown = false;
  target.m = 0;
  closeCurrent(room, target, 'unsolved');
  send(target.ws, { t: 'closeq' });
  room.marks.push({ id: target.id, x: target.x, y: target.y, color: target.color, character: target.character });
  p.tagReadyAt = now + IMPOSTOR.freezeCooldownMs;
  // 얼린 방해꾼들과 얼려진 사람(그리고 선생님)에게만 알린다
  sendEvent(room, { kind: 'freeze', by: p.id, id: target.id, x: target.x, y: target.y }, (q) => q.role === 'chaser' || q.id === target.id);
  checkImpostorWin(room);
  broadcast(room);
  sendMe(room, p);
  sendMe(room, target);
}

// 게임 중인 방에 모든 학생의 위치를 1초에 여러 번 보낸다
const stateTick = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase !== 'game') continue;
    const now = Date.now();
    const imp = isImpostorGame(room);
    if (imp && !room.over) {
      let changed = false;
      // 방해 효과가 끝났는지
      if (room.sabo.blackoutUntil && now >= room.sabo.blackoutUntil) (room.sabo.blackoutUntil = 0), (changed = true);
      if (room.sabo.lock && now >= room.sabo.lock.until) (room.sabo.lock = null), (changed = true);
      for (const p of room.players.values()) if (p.disguise && now >= p.disguise.until) (p.disguise = null), (changed = true);
      if (room.meeting) changed = advanceMeeting(room, now) || changed; // 회의 중에는 시계가 멈춘다
      else if (now >= room.endsAt) (endGame(room, 'chasers', 'time_up'), (changed = true));
      if (changed) broadcast(room);
    } else if (!room.over && now >= room.endsAt) {
      endGame(room, 'chasers', 'time_up'); // 시간 안에 학교를 못 고치면 술래 승리
      broadcast(room);
    }
    const rows = [...room.players.values()].map((p) => [p.id, p.x, p.y, p.f, p.m]);
    const msg = JSON.stringify({ t: 'state', p: rows });
    if (!isImpostorGame(room) || room.over) {
      for (const ws of [room.teacherWs, ...[...room.players.values()].map((p) => p.ws)]) {
        if (ws && ws.readyState === 1) ws.send(msg);
      }
      continue;
    }
    // 방해꾼 찾기: 살아 있는 학생에게는 유령 위치를 빼고 보낸다
    const ghosts = new Set([...room.players.values()].filter((p) => p.ghost).map((p) => p.id));
    const aliveMsg = ghosts.size ? JSON.stringify({ t: 'state', p: rows.filter((r) => !ghosts.has(r[0])) }) : msg;
    if (room.teacherWs && room.teacherWs.readyState === 1) room.teacherWs.send(msg);
    for (const p of room.players.values()) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(p.role === 'chaser' || p.ghost ? msg : aliveMsg);
    }
  }
}, 1000 / GAME.sendHz);
stateTick.unref();

// ───────────── 서버 켜기 ─────────────
const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws, req) => {
  ws.ip = req.socket.remoteAddress || 'unknown';
  ws.session = null;
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string' || !Object.hasOwn(handlers, m.t)) return;
    try {
      handlers[m.t](ws, m);
    } catch (e) {
      console.error('메시지 처리 오류:', m.t, e);
    }
  });

  ws.on('close', () => {
    const s = ws.session;
    if (!s) return;
    const now = Date.now();
    if (s.role === 'teacher' && s.room.teacherWs === ws) {
      s.room.teacherWs = null;
      s.room.teacherLeftAt = now;
    } else if (s.role === 'player' && s.player.ws === ws) {
      s.player.ws = null;
      s.player.leftAt = now;
      s.player.m = 0;
    }
    if (rooms.has(s.room.code)) broadcast(s.room);
  });
});

// 주기 정리: 죽은 연결, 오래 끊긴 학생, 버려진 방
const TEACHER_GONE_MS = 10 * 60_000;
const ROOM_MAX_MS = 4 * 60 * 60_000;
const sweep = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 15_000);
sweep.unref();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    let changed = false;
    // 연결이 끊긴 채 오래 지난 학생은 정리한다 (게임 중에도. 다시 오면 같은 이름으로 새로 들어올 수 있다)
    for (const p of [...room.players.values()]) {
      if (!p.ws && now - p.leftAt > REJOIN_MS) {
        removePlayer(room, p); // 방해꾼 찾기: 투표자 목록에서도 빼고 승패를 확인한다
        changed = true;
      }
    }
    const teacherGone = !room.teacherWs && now - room.teacherLeftAt > TEACHER_GONE_MS;
    if (teacherGone || now - room.createdAt > ROOM_MAX_MS) closeRoom(room, 'expired');
    else if (changed) broadcast(room);
  }
}, CLEANUP_MS);
cleanup.unref();

server.listen(PORT, () => {
  console.log(`게임 서버가 켜졌어요: http://localhost:${PORT}`);
  if (!TEACHER_PASSWORD) {
    console.log('주의: 선생님 비밀번호(TEACHER_PASSWORD)가 없어 방을 만들 수 없어요. .env 파일을 확인하세요.');
  }
});
