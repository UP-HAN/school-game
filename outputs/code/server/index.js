// 게임 서버: 화면 파일 제공 + 실시간 통신(웹소켓) + 방 관리 + 심판(채점·승패·안개·보급).
// 규칙의 근거: outputs/01·05·06 명세. 메시지 계약은 06 명세 12절.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  COLORS, CHARACTERS, MODES, MAPS, LIMITS, GAME, CHASE, MINUTES, MAFIA, MEETINGS, FOG, LOOT, ITEMS, ITEM_POOLS, ENERGY, STREAK,
  chaserCount, maxChasers, modeOf, stageValue, lootCount, CHASER_SPEED, CHASER_SPEED_DEFAULT, chaserSpeedOf, lootPool,
} from '../shared/config.js';
import { buildGrid, canStand, touchesRect, spawnPoint, validateMap, roomAt, distToRect, lootFurniture, floorAt, darkVisionAt } from '../shared/mapgrid.js';
import { sanitizeSet, isCorrect } from '../shared/questions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
// 서버를 열 주소. 기본 0.0.0.0(모든 곳에서 접속 가능, 개발용). 학교 서버(nginx 뒤)는 127.0.0.1(같은 컴퓨터 안에서만).
const HOST = String(process.env.HOST || '').trim() || '0.0.0.0';
// 앞에 nginx 같은 프록시가 있을 때만 1. 켜면 X-Forwarded-For 의 첫 값을 학생 컴퓨터 주소(IP)로 쓴다.
// 헤더는 누구나 꾸며 보낼 수 있으므로, 켤 때는 HOST=127.0.0.1 로 프록시만 서버에 닿게 해야 한다.
const TRUST_PROXY = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').trim().toLowerCase());
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';
// 주소 앞부분 (예: '/lantern' → https://학교주소/lantern/ 아래에서 게임을 연다). 비우면 '' (루트).
// 앞부분이 붙은 요청과 붙지 않은 요청(프록시가 떼고 넘긴 경우)을 둘 다 받는다.
const BASE_PATH = normalizeBase(process.env.BASE_PATH);
function normalizeBase(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return (s.startsWith('/') ? s : '/' + s).replace(/\/{2,}/g, '/');
}
// 요청 경로에서 BASE_PATH 를 뗀다. BASE_PATH 와 똑같은 경로(끝 슬래시 없음)는 null → 슬래시 붙여 다시 오게 한다.
function stripBase(pathname) {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return null;
  if (pathname.startsWith(BASE_PATH + '/')) return pathname.slice(BASE_PATH.length);
  return pathname;
}

// 시험용 시간 줄이기 (자동 시험 npm test 만 쓴다. 실제 수업에서는 비워 둔다).
// 환경변수 TEST_OVERRIDES = {
//   "chase"·"mafia"·"fog"·"loot"·"streak"·"energy"·"items": 같은 이름 묶음(config.js) 일부,
//   "minuteMs": 게임 1분의 길이, "rejoinMs": 끊긴 학생 정리 시간, "cleanupMs": 정리 주기,
//   "fogCenter": 안개 후보 번호 고정, "itemSeq": 상자에서 나올 아이템 차례, "lootFurniture": 상자를 숨길 가구 번호 목록,
//   "testGive": true 면 시험용 메시지 testGive(아이템 바로 주기)를 받는다,
//   "mapPatch": { "<맵 id>": { devices·zones·items 등 맵 JSON 맨 윗단 칸 } } — 시험 동안 그 칸을 통째로 바꿔 쓴다 }
const OVR = (() => {
  try {
    return JSON.parse(process.env.TEST_OVERRIDES || '{}') || {};
  } catch {
    return {};
  }
})();
function applyOverride(target, src) {
  if (!src || typeof src !== 'object') return;
  for (const [k, v] of Object.entries(src)) {
    if (!(k in target)) continue;
    if (Number.isFinite(v) || Array.isArray(v)) target[k] = v;
    else if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object') applyOverride(target[k], v);
  }
}
const GROUPS = { chase: CHASE, mafia: MAFIA, fog: FOG, loot: LOOT, streak: STREAK, energy: ENERGY, items: ITEMS };
for (const [name, target] of Object.entries(GROUPS)) applyOverride(target, OVR[name]);
const MINUTE_MS = Number(OVR.minuteMs) || 60_000;
const REJOIN_MS = Number(OVR.rejoinMs) || LIMITS.rejoinSeconds * 1000;
const CLEANUP_MS = Number(OVR.cleanupMs) || 15_000;

