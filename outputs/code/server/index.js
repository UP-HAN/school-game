// 게임 서버: 화면 파일 제공 + 실시간 통신(웹소켓) + 방 관리.
// 1단계 범위: 방 만들기, 입장, 대기방, 캐릭터 고르기, 재접속.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { COLORS, CHARACTERS, MODES, MAPS, LIMITS, GAME, TAG, MINUTES, chaserCount } from '../shared/config.js';
import { buildGrid, canStand, spawnPoint, validateMap } from '../shared/mapgrid.js';
import { sanitizeSet, isCorrect } from '../shared/questions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';

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

function roomView(room) {
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
          timeLeft: Math.max(0, room.endsAt - Date.now()),
        }
      : null),
    teacherConnected: !!room.teacherWs,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      character: p.character,
      connected: !!p.ws,
      ...(room.phase === 'game'
        ? { x: p.x, y: p.y, solved: p.solved, role: p.role, frozen: p.frozen, protMs: Math.max(0, p.protUntil - Date.now()) }
        : null),
    })),
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
function initPlayerGame(p, role, now) {
  p.role = role; // 'student' 또는 'chaser'(술래)
  p.frozen = false;
  p.protUntil = 0; // 이때까지는 잡히지 않는다
  p.tagReadyAt = now + TAG.graceMs; // 술래가 다음에 잡을 수 있는 때
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
  send(p.ws, {
    t: 'me',
    role: p.role,
    solved: p.solved,
    missions: room.settings.missions,
    done: [...p.done],
    tagMs: Math.max(0, p.tagReadyAt - Date.now()),
  });
}
// 방 안 모두에게 "방금 일어난 일"을 알린다 (잡기, 땡, 장치 타기 연출용)
function sendEvent(room, ev) {
  const msg = JSON.stringify({ t: 'event', ...ev });
  for (const ws of [room.teacherWs, ...[...room.players.values()].map((p) => p.ws)]) {
    if (ws && ws.readyState === 1) ws.send(msg);
  }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function endGame(room, winner, reason) {
  if (room.over) return;
  room.over = { winner, reason };
  for (const p of room.players.values()) closeCurrent(room, p, 'unsolved');
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
    wrong: cur.attempts,
    ms: Date.now() - cur.openedAt,
  });
}
function broadcast(room) {
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
      settings: { mode: MODES[0].id, map: MAPS[0].id, chasers: 'auto', missions: 5, minutes: 10 },
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
      initPlayerGame(player, 'student', Date.now()); // 도중에 들어오면 학생 역할
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
    s.room.players.delete(s.player.id);
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
    broadcast(s.room);
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
    if (p.role !== 'student' || p.frozen) return;
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
      p.solved += 1;
      p.done.add(cur.terminal);
      room.solvedTotal += 1;
      closeCurrent(room, p, cur.attempts === 0 ? 'first' : 'retry');
      send(ws, { t: 'result', ok: true });
      sendMe(room, p);
      if (room.solvedTotal >= goalOf(room)) endGame(room, 'students', 'restored');
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
    s.room.players.delete(p.id);
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
    if (room.settings.mode !== 'freeze-tag') {
      return fail(ws, 'mode_not_ready', '방해꾼 찾기는 아직 만드는 중이에요. 얼음땡으로 시작해 주세요.');
    }
    const map = maps.get(room.settings.map);
    const now = Date.now();
    // 술래 뽑기: 인원에 맞춘 수만큼 무작위로
    const order = shuffle([...room.players.keys()]);
    const chasers = new Set(order.slice(0, chaserCount(room.settings, order.length)));
    let i = 0;
    for (const p of room.players.values()) {
      [p.x, p.y] = spawnPoint(map.data, i++, room.players.size);
      p.f = 1;
      p.m = 0;
      p.movedAt = now;
      initPlayerGame(p, chasers.has(p.id) ? 'chaser' : 'student', now);
    }
    room.endsAt = now + room.settings.minutes * 60_000;
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
    const dt = Math.min(1, (now - p.movedAt) / 1000);
    const reach = GAME.speed * 1.25 * dt + 24;
    const grid = maps.get(s.room.settings.map).grid;
    if (Math.hypot(x - p.x, y - p.y) > reach || !canStand(grid, x, y, GAME.radius - 4)) {
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
    if (!device || p.frozen || now < p.rideUntil) return;
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
    sendEvent(room, { kind: 'ride', id: p.id, device: device.id, from, to, ms });
    broadcast(room);
  },
};

// 게임 중인 방에 모든 학생의 위치를 1초에 여러 번 보낸다
const stateTick = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase !== 'game') continue;
    if (!room.over && Date.now() >= room.endsAt) {
      endGame(room, 'chasers', 'time_up'); // 시간 안에 학교를 못 고치면 술래 승리
      broadcast(room);
    }
    const msg = JSON.stringify({
      t: 'state',
      p: [...room.players.values()].map((p) => [p.id, p.x, p.y, p.f, p.m]),
    });
    for (const ws of [room.teacherWs, ...[...room.players.values()].map((p) => p.ws)]) {
      if (ws && ws.readyState === 1) ws.send(msg);
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
  const now = Date.now();
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
  for (const room of [...rooms.values()]) {
    let changed = false;
    // 연결이 끊긴 채 오래 지난 학생은 정리한다 (게임 중에도. 다시 오면 같은 이름으로 새로 들어올 수 있다)
    for (const p of [...room.players.values()]) {
      if (!p.ws && now - p.leftAt > LIMITS.rejoinSeconds * 1000) {
        room.players.delete(p.id);
        changed = true;
      }
    }
    const teacherGone = !room.teacherWs && now - room.teacherLeftAt > TEACHER_GONE_MS;
    if (teacherGone || now - room.createdAt > ROOM_MAX_MS) closeRoom(room, 'expired');
    else if (changed) broadcast(room);
  }
}, 15_000);
sweep.unref();

server.listen(PORT, () => {
  console.log(`게임 서버가 켜졌어요: http://localhost:${PORT}`);
  if (!TEACHER_PASSWORD) {
    console.log('주의: 선생님 비밀번호(TEACHER_PASSWORD)가 없어 방을 만들 수 없어요. .env 파일을 확인하세요.');
  }
});
