// 게임 화면: 맵 위에서 돌아다니기, 술래·얼음 표시, 시야 제한, 미끄럼틀·개구멍 연출.
// 방해꾼 찾기 모드(opts.impostor)에서는 유령·얼음 흔적·동료 뿔·위장·정전·잠긴 문도 그린다.
import { COLORS, GAME, TAG } from '/shared/config.js';
import { buildGrid, canStand, zoneAt } from '/shared/mapgrid.js';
import { renderMap } from '/maprender.js';
import { drawCharacter } from '/characters.js';
import { IMP } from '/impconst.js';

const INK = '#2a2140';
const FONT = "'Jua', 'Malgun Gothic', sans-serif";

const mapCache = new Map();
async function loadMap(id) {
  if (!mapCache.has(id)) {
    const data = await (await fetch(`/maps/${id}.json`)).json();
    const grid = buildGrid(data);
    try {
      await document.fonts.load("40px 'Jua'"); // 방 이름을 만화 글씨로 그리기 위해 기다린다
    } catch {
      /* 글꼴을 못 받아도 기본 글씨로 그린다 */
    }
    mapCache.set(id, { data, grid, image: renderMap(data, grid) });
  }
  return mapCache.get(id);
}

// 여러 점을 잇는 길 위에서 k(0~1) 만큼 간 자리
function alongPath(pts, k) {
  const lens = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, k)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const f = lens[i] ? d / lens[i] : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }
    d -= lens[i];
  }
  return pts[pts.length - 1];
}

/**
 * opts: { canvas, mapId, role('teacher'|'player'), myId, players, send, impostor(true면 방해꾼 찾기),
 *         onContext(ctx|null)  — 지금 할 수 있는 행동(E)이 바뀔 때,
 *         onMark(id|null)      — 신고할 수 있는 얼음 흔적이 바뀔 때 (방해꾼 찾기),
 *         onKey('down'|'up', which) — 키를 누르고 뗄 때.
 *           which: 'act'(E·엔터, 얼음땡은 스페이스도) | 'freeze'(Q·스페이스) | 'sabo'(F) | 'sabo1'~'sabo3'(1·2·3) | 'alarm'(R) | 'map'(M) }
 * ctx: { type: 'tag'|'thaw'|'terminal'|'device'|'emergency', id, label }
 */