// 방 만들기 제한 (서버 자원 보호). 숫자는 .env 로 바꿀 수 있다. 비우거나 잘못 적으면 기본값.
function envInt(name, def) {
  const raw = String(process.env[name] ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 ? n : def;
}
const msOverride = (v, def) => (Number.isFinite(v) && v >= 0 ? v : def);
const ROOM_LIMITS = {
  maxRooms: envInt('MAX_ROOMS', 40), // 서버 전체에서 동시에 열 수 있는 방
  perIp: envInt('MAX_ROOMS_PER_IP', 8), // 같은 접속 주소(IP)가 동시에 가질 수 있는 방
  perHour: envInt('ROOM_CREATE_PER_HOUR', 20), // 같은 접속 주소가 1시간에 만들 수 있는 방
  gapMs: msOverride(OVR.createGapMs, 1000), // 연타 방지: 같은 주소는 1초에 1번
  windowMs: msOverride(OVR.createWindowMs, 60 * 60_000), // '1시간'의 길이 (시험용으로만 줄인다)
  // 방 자동 정리: 선생님 연결이 끊긴 채 / 아무 활동 없이 이 시간이 지나면 닫는다
  teacherGoneMs: msOverride(OVR.teacherGoneMs, envInt('ROOM_TEACHER_GONE_MINUTES', 30) * 60_000),
  idleMs: msOverride(OVR.idleMs, envInt('ROOM_IDLE_MINUTES', 120) * 60_000),
};
if (process.env.TEST_OVERRIDES) console.log('시험용 시간 설정을 쓰는 중이에요.');

// ───────────── 맵 읽기 ─────────────
const maps = new Map(); // 맵 id → { data, grid, loot(상자를 숨길 수 있는 가구) }
for (const m of MAPS) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', m.id + '.json'), 'utf8'));
  const patch = OVR.mapPatch && typeof OVR.mapPatch === 'object' ? OVR.mapPatch[m.id] : null;
  if (patch && typeof patch === 'object') Object.assign(data, patch); // 시험용 (TEST_OVERRIDES 일 때만)
  const grid = buildGrid(data);
  const problems = validateMap(data, grid, GAME.radius);
  if (problems.length) console.log(`맵 ${m.id} 에 문제가 있어요:\n - ` + problems.join('\n - '));
  let loot = lootFurniture(data, grid, LOOT.openReach, GAME.radius);
  if (Array.isArray(OVR.lootFurniture)) loot = loot.filter((f) => OVR.lootFurniture.includes(f.index));
  maps.set(m.id, { data, grid, loot });
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
  '.mp4': 'video/mp4',
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
  let search = '';
  try {
    const u = new URL(req.url, 'http://x');
    pathname = decodeURIComponent(u.pathname);
    search = u.search;
  } catch {
    res.writeHead(400).end();
    return;
  }
  const stripped = stripBase(pathname);
  if (stripped === null || stripped === '/teacher') {
    // '/lantern' → '/lantern/', '/lantern/teacher' → '/lantern/teacher/'
    // (끝 슬래시가 있어야 화면 안의 상대 주소가 맞게 풀린다. 상대 주소로 보내서 프록시가 앞부분을 떼든 말든 맞다)
    res.writeHead(301, { Location: pathname.split('/').pop() + '/' + search }).end();
    return;
  }
  pathname = stripped;
  if (pathname === '/teacher/' || pathname === '/teacher/index.html') return serveTeacherPage(req, res);
  if (pathname.endsWith('.part.html')) {
    res.writeHead(404).end('Not found'); // 페이지 조각은 따로 내려 주지 않는다
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
  if (type === MIME['.mp4']) return serveVideo(req, res, file, type);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// 안내 영상(.mp4): 통째로 읽지 않고 조금씩 흘려보낸다. 'Range'(일부만 달라는 요청)를 받아야
// 아이패드·사파리에서 재생되고, 영상 중간으로 건너뛸 수 있다.
function serveVideo(req, res, file, type) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const size = st.size;
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = size - 1;
    let code = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(m[2])); // 'bytes=-500' = 끝에서 500바이트
      }
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        return;
      }
      code = 206;
      head['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    head['Content-Length'] = end - start + 1;
    res.writeHead(code, head);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

// 선생님 페이지 (…/teacher/): 학생 페이지(index.html)와 같은 화면 틀·같은 app.js 를 쓰고,
// 첫 화면의 학생 입장 칸(home:start~home:end)만 teacher-home.part.html('방 만들기' 버튼)로 바꾼다.
// <base href="../"> 로 ./style.css · ./app.js 가 게임 첫 주소 기준으로 풀린다.
function teacherPageHtml() {
  const page = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
  const part = fs.readFileSync(path.join(ROOT, 'client', 'teacher-home.part.html'), 'utf8');
  // 비밀번호를 쓰지 않으면(기본) 비밀번호 칸(pw:start~pw:end)을 뺀다
  const home = (TEACHER_PASSWORD ? part : part.replace(/[ \t]*<!--pw:start-->[\s\S]*?<!--pw:end-->\r?\n?/, '')).trim();
  const out = page
    .replace(/<!--home:start-->[\s\S]*?<!--home:end-->/, () => home)
    .replace(/<head>/, '<head>\n  <base href="../">')
    .replace(/<title>([^<]*)<\/title>/, (_, t) => `<title>${t} · 선생님</title>`)
    .replace(/<body>/, '<body data-role="teacher">');
  if (!out.includes('id="create-form"') || out.includes('id="join-form"')) throw new Error('선생님 페이지를 만들지 못했어요');
  return out;
}
function serveTeacherPage(req, res) {
  let html;
  try {
    html = teacherPageHtml();
  } catch (e) {
    console.error('선생님 페이지 오류:', e.message);
    res.writeHead(500).end('Server error');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
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
// 받침이 있으면 a(은·이), 없으면 b(는·가)
function josa(word, a, b) {
  const c = String(word).charCodeAt(String(word).length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b;
}

const isMafiaGame = (room) => room.phase === 'game' && room.settings.mode === 'mafia';
const fogStage = (room) => (room.fogCur ? room.fogCur.stage : 0);
const fxOn = (p, kind, now = Date.now()) => !!(p.fx && p.fx[kind] > now);

// 방 정보. viewer = 받는 학생(선생님이면 null). 잠귀신 술래잡기·대기방은 모두에게 같은 내용,
// 꿈도둑을 찾아라 게임 중에는 받는 사람마다 보이는 값이 다르다 (05 명세 4-3절).
function roomView(room, viewer = null) {
  const imp = isMafiaGame(room);
  const now = Date.now();
  const game = room.phase === 'game';
  return {
    t: 'room',
    code: room.code,
    phase: room.phase,
    settings: room.settings,
    qset: room.qset ? { title: room.qset.title, count: room.qset.questions.length } : null,
    recordCount: room.records.length,
    ...(game
      ? {
          progress: { solved: room.solvedTotal, goal: goalOf(room) },
          over: room.over,
          timeLeft: timeLeftOf(room, now),
          ...(room.fogPlan ? { fog: fogNow(room.fogPlan, gameElapsed(room, now)) } : null),
          bonusTerminals: room.bonusTerminals,
          cratesLeft: room.crates.length,
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
        ? mafiaPlayerView(room, p, viewer, now)
        : {
            id: p.id,
            name: p.name,
            color: p.color,
            character: p.character,
            connected: !!p.ws,
            ...(game
              ? {
                  x: p.x,
                  y: p.y,
                  solved: p.solved,
                  role: p.role,
                  frozen: p.frozen,
                  protMs: Math.max(0, p.protUntil - now),
                  ...(fxOn(p, 'fogcape', now) ? { cloak: true } : null),
                  ...(fxOn(p, 'invis', now) ? { hide: true } : null), // 투명 망토: 잠귀신 화면에서는 그리지 않는다
                }
              : null),
          },
    ),
  };
}

// 꿈도둑을 찾아라: 한 사람(p)이 받는 사람(viewer)에게 어떻게 보이나 (05 명세 4-3절 표)
function mafiaPlayerView(room, p, viewer, now) {
  const all = !viewer || !!room.over; // 선생님, 또는 게임이 끝난 뒤에는 모두 공개
  const self = !!viewer && viewer.id === p.id;
  const vChaser = !!viewer && viewer.role === 'chaser';
  const seesGhosts = all || vChaser || viewer.ghost; // 꿈에 빠진 학생의 위치·상태를 모두 아는가
  const o = {
    id: p.id,
    name: p.name,
    color: p.color,
    character: p.character,
    connected: !!p.ws,
    frozen: false,
    protMs: Math.max(0, p.protUntil - now),
  };
  const trueLook = all || vChaser; // 변신의 진짜 모습을 아는가
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

// ───────────── 게임 시간 · 잠 안개 (06 명세 6절) ─────────────
// 게임 시간 = 실제로 흐른 시간. 꿈도둑을 찾아라의 모닥불 회의 중에는 멈춘다.
function timeLeftOf(room, now) {
  return isMafiaGame(room) && room.meeting ? room.pausedLeft : Math.max(0, room.endsAt - now);
}
const gameElapsed = (room, now) => Math.max(0, room.totalMs - timeLeftOf(room, now));

// 시작할 때 한 번: 중심 고르기 + 단계 시각 계산 (안개·보급이 꺼져 있거나 맵에 안개 자료가 없으면 null)
function planFog(room, map) {
  const fog = map.data.fog;
  if (!room.settings.fogLoot || !fog) return null;
  if (fog.mode === 'floors') return planFloorFog(room, map.data);
  if (!fog.centers || !fog.centers.length) return null;
  const ci = Number.isInteger(OVR.fogCenter) ? OVR.fogCenter % fog.centers.length : crypto.randomInt(fog.centers.length);
  const c = fog.centers[ci];
  const radii = fog.radii || FOG.radii;
  const [W, H] = map.data.size;
  const fullR = Math.ceil(Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - c.pos[0], y - c.pos[1]))));
  return {
    cx: c.pos[0],
    cy: c.pos[1],
    bonus: c.bonus || [],
    stages: FOG.stages.map((s, i) => ({
      startMs: s.at * room.totalMs,
      shrinkMs: Math.max(1, s.shrinkMs),
      fromR: i ? radii[i - 1] : fullR,
      toR: radii[i],
      warned: false,
      started: false,
      shrunk: false,
    })),
  };
}
// 층 단위 안개 (여러 층 맵, fog.mode 'floors'): 원 대신 "안전한 층" 목록이 단계마다 줄어든다.
// 시각·예고·졸음·마지막 밤 임시 랜턴은 원 안개와 같고, "빛 구역 안" 판정만 층 사각형으로 한다.
function planFloorFog(room, data) {
  const fog = data.fog;
  const ids = (data.floors || []).map((f) => f.id);
  if (!ids.length) return null;
  const safeAt = (i) => {
    const list = Array.isArray(fog.safe) ? fog.safe[Math.min(i, fog.safe.length - 1)] : null;
    return Array.isArray(list) && list.length ? list.filter((id) => ids.includes(id)) : ids;
  };
  return {
    mode: 'floors',
    floors: data.floors,
    bonus: fog.bonus || [],
    stages: FOG.stages.map((s, i) => ({
      startMs: s.at * room.totalMs,
      shrinkMs: Math.max(1, s.shrinkMs),
      safe: safeAt(i),
      warned: false,
      started: false,
      shrunk: true, // 층 안개는 좁혀지는 시간이 없다
    })),
  };
}
// 층 안개 단계 i(0부터)가 시작될 때 새로 어두워지는 층 / 그 뒤 안전한 층 (이름) — 알림 글씨용
function floorFogNews(plan, i) {
  const before = i ? plan.stages[i - 1].safe : plan.floors.map((f) => f.id);
  const after = plan.stages[i].safe;
  const name = (id) => {
    const f = plan.floors.find((x) => x.id === id);
    return f ? f.short || f.name : String(id);
  };
  return { dark: before.filter((id) => !after.includes(id)).map(name), safe: after.map(name) };
}
// 지금 안개 모습 (06 명세 12-1절 room.fog). r 이 null 이면 아직 안개가 없다.
function fogNow(plan, el) {
  let stage = 0;
  plan.stages.forEach((s, i) => {
    if (el >= s.startMs) stage = i + 1;
  });
  if (plan.mode === 'floors') {
    // 층 안개: safe = 지금 안전한 층 id (안개 전이면 null = 모두 안전), nextSafe = 다음 단계에 안전한 층
    const next = plan.stages[stage];
    return {
      mode: 'floors',
      stage,
      safe: stage ? plan.stages[stage - 1].safe : null,
      nextSafe: next ? next.safe : null,
      nextMsLeft: next ? Math.max(0, Math.round(next.startMs - el)) : null,
      shrinkMsLeft: 0,
      r: null,
      nextR: null,
    };
  }
  const o = { stage, cx: plan.cx, cy: plan.cy, r: null, fromR: null, toR: null, shrinkMsLeft: 0, nextMsLeft: null, nextR: null };
  if (stage) {
    const s = plan.stages[stage - 1];
    const k = Math.min(1, (el - s.startMs) / s.shrinkMs);
    o.r = Math.round(s.fromR + (s.toR - s.fromR) * k);
    o.fromR = s.fromR;
    o.toR = s.toR;
    o.shrinkMsLeft = Math.max(0, Math.round(s.startMs + s.shrinkMs - el));
  }
  const next = plan.stages[stage];
  if (next) {
    o.nextMsLeft = Math.max(0, Math.round(next.startMs - el));
    o.nextR = next.toR;
  }
  return o;
}
const isInFog = (room, p) => {
  const f = room.fogCur;
  if (f && f.mode === 'floors') {
    if (!f.safe || p.ghost) return false;
    const fl = floorAt(maps.get(room.settings.map).data, p.x, p.y);
    return !!fl && !f.safe.includes(fl.id);
  }
  return !!f && f.r !== null && !p.ghost && Math.hypot(p.x - f.cx, p.y - f.cy) > f.r;
};
// 위치 검사에 쓰는 속도 배율 (빨라지는 것만. 느려진 사람은 원래 받아 준다)
function speedBoost(room, p, now) {
  let m = 1;
  if (fxOn(p, 'shoes', now)) m = Math.max(m, ITEMS.shoes.speed);
  if (fxOn(p, 'kickboard', now)) m = Math.max(m, ITEMS.kickboard.speed);
  if (!isMafiaGame(room) && p.role === 'chaser' && fogStage(room) >= 3) m *= FOG.lastNightChaserSpeed;
  m *= chaserSpeedOf(room.settings, p.role); // 선생님이 고른 잠귀신 속도 (꿈도둑을 찾아라는 1)
  return m;
}
// 상자를 보여 줄 거리 = 시야 (안개·손전등·어두운 구역 반영) + 100
function seeRange(room, p, now) {
  let v = GAME.vision;
  if (p.inFog) v *= FOG.vision;
  if (!p.ghost) v *= darkVisionAt(maps.get(room.settings.map).data, p.x, p.y); // 유령의 집 (꿈에 빠진 사람은 그대로)
  if (fxOn(p, 'flashlight', now)) v *= ITEMS.flashlight.vision;
  return v + LOOT.seeExtra;
}

// ───────────── 퀴즈(랜턴·수첩) ─────────────
const TERMINAL_REACH = 95; // 랜턴에서 이만큼 안에 있어야 퀴즈를 열 수 있다

// 아침을 부르려면 켜야 하는 랜턴 수 = 학생 수 × 한 사람이 켤 랜턴 수
function goalOf(room) {
  let students = 0;
  for (const p of room.players.values()) if (p.role !== 'chaser') students++;
  return Math.max(1, students * room.settings.missions);
}
function initPlayerGame(p, role, now, room) {
  const mode = room.settings.mode;
  p.role = role; // 'student' 또는 'chaser'(잠귀신 / 꿈도둑)
  p.frozen = false; // 잠귀신 술래잡기: 꿈에 빠졌나
  p.protUntil = 0; // 이때까지는 꿈에 빠지지 않는다
  p.tagReadyAt = now + (mode === 'mafia' ? MAFIA.freezeGraceMs : CHASE.graceMs); // 다음에 꿈을 걸 수 있는 때
  // 꿈도둑을 찾아라 칸 (잠귀신 술래잡기에서는 쓰지 않는다)
  p.ghost = false; // 꿈에 빠진 학생인가 (꿈이 걸렸거나 추방됨)
  p.ghostKnown = false; // 다른 사람들이 그 사실을 아는가
  p.ejected = false; // 투표로 추방되었나
  p.usedButton = false; // 회의 종을 이미 울렸나
  p.disguise = null; // 변신 중이면 { color, character, until }
  p.disguiseLeft = MAFIA.disguisePerGame;
  p.rideUntil = 0; // 미끄럼틀·개구멍을 타는 중이면 끝나는 때
  p.devReadyAt = {}; // 장치별로 다시 탈 수 있는 때
  p.thaw = null; // 깨우기 버튼을 누르기 시작한 기록
  p.solved = 0;
  p.done = new Set(); // 이미 켠 랜턴
  p.seen = new Set(); // 이미 본 문제 번호
  p.missed = new Set(); // 보고도 못 푼 문제 번호
  p.current = null; // 지금 열어 둔 퀴즈
  // 06 명세 새 칸
  p.inFog = false;
  p.drowsy = 0; // 졸음 (ms)
  p.drowsyShown = 0;
  p.item = null; // 가방 (1칸)
  p.fx = {}; // 아이템 효과 → 끝나는 때
  p.loot = null; // 상자를 꾹 누르는 중이면 { crate, at, x, y }
  const eng = ENERGY[mode];
  p.energy = role === 'chaser' ? eng.start : 0; // 꿈 구슬
  p.lanternReadyAt = {}; // 잠귀신: 랜턴별 다시 켤 수 있는 때
  p.streak = 0; // 연속 정답
  p.hint = null; // { crate, room, x, y, exact, until }
  p.hintBank = null; // 상자가 없을 때 모아 둔 힌트 종류 ('room'·'exact')
  p.cratesKey = null; // 마지막으로 보낸 상자 목록
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
    item: p.item,
    effects: Object.fromEntries(Object.entries(p.fx || {}).filter(([, u]) => u > now).map(([k, u]) => [k, u - now])),
    energy: p.energy,
    energyMax: p.role === 'chaser' ? ENERGY[room.settings.mode].max : 0,
    streak: p.streak,
    hint: p.hint && p.hint.until > now ? { room: p.hint.room, x: p.hint.x, y: p.hint.y, exact: p.hint.exact, msLeft: p.hint.until - now } : null,
    hintBank: p.hintBank ? 1 : 0,
    drowsy: Math.min(1, Math.round((p.drowsy / FOG.drowsyMs) * 100) / 100),
    inFog: !!p.inFog,
    speedK: chaserSpeedOf(room.settings, p.role), // 잠귀신 속도 설정 배율 (화면이 내 걸음에 곱한다)
  };
  if (!isMafiaGame(room) && p.role === 'chaser') {
    msg.lanternMs = Object.fromEntries(Object.entries(p.lanternReadyAt).filter(([, u]) => u > now).map(([k, u]) => [k, u - now]));
  }
  if (isMafiaGame(room)) {
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
// "방금 일어난 일"을 알린다 (꿈 걸기, 깨우기, 장치 타기 연출용). who(p) 를 주면 그 학생들 + 선생님에게만.
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
  if (!isMafiaGame(room)) {
    // 잠귀신도 공부했다는 칭찬용: 잠귀신별 맞힌 퀴즈 수
    room.over.chaserSolved = [...room.players.values()].filter((p) => p.role === 'chaser').map((p) => ({ id: p.id, name: p.name, solved: p.solved }));
  }
  room.meeting = null;
  for (const p of room.players.values()) {
    closeCurrent(room, p, 'unsolved');
    p.loot = null;
  }
}
// 꿈도둑을 찾아라 승패 (05 명세 2-8절, 위에서부터). 시간 끝(④)은 stateTick 에서 따로 본다.
function checkMafiaWin(room) {
  if (room.over || !isMafiaGame(room)) return;
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
// 학생이 모두 꿈에 빠졌으면 잠귀신 승리
function checkAllAsleep(room) {
  const students = [...room.players.values()].filter((p) => p.role === 'student');
  if (students.length && students.every((p) => p.frozen)) endGame(room, 'chasers', 'all_asleep');
}
// 잠귀신 술래잡기: 꿈에 빠뜨린다 (꿈 걸기와 안개 졸음이 같은 처리). by = 건 잠귀신 id 또는 'fog'
function putToSleep(room, target, by) {
  target.frozen = true;
  target.m = 0;
  target.thaw = null;
  target.loot = null;
  target.drowsy = 0;
  if (target.current) {
    closeCurrent(room, target, 'unsolved');
    send(target.ws, { t: 'closeq' });
  }
  sendEvent(room, { kind: 'tag', by, id: target.id });
  if (by === 'fog') send(target.ws, { t: 'event', kind: 'drowsySleep' });
  checkAllAsleep(room);
  sendMe(room, target);
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
    source: cur.source,
    kind: q.kind,
    text: q.q,
    choices: q.kind === 'choice' ? cur.order : undefined,
    removed: cur.removed,
    attempts: cur.attempts,
    help: helpFor(q, cur),
    chance: !!cur.chance,
    lockMs: Math.max(0, cur.lockUntil - Date.now()),
  };
}
// 오답 도움: 주관식은 helpAfter 번 틀리면 글자 수, 한 번 더 틀리면 첫 글자까지. 찬스 카드면 바로 둘 다.
function helpFor(q, cur) {
  if (q.kind !== 'short') return null;
  const h = cur.helpAfter || 2;
  if (!cur.chance && cur.attempts < h) return null;
  const chars = [...q.a];
  return { length: chars.length, first: cur.chance || cur.attempts >= h + 1 ? chars[0] : undefined };
}
// 4지선다에서 틀린 보기 n개를 지운다 (보기는 2개까지만 남긴다)
function removeWrong(q, cur, n, keep = -1) {
  for (let k = 0; k < n; k++) {
    const left = cur.order.map((c, i) => i).filter((i) => !cur.removed.includes(i) && cur.order[i] !== q.a && i !== keep);
    if (!left.length || cur.order.length - cur.removed.length <= 2) return;
    cur.removed.push(left[crypto.randomInt(left.length)]);
  }
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
  if (result === 'unsolved') {
    p.missed.add(cur.qi);
    p.streak = 0; // 못 풀고 닫으면 연속 정답이 끊긴다
  } else p.missed.delete(cur.qi);
  room.records.push({
    pid: p.id,
    name: p.name,
    color: p.color,
    character: p.character,
    question: q.q,
    answer: q.a,
    kind: q.kind,
    result, // 'first' 첫 시도 정답 · 'retry' 다시 도전해 해결 · 'unsolved' 못 풂
    role: p.role, // 'student' · 'chaser' (잠귀신·꿈도둑도 퀴즈를 푼다)
    ghost: !!p.ghost, // 꿈에 빠진 상태에서 푼 문제인가 (꿈도둑을 찾아라)
    source: cur.source, // 'lantern' 랜턴 · 'notebook' 퀴즈 수첩
    wrong: cur.attempts,
    ms: Date.now() - cur.openedAt,
  });
}
function gainEnergy(room, p, n) {
  if (p.role !== 'chaser') return;
  p.energy = Math.min(ENERGY[room.settings.mode].max, p.energy + n);
}
// ── 연속 정답 · 보급 상자 힌트 (06 명세 8-3절) ──
function nearestCrate(room, p) {
  let best = null;
  for (const c of room.crates) if (!best || Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = c;
  return best;
}
// 힌트 주기. 상자가 없으면 false
function giveHint(room, p, kind) {
  const c = nearestCrate(room, p);
  if (!c) return false;
  const exact = kind === 'exact';
  p.hint = { crate: c.id, room: c.roomName, x: c.x, y: c.y, exact, until: Date.now() + (exact ? STREAK.exactHintMs : STREAK.roomHintMs) };
  return true;
}
function bumpStreak(room, p) {
  p.streak += 1;
  let reward = null;
  if (p.streak === STREAK.roomHintAt) reward = 'room';
  if (p.streak >= STREAK.exactHintAt && (p.streak - STREAK.exactHintAt) % STREAK.repeatEvery === 0) reward = 'exact';
  let banked = false;
  if (reward && room.settings.fogLoot && !giveHint(room, p, reward)) {
    // 상자가 없으면 다음 부엉이 택배 때까지 1개만 모아 둔다 (가구 힌트가 방 힌트보다 앞선다)
    if (STREAK.bankMax > 0 && (!p.hintBank || reward === 'exact')) p.hintBank = reward;
    banked = true;
  }
  send(p.ws, { t: 'event', kind: 'streak', n: p.streak, reward, ...(banked ? { banked: true } : null) }); // 본인에게만
}
function broadcast(room) {
  if (isMafiaGame(room)) {
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
  if (isMafiaGame(room) && !room.over) {
    if (room.meeting) {
      room.meeting.voters.delete(p.id);
      room.meeting.votes.delete(p.id);
    }
    checkMafiaWin(room);
  }
}

// ───────────── 보급 상자 (06 명세 7절) ─────────────
function dropCrates(room, now) {
  const map = maps.get(room.settings.map);
  const busy = new Set(room.crates.map((c) => c.fi));
  const all = map.loot.filter((f) => !busy.has(f.index));
  let pool = all.filter((f) => !room.lastDrop.has(f.index)); // 바로 전 차례와 같은 가구는 피한다
  const f0 = room.fogCur;
  if (f0 && f0.mode === 'floors' && f0.safe) {
    const inner = pool.filter((f) => {
      const fl = floorAt(map.data, f.x, f.y);
      return fl && f0.safe.includes(fl.id);
    }); // 층 안개 뒤에는 안전한 층 가구 먼저
    if (inner.length) pool = inner;
  } else if (f0 && f0.r !== null) {
    const inner = pool.filter((f) => Math.hypot(f.x - f0.cx, f.y - f0.cy) <= f0.r); // 안개 뒤에는 빛 구역 안 가구 먼저
    if (inner.length) pool = inner;
  }
  if (!pool.length) pool = all;
  const want = lootCount(room.players.size);
  const picked = [];
  for (const f of shuffle(pool)) {
    if (picked.length >= want) break;
    if (picked.some((g) => g.room === f.room)) continue; // 같은 때 떨어지는 상자는 서로 다른 방
    picked.push(f);
  }
  room.lastDrop = new Set(picked.map((f) => f.index));
  if (!picked.length) return;
  for (const f of picked) {
    room.crates.push({ id: 'c' + ++room.crateSeq, fi: f.index, x: f.x, y: f.y, rect: f.rect, room: f.room, roomName: f.roomName, until: now + LOOT.lifeMs });
  }
  sendEvent(room, { kind: 'drop', count: picked.length });
  // 모아 둔 힌트가 있으면 바로 보여 준다
  for (const p of room.players.values()) {
    if (p.hintBank && giveHint(room, p, p.hintBank)) {
      p.hintBank = null;
      sendMe(room, p);
    }
  }
}
function removeCrate(room, crate) {
  room.crates = room.crates.filter((c) => c !== crate);
  for (const p of room.players.values()) {
    if (p.hint && p.hint.crate === crate.id) {
      p.hint = null;
      sendMe(room, p);
    }
  }
}
// 사람마다 시야+100 안의 상자만 보낸다 (바뀔 때만). 선생님은 모두.
function sendCrates(room, now) {
  const all = room.crates.map((c) => c.id).join(',');
  if (room.teacherCratesKey !== all) {
    room.teacherCratesKey = all;
    send(room.teacherWs, { t: 'crates', crates: room.crates.map(({ id, x, y, rect, room: r }) => ({ id, x, y, rect, room: r })) });
  }
  for (const p of room.players.values()) {
    const range = seeRange(room, p, now);
    const vis = room.crates.filter((c) => distToRect(p.x, p.y, c.rect) <= range);
    const key = vis.map((c) => c.id).join(',');
    if (key !== p.cratesKey) {
      p.cratesKey = key;
      send(p.ws, { t: 'crates', crates: vis.map(({ id, x, y, rect }) => ({ id, x, y, rect })) });
    }
  }
}
// 아이템 쓰는 모습은 그 사람을 볼 수 있는 사람에게 (꿈에 빠진 학생은 꿈도둑·꿈에 빠진 사람에게만 보인다)
const seesPlayer = (room, p) => (isMafiaGame(room) && p.ghost ? (q) => q.role === 'chaser' || q.ghost || q.id === p.id : null);

function applyChance(room, p) {
  const cur = p.current;
  const q = room.qset.questions[cur.qi];
  cur.chance = true;
  if (q.kind === 'choice') removeWrong(q, cur, 2);
  p.item = null;
  send(p.ws, questionMessage(room, cur));
  sendEvent(room, { kind: 'item', id: p.id, item: 'chance' }, seesPlayer(room, p));
  sendMe(room, p);
}

// ───────────── 꿈도둑을 찾아라: 회의 ─────────────
// 회의 시작: 시계 멈춤, 퀴즈 창 닫기(기록 없이), 작전 효과·변신·꿈에 빠진 자리 지우기, 투표자 정하기
function startMeeting(room, reason, reporter, found) {
  const now = Date.now();
  room.pausedLeft = Math.max(0, room.endsAt - now);
  room.meetingAt = now;
  for (const p of room.players.values()) {
    if (p.current) {
      closeCurrent(room, p, 'cancel');
      send(p.ws, { t: 'closeq' });
    }
    p.thaw = null;
    p.loot = null;
    p.m = 0;
    p.disguise = null;
    if (p.ghost) p.ghostKnown = true;
  }
  room.sabo.blackoutUntil = 0;
  room.sabo.lock = null;
  room.marks = [];
  room.meeting = {
    stage: 'intro',
    stageEndsAt: now + MAFIA.meetingIntroMs,
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
// 투표 결과 계산: 가장 많이 받은 사람이 한 명뿐이고, 기권 표보다 많아야 추방
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
  m.stageEndsAt = now + MAFIA.resultMs;
  if (ejected) sendEvent(room, { kind: 'eject', id: ejected, ...(m.result.role ? { role: m.result.role } : null) });
}
// 회의 끝: 추방 적용 → 승패 확인 → 모두 시작 자리로, 시계 다시 흐름 (아이템 효과·상자 수명도 회의만큼 늦춘다)
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
  checkMafiaWin(room);
  if (!room.over) {
    const map = maps.get(room.settings.map);
    const pause = Math.max(0, now - (room.meetingAt || now));
    let i = 0;
    for (const p of room.players.values()) {
      [p.x, p.y] = spawnPoint(map.data, i++, room.players.size);
      p.f = 1;
      p.m = 0;
      p.movedAt = now;
      p.rideUntil = 0;
      if (p.role === 'chaser') p.tagReadyAt = now + MAFIA.freezeAfterMeetingMs;
      for (const k of Object.keys(p.fx)) if (p.fx[k] > room.meetingAt) p.fx[k] += pause;
      if (p.hint) p.hint.until += pause;
      send(p.ws, { t: 'fix', x: p.x, y: p.y });
    }
    for (const c of room.crates) c.until += pause;
    room.endsAt = now + room.pausedLeft;
    room.buttonReadyAt = now + MAFIA.buttonGraceMs;
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
    m.stageEndsAt = now + MAFIA.discussMs;
  } else if (m.stage === 'discuss') {
    m.stage = 'vote';
    m.stageEndsAt = now + MAFIA.voteMs;
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

// ───────────── 방 만들기 제한 ─────────────
// 누구나 선생님 주소로 방을 만들 수 있으므로, 서버가 버틸 수 있게 방 수와 만들기 횟수를 제한한다.
// 같은 학교 선생님들은 같은 공인 주소(IP)를 쓸 수 있어서 주소별 제한은 넉넉하게 둔다.
const createLog = new Map(); // 접속 주소 → 최근 1시간 안에 방을 만든 시각들
function recentCreates(ip, now) {
  const list = (createLog.get(ip) || []).filter((at) => now - at < ROOM_LIMITS.windowMs);
  if (list.length) createLog.set(ip, list);
  else createLog.delete(ip);
  return list;
}
// 막아야 하면 { code, msg }, 괜찮으면 null
function createLimit(ip, now) {
  if (rooms.size >= ROOM_LIMITS.maxRooms) {
    return { code: 'server_full', msg: '지금은 방이 꽉 찼어요. 잠시 뒤 다시 해 주세요.' };
  }
  const list = recentCreates(ip, now);
  const last = list[list.length - 1];
  if (last !== undefined && now - last < ROOM_LIMITS.gapMs) {
    return { code: 'too_fast', msg: '조금만 천천히 눌러 주세요. 잠시 뒤 다시 해 주세요.' };
  }
  let mine = 0;
  for (const r of rooms.values()) if (r.ownerIp === ip) mine++;
  if (mine >= ROOM_LIMITS.perIp) {
    return { code: 'too_many_rooms', msg: `같은 곳에서 연 방이 ${ROOM_LIMITS.perIp}개라 더 만들 수 없어요. 안 쓰는 방을 닫고 다시 해 주세요.` };
  }
  if (list.length >= ROOM_LIMITS.perHour) {
    const min = Math.max(1, Math.ceil((list[0] + ROOM_LIMITS.windowMs - now) / 60_000));
    return { code: 'too_many_creates', msg: `방을 너무 많이 만들었어요. ${min}분 뒤에 다시 해 주세요.` };
  }
  return null;
}
function noteCreate(ip, now) {
  // 기록이 너무 많아지면 (주소를 바꿔 가며 만드는 경우) 오래된 기록부터 정리한다
  if (createLog.size > 5000) for (const k of [...createLog.keys()]) recentCreates(k, now);
  const list = recentCreates(ip, now);
  list.push(now);
  createLog.set(ip, list);
}

// ───────────── 메시지 처리 ─────────────
const cleanName = (s) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
const validCharacter = (id) => CHARACTERS.some((c) => c.id === id);
// 게임 중인 학생 세션 (게임이 끝났으면 null)
function playSession(ws) {
  const s = ws.session;
  if (!s || s.role !== 'player' || s.room.phase !== 'game' || s.room.over) return null;
  return s;
}

const handlers = {
  // 선생님: 방 만들기
  create(ws, m) {
    if (ws.session) return fail(ws, 'already_in_room', '이미 방에 들어와 있어요.');
    const now = Date.now();
    // 선생님 비밀번호는 선택 기능: TEACHER_PASSWORD 가 있을 때만 확인한다 (기본 운영은 비밀번호 없음)
    if (TEACHER_PASSWORD) {
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
        // 기록이 너무 많아지면 (주소를 바꿔 가며 시도하는 경우) 잠기지 않은 기록부터 지운다
        if (passwordFails.size > 5000) for (const [ip, r] of passwordFails) if (r.lockedUntil <= now) passwordFails.delete(ip);
        passwordFails.set(ws.ip, rec);
        return fail(ws, 'bad_password', '비밀번호가 맞지 않아요.');
      }
      passwordFails.delete(ws.ip);
    }
    const limited = createLimit(ws.ip, now);
    if (limited) return fail(ws, limited.code, limited.msg);
    const code = newRoomCode();
    if (!code) return fail(ws, 'server_full', '지금은 방이 꽉 찼어요. 잠시 뒤 다시 해 주세요.');
    noteCreate(ws.ip, now);
    const room = {
      code,
      phase: 'lobby',
      settings: {
        mode: MODES[0].id,
        map: MAPS[0].id,
        chasers: 'auto',
        missions: 5, // 한 사람이 켤 랜턴 수
        minutes: 10,
        meetings: MAFIA.meetingsDefault, // 꿈도둑을 찾아라: 회의 종 총 횟수
        reveal: true, // 꿈도둑을 찾아라: 추방된 사람의 정체 공개
        fogLoot: true, // 잠 안개·보급 상자
        notebook: true, // 퀴즈 수첩
        chaserSpeed: CHASER_SPEED_DEFAULT, // 잠귀신 술래잡기: 잠귀신 속도 ('same'|'fast'|'very')
      },
      pickedChasers: [], // 선생님이 몰래 정한 꿈도둑 (선생님에게만 보낸다. settings 에 넣지 않는다)
      meetingsLeft: 0,
      marks: [], // 꿈에 빠진 자리
      sabo: { blackoutUntil: 0, lock: null, graceUntil: 0, readyAt: { blackout: 0, lock: 0 } },
      meeting: null,
      buttonReadyAt: 0,
      pausedLeft: 0,
      endsAt: 0,
      totalMs: 0,
      fogPlan: null,
      fogCur: null,
      bonusTerminals: [],
      crates: [],
      crateSeq: 0,
      dropIndex: 0,
      lastDrop: new Set(),
      qset: null,
      solvedTotal: 0,
      over: null,
      records: [],
      teacherToken: newToken(),
      teacherWs: ws,
      teacherLeftAt: 0,
      players: new Map(),
      createdAt: now,
      activeAt: now, // 마지막 활동 (선생님·학생이 메시지를 보낼 때마다 갱신. 자동 정리에 쓴다)
      ownerIp: ws.ip, // 방을 만든 접속 주소 (주소별 동시 방 수 제한)
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
      same.cratesKey = null;
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
      initPlayerGame(player, 'student', Date.now(), room); // 도중에 들어오면 학생 역할 (회의 중이면 그 회의 투표는 못 한다)
      player.protUntil = Date.now() + CHASE.joinProtectMs;
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
      room.teacherCratesKey = null; // 상자 목록을 다시 보낸다
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
    player.cratesKey = null;
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

  // 선생님: 대기방 설정 바꾸기 (모르는 값은 무시)
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
    if (typeof m.fogLoot === 'boolean') s.room.settings.fogLoot = m.fogLoot;
    if (typeof m.notebook === 'boolean') s.room.settings.notebook = m.notebook;
    if (typeof m.chaserSpeed === 'string' && Object.hasOwn(CHASER_SPEED, m.chaserSpeed)) s.room.settings.chaserSpeed = m.chaserSpeed;
    broadcast(s.room);
  },

  // 선생님: 꿈도둑 몰래 정하기 (대기방에서만). 목록은 선생님에게만 돌려준다.
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

  // 퀴즈 열기: 랜턴(terminal = 랜턴 id·임시 랜턴 id) 또는 퀴즈 수첩(terminal = 'notebook')
  open(ws, m) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const imp = isMafiaGame(room);
    if (imp && room.meeting) return; // 회의 중에는 안 된다
    const now = Date.now();
    let terminalId;
    let source;
    if (m.terminal === 'notebook') {
      // 퀴즈 수첩: 어디서나, 꿈에 빠진 학생도 연다. 새벽빛은 오르지 않는다.
      if (!room.settings.notebook) return fail(ws, 'notebook_off', '이번 판은 퀴즈 수첩을 쓰지 않아요.');
      terminalId = 'notebook';
      source = 'notebook';
    } else {
      // 꿈도둑을 찾아라: 꿈도둑·꿈에 빠진 학생도 랜턴을 켤 수 있다. 잠귀신 술래잡기: 꿈에 빠진 학생은 못 켠다.
      if (!imp && p.frozen) return;
      const terminal =
        maps.get(room.settings.map).data.terminals.find((t) => t.id === m.terminal) || room.bonusTerminals.find((t) => t.id === m.terminal);
      if (!terminal) return;
      terminalId = terminal.id;
      source = 'lantern';
      if (p.current && p.current.terminal === terminalId) return send(ws, questionMessage(room, p.current));
      if (Math.hypot(p.x - terminal.pos[0], p.y - terminal.pos[1]) > TERMINAL_REACH) {
        return fail(ws, 'too_far', '랜턴에 더 가까이 가 주세요.');
      }
      const bonus = room.bonusTerminals.some((t) => t.id === terminalId);
      if (!imp && p.role === 'chaser') {
        // 잠귀신: 같은 랜턴은 30초 뒤 다시 (06 명세 8-1절)
        const ready = p.lanternReadyAt[terminalId] || 0;
        if (now < ready) return fail(ws, 'lantern_cooldown', `${Math.ceil((ready - now) / 1000)}초 뒤에 이 랜턴을 다시 켤 수 있어요.`);
      } else {
        if (!bonus && p.solved >= room.settings.missions) return fail(ws, 'all_done', '내 랜턴을 다 켰어요!');
        if (p.done.has(terminalId)) return fail(ws, 'terminal_done', '이 랜턴은 이미 켰어요. 다른 랜턴을 찾아보세요.');
      }
    }
    if (p.current && p.current.terminal === terminalId) return send(ws, questionMessage(room, p.current));
    closeCurrent(room, p, 'unsolved');
    const qi = pickQuestion(room, p);
    const q = room.qset.questions[qi];
    p.seen.add(qi);
    p.current = {
      terminal: terminalId,
      source,
      qi,
      order: q.kind === 'choice' ? shuffle([q.a, ...q.wrong]) : null,
      removed: [],
      attempts: 0,
      lockUntil: 0,
      openedAt: now,
      inFog: !!p.inFog, // 안개 속에서 연 퀴즈는 오답 잠금이 길다
      helpAfter: stageValue('helpAfter', fogStage(room)),
      chance: false,
    };
    send(ws, questionMessage(room, p.current));
  },

  // 답 내기. 채점은 서버가 한다 (정답은 학생 화면으로 보내지 않는다).
  answer(ws, m) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const cur = p.current;
    const now = Date.now();
    if (!cur || now < cur.lockUntil) return;
    const q = room.qset.questions[cur.qi];
    let value = m.value;
    if (q.kind === 'choice') {
      if (!Number.isInteger(value) || value < 0 || value >= cur.order.length || cur.removed.includes(value)) return;
      value = cur.order[value];
    } else if (typeof value !== 'string' || !value.trim() || value.length > 100) return;

    if (isCorrect(q, value)) {
      const imp = isMafiaGame(room);
      const eng = ENERGY[room.settings.mode];
      const first = cur.attempts === 0;
      if (cur.source === 'notebook') {
        gainEnergy(room, p, eng.notebook); // 수첩: 새벽빛 없이 꿈 구슬(잠귀신·꿈도둑)·연속 정답만
      } else if (!imp && p.role === 'chaser') {
        // 잠귀신의 랜턴: 새벽빛에는 안 들어가고 꿈 구슬이 생긴다
        gainEnergy(room, p, eng.lantern);
        p.solved += 1;
        p.lanternReadyAt[cur.terminal] = now + ENERGY.chaserLanternCooldownMs;
      } else {
        p.solved += 1;
        p.done.add(cur.terminal);
        if (imp && p.role === 'chaser') gainEnergy(room, p, eng.lantern); // 꿈도둑의 퀴즈는 새벽빛에 안 들어간다
        else room.solvedTotal += 1;
      }
      closeCurrent(room, p, first ? 'first' : 'retry');
      send(ws, { t: 'result', ok: true, source: cur.source });
      if (first) bumpStreak(room, p);
      sendMe(room, p);
      if (imp) checkMafiaWin(room);
      else if (room.solvedTotal >= goalOf(room)) endGame(room, 'students', 'restored');
      return broadcast(room);
    }
    if (cur.attempts === 0 && p.streak) {
      p.streak = 0; // 첫 오답에서 연속 정답이 끊긴다
      sendMe(room, p);
    }
    cur.attempts += 1;
    // 오답 잠금: 수첩 3초 / 안개 속에서 연 퀴즈 8초 / 빛 구역 안은 안개 단계 값
    const lockMs =
      cur.source === 'notebook' ? STREAK.notebookWrongLockMs : cur.inFog ? FOG.wrongLockMs : stageValue('innerWrongLockMs', fogStage(room));
    cur.lockUntil = now + lockMs;
    // 4지선다는 helpAfter 번 틀리면 틀린 보기 하나를 지워 준다 (보기는 2개까지만 남긴다)
    if (q.kind === 'choice' && cur.attempts >= cur.helpAfter) removeWrong(q, cur, 1, m.value);
    send(ws, { t: 'result', ok: false, attempts: cur.attempts, lockMs, removed: cur.removed, help: helpFor(q, cur) });
  },

  // 퀴즈 창 닫기 (못 푼 문제로 남는다, 연속 정답이 끊긴다)
  closeq(ws) {
    const s = ws.session;
    if (!s || s.role !== 'player' || s.room.phase !== 'game') return;
    const had = !!s.player.current;
    closeCurrent(s.room, s.player, 'unsolved');
    if (had) sendMe(s.room, s.player);
  },

  // 찬스 카드: 열린 퀴즈에 바로 도움 (선다: 틀린 보기 2개 지움 / 주관식: 글자 수 + 첫 글자)
  chance(ws) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (p.item !== 'chance') return fail(ws, 'no_item', '가방에 찬스 카드가 없어요.');
    if (!p.current) return fail(ws, 'need_quiz', '퀴즈 창에서 쓰는 카드예요.');
    applyChance(room, p);
  },

  // 가방의 아이템 쓰기
  useItem(ws) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const now = Date.now();
    if (isMafiaGame(room) && room.meeting) return;
    const kind = p.item;
    if (!kind) return fail(ws, 'no_item', '가방이 비어 있어요.');
    if (p.frozen || p.ghost) return fail(ws, 'asleep', '꿈에 빠져 있을 때는 아이템을 쓸 수 없어요.');
    if (kind === 'chance') {
      if (!p.current) return fail(ws, 'need_quiz', '퀴즈 창에서 쓰는 카드예요.');
      return applyChance(room, p);
    }
    p.item = null;
    if (kind === 'bugle') {
      // 기상 나팔: 둘레의 꿈에 빠진 친구를 모두 깨운다
      const protect = stageValue('wakeProtectMs', fogStage(room), CHASE.thawProtectMs);
      for (const q of room.players.values()) {
        if (q.role !== 'student' || !q.frozen || dist(p, q) > ITEMS.bugle.reach + 8) continue;
        wakeUp(room, q, p.id, now, protect);
      }
    } else if (ITEMS[kind] && ITEMS[kind].ms) {
      p.fx[kind] = now + ITEMS[kind].ms;
    }
    // 투명 망토를 쓴 것은 잠귀신에게 알리지 않는다 (알림 글씨가 뜨면 자리가 드러난다)
    const seen = kind === 'invis' ? (q) => q.role !== 'chaser' : seesPlayer(room, p);
    sendEvent(room, { kind: 'item', id: p.id, item: kind }, seen);
    sendMe(room, p);
    broadcast(room);
  },

  // 시험용: 아이템 바로 주기 (TEST_OVERRIDES.testGive 일 때만)
  testGive(ws, m) {
    if (!OVR.testGive) return;
    const s = playSession(ws);
    if (!s || !ITEMS[m.item]) return;
    s.player.item = m.item;
    sendMe(s.room, s.player);
  },

  // 보급 상자 열기: 가구 둘레에서 꾹 누르기 시작
  lootStart(ws, m) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (isMafiaGame(room) && room.meeting) return;
    const crate = room.crates.find((c) => c.id === m.crate);
    if (!crate) return fail(ws, 'no_crate', '그 보급 상자가 없어요.');
    if (p.frozen || p.ghost) return fail(ws, 'asleep', '꿈에 빠져 있을 때는 상자를 열 수 없어요.');
    if (p.item) return fail(ws, 'bag_full', '가방이 꽉 찼어요. 먼저 써 주세요.');
    if (distToRect(p.x, p.y, crate.rect) > LOOT.openReach + 15) return fail(ws, 'too_far', '보급 상자에 더 가까이 가 주세요.');
    p.loot = { crate: crate.id, at: Date.now(), x: p.x, y: p.y };
  },
  // 킥보드를 타고 벽에 정면으로 부딪혔다: 잠깐(2초) 빙글빙글 돌며 못 움직인다. 부딪힘 판정은 화면이 한다
  crash(ws) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const now = Date.now();
    if (p.frozen || now < p.rideUntil || !fxOn(p, 'kickboard', now)) return;
    if (now < (p.spinUntil || 0) + ITEMS.kickboard.spinSafeMs) return; // 돌고 난 바로 뒤에는 다시 돌지 않는다
    p.spinUntil = now + ITEMS.kickboard.spinMs;
    p.m = 0;
    sendEvent(room, { kind: 'spin', id: p.id, ms: ITEMS.kickboard.spinMs }, seesPlayer(room, p));
  },
  lootCancel(ws) {
    if (ws.session && ws.session.role === 'player') ws.session.player.loot = null;
  },
  // 충분히 오래 눌렀으면 상자가 열린다 (먼저 채운 사람만)
  lootEnd(ws) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const rec = p.loot;
    p.loot = null;
    const now = Date.now();
    if (!rec) return fail(ws, 'loot_cancelled', '상자 열기가 취소됐어요. 다시 꾹 눌러 주세요.');
    if (now - rec.at < LOOT.openHoldMs - 200) return fail(ws, 'too_soon', '조금 더 꾹 눌러 주세요.');
    const crate = room.crates.find((c) => c.id === rec.crate);
    if (!crate) return fail(ws, 'crate_gone', '상자가 이미 열렸거나 사라졌어요.');
    if (p.frozen || p.ghost || p.item) return;
    if (Math.hypot(p.x - rec.x, p.y - rec.y) > LOOT.moveCancel) return fail(ws, 'loot_cancelled', '상자 열기가 취소됐어요. 다시 꾹 눌러 주세요.');
    removeCrate(room, crate);
    // 기본 목록 + 맵 전용 아이템(items.extra, 놀이공원 킥보드)
    const pool = lootPool(room.settings.mode, p.role, maps.get(room.settings.map).data.items);
    let kind = pool[crypto.randomInt(pool.length)];
    if (Array.isArray(OVR.itemSeq) && OVR.itemSeq.length) kind = OVR.itemSeq[room.itemSeqI++ % OVR.itemSeq.length];
    p.item = kind;
    sendEvent(room, { kind: 'crateOpened' }); // 누가 열었는지는 알리지 않는다 (꿈도둑 정체 보호)
    sendMe(room, p);
    broadcast(room);
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

  // 선생님: 게임 시작
  start(ws) {
    const s = ws.session;
    if (!s || s.role !== 'teacher' || s.room.phase !== 'lobby') return;
    const room = s.room;
    if (room.players.size < LIMITS.minPlayers) {
      return fail(ws, 'need_players', `학생이 ${LIMITS.minPlayers}명 이상 있어야 시작할 수 있어요.`);
    }
    if (!room.qset) return fail(ws, 'need_questions', '퀴즈 문제를 먼저 올려 주세요.');
    const mode = room.settings.mode;
    const map = maps.get(room.settings.map);
    const now = Date.now();
    let chasers = null;
    if (mode === 'mafia') {
      // 선생님이 몰래 정한 꿈도둑이 있으면 그 학생들만 (나간 학생은 빠진다)
      room.pickedChasers = room.pickedChasers.filter((id) => room.players.has(id));
      if (room.pickedChasers.length > maxChasers(mode, room.players.size)) {
        return fail(ws, 'too_many_chasers', `꿈도둑이 너무 많아요. 지금 인원이면 ${maxChasers(mode, room.players.size)}명까지 정할 수 있어요.`);
      }
      if (room.pickedChasers.length) chasers = new Set(room.pickedChasers);
    }
    if (!chasers) {
      // 잠귀신(꿈도둑) 뽑기: 인원에 맞춘 수만큼 무작위로
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
      initPlayerGame(p, chasers.has(p.id) ? 'chaser' : 'student', now, room);
    }
    // 꿈도둑을 찾아라 값 초기화
    room.meetingsLeft = room.settings.meetings;
    room.marks = [];
    const graceUntil = now + MAFIA.sabotageGraceMs;
    room.sabo = { blackoutUntil: 0, lock: null, graceUntil, readyAt: { blackout: graceUntil, lock: graceUntil } };
    room.meeting = null;
    room.pausedLeft = 0;
    room.buttonReadyAt = now + MAFIA.buttonGraceMs;
    room.totalMs = room.settings.minutes * MINUTE_MS;
    room.endsAt = now + room.totalMs;
    // 잠 안개 · 보급 (06 명세 12-4절)
    room.fogPlan = planFog(room, map);
    room.fogCur = room.fogPlan ? fogNow(room.fogPlan, 0) : null;
    room.fogBroadcastAt = 0;
    room.bonusTerminals = [];
    room.crates = [];
    room.crateSeq = 0;
    room.dropIndex = 0;
    room.lastDrop = new Set();
    room.itemSeqI = 0;
    room.devBusy = {}; // 줄 서는 장치(solo): 장치 id → 앞사람이 다 탈 때
    room.teacherCratesKey = null;
    room.tickAt = now;
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
    s.room.crates = [];
    s.room.devBusy = {};
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
    if (now < (p.spinUntil || 0)) return; // 킥보드로 벽에 부딪혀 도는 중에는 못 움직인다
    if (p.frozen) return send(ws, { t: 'fix', x: p.x, y: p.y }); // 꿈에 빠지면 못 움직인다
    if (s.room.meeting && isMafiaGame(s.room)) return send(ws, { t: 'fix', x: p.x, y: p.y }); // 회의 중에는 아무도 못 움직인다
    if (p.current && p.current.source === 'notebook') return send(ws, { t: 'fix', x: p.x, y: p.y }); // 수첩을 여는 동안은 못 움직인다
    const dt = Math.min(1, (now - p.movedAt) / 1000);
    // 빨라지는 효과(운동화·킥보드·마지막 밤 잠귀신·잠귀신 속도 설정)만 곱한다. 안개 속에서 느려진 사람은 원래 받아 준다.
    const reach = GAME.speed * 1.25 * speedBoost(s.room, p, now) * dt + 24;
    const grid = maps.get(s.room.settings.map).grid;
    const r = GAME.radius - 4;
    // 막힌 문은 벽처럼 막힌다. 단 이미 그 문 칸에 서 있던 사람은 빠져나올 수 있다 (끼임 방지)
    const lock = isMafiaGame(s.room) && s.room.sabo.lock;
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
    if (p.loot && Math.hypot(p.x - p.loot.x, p.y - p.loot.y) > LOOT.moveCancel) p.loot = null; // 움직이면 상자 열기 취소
  },

  // 선생님: 퀴즈 리포트 전체 (게임 중에도, 끝난 뒤 대기방에서도 볼 수 있다. 다음 게임을 시작하면 지워진다)
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

  // 학생: 내 퀴즈 노트 (내 것만. 정답은 게임이 끝난 뒤에만 알려 준다)
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
        .map((r) => ({ question: r.question, result: r.result, wrong: r.wrong, ms: r.ms, source: r.source, answer: finished ? r.answer : undefined })),
    });
  },

  // 잠귀신: 꿈 걸기. 가장 가까운 학생 한 명을 꿈에 빠뜨린다 (꿈 구슬 1개).
  tag(ws, m) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (isMafiaGame(room)) return freezeTag(room, p);
    const now = Date.now();
    if (p.role !== 'chaser' || now < p.tagReadyAt) return;
    if (now < p.rideUntil) return; // 장치를 타는 중에는 꿈을 걸 수 없다
    if (p.energy <= 0) return fail(ws, 'no_energy', '꿈 구슬이 없어요. 퀴즈를 풀어 채워요.');
    let target = null;
    let best = (fxOn(p, 'pillow', now) ? ITEMS.pillow.reach : CHASE.reach) + 8; // 화면과 서버의 위치 차이만큼 조금 넉넉하게
    for (const q of room.players.values()) {
      if (q.role !== 'student' || q.frozen || now < q.protUntil || now < q.rideUntil) continue;
      const d = dist(p, q);
      if (d <= best) (target = q), (best = d);
    }
    if (!target) {
      p.tagReadyAt = now + 800; // 헛손질: 마구 누르지 못하게 잠깐 쉰다 (구슬은 안 쓴다)
      return sendMe(room, p);
    }
    p.tagReadyAt = now + stageValue('chaseCooldownMs', fogStage(room), CHASE.cooldownMs);
    if (fxOn(target, 'umbrella', now)) return popShield(room, p, target);
    p.energy -= 1;
    if (p.fx.pillow) p.fx.pillow = 0;
    putToSleep(room, target, p.id);
    broadcast(room);
    sendMe(room, p);
  },

  // 학생: 꿈에 빠진 친구 옆에서 깨우기 버튼을 누르기 시작
  thawStart(ws, m) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const target = room.players.get(m.id);
    if (isMafiaGame(room)) return; // 꿈도둑을 찾아라에는 깨우기가 없다
    if (p.role !== 'student' || p.frozen || !target || !target.frozen) return;
    if (dist(p, target) > CHASE.reach + 15) return;
    p.thaw = { id: target.id, at: Date.now() };
  },
  thawCancel(ws) {
    if (ws.session && ws.session.role === 'player') ws.session.player.thaw = null;
  },
  // 학생: 충분히 오래 누르고 있었으면 친구가 깨어난다 (누르는 시간은 안개 단계 값)
  thawEnd(ws) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const rec = p.thaw;
    p.thaw = null;
    const now = Date.now();
    const stage = fogStage(room);
    if (!rec || p.frozen || now - rec.at < stageValue('wakeHoldMs', stage, CHASE.thawHoldMs) - 200) return;
    const target = room.players.get(rec.id);
    if (!target || !target.frozen || dist(p, target) > CHASE.reach + 25) return;
    wakeUp(room, target, p.id, now, stageValue('wakeProtectMs', stage, CHASE.thawProtectMs));
    broadcast(room);
  },

  // 미끄럼틀·개구멍 타기. 누가 탈 수 있는지는 맵 데이터의 who 에 적혀 있다.
  use(ws, m) {
    const s = playSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    const now = Date.now();
    const map = maps.get(room.settings.map).data;
    const device = (map.devices || []).find((d) => d.id === m.device);
    if (!device || p.frozen || now < p.rideUntil || room.meeting) return;
    const allowed = (device.who && device.who[room.settings.mode]) || [];
    if (!allowed.includes(p.role)) {
      const mode = modeOf(room.settings.mode);
      const who = p.role === 'chaser' ? mode.chaser : mode.student;
      return fail(ws, 'not_allowed', `${device.name}: ${who}${josa(who, '은', '는')} 탈 수 없어요!`);
    }
    if (Math.hypot(p.x - device.from[0], p.y - device.from[1]) > CHASE.deviceReach + 15) {
      // 출구 근처에서 누르면 "여기는 출구" 안내 (06 명세 9-3절)
      // (계단·엘리베이터는 도착한 곳에 짝 장치가 있어서 "출구" 안내를 하지 않는다)
      const exits = device.type === 'teleport' ? device.exits || [] : device.to ? [device.to] : [];
      const pairStyle = device.style === 'stairs-up' || device.style === 'stairs-down' || device.style === 'elevator';
      if (!pairStyle && exits.some((e) => Math.hypot(p.x - e[0], p.y - e[1]) <= TERMINAL_REACH)) {
        if (device.style === 'carousel') return fail(ws, 'not_entrance', '여기는 회전목마 내리는 곳이에요. 타는 곳은 반대편에 있어요.');
        const at = roomAt(map, device.from[0], device.from[1]);
        return fail(ws, 'not_entrance', `여기는 출구예요. 들어가는 곳은 ${at ? at.name : '복도'}에 있어요.`);
      }
      return fail(ws, 'too_far', '입구에 더 가까이 가 주세요.');
    }
    // 다시 탈 때까지 기다리는 시간은 장치마다. cooldown.group 이 같은 장치들(예: 엘리베이터 문 여러 개)은 함께 센다
    const cdKey = (device.cooldown && device.cooldown.group) || device.id;
    const ready = p.devReadyAt[cdKey] || 0;
    if (now < ready) return fail(ws, 'device_cooldown', `${Math.ceil((ready - now) / 1000)}초 뒤에 다시 탈 수 있어요.`);
    // 줄 서는 장치 (solo: true, 놀이공원 미끄럼틀): 한 번에 한 명만. 앞사람이 다 탈 때(+ soloGap 초)까지 기다린다.
    // 꿈도둑을 찾아라의 꿈에 빠진 사람은 다른 사람에게 보이지 않으므로 줄에 끼지도, 막히지도 않는다.
    const solo = !!device.solo && !p.ghost;
    if (!room.devBusy) room.devBusy = {};
    if (solo && now < (room.devBusy[device.id] || 0)) {
      return fail(ws, 'device_busy', `앞사람이 타고 있어요. ${Math.ceil((room.devBusy[device.id] - now) / 1000)}초 뒤에 탈 수 있어요.`);
    }
    const from = [p.x, p.y];
    const to = device.type === 'teleport' ? device.exits[crypto.randomInt(device.exits.length)] : device.to;
    const ms = (device.duration || 1.5) * 1000;
    if (solo) {
      const gap = Number.isFinite(device.soloGap) && device.soloGap >= 0 ? device.soloGap : 0.5;
      room.devBusy[device.id] = now + ms + gap * 1000;
    }
    closeCurrent(room, p, 'unsolved');
    p.thaw = null;
    p.loot = null;
    [p.x, p.y] = to;
    p.m = 0;
    p.rideUntil = now + ms;
    p.movedAt = now + ms;
    p.protUntil = Math.max(p.protUntil, now + ms + (device.protectAfter || 0) * 1000); // 타는 동안 + 도착 뒤 잠깐은 꿈에 안 빠진다
    p.devReadyAt[cdKey] = now + ms + ((device.cooldown && device.cooldown.seconds) || 0) * 1000;
    // 꿈에 빠진 학생이 타는 모습은 볼 수 있는 사람(선생님·꿈도둑·꿈에 빠진 사람)에게만 알린다
    sendEvent(room, { kind: 'ride', id: p.id, device: device.id, from, to, ms }, seesPlayer(room, p));
    broadcast(room);
  },

  // ── 꿈도둑을 찾아라 ──
  // 꿈도둑: 작전 (blackout 안개 뿌리기 · lock 문 막기 · disguise 변신)
  sabotage(ws, m) {
    const s = mafiaSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (p.role !== 'chaser' || p.ghost || room.meeting) return;
    const now = Date.now();
    const sabo = room.sabo;
    const wait = (until) => fail(ws, 'sabo_cooldown', `${Math.ceil((until - now) / 1000)}초 뒤에 쓸 수 있어요.`);
    if (!['blackout', 'lock', 'disguise'].includes(m.kind)) return;
    if (now < sabo.graceUntil) return fail(ws, 'too_early', `${Math.ceil((sabo.graceUntil - now) / 1000)}초 뒤부터 작전을 쓸 수 있어요.`);
    if (m.kind === 'blackout') {
      if (fogStage(room) >= 3) return fail(ws, 'fog_night', '마지막 밤에는 안개 뿌리기를 쓸 수 없어요.');
      if (now < sabo.readyAt.blackout) return wait(sabo.readyAt.blackout);
      sabo.blackoutUntil = now + MAFIA.blackoutMs;
      sabo.readyAt.blackout = now + MAFIA.blackoutCooldownMs;
      sendEvent(room, { kind: 'blackout', ms: MAFIA.blackoutMs }); // 누가 썼는지는 넣지 않는다
    } else if (m.kind === 'lock') {
      if (now < sabo.readyAt.lock) return wait(sabo.readyAt.lock);
      let door = null;
      let best = MAFIA.lockReach;
      for (const d of maps.get(room.settings.map).data.doors || []) {
        if (!d.lockable) continue;
        const dd = Math.hypot(p.x - (d.rect[0] + d.rect[2] / 2), p.y - (d.rect[1] + d.rect[3] / 2));
        if (dd <= best) (door = d), (best = dd);
      }
      if (!door) return fail(ws, 'no_door', '근처에 막을 문이 없어요.'); // 쿨타임은 쓰지 않는다
      sabo.lock = { door: door.id, rect: door.rect, until: now + MAFIA.lockMs };
      sabo.readyAt.lock = now + MAFIA.lockCooldownMs;
      sendEvent(room, { kind: 'lock', door: door.id, ms: MAFIA.lockMs });
    } else {
      if (p.disguise) return fail(ws, 'already_disguised', '이미 변신 중이에요.');
      if (p.disguiseLeft <= 0) return fail(ws, 'no_disguise', `변신은 한 판에 ${MAFIA.disguisePerGame}번까지예요.`);
      const pool = [...room.players.values()].filter((q) => q.role === 'student' && !q.ghost);
      if (!pool.length) return fail(ws, 'no_target', '변신할 대상이 없어요.');
      const look = pool[crypto.randomInt(pool.length)];
      p.disguise = { color: look.color, character: look.character, until: now + MAFIA.disguiseMs };
      p.disguiseLeft -= 1;
    }
    broadcast(room);
    for (const q of room.players.values()) if (q.role === 'chaser') sendMe(room, q);
  },

  // 깨어 있는 사람: 꿈에 빠진 자리에서 호루라기 → 회의
  alarm(ws, m) {
    const s = mafiaSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (room.meeting) return;
    if (p.ghost) return fail(ws, 'ghost', '꿈에 빠져 있을 때는 호루라기를 불 수 없어요.');
    const mark = room.marks.find((k) => k.id === m.mark);
    if (!mark) return fail(ws, 'no_mark', '그 자리에는 꿈에 빠진 친구가 없어요.');
    if (dist(p, mark) > MAFIA.reportReach + 8) return fail(ws, 'too_far', '꿈에 빠진 친구에게 더 가까이 가 주세요.');
    startMeeting(room, 'report', p.id, mark.id);
  },

  // 깨어 있는 학생: 회의 종 울리기
  emergency(ws) {
    const s = mafiaSession(ws);
    if (!s) return;
    const { room, player: p } = s;
    if (room.meeting) return;
    const now = Date.now();
    if (p.ghost) return fail(ws, 'ghost', '꿈에 빠져 있을 때는 회의 종을 울릴 수 없어요.');
    if (p.role !== 'student') return fail(ws, 'not_now', '지금은 울릴 수 없어요.');
    if (p.usedButton) return fail(ws, 'button_used', '회의 종은 한 사람이 한 번만 울릴 수 있어요.');
    if (room.meetingsLeft <= 0) return fail(ws, 'no_meetings', '회의 종을 모두 썼어요.');
    const bell = maps.get(room.settings.map).data.bell;
    if (!bell) return;
    if (Math.hypot(p.x - bell.pos[0], p.y - bell.pos[1]) > MAFIA.buttonReach + 8) {
      return fail(ws, 'too_far', '회의 종에 더 가까이 가 주세요.');
    }
    if (now < room.buttonReadyAt) return fail(ws, 'too_early', `${Math.ceil((room.buttonReadyAt - now) / 1000)}초 뒤에 울릴 수 있어요.`);
    p.usedButton = true;
    room.meetingsLeft -= 1;
    startMeeting(room, 'button', null, null); // 누가 울렸는지는 보내지 않는다
  },

  // 투표 (투표 단계, 회의 시작 때 깨어 있고 연결된 사람만)
  vote(ws, m) {
    const s = mafiaSession(ws);
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
    if (!s || s.role !== 'teacher' || !isMafiaGame(s.room) || s.room.over) return;
    const mt = s.room.meeting;
    if (!mt || mt.stage !== 'discuss') return;
    const now = Date.now();
    if (m.action === 'extend') {
      if (mt.extended >= MAFIA.extendMax) return;
      mt.extended += 1;
      mt.stageEndsAt += MAFIA.extendMs;
    } else if (m.action === 'vote') {
      mt.stage = 'vote';
      mt.stageEndsAt = now + MAFIA.voteMs;
    } else return;
    broadcast(s.room);
  },
};

function mafiaSession(ws) {
  const s = playSession(ws);
  return s && isMafiaGame(s.room) ? s : null;
}

// 깨우기 (깨우기 버튼·기상 나팔)
function wakeUp(room, target, by, now, protect) {
  target.frozen = false;
  target.drowsy = 0;
  target.protUntil = now + protect;
  target.movedAt = now;
  sendEvent(room, { kind: 'thaw', by, id: target.id });
  sendMe(room, target);
}
// 꿈막이 우산이 꿈 걸기를 막았다: 건 사람은 쿨타임만 쓰고 구슬은 안 쓴다
function popShield(room, p, target) {
  target.fx.umbrella = 0;
  sendEvent(room, { kind: 'shieldPop', id: target.id }, seesPlayer(room, target));
  sendMe(room, target);
  sendMe(room, p);
  broadcast(room);
}

// 꿈도둑을 찾아라의 꿈 걸기: 가장 가까운 깨어 있는 학생을 꿈에 빠뜨린다 (꿈 구슬 1개)
function freezeTag(room, p) {
  const now = Date.now();
  if (p.role !== 'chaser' || p.ghost || room.meeting || now < p.tagReadyAt) return;
  if (now < p.rideUntil) return; // 장치를 타는 중에는 꿈을 걸 수 없다
  if (p.energy <= 0) return fail(p.ws, 'no_energy', '꿈 구슬이 없어요. 퀴즈를 풀어 채워요.');
  let target = null;
  let best = MAFIA.freezeReach + 8; // 화면과 서버의 위치 차이만큼 조금 넉넉하게
  for (const q of room.players.values()) {
    if (q.role !== 'student' || q.ghost || now < q.protUntil || now < q.rideUntil) continue;
    const d = dist(p, q);
    if (d <= best) (target = q), (best = d);
  }
  if (!target) {
    p.tagReadyAt = now + 800; // 헛손질: 마구 누르지 못하게 잠깐 쉰다
    return sendMe(room, p);
  }
  p.tagReadyAt = now + stageValue('mafiaCooldownMs', fogStage(room), MAFIA.freezeCooldownMs);
  if (fxOn(target, 'umbrella', now)) return popShield(room, p, target);
  p.energy -= 1;
  target.ghost = true;
  target.ghostKnown = false;
  target.m = 0;
  target.loot = null;
  closeCurrent(room, target, 'unsolved');
  send(target.ws, { t: 'closeq' });
  room.marks.push({ id: target.id, x: target.x, y: target.y, color: target.color, character: target.character });
  // 건 꿈도둑들과 꿈에 빠진 사람(그리고 선생님)에게만 알린다
  sendEvent(room, { kind: 'freeze', by: p.id, id: target.id, x: target.x, y: target.y }, (q) => q.role === 'chaser' || q.id === target.id);
  checkMafiaWin(room);
  broadcast(room);
  sendMe(room, p);
  sendMe(room, target);
}