export async function startGame(opts) {
  const { canvas, role, myId, send } = opts;
  const impostor = !!opts.impostor;
  const { data: map, grid, image } = await loadMap(opts.mapId);
  const ctx = canvas.getContext('2d');
  const players = new Map(); // id → 그릴 정보
  const popups = []; // "꽁!", "땡!" 같은 글자 효과
  let me = null;
  let running = true;
  let raf = 0;
  let over = false;

  // 방해꾼 찾기 상태
  let marks = []; // 얼음 흔적 [{ id, x, y, color, character }]
  let mates = new Set(); // 동료 방해꾼 id (내가 방해꾼일 때)
  let myRole = null; // 'me' 메시지로 받은 내 역할
  let myGhost = false;
  let meeting = false; // 회의 중이면 아무도 움직이지 않는다
  let showRoles = false; // 선생님 "역할 보기"
  let blackoutUntil = 0;
  let blackoutStart = -1e9;
  let lock = null; // { door, rect, until }
  let minimap = null; // 지도(M) 캔버스
  let markKey = '';

  function setPlayers(list, isOver) {
    over = !!isOver;
    const now = performance.now();
    const ids = new Set(list.map((p) => p.id));
    for (const id of players.keys()) if (!ids.has(id)) players.delete(id);
    for (const p of list) {
      let q = players.get(p.id);
      if (!q) {
        const hasPos = typeof p.x === 'number';
        q = { id: p.id, x: p.x || 0, y: p.y || 0, fromX: p.x || 0, fromY: p.y || 0, toX: p.x || 0, toY: p.y || 0, at: 0, f: 1, m: 0, seed: Math.random() * 3, ride: null, seenAt: hasPos ? now : -1e9 };
        players.set(p.id, q);
      }
      q.color = (COLORS[p.color] || COLORS[0]).hex;
      q.character = p.character;
      q.connected = p.connected;
      q.role = p.role;
      q.frozen = !!p.frozen;
      q.protUntil = now + (p.protMs || 0);
      const wasGhost = q.ghost;
      q.ghost = !!p.ghost;
      q.ejected = !!p.ejected;
      if (q.ghost && !wasGhost && q.morphAt == null) q.morphAt = -1e9; // 이미 유령이었던 사람은 변신 연출 없이
      // 위장: 선생님·방해꾼 화면에는 진짜 모습 + 위장 표시 (서버가 disguise 를 붙여 줄 때만)
      if (p.disguise) {
        const until = now + (typeof p.disguise.ms === 'number' ? p.disguise.ms : IMP.disguiseMs);
        if (!q.disguise || Math.abs(q.disguise.until - until) > 400) q.disguise = { until };
      } else q.disguise = null;
    }
    me = role === 'player' ? players.get(myId) || null : null;
    if (me && myGhost) me.ghost = true;
  }
  setPlayers(opts.players, false);

  // 회의 시작·끝에 서버가 정해 준 자리로 모두를 바로 옮긴다
  function snapAll(list) {
    for (const p of list) {
      const q = players.get(p.id);
      if (!q || typeof p.x !== 'number') continue;
      q.ride = null;
      q.x = q.fromX = q.toX = p.x;
      q.y = q.fromY = q.toY = p.y;
      q.at = 0;
      q.m = 0;
    }
  }

  // 서버가 보내 준 모두의 위치. 다른 사람은 부드럽게 따라가도록 목표만 바꾼다.
  function onState(list) {
    const now = performance.now();
    for (const [id, x, y, f, m] of list) {
      const q = players.get(id);
      if (q) q.seenAt = now;
      if (!q || q === me || q.ride) continue;
      q.fromX = q.x;
      q.fromY = q.y;
      q.toX = x;
      q.toY = y;
      q.at = now;
      q.f = f;
      q.m = m;
    }
  }
  function onFix(x, y) {
    if (me && !me.ride) (me.x = x), (me.y = y);
  }

  // 정전·문 잠금 상태 (room.sabo: { blackoutMs, lockedDoor, lockMs })
  function setSabo(s) {
    const now = performance.now();
    const bMs = (s && s.blackoutMs) || 0;
    if (bMs > 0) {
      const until = now + bMs;
      if (blackoutUntil <= now) blackoutStart = now; // 막 시작됨 → 깜빡임 연출
      if (Math.abs(until - blackoutUntil) > 300) blackoutUntil = until;
    } else if (blackoutUntil > now) blackoutUntil = now; // 회의 등으로 일찍 풀림
    const doorId = s && s.lockedDoor;
    const lMs = (s && s.lockMs) || 0;
    if (doorId && lMs > 0) {
      const door = (map.doors || []).find((d) => d.id === doorId);
      if (door) {
        const until = now + lMs;
        if (!lock || lock.door !== doorId) lock = { door: doorId, rect: door.rect, until, total: lMs, at: now };
        else if (Math.abs(lock.until - until) > 300) lock.until = until;
      }
    } else lock = null;
  }
  function blackoutActive(now) {
    return now < blackoutUntil;
  }
  // 정전 때 시야가 줄어드는 사람: 살아 있는 학생만
  function blackoutHitsMe() {
    return !!me && !myGhost && !me.ghost && myRole !== 'chaser';
  }
  // 시야 배율: 깜빡깜빡(0.6초) → 0.4초에 걸쳐 줄어듦, 끝나면 0.4초에 걸쳐 다시 넓어짐
  function visionScale(now) {
    if (!impostor || !blackoutHitsMe()) return 1;
    const low = IMP.blackoutVision;
    if (blackoutActive(now)) {
      const e = (now - blackoutStart) / 1000;
      if (e < 0.6) return 1;
      return 1 - (1 - low) * Math.min(1, (e - 0.6) / 0.4);
    }
    const e = (now - blackoutUntil) / 1000;
    if (e < 0.4 && blackoutUntil > 0) return low + (1 - low) * (e / 0.4);
    return 1;
  }
  // 잠긴 문 칸과 겹치는가 (화면 쪽 예측. 서버도 같은 규칙으로 되돌린다)
  function hitsLock(x, y, now) {
    if (!lock || now >= lock.until) return false;
    const r = GAME.radius;
    const [lx, ly, lw, lh] = lock.rect;
    return x + r > lx && x - r < lx + lw && y + r > ly && y - r < ly + lh;
  }

  // 잡기·땡·장치 타기 연출 (방해꾼 찾기: 얼리기·정전·문 잠금)
  function onEvent(ev) {
    const now = performance.now();
    if (ev.kind === 'blackout') {
      setSabo({ blackoutMs: ev.ms || IMP.blackoutMs, lockedDoor: lock && lock.door, lockMs: lock ? lock.until - now : 0 });
      return;
    }
    if (ev.kind === 'lock') {
      const door = (map.doors || []).find((d) => d.id === ev.door);
      if (door) {
        setSabo({ blackoutMs: Math.max(0, blackoutUntil - now), lockedDoor: ev.door, lockMs: ev.ms || IMP.lockMs });
        popups.push({ text: '철컥!', x: door.rect[0] + door.rect[2] / 2, y: door.rect[1] - 30, at: now, color: '#e5484d' });
      }
      return;
    }
    const q = players.get(ev.id);
    if (!q) return;
    if (ev.kind === 'freeze') {
      // 얼려짐: 얼음에 갇혔다가 유령으로 변신
      q.morphAt = now;
      q.ghost = true;
      if (q === me) myGhost = true;
      popups.push({ text: '꽁!', x: q.x, y: q.y - 100, at: now, color: '#5cc8f2' });
      return;
    }
    if (ev.kind === 'tag') popups.push({ text: '꽁!', x: q.x, y: q.y - 100, at: now, color: '#5cc8f2' });
    if (ev.kind === 'thaw') popups.push({ text: '땡!', x: q.x, y: q.y - 100, at: now, color: '#ffd94a' });
    if (ev.kind === 'ride') {
      const device = (map.devices || []).find((d) => d.id === ev.device);
      const slide = device && device.type === 'slide';
      q.ride = {
        at: now,
        ms: ev.ms,
        slide,
        path: slide ? [ev.from, device.from, ...(device.path || []), device.to] : [ev.from, device ? device.from : ev.from, ev.to],
        to: ev.to,
      };
      popups.push({ text: slide ? '슈웅~' : '쏙!', x: ev.from[0], y: ev.from[1] - 90, at: now, color: '#ff7a59' });
    }
  }

  // ───── 미션·행동 ─────
  let mine = { solved: 0, missions: 0, done: new Set() };
  let reveal = false; // 선생님 화면: 학생 위치를 보여 줄지 (기본은 숨김. TV에 띄워도 술래가 훔쳐보지 못하게)
  let paused = false; // 문제 창이 떠 있는 동안은 움직이지 않는다
  let ctxKey = '';
  function setMe(info) {
    mine = { solved: info.solved, missions: info.missions, done: new Set(info.done) };
    myRole = info.role || null;
    myGhost = myGhost || !!info.ghost; // 한 판 안에서 유령은 되돌아오지 않는다
    if (me && myGhost) me.ghost = true;
    mates = new Set(info.mates || []);
  }
  function setPaused(v) {
    paused = v;
    keys.clear();
    stick.active = false;
  }
  // 방해꾼 찾기: 지금 할 수 있는 E 행동 하나 (문제 > 긴급회의 > 장치 중 가장 가까운 것)
  function findImpostorContext() {
    const ghost = myGhost || me.ghost;
    let best = null;
    let bestD = Infinity;
    const consider = (d, reach, c) => {
      if (d <= reach && d < bestD) (best = c), (bestD = d);
    };
    if (mine.solved < mine.missions) {
      for (const t of map.terminals || []) {
        if (mine.done.has(t.id)) continue;
        consider(Math.hypot(me.x - t.pos[0], me.y - t.pos[1]), 80, { type: 'terminal', id: t.id, label: '문제 풀기' });
      }
    }
    if (!ghost && map.meetingButton) {
      const [bx, by] = map.meetingButton.pos;
      consider(Math.hypot(me.x - bx, me.y - by), IMP.buttonReach, { type: 'emergency', id: 'button', label: '긴급회의' });
    }
    for (const d of map.devices || []) {
      consider(Math.hypot(me.x - d.from[0], me.y - d.from[1]), TAG.deviceReach, { type: 'device', id: d.id, label: d.type === 'slide' ? '미끄럼틀 타기' : '개구멍 들어가기' });
    }
    return best;
  }
  // 신고할 수 있는 가장 가까운 얼음 흔적 (살아 있는 사람만)
  function findMark() {
    if (!impostor || !me || paused || over || meeting || me.ride || myGhost || me.ghost) return null;
    let best = null;
    let bestD = IMP.reportReach;
    for (const k of marks) {
      const d = Math.hypot(me.x - k.x, me.y - k.y);
      if (d <= bestD) (best = k.id), (bestD = d);
    }
    return best;
  }
  // 지금 할 수 있는 행동 하나를 고른다 (학생: 땡 > 문제 > 장치, 술래: 잡기)
  function findContext() {
    if (!me || paused || over || me.ride || meeting) return null;
    if (impostor) return findImpostorContext();
    if (me.role === 'chaser') return { type: 'tag', id: 'tag', label: '잡기' };
    if (me.frozen) return null;
    let best = null;
    let bestD = TAG.reach;
    for (const q of players.values()) {
      if (q === me || !q.frozen || q.role !== 'student') continue;
      const d = Math.hypot(me.x - q.x, me.y - q.y);
      if (d <= bestD) (best = { type: 'thaw', id: q.id, label: '땡! (꾹 누르기)' }), (bestD = d);
    }
    if (best) return best;
    if (mine.solved < mine.missions) {
      bestD = 80;
      for (const t of map.terminals || []) {
        if (mine.done.has(t.id)) continue;
        const d = Math.hypot(me.x - t.pos[0], me.y - t.pos[1]);
        if (d <= bestD) (best = { type: 'terminal', id: t.id, label: '문제 풀기' }), (bestD = d);
      }
      if (best) return best;
    }
    bestD = TAG.deviceReach;
    for (const d of map.devices || []) {
      const dd = Math.hypot(me.x - d.from[0], me.y - d.from[1]);
      if (dd <= bestD) (best = { type: 'device', id: d.id, label: d.type === 'slide' ? '미끄럼틀 타기' : '개구멍 들어가기' }), (bestD = dd);
    }
    return best;
  }

  // ───── 조작: 키보드 + 화면 조이스틱 ─────
  const keys = new Set();
  const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  const KEYMAP = {
    ArrowLeft: 'L', a: 'L', A: 'L', ㅁ: 'L',
    ArrowRight: 'R', d: 'R', D: 'R', ㅇ: 'R',
    ArrowUp: 'U', w: 'U', W: 'U', ㅈ: 'U',
    ArrowDown: 'D', s: 'D', S: 'D', ㄴ: 'D',
  };
  // 어떤 행동 키인가 (한글 자판 상태에서도 같은 자리의 글자를 받는다)
  const IMP_KEYS = {
    e: 'act', E: 'act', ㄷ: 'act', Enter: 'act',
    q: 'freeze', Q: 'freeze', ㅂ: 'freeze', ' ': 'freeze',
    f: 'sabo', F: 'sabo', ㄹ: 'sabo',
    1: 'sabo1', 2: 'sabo2', 3: 'sabo3',
    r: 'alarm', R: 'alarm', ㄱ: 'alarm',
    m: 'map', M: 'map', ㅡ: 'map',
  };
  const actionOf = (e) => {
    if (impostor) return IMP_KEYS[e.key] || null;
    return e.key === 'e' || e.key === 'E' || e.key === 'ㄷ' || e.key === ' ' || e.key === 'Enter' ? 'act' : null;
  };
  const onKeyDown = (e) => {
    if (paused || role !== 'player') return; // 문제 창에 글자를 적을 수 있게 그대로 둔다
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const which = actionOf(e);
    if (which) {
      if (!e.repeat) opts.onKey('down', which);
      e.preventDefault();
      return;
    }
    const k = KEYMAP[e.key];
    if (!k) return;
    keys.add(k);
    e.preventDefault();
  };
  const onKeyUp = (e) => {
    const which = actionOf(e);
    if (which && role === 'player') opts.onKey('up', which);
    keys.delete(KEYMAP[e.key]);
  };
  const onBlur = () => keys.clear();
  const onDown = (e) => {
    if (role !== 'player' || stick.active || paused || meeting) return;
    Object.assign(stick, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 });
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    stick.dx = e.clientX - stick.ox;
    stick.dy = e.clientY - stick.oy;
  };
  const onUp = (e) => {
    if (e.pointerId === stick.id) stick.active = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const STICK_MAX = 64;
  function inputVector() {
    if (paused || meeting || me.frozen || me.ride) return [0, 0];
    let x = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
    let y = (keys.has('D') ? 1 : 0) - (keys.has('U') ? 1 : 0);
    if (stick.active) {
      const len = Math.hypot(stick.dx, stick.dy);
      if (len > 12) {
        const k = Math.min(1, len / STICK_MAX) / len;
        x = stick.dx * k;
        y = stick.dy * k;
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? [x / len, y / len] : [x, y];
  }

  // ───── 내 캐릭터 움직이기 (벽에 닿으면 미끄러지듯) ─────
  let lastSent = 0;
  let sentX = NaN;
  let sentY = NaN;
  let sentM = -1;
  function moveMe(dt, now) {
    const [ix, iy] = inputVector();
    const zone = zoneAt(map, me.x, me.y);
    const speed = GAME.speed * (zone && zone.type === 'slow' ? zone.amount : 1);
    let left = Math.hypot(ix, iy) * speed * dt;
    const moving = left > 0.01;
    // 잠긴 문: 벽처럼 막는다. 이미 문 칸에 서 있으면 빠져나올 수 있다 (끼임 방지)
    const free = (x, y) => canStand(grid, x, y, GAME.radius) && (!hitsLock(x, y, now) || hitsLock(me.x, me.y, now));
    // 한 번에 너무 멀리 가서 얇은 벽을 넘지 않도록 잘게 나눠 움직인다
    while (left > 0.01) {
      const stepLen = Math.min(left, 8);
      left -= stepLen;
      const len = Math.hypot(ix, iy);
      const sx = (ix / len) * stepLen;
      const sy = (iy / len) * stepLen;
      if (sx && free(me.x + sx, me.y)) me.x += sx;
      if (sy && free(me.x, me.y + sy)) me.y += sy;
    }
    me.m = moving ? 1 : 0;
    if (Math.abs(ix) > 0.15) me.f = ix < 0 ? -1 : 1;
    if (me.frozen || me.ride || meeting) return;

    const due = now - lastSent >= 1000 / GAME.sendHz;
    const changed = Math.round(me.x) !== sentX || Math.round(me.y) !== sentY || me.m !== sentM;
    if (due && (changed || now - lastSent > 2000)) {
      sentX = Math.round(me.x);
      sentY = Math.round(me.y);
      sentM = me.m;
      lastSent = now;
      send({ t: 'pos', x: sentX, y: sentY, f: me.f, m: me.m });
    }
  }

  // 장치를 타는 중인 캐릭터의 자리와 크기
  function rideStep(q, now) {
    const r = q.ride;
    const k = (now - r.at) / r.ms;
    if (k >= 1) {
      q.ride = null;
      q.x = q.fromX = q.toX = r.to[0];
      q.y = q.fromY = q.toY = r.to[1];
      q.at = 0;
      q.rideScale = 1;
      return;
    }
    if (r.slide) {
      // 입구까지 걸어가(앞 15%) 관을 타고 미끄러진다
      [q.x, q.y] = alongPath(r.path, k);
      q.rideScale = 0.75;
      q.m = 1;
    } else {
      // 개구멍: 쏙 들어갔다가(앞 35%) 출구에서 쏙 나온다(뒤 35%)
      const inK = Math.min(1, k / 0.35);
      const outK = Math.max(0, (k - 0.65) / 0.35);
      if (k < 0.5) (q.x = r.path[0][0] + (r.path[1][0] - r.path[0][0]) * inK), (q.y = r.path[0][1] + (r.path[1][1] - r.path[0][1]) * inK);
      else (q.x = r.to[0]), (q.y = r.to[1]);
      q.rideScale = k < 0.5 ? 1 - inK : outK;
    }
  }

  // ───── 그리기 ─────
  function badge(text, x, y, fill, color = '#fff') {
    ctx.font = `22px ${FONT}`;
    const w = ctx.measureText(text).width + 22;
    ctx.fillStyle = fill;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 16, w, 32, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
    frame.last = now;
    const t = now / 1000;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
    }

    if (me) moveMe(dt, now);
    for (const q of players.values()) {
      if (q.ride) {
        rideStep(q, now);
        continue;
      }
      q.rideScale = 1;
      if (q === me) continue;
      const k = Math.min(1, (now - q.at) / (1100 / GAME.sendHz));
      q.x = q.fromX + (q.toX - q.fromX) * k;
      q.y = q.fromY + (q.toY - q.fromY) * k;
    }
    const next = findContext();
    const key = next ? next.type + ':' + next.id : '';
    if (key !== ctxKey) {
      ctxKey = key;
      opts.onContext(next);
    }
    if (impostor) {
      const mk = findMark() || '';
      if (mk !== markKey) {
        markKey = mk;
        if (opts.onMark) opts.onMark(mk || null);
      }
    }

    // 카메라: 학생은 내 캐릭터를 따라가고, 선생님은 맵 전체를 본다
    const [W, H] = map.size;
    let scale;
    let camX;
    let camY;
    if (me) {
      scale = Math.max(0.55, Math.min(1.25, Math.min(vw, vh * 1.5) / 900));
      const halfW = vw / 2 / scale;
      const halfH = vh / 2 / scale;
      camX = halfW * 2 >= W ? W / 2 : Math.max(halfW, Math.min(W - halfW, me.x));
      camY = halfH * 2 >= H ? H / 2 : Math.max(halfH, Math.min(H - halfH, me.y - 30));
    } else {
      scale = Math.min(vw / W, vh / H);
      camX = W / 2;
      camY = H / 2;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#4c6a5c'; // 맵 바깥의 밤 운동장 색
    ctx.fillRect(0, 0, vw, vh);
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);
    ctx.drawImage(image, 0, 0);

    // 개구멍 속에서 깜빡이는 눈 (누가 살고 있는 걸까?)
    for (const d of map.devices || []) {
      if (d.type !== 'teleport') continue;
      [d.from, ...(d.exits || [])].forEach((h, i) => {
        const phase = (t * 0.7 + i * 1.7) % 6;
        if (phase > 2.6) return; // 가끔만 나타난다
        const open = phase % 1.3 < 1.15 ? 1 : 0.15; // 깜빡임
        const look = Math.sin(t * 1.3 + i) * 3;
        for (const s of [-1, 1]) {
          ctx.fillStyle = '#ffe14a';
          ctx.beginPath();
          ctx.ellipse(h[0] + s * 9 + look, h[1] + 2, 5.5, 6.5 * open, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1c1530';
          ctx.beginPath();
          ctx.ellipse(h[0] + s * 9 + look * 1.4, h[1] + 2, 2, 5 * open, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 잠긴 문: 빨간 철창 + 자물쇠 + 남은 시간 원 (모두에게 보인다)
    if (impostor && lock && now < lock.until) drawLock(lock, now);

    // 얼음 흔적: 얼려진 사람이 얼음 덩어리에 갇힌 모습 + 깜빡이는 "!"
    //   (학생 화면은 시야 안만, 선생님 화면은 위치 보기를 켰을 때만 — TV로 흔적 위치가 드러나지 않게)
    if (impostor && (me || reveal || over)) {
      for (const k of marks) {
        if (me && Math.hypot(k.x - me.x, k.y - me.y) > GAME.vision * visionScale(now) * 1.08) continue;
        const sz = GAME.charSize * (me ? 1 : 1.5);
        drawCharacter(ctx, { kind: k.character, color: (COLORS[k.color] || COLORS[0]).hex, x: k.x, y: k.y, size: sz, t, seed: 0, moving: false, facing: 1, frozen: true });
        if (Math.floor(t * 3) % 2 === 0) badge('!', k.x, k.y - sz - 18, '#ffd94a', INK);
      }
    }

    // 단말기 표시: 고친 곳은 초록 체크, 아직 남은 곳은 통통 튀는 느낌표 (학생만. 방해꾼 찾기는 방해꾼·유령도 미션을 푼다)
    if (me && (me.role === 'student' || impostor)) {
      const left = mine.solved < mine.missions;
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const tm of map.terminals || []) {
        const [tx, ty] = tm.pos;
        if (mine.done.has(tm.id)) {
          ctx.fillStyle = '#5fd070';
          ctx.beginPath();
          ctx.arc(tx + 22, ty - 32, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(tx + 15, ty - 32);
          ctx.lineTo(tx + 20, ty - 26);
          ctx.lineTo(tx + 29, ty - 38);
          ctx.stroke();
          ctx.strokeStyle = INK;
        } else if (left) {
          const hop = Math.abs(Math.sin(t * 4 + tx)) * 10;
          const big = ctxKey === 'terminal:' + tm.id ? 1.25 : 1;
          ctx.fillStyle = '#ffd94a';
          ctx.beginPath();
          ctx.arc(tx, ty - 58 - hop, 16 * big, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = INK;
          ctx.font = `${22 * big}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', tx, ty - 57 - hop);
        }
      }
    }

    // 캐릭터 (학생·술래는 시야 안에 있는 사람만 보인다)
    const big = me ? 1 : 1.5;
    const size = GAME.charSize * big;
    const sorted = me || reveal || over ? [...players.values()].sort((a, b) => a.y - b.y) : [];
    const vis = GAME.vision * visionScale(now);
    const iAmGhost = !!me && (myGhost || me.ghost);
    const iAmChaser = myRole === 'chaser';
    for (const q of sorted) {
      if (me && q !== me && Math.hypot(q.x - me.x, q.y - me.y) > vis * 1.08) continue;
      const s = size * (q.rideScale ?? 1);
      if (s < 4) continue;
      if (impostor) {
        drawImpostorPlayer(q, s, big, now, t, { iAmGhost, iAmChaser });
        continue;
      }
      if (q.role === 'chaser' && !q.ride) {
        // 술래 발밑에서 일렁이는 붉은 기운
        const pulse = 1 + Math.sin(t * 5 + q.seed) * 0.12;
        const aura = ctx.createRadialGradient(q.x, q.y - 6, 4, q.x, q.y - 6, 62 * big * pulse);
        aura.addColorStop(0, 'rgba(229,72,77,.55)');
        aura.addColorStop(1, 'rgba(229,72,77,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(q.x, q.y - 6, 66 * big * pulse, 34 * big * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = q.connected ? 1 : 0.4;
      drawCharacter(ctx, { kind: q.character, color: q.color, x: q.x, y: q.y, size: s, t, seed: q.seed, moving: !!q.m && !q.frozen, facing: q.f, frozen: q.frozen });
      ctx.globalAlpha = 1;
      if (q.ride) continue;
      if (now < q.protUntil && !q.frozen) {
        // 보호 중: 반짝이는 방패 고리
        ctx.strokeStyle = `rgba(255,217,74,${0.55 + Math.sin(t * 10) * 0.3})`;
        ctx.lineWidth = 6;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        ctx.ellipse(q.x, q.y - s * 0.5, s * 0.62, s * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (q.role === 'chaser') badge('술래', q.x, q.y - s * (q.character === 'slime' ? 0.72 : 1) - 22, '#e5484d');
    }
    if (me && !me.ride) {
      // 내 캐릭터 위의 화살표
      const bob = Math.sin(t * 5) * 4;
      const top = me.y - size - (me.role === 'chaser' || (impostor && myRole === 'chaser') ? 62 : 26) + (impostor && iAmGhost ? ghostBob(me, t) : 0);
      ctx.fillStyle = '#ffd94a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(me.x - 13, top + bob);
      ctx.lineTo(me.x + 13, top + bob);
      ctx.lineTo(me.x, top + 18 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 글자 효과
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const k = (now - p.at) / 900;
      if (k >= 1) {
        popups.splice(i, 1);
        continue;
      }
      if (me && Math.hypot(p.x - me.x, p.y - me.y) > vis * 1.08) continue;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `${44 + k * 14}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.strokeText(p.text, p.x, p.y - k * 50);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - k * 50);
      ctx.globalAlpha = 1;
    }

    // 시야 제한: 멀리 있는 곳은 어둡게 덮는다
    if (me) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = vw / 2 + (me.x - camX) * scale;
      const cy = vh / 2 + (me.y - 40 - camY) * scale;
      // 손전등 불빛: 가끔 살짝 흔들리고, 아주 가끔 깜빡 꺼질 듯하다
      const blink = (t * 0.37) % 9 < 0.12 || ((t * 0.37) % 9 > 0.2 && (t * 0.37) % 9 < 0.27) ? 0.86 : 1;
      const r = vis * scale * (1 + Math.sin(t * 7.3) * 0.006 + Math.sin(t * 2.1) * 0.01) * blink;
      const fog = ctx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r * 1.08);
      fog.addColorStop(0, 'rgba(16,11,34,0)');
      fog.addColorStop(0.55, 'rgba(16,11,34,0.45)');
      fog.addColorStop(1, 'rgba(16,11,34,0.93)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, vw, vh);

      if (impostor && blackoutHitsMe() && blackoutActive(now)) {
        // 정전 시작: 형광등이 깜빡깜빡 꺼진다
        const e = (now - blackoutStart) / 1000;
        if (e < 0.6 && Math.floor(e * 10) % 2 === 0) {
          ctx.fillStyle = 'rgba(8,5,20,0.75)';
          ctx.fillRect(0, 0, vw, vh);
        }
        // 단말기 초록 불빛은 정전 중에도 보인다 (찾아갈 수 있게)
        for (const tm of map.terminals || []) {
          if (mine.done.has(tm.id)) continue;
          const sx = vw / 2 + (tm.pos[0] - camX) * scale;
          const sy = vh / 2 + (tm.pos[1] - 20 - camY) * scale;
          if (sx < -40 || sy < -40 || sx > vw + 40 || sy > vh + 40) continue;
          const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, 34 * scale);
          glow.addColorStop(0, `rgba(110,255,150,${0.75 + Math.sin(t * 4 + tm.pos[0]) * 0.2})`);
          glow.addColorStop(1, 'rgba(110,255,150,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, sy, 34 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (impostor && iAmGhost) {
        // 유령 화면: 옅은 보랏빛
        ctx.fillStyle = 'rgba(200,190,255,0.14)';
        ctx.fillRect(0, 0, vw, vh);
      }
      // 내가 얼려지는 순간: 하얀 번쩍임
      if (impostor && me.morphAt && now - me.morphAt < 700) {
        ctx.fillStyle = `rgba(220,245,255,${0.7 * (1 - (now - me.morphAt) / 700)})`;
        ctx.fillRect(0, 0, vw, vh);
      }

      // 술래가 가까이 오면 화면 가장자리가 붉게 두근거린다 (학생만. 방해꾼 찾기는 정체가 드러나므로 끈다)
      if (!impostor && me.role === 'student' && !over) {
        let nearest = Infinity;
        for (const q of players.values()) {
          if (q.role === 'chaser') nearest = Math.min(nearest, Math.hypot(q.x - me.x, q.y - me.y));
        }
        if (nearest < GAME.vision) {
          const danger = 1 - nearest / GAME.vision; // 가까울수록 1
          const beat = 0.5 + Math.abs(Math.sin(t * (3 + danger * 5))) * 0.5;
          const edge = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
          edge.addColorStop(0, 'rgba(229,40,60,0)');
          edge.addColorStop(1, `rgba(229,40,60,${(0.2 + danger * 0.5) * beat})`);
          ctx.fillStyle = edge;
          ctx.fillRect(0, 0, vw, vh);
        }
      }
      if (me.frozen) {
        ctx.fillStyle = 'rgba(140,210,255,0.22)';
        ctx.fillRect(0, 0, vw, vh);
      }
    }

    // 화면 조이스틱
    if (stick.active) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = canvas.getBoundingClientRect();
      const ox = stick.ox - r.left;
      const oy = stick.oy - r.top;
      const len = Math.hypot(stick.dx, stick.dy) || 1;
      const k = Math.min(STICK_MAX, len) / len;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(42,33,64,.55)';
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath();
      ctx.arc(ox, oy, STICK_MAX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,217,74,.9)';
      ctx.beginPath();
      ctx.arc(ox + stick.dx * k, oy + stick.dy * k, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (minimap) drawMinimap(minimap, t);
  }

  // ───── 방해꾼 찾기 그리기 도우미 ─────
  function ghostBob(q, t) {
    return Math.sin(t * 2.4 + q.seed * 2) * 7 - 10;
  }
  function drawHorns(x, y) {
    ctx.fillStyle = '#e5484d';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + s * 10, y);
      ctx.lineTo(x + s * 22, y);
      ctx.lineTo(x + s * 19, y - 20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  // 유령 꼬리: 머리 위에 하늘하늘한 흰 꼬리
  function drawWisp(x, y, t) {
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 9, y);
    ctx.quadraticCurveTo(x - 10, y - 16, x + Math.sin(t * 3) * 6, y - 26);
    ctx.quadraticCurveTo(x + 4, y - 12, x + 9, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  function drawImpostorPlayer(q, s, big, now, t, view) {
    const morphing = q.morphAt && now - q.morphAt < 1200; // 얼음 → 유령 변신 중
    const isGhost = q.ghost && !morphing;
    // 살아 있는 사람(학생·방해꾼) 화면에는 유령이 안 보인다. 끝나면 모두 보인다
    if (isGhost && q !== me && me && !view.iAmGhost && !over) return;
    // 서버가 위치를 안 보내 주는 사람(내게 숨겨진 유령)은 마지막 자리에 남겨 두지 않는다
    if (q !== me && me && !morphing && now - q.seenAt > 1500) return;
    const isMate = q !== me && mates.has(q.id);
    const roleShown = q.role === 'chaser' && (over || (me ? q === me || isMate || view.iAmChaser : showRoles));
    let y = q.y;
    if (isGhost) {
      ctx.globalAlpha = q.connected ? 0.5 : 0.25;
      y += ghostBob(q, t);
    } else ctx.globalAlpha = q.connected ? 1 : 0.4;
    let dx = 0;
    if (morphing) dx = Math.sin(now / 25) * 3 * (1 - (now - q.morphAt) / 1200);
    drawCharacter(ctx, { kind: q.character, color: q.color, x: q.x + dx, y, size: s, t, seed: q.seed, moving: !!q.m && !morphing, facing: q.f, frozen: morphing });
    const head = y - s * (q.character === 'slime' ? 0.72 : 1);
    if (isGhost) drawWisp(q.x, head - 2, t + q.seed);
    ctx.globalAlpha = 1;
    if (q.ride) return;
    if (now < q.protUntil && !isGhost) {
      ctx.strokeStyle = `rgba(255,217,74,${0.55 + Math.sin(t * 10) * 0.3})`;
      ctx.lineWidth = 6;
      ctx.setLineDash([14, 10]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y - s * 0.5, s * 0.62, s * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 위장 표시 (선생님·방해꾼 화면만 서버가 disguise 를 알려 준다)
    if (q.disguise && now < q.disguise.until && !isGhost) {
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = t * 30;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y - s * 0.5, s * 0.66, s * 0.76, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const left = Math.ceil((q.disguise.until - now) / 1000);
      badge(q === me ? `위장 중 ${left}초` : '위장', q.x, q.y + 24 * big, '#9b6bf2');
    }
    if (isMate && !isGhost) drawHorns(q.x, head - 4);
    if (roleShown) badge(q.ejected ? '방해꾼(제외)' : '방해꾼', q.x, head - (isMate ? 40 : 22), '#e5484d');
  }
  function drawLock(lk, now) {
    const [x, y, w, h] = lk.rect;
    ctx.save();
    ctx.fillStyle = 'rgba(229,72,77,.35)';
    ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    // 철창
    ctx.strokeStyle = '#b3262b';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (w >= h) for (let v = x + 8; v < x + w; v += 16) (ctx.moveTo(v, y - 2), ctx.lineTo(v, y + h + 2));
    else for (let v = y + 8; v < y + h; v += 16) (ctx.moveTo(x - 2, v), ctx.lineTo(x + w + 2, v));
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    // 자물쇠 + 남은 시간 원
    const cx = x + w / 2;
    const cy = y + h / 2;
    const k = Math.max(0, Math.min(1, (lk.until - now) / (lk.total || IMP.lockMs)));
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e5484d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy - 6, 7, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath();
    ctx.roundRect(cx - 11, cy - 6, 22, 16, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  // 지도(M): 방 이름과 단말기 위치. 사람은 그리지 않는다 (나만 표시)
  function drawMinimap(cv, t) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr)) (cv.width = Math.round(w * dpr)), (cv.height = Math.round(h * dpr));
    const c = cv.getContext('2d');
    const [W, H] = map.size;
    const k = Math.min(w / W, h / H);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.translate((w - W * k) / 2, (h - H * k) / 2);
    c.scale(k, k);
    c.drawImage(image, 0, 0);
    for (const tm of map.terminals || []) {
      const done = mine.done.has(tm.id);
      c.fillStyle = done ? '#5fd070' : '#ffd94a';
      c.strokeStyle = INK;
      c.lineWidth = 8;
      c.beginPath();
      c.arc(tm.pos[0], tm.pos[1] - 20, 30, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (lock && performance.now() < lock.until) {
      c.fillStyle = 'rgba(229,72,77,.8)';
      const [x, y, rw, rh] = lock.rect;
      c.fillRect(x - 10, y - 10, rw + 20, rh + 20);
    }
    if (me) {
      c.fillStyle = me.color;
      c.strokeStyle = '#fff';
      c.lineWidth = 10;
      c.beginPath();
      c.arc(me.x, me.y - 20, 40 + Math.sin(t * 6) * 8, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    setPlayers,
    onState,
    onFix,
    onEvent,
    setMe,
    setPaused,
    setReveal(v) {
      reveal = !!v;
    },
    // ── 방해꾼 찾기 ──
    setMarks(list) {
      marks = Array.isArray(list) ? list : [];
    },
    setSabo,
    setMeeting(v) {
      v = !!v;
      if (v === meeting) return;
      meeting = v;
      keys.clear();
      stick.active = false;
    },
    setRoles(v) {
      showRoles = !!v;
    },
    snapAll,
    setMinimap(cv) {
      minimap = cv || null;
    },
    blackoutLeft() {
      return Math.max(0, blackoutUntil - performance.now());
    },
    blackoutHitsMe,
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    },
  };
}