// 안개·보급·졸음·효과 시계 (회의 중이 아닐 때 stateTick 이 부른다). 방 정보를 다시 보내야 하면 true.
function worldTick(room, now, dt) {
  let changed = false;
  const imp = isMafiaGame(room);
  const el = gameElapsed(room, now);
  const dirty = new Set(); // me 를 다시 보낼 사람
  // 1) 잠 안개: 예고 / 단계 시작 / 반지름 / 마지막 밤 임시 랜턴
  const plan = room.fogPlan;
  if (plan) {
    room.fogCur = fogNow(plan, el);
    const last = plan.stages.length - 1;
    plan.stages.forEach((s, i) => {
      // 층 안개는 어떤 층이 어두워지는지(dark)·안전한 층(safe) 이름도 알린다
      const news = plan.mode === 'floors' ? floorFogNews(plan, i) : null;
      if (!s.warned && el >= s.startMs - FOG.warnMs) {
        s.warned = true;
        sendEvent(room, { kind: 'fogWarn', stage: i + 1, inMs: Math.max(0, Math.round(s.startMs - el)), ...news });
        changed = true;
      }
      if (!s.started && el >= s.startMs) {
        s.started = true;
        sendEvent(room, { kind: 'fogStart', stage: i + 1, ...news });
        if (i === last) {
          room.bonusTerminals = plan.bonus.slice(0, FOG.bonusCount).map((pos, k) => ({ id: 'b' + (k + 1), pos }));
          sendEvent(room, { kind: 'bonusLanterns' });
        }
        changed = true;
      }
      if (s.started && !s.shrunk && el >= s.startMs + s.shrinkMs) {
        s.shrunk = true;
        changed = true;
      }
    });
    if (room.fogCur.shrinkMsLeft > 0 && now - room.fogBroadcastAt >= 1000) changed = true; // 좁혀지는 동안 1초마다
  }
  // 2) 보급: 차례가 되면 떨어뜨리고, 수명이 끝난 상자는 지운다
  if (room.settings.fogLoot) {
    while (room.dropIndex < LOOT.dropsAt.length && el >= LOOT.dropsAt[room.dropIndex] * room.totalMs) {
      room.dropIndex++;
      dropCrates(room, now);
      changed = true;
    }
    for (const c of [...room.crates]) {
      if (now >= c.until) {
        removeCrate(room, c);
        sendEvent(room, { kind: 'crateGone' });
        changed = true;
      }
    }
  }
  // 3) 사람마다: 안개 안/밖, 졸음(잠귀신 술래잡기 학생만), 효과·힌트 시계
  for (const p of room.players.values()) {
    const fogged = isInFog(room, p);
    if (fogged !== p.inFog) {
      p.inFog = fogged;
      dirty.add(p);
    }
    if (!imp && p.role === 'student' && !p.frozen && now >= p.rideUntil) {
      if (fogged) p.drowsy += dt;
      else p.drowsy = Math.max(0, p.drowsy - dt * FOG.drowsyRecover);
      if (p.drowsy >= FOG.drowsyMs && !room.over) {
        putToSleep(room, p, 'fog');
        changed = true;
      }
      const shown = Math.round((p.drowsy / FOG.drowsyMs) * 20);
      if (shown !== p.drowsyShown) {
        p.drowsyShown = shown;
        dirty.add(p);
      }
    }
    for (const [k, u] of Object.entries(p.fx)) {
      if (u && u <= now) {
        p.fx[k] = 0;
        dirty.add(p);
        if (k === 'fogcape' || k === 'invis') changed = true;
      }
    }
    if (p.hint && p.hint.until <= now) {
      p.hint = null;
      dirty.add(p);
    }
  }
  for (const p of dirty) sendMe(room, p);
  // 4) 보이는 상자가 바뀐 사람에게 crates
  if (room.settings.fogLoot) sendCrates(room, now);
  if (changed) room.fogBroadcastAt = now;
  return changed;
}

// 게임 중인 방에 모든 학생의 위치를 1초에 여러 번 보낸다 + 시간이 흐르는 규칙을 처리한다
const stateTick = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase !== 'game') continue;
    const now = Date.now();
    const dt = Math.min(500, Math.max(0, now - (room.tickAt || now)));
    room.tickAt = now;
    const imp = isMafiaGame(room);
    if (!room.over) {
      let changed = false;
      if (imp) {
        // 작전 효과가 끝났는지
        if (room.sabo.blackoutUntil && now >= room.sabo.blackoutUntil) (room.sabo.blackoutUntil = 0), (changed = true);
        if (room.sabo.lock && now >= room.sabo.lock.until) (room.sabo.lock = null), (changed = true);
        for (const p of room.players.values()) if (p.disguise && now >= p.disguise.until) (p.disguise = null), (changed = true);
        if (room.meeting) changed = advanceMeeting(room, now) || changed; // 회의 중에는 시계가 멈춘다
        else if (now >= room.endsAt) (endGame(room, 'chasers', 'time_up'), (changed = true));
      } else if (now >= room.endsAt) {
        endGame(room, 'chasers', 'time_up'); // 아침까지 랜턴을 다 못 켜면 잠귀신 승리
        changed = true;
      }
      if (!room.over && !(imp && room.meeting)) changed = worldTick(room, now, dt) || changed;
      if (changed) broadcast(room);
    }
    const rows = [...room.players.values()].map((p) => [p.id, p.x, p.y, p.f, p.m]);
    const msg = JSON.stringify({ t: 'state', p: rows });
    if (!isMafiaGame(room) || room.over) {
      for (const ws of [room.teacherWs, ...[...room.players.values()].map((p) => p.ws)]) {
        if (ws && ws.readyState === 1) ws.send(msg);
      }
      continue;
    }
    // 꿈도둑을 찾아라: 깨어 있는 학생에게는 꿈에 빠진 사람의 위치를 빼고 보낸다
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
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
// 접속한 컴퓨터 주소(IP). TRUST_PROXY 가 켜져 있으면 프록시가 적어 준 X-Forwarded-For 의 첫 값, 아니면 연결 주소.
function clientIp(req) {
  if (TRUST_PROXY) {
    const raw = req.headers['x-forwarded-for'];
    const first = String(Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim();
    if (first && first.length <= 64) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}
// 웹소켓 주소: '/ws' 와 BASE_PATH+'/ws' (예: '/lantern/ws') 둘 다 받는다
server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try {
    pathname = stripBase(new URL(req.url, 'http://x').pathname);
  } catch {
    /* 잘못된 주소 */
  }
  if (pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  ws.ip = clientIp(req);
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
    if (ws.session) ws.session.room.activeAt = Date.now(); // 방 안의 누군가가 무엇이든 하면 활동으로 친다
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
      s.player.loot = null;
    }
    if (rooms.has(s.room.code)) broadcast(s.room);
  });
});

// 주기 정리: 죽은 연결, 오래 끊긴 학생, 버려진 방
// (선생님이 끊긴 지 ROOM_LIMITS.teacherGoneMs, 아무 활동 없이 ROOM_LIMITS.idleMs, 만든 지 ROOM_MAX_MS 가 지나면 닫는다.
//  그 전에 선생님이 새로고침·재접속하면 resume 으로 방을 그대로 이어받는다)
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
        removePlayer(room, p); // 꿈도둑을 찾아라: 투표자 목록에서도 빼고 승패를 확인한다
        changed = true;
      }
    }
    const teacherGone = !room.teacherWs && now - room.teacherLeftAt > ROOM_LIMITS.teacherGoneMs;
    if (teacherGone) closeRoom(room, 'teacher_gone');
    else if (now - room.activeAt > ROOM_LIMITS.idleMs) closeRoom(room, 'idle');
    else if (now - room.createdAt > ROOM_MAX_MS) closeRoom(room, 'expired');
    else if (changed) broadcast(room);
  }
}, CLEANUP_MS);
cleanup.unref();

server.listen(PORT, HOST, () => {
  console.log(`게임 서버가 켜졌어요: http://localhost:${PORT}${BASE_PATH}/`);
  console.log(`여는 주소(HOST): ${HOST}:${PORT}${HOST === '127.0.0.1' ? ' — 같은 컴퓨터(nginx)에서만 접속할 수 있어요.' : ''}`);
  if (TRUST_PROXY) {
    console.log('프록시 믿기(TRUST_PROXY): 켜짐 — X-Forwarded-For 의 첫 값을 접속 주소로 써요.');
    if (!['127.0.0.1', '::1', 'localhost'].includes(HOST)) {
      console.log('주의: TRUST_PROXY 를 켰는데 HOST 가 127.0.0.1 이 아니에요. 바깥에서 주소를 꾸며 보낼 수 있으니 HOST=127.0.0.1 로 하세요.');
    }
  }
  if (BASE_PATH) console.log(`주소 앞부분(BASE_PATH): ${BASE_PATH} — 앞부분 없는 주소(http://localhost:${PORT}/)도 같이 받아요.`);
  console.log(
    TEACHER_PASSWORD
      ? '선생님 비밀번호(TEACHER_PASSWORD): 사용 — 방을 만들 때 비밀번호를 물어요.'
      : '선생님 비밀번호(TEACHER_PASSWORD): 없음 — 선생님 주소에서 누구나 방을 만들 수 있어요.',
  );
  console.log(
    `방 제한: 전체 ${ROOM_LIMITS.maxRooms}개 · 같은 주소 동시 ${ROOM_LIMITS.perIp}개 · 같은 주소 1시간 ${ROOM_LIMITS.perHour}개 · ` +
      `선생님 끊김 ${Math.round(ROOM_LIMITS.teacherGoneMs / 60_000)}분/활동 없음 ${Math.round(ROOM_LIMITS.idleMs / 60_000)}분 뒤 자동 정리`,
  );
});
