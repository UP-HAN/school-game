// 게임 화면: 맵 위에서 돌아다니기, 잠귀신·꿈에 빠진 친구 표시, 시야, 잠 안개, 보급 상자, 미끄럼틀·개구멍 연출.
// 꿈도둑을 찾아라 모드(mode 'mafia')에서는 꿈에 빠진 학생·꿈에 빠진 자리·동료 뿔·변신·안개 뿌리기·문 막기도 그린다.
import { COLORS, GAME } from './shared/config.js';
import { buildGrid, canStand, zoneAt, darkVisionAt, floorAt, floorPanels, floorShort, DEVICE_STYLES } from './shared/mapgrid.js';
import { renderMap, drawLantern } from './maprender.js';
import { drawCharacter } from './characters.js';
import { KEYS } from './keys.js';
import { MAF, CH, FOG, LOOT, ITEMS, FONT, font, fontsReady, byStage } from './mafiaconst.js';

const INK = '#2a2140';
// 큰 행동 버튼 색 (11-4절)
export const ACTION_COLORS = {
  thaw: '#7fe0c4',
  tag: '#9b6bf2',
  terminal: '#ffb547',
  loot: '#ff9ec4',
  device: '#5cc8f2',
  alarm: '#ffd84d',
  bell: '#e0a43a',
  notebook: '#fff6e5',
  off: '#b9b4c9',
};

const mapCache = new Map();
async function loadMap(id, mode) {
  const key = id + ':' + mode;
  if (!mapCache.has(key)) {
    const data = await (await fetch(new URL(`./maps/${id}.json`, import.meta.url))).json();
    const grid = buildGrid(data);
    // 방 이름을 G마켓 산스로 그리려고 잠깐 기다린다. 늦으면 대체 글꼴로 먼저 그리고, 글꼴이 오면 다시 그린다.
    let loaded = false;
    await Promise.race([fontsReady.then(() => (loaded = true)), new Promise((r) => setTimeout(r, 2500))]);
    const entry = { data, grid, image: renderMap(data, grid, { mode }) };
    if (!loaded) fontsReady.then(() => (entry.image = renderMap(data, grid, { mode })));
    mapCache.set(key, entry);
  }
  return mapCache.get(key);
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
// 점에서 사각형까지 거리
function distToRect(x, y, r) {
  const dx = Math.max(r[0] - x, 0, x - (r[0] + r[2]));
  const dy = Math.max(r[1] - y, 0, y - (r[1] + r[3]));
  return Math.hypot(dx, dy);
}
const roomAt = (map, x, y) => (map.rooms || []).find((r) => x >= r.rect[0] && x < r.rect[0] + r.rect[2] && y >= r.rect[1] && y < r.rect[1] + r.rect[3]);

/**
 * opts: { canvas, mapId, mode('sleep-tag'|'mafia'), role('teacher'|'player'), myId, players, send,
 *         onContext(ctx|null) — 스페이스(큰 버튼)로 지금 할 일이 바뀔 때,
 *         onKey('down'|'up', which) — which: 'act'(스페이스·엔터) | 'bag'(B) | 'notebook'(N) | 'map'(M) | 'esc'(Esc)
 *                                      | 'sabo1'~'sabo3'(1·2·3, 꿈도둑을 찾아라에서만) }
 *         onNav(dir) — 'L'|'R'|'U'|'D'. 가방 창처럼 고르는 창이 열려 있으면 true 를 돌려주고, 그때는 걷지 않는다
 * ctx: { type: 'thaw'|'tag'|'loot'|'terminal'|'device'|'alarm'|'bell'|'notebook'|'none', id, label, sub, hold, disabled, readyAt, hint, color }
 */
export async function startGame(opts) {
  const { canvas, role, myId, send } = opts;
  const mode = opts.mode || 'sleep-tag';
  const mafia = mode === 'mafia';
  const mapEntry = await loadMap(opts.mapId, mode);
  const { data: map, grid } = mapEntry;
  const ctx = canvas.getContext('2d');
  const players = new Map(); // id → 그릴 정보
  const popups = []; // "Zzz", "일어나!" 같은 글자 효과
  let me = null;
  let running = true;
  let raf = 0;
  let over = false;

  // 꿈도둑을 찾아라 상태
  let marks = []; // 꿈에 빠진 자리 [{ id, x, y, color, character }]
  let mates = new Set(); // 동료 꿈도둑 id (내가 꿈도둑일 때)
  let myRole = null; // 'me' 메시지로 받은 내 역할
  let myGhost = false; // 꿈에 빠짐 (꿈도둑을 찾아라: 다시 깨어나지 않는다)
  let meeting = false; // 회의 중이면 아무도 움직이지 않는다
  let showRoles = false; // 선생님 "정체 표시"
  let blackoutUntil = 0;
  let blackoutStart = -1e9;
  let lock = null; // { door, rect, until }
  let minimap = null; // 작은 지도 캔버스

  // 새 기능 상태 (안개·임시 랜턴·보급 상자·내 정보)
  let fog = null; // { stage, cx, cy, r0, toR, shrinkMs, at, nextAt, nextR }
  let bonus = []; // 마지막 밤 임시 랜턴 [{ id, pos }]
  let crates = []; // 보이는 보급 상자 [{ id, x, y, rect }]
  let info = {}; // 'me' 메시지 전체
  let tagReadyAt = 0;
  let myFx = {}; // 내 아이템 효과 → 끝나는 때
  let hint = null; // { room, x, y, exact, until }
  const lanternReady = {}; // 잠귀신: 랜턴별 다시 켤 수 있는 때
  const devReady = {}; // 장치별 다시 탈 수 있는 때 (cooldown.group 이 같은 장치들은 같은 칸)
  const devKey = (d) => (d.cooldown && d.cooldown.group) || d.id;
  // 계단·엘리베이터는 도착한 곳에 짝 장치가 있어서 "출구" 안내를 하지 않는다
  const pairDevice = (d) => d.style === 'stairs-up' || d.style === 'stairs-down' || d.style === 'elevator';
  const devBusy = {}; // 줄 서는 장치(solo): 장치 id → 앞사람이 다 탈 때 (ride 알림으로 안다. 판정은 서버가 한다)
  let darkZone = null; // 지금 내가 있는 어두운 구역 (유령의 집)
  const darkShown = new Set(); // 이번 판에 이미 안내한 어두운 구역 id
  let notebookOn = true;
  let visK = 1; // 안개 시야 배율 (부드럽게 바뀜)
  let waking = null; // 내가 깨우는 중인 친구 { id, at, ms }
  let myFloor = null; // 여러 층 맵: 지금 내가 있는 층 (바뀌면 opts.onFloor)

  function setPlayers(list, isOver) {
    over = !!isOver;
    const now = performance.now();
    const ids = new Set(list.map((p) => p.id));
    for (const id of players.keys()) if (!ids.has(id)) players.delete(id);
    for (const p of list) {
      let q = players.get(p.id);
      if (!q) {
        const hasPos = typeof p.x === 'number';
        q = { id: p.id, x: p.x || 0, y: p.y || 0, fromX: p.x || 0, fromY: p.y || 0, toX: p.x || 0, toY: p.y || 0, at: 0, f: 1, m: 0, seed: Math.random() * 3, ride: null, seenAt: hasPos ? now : -1e9, fx: {} };
        players.set(p.id, q);
      }
      q.color = (COLORS[p.color] || COLORS[0]).hex;
      q.character = p.character;
      q.connected = p.connected;
      q.role = p.role;
      q.frozen = !!p.frozen;
      q.cloak = !!p.cloak;
      q.protUntil = now + (p.protMs || 0);
      const wasGhost = q.ghost;
      q.ghost = !!p.ghost;
      q.ejected = !!p.ejected;
      if (q.ghost && !wasGhost && q.morphAt == null) q.morphAt = -1e9; // 이미 꿈에 빠져 있던 사람은 연출 없이
      // 변신: 선생님·꿈도둑 화면에는 진짜 모습 + 변신 표시 (서버가 disguise 를 붙여 줄 때만)
      if (p.disguise) {
        const until = now + (typeof p.disguise.ms === 'number' ? p.disguise.ms : MAF.disguiseMs);
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

  // 안개 뿌리기·문 막기 상태 (room.sabo: { blackoutMs, lockedDoor, lockMs })
  function setSabo(s) {
    const now = performance.now();
    const bMs = (s && s.blackoutMs) || 0;
    if (bMs > 0) {
      const until = now + bMs;
      if (blackoutUntil <= now) blackoutStart = now;
      if (Math.abs(until - blackoutUntil) > 300) blackoutUntil = until;
    } else if (blackoutUntil > now) blackoutUntil = now;
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
  const blackoutActive = (now) => now < blackoutUntil;
  // 안개 뿌리기로 시야가 줄어드는 사람: 꿈에 빠지지 않은 학생만
  function blackoutHitsMe() {
    return !!me && !myGhost && !me.ghost && myRole !== 'chaser';
  }
  function blackoutScale(now) {
    if (!mafia || !blackoutHitsMe()) return 1;
    const low = MAF.blackoutVision;
    if (blackoutActive(now)) {
      const e = (now - blackoutStart) / 1000;
      if (e < 0.6) return 1;
      return 1 - (1 - low) * Math.min(1, (e - 0.6) / 0.4);
    }
    const e = (now - blackoutUntil) / 1000;
    if (e < 0.4 && blackoutUntil > 0) return low + (1 - low) * (e / 0.4);
    return 1;
  }
  function hitsLock(x, y, now) {
    if (!lock || now >= lock.until) return false;
    const r = GAME.radius;
    const [lx, ly, lw, lh] = lock.rect;
    return x + r > lx && x - r < lx + lw && y + r > ly && y - r < ly + lh;
  }

  // ───── 잠 안개 (room.fog) ─────
  function setFog(f) {
    const now = performance.now();
    if (f && f.mode === 'floors') {
      // 층 단위 안개: safe = 지금 안전한 층 id (null 이면 모두 안전), nextSafe = 다음 단계에 안전한 층
      fog = {
        mode: 'floors',
        stage: f.stage || 0,
        safe: Array.isArray(f.safe) ? f.safe : null,
        nextSafe: Array.isArray(f.nextSafe) ? f.nextSafe : null,
        shrinkMs: 0,
        at: now,
        nextAt: typeof f.nextMsLeft === 'number' ? now + f.nextMsLeft : null,
      };
      return;
    }
    if (!f || !(f.stage >= 1) || typeof f.r !== 'number') {
      fog = f && typeof f.nextMsLeft === 'number' ? { stage: 0, nextAt: now + f.nextMsLeft, nextR: f.nextR, cx: f.cx, cy: f.cy } : null;
      return;
    }
    fog = {
      stage: f.stage,
      cx: f.cx,
      cy: f.cy,
      r0: f.r,
      toR: typeof f.toR === 'number' ? f.toR : f.r,
      shrinkMs: Math.max(0, f.shrinkMsLeft || 0),
      at: now,
      nextAt: typeof f.nextMsLeft === 'number' ? now + f.nextMsLeft : null,
      nextR: f.nextR,
    };
  }
  function fogR(now) {
    if (!fog || !(fog.stage >= 1)) return Infinity;
    if (fog.shrinkMs > 0) return fog.r0 + (fog.toR - fog.r0) * Math.min(1, (now - fog.at) / fog.shrinkMs);
    return fog.r0;
  }
  function inFogAt(x, y, now) {
    if (!fog || !(fog.stage >= 1)) return false;
    if (fog.mode === 'floors') {
      const fl = floorAt(map, x, y);
      return !!fl && !!fog.safe && !fog.safe.includes(fl.id);
    }
    return Math.hypot(x - fog.cx, y - fog.cy) > fogR(now);
  }
  function fogInfo() {
    const now = performance.now();
    if (!fog) return null;
    return {
      stage: fog.stage || 0,
      shrinking: fog.stage >= 1 && fog.shrinkMs > 0 && now - fog.at < fog.shrinkMs,
      nextMsLeft: fog.nextAt != null ? Math.max(0, fog.nextAt - now) : null,
    };
  }
  const fogStage = () => (fog && fog.stage) || 0;

  // 이벤트 연출
  function onEvent(ev) {
    const now = performance.now();
    if (ev.kind === 'blackout') {
      setSabo({ blackoutMs: ev.ms || MAF.blackoutMs, lockedDoor: lock && lock.door, lockMs: lock ? lock.until - now : 0 });
      return;
    }
    if (ev.kind === 'lock') {
      const door = (map.doors || []).find((d) => d.id === ev.door);
      if (door) {
        setSabo({ blackoutMs: Math.max(0, blackoutUntil - now), lockedDoor: ev.door, lockMs: ev.ms || MAF.lockMs });
        popups.push({ text: '덩굴!', x: door.rect[0] + door.rect[2] / 2, y: door.rect[1] - 30, at: now, color: '#7fe0c4' });
      }
      return;
    }
    const q = players.get(ev.id);
    if (!q) return;
    if (ev.kind === 'freeze') {
      // 꿈에 빠뜨려짐: 잠든 모습이 됐다가 꿈에 빠진 모습으로
      q.morphAt = now;
      q.ghost = true;
      if (q === me) myGhost = true;
      popups.push({ text: 'Zzz', x: q.x, y: q.y - 100, at: now, color: '#9b6bf2' });
      return;
    }
    if (ev.kind === 'tag') popups.push({ text: ev.by === 'fog' ? '스르륵…Zzz' : 'Zzz', x: q.x, y: q.y - 100, at: now, color: '#9b6bf2' });
    if (ev.kind === 'thaw') popups.push({ text: '일어나!', x: q.x, y: q.y - 100, at: now, color: '#ffb547' });
    if (ev.kind === 'item') {
      const kind = ev.item;
      if (kind && ITEMS[kind]) {
        q.fx[kind] = now + (ITEMS[kind].ms || 1200);
        popups.push({ text: ITEMS[kind].name, x: q.x, y: q.y - 110, at: now, color: ITEMS[kind].color });
        if (kind === 'bugle') popups.push({ text: '일어나!', x: q.x, y: q.y - 150, at: now + 200, color: '#ffd84d' });
      }
    }
    if (ev.kind === 'shieldPop') {
      delete q.fx.umbrella;
      if (q === me) delete myFx.umbrella;
      popups.push({ text: '펑!', x: q.x, y: q.y - 100, at: now, color: '#7fe0c4' });
    }
    if (ev.kind === 'ride') {
      const device = (map.devices || []).find((d) => d.id === ev.device);
      const slide = device && device.type === 'slide';
      const carousel = slide && device.style === 'carousel';
      q.ride = {
        at: now,
        ms: ev.ms,
        slide,
        carousel,
        path: slide ? [ev.from, device.from, ...(device.path || []), device.to] : [ev.from, device ? device.from : ev.from, ev.to],
        to: ev.to,
      };
      if (q === me && device) {
        const cd = device.cooldown;
        devReady[devKey(device)] = now + (ev.ms || 1500) + (cd && typeof cd.seconds === 'number' ? cd.seconds : 10) * 1000;
      }
      if (device && device.solo && !q.ghost) {
        const gap = Number.isFinite(device.soloGap) && device.soloGap >= 0 ? device.soloGap : 0.5;
        devBusy[device.id] = now + (ev.ms || 1500) + gap * 1000;
      }
      const RIDE_TEXT = { 'stairs-up': '총총!', 'stairs-down': '총총!', elevator: '띵동!', tube: '슈웅~', carousel: '빙글빙글~' };
      const text = (device && RIDE_TEXT[device.style]) || (slide ? '슈웅~' : '쏙!');
      popups.push({ text, x: ev.from[0], y: ev.from[1] - 90, at: now, color: '#ff7a59' });
    }
  }

  // ───── 퀴즈·행동 ─────
  let mine = { solved: 0, missions: 0, done: new Set() };
  let reveal = false; // 선생님 화면: 학생 위치를 보여 줄지 (기본은 숨김)
  let paused = false; // 퀴즈 창이 떠 있는 동안은 움직이지 않는다
  let ctxKey = '';
  function setMe(m) {
    const now = performance.now();
    info = m || {};
    mine = { solved: m.solved, missions: m.missions, done: new Set(m.done || []) };
    myRole = m.role || null;
    myGhost = myGhost || !!m.ghost; // 한 판 안에서 꿈도둑을 찾아라의 꿈은 되돌아오지 않는다
    if (me && myGhost) me.ghost = true;
    mates = new Set(m.mates || []);
    tagReadyAt = now + (m.freezeMs ?? m.tagMs ?? 0);
    myFx = {};
    for (const [k, ms] of Object.entries(m.effects || {})) if (ms > 0) myFx[k] = now + ms;
    hint = m.hint && m.hint.msLeft > 0 ? { ...m.hint, until: now + m.hint.msLeft } : null;
    if (m.lanternMs && typeof m.lanternMs === 'object') for (const [id, ms] of Object.entries(m.lanternMs)) lanternReady[id] = now + ms;
  }
  function setPaused(v) {
    paused = v;
    keys.clear();
    stick.active = false;
  }
  const fxOn = (k, now) => (myFx[k] || 0) > now;

  // 지금 스페이스로 할 일 하나 (11-2절 표: 위 칸이 먼저, 같은 칸은 가까운 것)
  function pickAction(now) {
    if (!me || paused || over || me.ride || meeting) return null;
    const ghost = mafia && (myGhost || me.ghost);
    const chaser = myRole === 'chaser' || me.role === 'chaser';
    const sleeping = !mafia && me.frozen;
    const near = (x, y) => Math.hypot(me.x - x, me.y - y);
    let exitHint = null;

    // 칸마다 후보들 중 가장 가까운 것
    const slot = (list) => {
      let best = null;
      for (const c of list) if (c && (!best || c.dist < best.dist)) best = c;
      return best;
    };
    const thaws = () =>
      [...players.values()]
        .filter((q) => q !== me && q.frozen && q.role === 'student' && !q.ride)
        .map((q) => ({ type: 'thaw', id: q.id, label: '깨우기', sub: '꾹 누르기', hold: info.wakeHoldMs || (fog ? byStage(FOG.wakeHoldMs, fogStage(), CH.thawHoldMs) : CH.thawHoldMs), dist: near(q.x, q.y) }))
        .filter((c) => c.dist <= CH.reach);
    const loots = () => {
      if (ghost || sleeping) return [];
      return crates
        .map((k) => ({ k, d: distToRect(me.x, me.y, k.rect || [k.x - 20, k.y - 20, 40, 40]) }))
        .filter((o) => o.d <= LOOT.openReach)
        .map(({ k, d }) =>
          info.item
            ? { type: 'loot', id: k.id, label: '가방이 꽉 찼어요', sub: info.item === 'chance' ? '찬스 카드는 퀴즈 창에서 써요' : '가방(B)에서 먼저 써요', disabled: true, dist: d }
            : { type: 'loot', id: k.id, label: '상자 열기', sub: '꾹 누르기', hold: LOOT.openHoldMs, dist: d },
        );
    };
    const lanterns = () => {
      const out = [];
      const all = [...(map.terminals || []).map((t) => ({ ...t, bonus: false })), ...bonus.map((b) => ({ ...b, bonus: true }))];
      for (const t of all) {
        const d = near(t.pos[0], t.pos[1]);
        if (d > 80) continue;
        if (!mafia && chaser) {
          // 잠귀신: 같은 랜턴은 30초 뒤 다시 (꿈 구슬을 모은다)
          out.push({ type: 'terminal', id: t.id, label: '랜턴 켜기', sub: '꿈 구슬 모으기', readyAt: lanternReady[t.id] || 0, dist: d });
          continue;
        }
        if (mine.done.has(t.id)) continue;
        if (!t.bonus && mine.solved >= mine.missions) continue;
        out.push({ type: 'terminal', id: t.id, label: '랜턴 켜기', sub: t.bonus ? '임시 랜턴' : '', dist: d });
      }
      return out;
    };
    const devices = () => {
      const out = [];
      for (const d of map.devices || []) {
        const dd = near(d.from[0], d.from[1]);
        // 맵 데이터의 action(버튼 글씨)·sub(작은 글씨)·denyHint(못 탈 때 안내)가 있으면 그 글씨를 쓴다
        const name = d.type === 'slide' ? (d.style === 'carousel' ? '회전목마' : '미끄럼틀') : DEVICE_STYLES[d.style] && d.style !== 'tube' ? (d.style === 'elevator' ? '엘리베이터' : '계단') : d.name || '개구멍';
        if (dd <= CH.deviceReach) {
          const who = (d.who && d.who[mode]) || (mafia ? ['student', 'chaser'] : ['student']);
          if (!who.includes(chaser ? 'chaser' : 'student')) {
            out.push({ type: 'device', id: d.id, label: `${mafia ? '꿈도둑' : '잠귀신'}은 못 타요`, disabled: true, hint: d.denyHint || '개구멍·미끄럼틀은 학생만 탈 수 있어요', dist: dd });
          } else {
            const n = (d.exits || []).length;
            const label = d.action || (d.type === 'slide' ? `${name} 타기` : `${name} 들어가기`);
            const sub = d.sub != null ? d.sub : d.type === 'teleport' && n > 1 ? `출구 ${n}곳 중 하나` : '';
            out.push({ type: 'device', id: d.id, label, sub, readyAt: devReady[devKey(d)] || 0, short: name, dist: dd });
          }
          continue;
        }
        // 출구·도착 쪽: 버튼 없이 안내만
        const ends = d.type === 'slide' ? [d.to] : d.exits || [];
        if (!pairDevice(d) && ends.some((e) => near(e[0], e[1]) <= 95)) {
          const from = roomAt(map, d.from[0], d.from[1]);
          const where = from ? from.name : '다른 곳';
          exitHint = d.style === 'carousel'
            ? '회전목마 내리는 곳이에요. 타는 곳은 반대편에 있어요'
            : d.type === 'slide' || d.style === 'tube'
              ? `미끄럼틀 도착 지점이에요. 타는 곳은 ${where}에 있어요`
              : `여기는 ${name} 출구예요. 들어가는 곳은 ${where}에 있어요`;
        }
      }
      return out;
    };
    const alarms = () => {
      if (!mafia || ghost) return [];
      return marks.map((k) => ({ type: 'alarm', id: k.id, label: '호루라기', sub: '꿈에 빠진 친구 발견!', dist: near(k.x, k.y) })).filter((c) => c.dist <= MAF.reportReach);
    };
    const bells = () => {
      const bell = map.bell || map.meetingButton;
      if (!mafia || ghost || !bell) return [];
      const d = near(bell.pos[0], bell.pos[1]);
      return d <= MAF.buttonReach ? [{ type: 'bell', id: 'bell', label: '종 울리기', dist: d }] : [];
    };
    const tagFallback = () => {
      const energy = info.energy;
      if (typeof energy === 'number' && energy <= 0) return { type: 'tag', id: 'tag', label: '꿈 구슬이 없어요', sub: '퀴즈를 풀어 채워요', disabled: true, dist: 0 };
      return { type: 'tag', id: 'tag', label: '꿈에 빠뜨리기', readyAt: tagReadyAt, dist: 0 };
    };

    // 꿈도둑(꿈도둑을 찾아라)의 꿈 걸기: 정체가 실수로 드러나지 않게 맨 마지막 칸 (랜턴·종·장치가 가까우면 그쪽이 먼저)
    const mafiaTargets = () => {
      if (!chaser || ghost) return [];
      const noOrb = typeof info.energy === 'number' && info.energy <= 0;
      return [...players.values()]
        .filter((q) => q !== me && !mates.has(q.id) && q.role !== 'chaser' && !q.ghost && !q.ejected && !q.ride && q.connected !== false)
        .map((q) => ({ type: 'tag', id: 'tag', label: noOrb ? '꿈 구슬이 없어요' : '꿈에 빠뜨리기', sub: noOrb ? '퀴즈를 풀어 채워요' : '', disabled: noOrb, readyAt: tagReadyAt, dist: near(q.x, q.y) }))
        .filter((c) => c.dist <= MAF.freezeReach);
    };

    let order;
    if (mafia) {
      if (ghost) order = [lanterns, devices];
      else order = [alarms, loots, lanterns, bells, devices, mafiaTargets];
    } else if (chaser) {
      const reach = fxOn('pillow', now) ? Math.max(CH.reach, ITEMS.pillow.reach || CH.reach + 40) : CH.reach;
      const canTag = now >= tagReadyAt && !(typeof info.energy === 'number' && info.energy <= 0);
      const targets = () =>
        !canTag
          ? []
          : [...players.values()]
              .filter((q) => q !== me && q.role === 'student' && !q.frozen && !q.ride && q.protUntil <= now)
              .map((q) => ({ type: 'tag', id: 'tag', label: '꿈에 빠뜨리기', dist: near(q.x, q.y) }))
              .filter((c) => c.dist <= reach);
      order = [targets, loots, lanterns, devices, () => [tagFallback()]];
    } else if (sleeping) {
      order = [() => (notebookOn ? [{ type: 'notebook', id: 'notebook', label: '퀴즈 수첩 열기', sub: '깨워 줄 때까지 공부해요', dist: 0 }] : [])];
    } else order = [thaws, loots, lanterns, devices];

    for (const f of order) {
      const best = slot(f());
      if (best) {
        if (best.disabled) best.color = ACTION_COLORS.off;
        else best.color = ACTION_COLORS[best.type] || ACTION_COLORS.terminal;
        if (!best.hint && exitHint) best.hint = exitHint;
        return best;
      }
    }
    return exitHint ? { type: 'none', id: 'none', label: '', hint: exitHint } : null;
  }

  // ───── 조작: 키보드 + 화면 조이스틱 ─────
  const keys = new Set();
  const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  // 키는 e.code(자판의 자리)로 읽는다: 한글 자판·Caps Lock 이어도 같은 키로 받는다.
  // 이동 = WASD 또는 방향키 (함께 눌러도 됨: 대각선), 행동 = 스페이스·엔터, 지도 = M,
  // 꿈도둑 작전 = 숫자 1·2·3 (꿈도둑을 찾아라에서 꿈도둑만, 바로 실행)
  // 키 배치는 keys.js 의 KEYS 표 하나에서 읽는다
  const MOVE_CODES = {};
  for (const [d, codes] of Object.entries(KEYS.move.codes)) for (const c of codes) MOVE_CODES[c] = d;
  const ACT_CODES = {};
  const MAFIA_CODES = {};
  for (const k of ['act', 'bag', 'notebook', 'map', 'esc']) for (const c of KEYS[k].codes) ACT_CODES[c] = k;
  for (const k of ['sabo1', 'sabo2', 'sabo3']) for (const c of KEYS[k].codes) MAFIA_CODES[c] = k;
  // e.code 가 비어 있는 화면 키보드 등을 위해 e.key 로도 한 번 더 찾는다
  const KEY_TO_CODE = { ' ': 'Space', Enter: 'Enter', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', 1: 'Digit1', 2: 'Digit2', 3: 'Digit3' };
  const codeOf = (e) => e.code || KEY_TO_CODE[e.key] || '';
  const actionOf = (e) => {
    const c = codeOf(e);
    return ACT_CODES[c] || (mafia ? MAFIA_CODES[c] : null) || null;
  };
  const held = new Map(); // 눌린 이동 키 code → 방향 (같은 방향 키 두 개 중 하나를 떼도 멈추지 않게)
  const syncKeys = () => {
    keys.clear();
    for (const d of held.values()) keys.add(d);
  };
  const onKeyDown = (e) => {
    if (role !== 'player') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 브라우저 단축키는 그대로
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // 퀴즈 창에 글자를 적을 수 있게
    if (meeting) return; // 회의 화면은 meeting.js 가 키를 받는다
    const which = actionOf(e);
    const dir = MOVE_CODES[codeOf(e)];
    if (paused) {
      // 퀴즈 창 안의 버튼(보기 고르기 등)은 스페이스·엔터가 그대로 눌린다. 그 밖(뒤의 큰 버튼)은 막는다
      const inMission = e.target && e.target.closest && e.target.closest('.mission-card');
      if ((which === 'act' && !inMission) || which === 'map' || dir) e.preventDefault();
      return;
    }
    if (which) {
      if (!e.repeat) opts.onKey('down', which);
      e.preventDefault(); // 스페이스로 화면이 내려가거나 초점 버튼이 한 번 더 눌리지 않게
      return;
    }
    if (!dir) return;
    // 가방 창이 열려 있으면 방향키는 아이템 고르기 (걷지 않는다)
    if (opts.onNav && opts.onNav(dir, e.repeat)) {
      held.clear();
      syncKeys();
      e.preventDefault();
      return;
    }
    held.set(codeOf(e), dir);
    syncKeys();
    e.preventDefault();
  };
  const onKeyUp = (e) => {
    const which = actionOf(e);
    if (which && role === 'player') opts.onKey('up', which);
    if (held.delete(codeOf(e))) syncKeys();
  };  const onBlur = () => {
    held.clear();
    keys.clear();
    opts.onKey('up', 'act'); // 꾹 누르던 중 창을 벗어나면 취소
  };
  // 조이스틱: 화면 어디를 눌러도 그 자리가 조이스틱 가운데가 된다 (엄지가 닿는 곳).
  // 가장자리를 누르면 원이 화면 밖으로 나가지 않게 안쪽으로 옮긴다. 손가락 하나만 조이스틱으로 쓰고,
  // 다른 손가락은 행동 버튼(다른 요소)을 따로 누를 수 있다.
  const onDown = (e) => {
    if (role !== 'player' || stick.active || paused || meeting) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const R = stickMax();
    const pad = R + 8;
    const ox = Math.max(r.left + pad, Math.min(r.right - pad, e.clientX));
    const oy = Math.max(r.top + pad, Math.min(r.bottom - pad, e.clientY));
    Object.assign(stick, { active: true, id: e.pointerId, ox, oy, dx: e.clientX - ox, dy: e.clientY - oy, touch: e.pointerType !== 'mouse' });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  };
  const onMove = (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    stick.dx = e.clientX - stick.ox;
    stick.dy = e.clientY - stick.oy;
  };
  const onUp = (e) => {
    if (e.pointerId === stick.id) stick.active = false;
  };
  const noMenu = (e) => e.preventDefault(); // 꾹 눌러도 메뉴가 뜨지 않게
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);
  canvas.addEventListener('contextmenu', noMenu);

  // 조이스틱 크기: 화면 짧은 변에 맞춘다 (휴대폰 약 52px ~ 태블릿 80px)
  const stickMax = () => Math.max(52, Math.min(80, Math.min(canvas.clientWidth, canvas.clientHeight) * 0.11));
  const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)') : { matches: false };
  // 안전 영역(노치·홈 막대) 크기를 재 둔다. 화면 크기가 바뀔 때만 다시 잰다
  function readSafeArea() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.append(probe);
    const cs = getComputedStyle(probe);
    const out = { l: parseFloat(cs.paddingLeft) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    probe.remove();
    return out;
  }
  let safeArea = { l: 0, b: 0 };
  function inputVector() {
    const STICK_MAX = stickMax();
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

  // 화면 쪽 이동 속도 배율 (서버가 되돌리지 않게 서버와 같은 규칙으로)
  function speedMult(now) {
    let k = 1;
    const ghost = mafia && (myGhost || me.ghost);
    if (!ghost && inFogAt(me.x, me.y, now)) k *= FOG.slow;
    if (fxOn('shoes', now)) k *= ITEMS.shoes.speed || 1.4;
    if (fxOn('windcape', now)) k *= ITEMS.windcape.speed || 1.3;
    if (fxOn('kickboard', now)) k *= ITEMS.kickboard.speed || 1.6;
    if (!mafia && myRole === 'chaser' && fogStage() >= 3) k *= FOG.lastNightChaserSpeed || 1;
    if (!mafia && myRole === 'chaser') k *= info.speedK > 0 ? info.speedK : 1; // 선생님이 고른 잠귀신 속도 (서버가 'me' 로 보낸다)
    return k;
  }

  // ───── 내 캐릭터 움직이기 (벽에 닿으면 미끄러지듯) ─────
  let lastSent = 0;
  let sentX = NaN;
  let sentY = NaN;
  let sentM = -1;
  function moveMe(dt, now) {
    const [ix, iy] = inputVector();
    const zone = zoneAt(map, me.x, me.y, 'slow'); // 느린 바닥만 (어두운 구역은 시야만 줄인다)
    const speed = GAME.speed * (zone ? zone.amount : 1) * speedMult(now);
    let left = Math.hypot(ix, iy) * speed * dt;
    const moving = left > 0.01;
    const free = (x, y) => canStand(grid, x, y, GAME.radius) && (!hitsLock(x, y, now) || hitsLock(me.x, me.y, now));
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
      [q.x, q.y] = alongPath(r.path, k); // 회전목마도 path(둥근 점 여러 개)를 따라 돈다
      q.rideScale = r.carousel ? 0.9 : 0.75;
      q.m = 1;
    } else {
      const inK = Math.min(1, k / 0.35);
      const outK = Math.max(0, (k - 0.65) / 0.35);
      if (k < 0.5) (q.x = r.path[0][0] + (r.path[1][0] - r.path[0][0]) * inK), (q.y = r.path[0][1] + (r.path[1][1] - r.path[0][1]) * inK);
      else (q.x = r.to[0]), (q.y = r.to[1]);
      q.rideScale = k < 0.5 ? 1 - inK : outK;
    }
  }

  // ───── 그리기 도우미 ─────
  function badge(text, x, y, fill, color = '#fff') {
    ctx.font = font(20);
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
  function star(c, x, y, r, rot = 0) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
  }
  // 보급 상자가 숨은 가구 위 별가루
  function sparkle(rect, t, strong = false) {
    const [x, y, w, h] = rect;
    for (let i = 0; i < (strong ? 9 : 6); i++) {
      const k = (t * 0.8 + i * 0.37) % 1;
      const sx = x + ((Math.sin(i * 12.9 + 3) + 1) / 2) * w;
      const sy = y + h * 0.8 - k * (h + 40);
      ctx.globalAlpha = Math.sin(k * Math.PI);
      ctx.fillStyle = i % 2 ? '#fff3a0' : '#ff9ec4';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      star(ctx, sx, sy, strong ? 11 : 8, t * 2 + i);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (strong) {
      ctx.strokeStyle = `rgba(255,158,196,${0.6 + Math.sin(t * 6) * 0.3})`;
      ctx.lineWidth = 6;
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(x - 8, y - 8, w + 16, h + 16);
      ctx.setLineDash([]);
    }
  }
  // 빛 구역 밖을 보랏빛 안개로 덮는다 (월드 좌표)
  function drawFogZone(c, now, t, W, H, lw = 1) {
    if (!fog) return;
    if (fog.mode === 'floors') return drawFloorFog(c, now, t, lw);
    if (fog.stage >= 1) {
      const r = fogR(now);
      c.save();
      c.beginPath();
      c.rect(-600, -600, W + 1200, H + 1200);
      const n = 64;
      for (let i = n; i >= 0; i--) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (1 + Math.sin(a * 7 + t * 1.3) * 0.012 + Math.sin(a * 3 - t) * 0.01);
        if (i === n) c.moveTo(fog.cx + Math.cos(a) * rr, fog.cy + Math.sin(a) * rr);
        else c.lineTo(fog.cx + Math.cos(a) * rr, fog.cy + Math.sin(a) * rr);
      }
      c.closePath();
      c.fillStyle = 'rgba(120,86,190,0.42)';
      c.fill('evenodd');
      // 경계의 안개 덩어리
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + t * 0.04;
        const br = 50 + Math.sin(t * 1.7 + i) * 12;
        c.fillStyle = 'rgba(190,170,240,0.22)';
        c.beginPath();
        c.arc(fog.cx + Math.cos(a) * (r + br * 0.4), fog.cy + Math.sin(a) * (r + br * 0.4), br, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = 'rgba(230,220,255,0.75)';
      c.lineWidth = 6 * lw;
      c.setLineDash([22 * lw, 12 * lw]);
      c.lineDashOffset = -t * 30;
      c.beginPath();
      c.arc(fog.cx, fog.cy, r, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }
    // 다음 빛 구역 테두리: 흰 점선 (예고 때부터)
    const left = fog.nextAt != null ? fog.nextAt - now : Infinity;
    if (typeof fog.nextR === 'number' && fog.cx != null && left <= (FOG.warnMs || 20000) + 500) {
      c.save();
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 5 * lw;
      c.setLineDash([16 * lw, 14 * lw]);
      c.beginPath();
      c.arc(fog.cx, fog.cy, fog.nextR, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
  }
  // 층 단위 안개: 어두워진 층은 보랏빛 안개로 덮고, 곧 어두워질 층은 흰 점선 테두리 + "곧 안개" (월드 좌표)
  function drawFloorFog(c, now, t, lw) {
    const all = (map.floors || []).map((f) => f.id);
    const safeNow = fog.stage >= 1 && fog.safe ? fog.safe : all;
    const left = fog.nextAt != null ? fog.nextAt - now : Infinity;
    const warn = fog.nextSafe && left <= (FOG.warnMs || 20000) + 500;
    for (const f of map.floors || []) {
      const [x, y, w, h] = f.rect;
      if (!safeNow.includes(f.id)) {
        c.save();
        c.fillStyle = 'rgba(120,86,190,0.5)';
        c.fillRect(x, y, w, h);
        for (let i = 0; i < 26; i++) {
          const bx = x + (((i * 0.383 + t * 0.012) % 1) + 1) % 1 * w;
          const by = y + ((Math.sin(i * 2.1) + 1) / 2) * h;
          const br = 70 + Math.sin(t * 1.3 + i) * 18;
          c.fillStyle = 'rgba(190,170,240,0.2)';
          c.beginPath();
          c.arc(bx, by, br, 0, Math.PI * 2);
          c.fill();
        }
        c.strokeStyle = 'rgba(230,220,255,0.75)';
        c.lineWidth = 8 * lw;
        c.setLineDash([22 * lw, 12 * lw]);
        c.lineDashOffset = -t * 30;
        c.strokeRect(x, y, w, h);
        c.restore();
      } else if (warn && !fog.nextSafe.includes(f.id)) {
        c.save();
        c.strokeStyle = `rgba(255,255,255,${0.6 + Math.sin(t * 6) * 0.3})`;
        c.lineWidth = 10 * lw;
        c.setLineDash([26 * lw, 16 * lw]);
        c.strokeRect(x + 10, y + 10, w - 20, h - 20);
        c.restore();
      }
    }
  }
  // 화면 가장자리 화살표 (sx, sy: 내 화면 자리, tx, ty: 목표 화면 자리)
  function edgeArrow(sx, sy, tx, ty, vw, vh, color, text) {
    const a = Math.atan2(ty - sy, tx - sx);
    const d = Math.hypot(tx - sx, ty - sy);
    const R = Math.min(Math.min(vw, vh) * 0.4, Math.max(70, d - 30));
    const x = sx + Math.cos(a) * R;
    const y = sy + Math.sin(a) * R;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(-12, -16);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-12, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (text) {
      ctx.font = font(16);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.strokeText(text, x, y + 30);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x, y + 30);
    }
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
    frame.last = now;
    const t = now / 1000;
    const image = mapEntry.image;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    // 창 크기 변경·화면 회전: 크기가 달라지면 그 프레임에 바로 다시 맞춘다
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      safeArea = readSafeArea();
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
    const next = pickAction(now);
    const key = next ? [next.type, next.id, next.label, next.disabled ? 1 : 0, next.hint || '', next.readyAt || 0].join('|') : '';
    if (key !== ctxKey) {
      ctxKey = key;
      opts.onContext(next);
    }

    // 카메라: 학생은 내 캐릭터를 따라가고, 선생님은 맵 전체를 본다
    const [W, H] = map.size;
    let scale;
    let camX;
    let camY;
    if (me) {
      // 화면의 짧은 변에 시야 원(반지름 GAME.vision)이 거의 꽉 차게 맞춘다 → 휴대폰·태블릿·컴퓨터에서 보이는 범위가 비슷하다.
      // 아주 작은 화면은 캐릭터·가구가 너무 작아지지 않게 0.6 아래로는 줄이지 않는다
      const short = Math.min(vw, vh);
      scale = Math.max(0.6, Math.min(1.3, (short * 1.1) / (GAME.vision * 2)));
      const halfW = vw / 2 / scale;
      const halfH = vh / 2 / scale;
      camX = halfW * 2 >= W ? W / 2 : Math.max(halfW, Math.min(W - halfW, me.x));
      camY = halfH * 2 >= H ? H / 2 : Math.max(halfH, Math.min(H - halfH, me.y - 30));
    } else {
      scale = Math.min(vw / W, vh / H);
      camX = W / 2;
      camY = H / 2;
    }
    const toScreen = (x, y) => [vw / 2 + (x - camX) * scale, vh / 2 + (y - camY) * scale];

    // 시야: 안개 속이면 0.4초에 걸쳐 좁아지고, 나오면 넓어진다 (꿈에 빠진 학생은 그대로)
    const ghostMe = !!me && mafia && (myGhost || me.ghost);
    // 어두운 구역(유령의 집)이면 시야 × amount (서버 seeRange 와 같은 규칙). 처음 들어갈 때 한 번 안내
    const dz = me && !ghostMe ? zoneAt(map, me.x, me.y, 'dark') : null;
    if (dz !== darkZone) {
      darkZone = dz;
      const zid = dz && (dz.id || dz.name || 'dark');
      if (dz && !darkShown.has(zid)) {
        darkShown.add(zid);
        if (opts.onZone) opts.onZone(dz);
      }
    }
    const darkK = dz ? darkVisionAt(map, me.x, me.y) : 1;
    const wantK = (me && !ghostMe && inFogAt(me.x, me.y, now) ? FOG.vision : 1) * darkK;
    visK += (wantK - visK) * Math.min(1, dt / 0.4 * 2.2);
    const vis = GAME.vision * blackoutScale(now) * visK * (fxOn('flashlight', now) ? ITEMS.flashlight.vision || 1.5 : 1);
    const seen = (x, y) => !me || Math.hypot(x - me.x, y - me.y) <= vis * 1.08;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#26214a'; // 맵 바깥의 밤
    ctx.fillRect(0, 0, vw, vh);
    const allLanterns = [...(map.terminals || []), ...bonus];
    // 맵 위 그림 (맵·랜턴·상자·캐릭터·안개·글자 효과). 여러 층 맵의 선생님 화면은 층마다 한 칸씩 나눠 여러 번 그린다
    if (!me && map.floors && map.floors.length) {
      const top = 34;
      for (const p of floorPanels(map, vw, vh, { gap: 16, pad: 10, top })) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = font(22);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = INK;
        ctx.strokeText(p.floor.name, p.x + p.w / 2, p.y - top / 2);
        ctx.fillStyle = '#c8f56a';
        ctx.fillText(p.floor.name, p.x + p.w / 2, p.y - top / 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(p.x, p.y, p.w, p.h);
        ctx.clip();
        ctx.translate(p.x, p.y);
        ctx.scale(p.k, p.k);
        ctx.translate(-p.src[0], -p.src[1]);
        drawWorld(p.k);
        ctx.restore();
      }
    } else {
      ctx.translate(vw / 2, vh / 2);
      ctx.scale(scale, scale);
      ctx.translate(-camX, -camY);
      drawWorld(scale);
    }
    // 내 층이 바뀌면 알린다 (층 이름 글씨)
    if (me && map.floors && !me.ride) {
      const fl = floorAt(map, me.x, me.y);
      if (fl && fl !== myFloor) {
        if (myFloor && opts.onFloor) opts.onFloor(fl);
        myFloor = fl;
      }
    }

  function drawWorld(viewScale) {
    ctx.drawImage(image, 0, 0);

    // 개구멍 속에서 깜빡이는 눈 (입구에만)
    for (const d of map.devices || []) {
      if (d.type !== 'teleport' || DEVICE_STYLES[d.style]) continue; // 개구멍(모양 없는 순간이동)만
      const h = d.from;
      const phase = (t * 0.7) % 6;
      if (phase <= 2.6) {
        const open = phase % 1.3 < 1.15 ? 1 : 0.15;
        const look = Math.sin(t * 1.3) * 3;
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
      }
    }

    // 문 막기: 덩굴 + 남은 시간 원 (모두에게 보인다)
    if (mafia && lock && now < lock.until) drawLock(lock, now);

    // 꿈에 빠진 자리: 베개 위에 잠든 모습 + 반짝이는 별
    //   (학생 화면은 시야 안만, 선생님 화면은 위치 표시를 켰을 때만)
    if (mafia && (me || reveal || over)) {
      for (const k of marks) {
        if (!seen(k.x, k.y)) continue;
        const sz = GAME.charSize * (me ? 0.85 : 1.3); // 작은 조각상처럼 (달 + Zzz)
        drawCharacter(ctx, { kind: k.character, color: (COLORS[k.color] || COLORS[0]).hex, x: k.x, y: k.y, size: sz, t, seed: 0, moving: false, facing: 1, frozen: true });
      }
    }

    // 퀴즈 랜턴: 내가 켠 랜턴은 노란 불빛, 아직 안 켠 랜턴만 은은히 깜빡인다
    const showLanternState = !!me;
    for (const tm of allLanterns) {
      const [tx, ty] = tm.pos;
      const isBonus = bonus.includes(tm);
      const done = mine.done.has(tm.id);
      const lit = showLanternState && done;
      if (lit) {
        const glow = ctx.createRadialGradient(tx, ty - 10, 6, tx, ty - 10, 120);
        glow.addColorStop(0, 'rgba(255,214,106,.55)');
        glow.addColorStop(1, 'rgba(255,214,106,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(tx - 120, ty - 130, 240, 240);
        drawLantern(ctx, tx, ty, true);
      } else {
        if (isBonus) drawLantern(ctx, tx, ty, false);
        const pulse = 0.25 + (Math.sin(t * 2.2 + tx * 0.01) + 1) * 0.18;
        const g = ctx.createRadialGradient(tx, ty - 10, 4, tx, ty - 10, 70);
        g.addColorStop(0, `rgba(255,181,71,${pulse})`);
        g.addColorStop(1, 'rgba(255,181,71,0)');
        ctx.fillStyle = g;
        ctx.fillRect(tx - 70, ty - 80, 140, 140);
        if (isBonus) badge('임시', tx, ty - 62, '#7fe0c4', INK);
        else if (me && ctxKey.startsWith('terminal|' + tm.id + '|')) badge(KEYS.act.label, tx, ty - 62, '#ffb547', INK);
      }
    }

    // 보급 상자: 서버가 알려 준 것(내 시야 근처, 선생님은 모두)만 반짝인다
    for (const k of crates) {
      const rect = k.rect || [k.x - 30, k.y - 30, 60, 60];
      if (me && !seen(k.x ?? rect[0] + rect[2] / 2, k.y ?? rect[1] + rect[3] / 2)) continue;
      sparkle(rect, t, !me);
    }

    // 캐릭터 (학생·잠귀신은 시야 안에 있는 사람만 보인다)
    const big = me ? 1 : 1.5;
    const size = GAME.charSize * big;
    const sorted = me || reveal || over ? [...players.values()].sort((a, b) => a.y - b.y) : [];
    const iAmGhost = ghostMe;
    const iAmChaser = myRole === 'chaser';
    for (const q of sorted) {
      if (me && q !== me && !seen(q.x, q.y)) continue;
      const s = size * (q.rideScale ?? 1);
      if (s < 4) continue;
      drawEffects(q, s, now, t);
      if (mafia) {
        drawMafiaPlayer(q, s, big, now, t, { iAmGhost, iAmChaser });
        continue;
      }
      const cloaked = q.cloak && q !== me && !iAmChaser;
      if (q.role === 'chaser' && !q.ride && !cloaked) {
        // 잠귀신 발밑에서 일렁이는 보랏빛 안개
        const pulse = 1 + Math.sin(t * 5 + q.seed) * 0.12;
        const aura = ctx.createRadialGradient(q.x, q.y - 6, 4, q.x, q.y - 6, 62 * big * pulse);
        aura.addColorStop(0, 'rgba(155,107,242,.6)');
        aura.addColorStop(1, 'rgba(155,107,242,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(q.x, q.y - 6, 66 * big * pulse, 34 * big * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = (q.connected ? 1 : 0.4) * (cloaked ? ITEMS.fogcape.alpha || 0.3 : q.cloak ? 0.6 : 1);
      const wake = waking && waking.id === q.id ? Math.min(1, (now - waking.at) / waking.ms) : 0;
      drawCharacter(ctx, { kind: q.character, color: q.color, x: q.x, y: q.y, size: s, t, seed: q.seed, moving: !!q.m && !q.frozen, facing: q.f, frozen: q.frozen, wake });
      ctx.globalAlpha = 1;
      if (q.ride) continue;
      if (now < q.protUntil && !q.frozen) protRing(q, s, t);
      if (q.role === 'chaser' && !cloaked) badge('잠귀신', q.x, q.y - s * (q.character === 'slime' ? 0.72 : 1) - 22, '#9b6bf2');
    }
    if (me && !me.ride) {
      // 내 캐릭터 위의 화살표
      const bob = Math.sin(t * 5) * 4;
      const top = me.y - size - (me.role === 'chaser' || (mafia && myRole === 'chaser') ? 62 : 26) + (mafia && iAmGhost ? ghostBob(me, t) : 0) - (me.frozen ? 50 : 0);
      ctx.fillStyle = '#ffb547';
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
      // 졸음 막대 (잠귀신 술래잡기 학생, 안개 속에서 차오른다)
      const drowsy = Math.max(0, Math.min(1, info.drowsy || 0));
      if (!mafia && me.role === 'student' && !me.frozen && drowsy > 0.01) {
        const bw = 70;
        const bx = me.x - bw / 2;
        const by = top - 26;
        ctx.fillStyle = '#fff6e5';
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, 14, 7);
        ctx.fill();
        ctx.fillStyle = drowsy > 0.7 ? '#ff6b6b' : '#9b6bf2';
        ctx.beginPath();
        ctx.roundRect(bx, by, Math.max(8, bw * drowsy), 14, 7);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, 14, 7);
        ctx.stroke();
        ctx.font = font(14);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeText('졸음', me.x, by - 12);
        ctx.fillText('졸음', me.x, by - 12);
      }
    }

    // 줄 서는 장치(solo): 누가 타는 중이면 입구 위에 "사용 중 · N초"
    for (const d of map.devices || []) {
      const until = d.solo ? devBusy[d.id] || 0 : 0;
      if (until <= now || (me && !seen(d.from[0], d.from[1]))) continue;
      badge(`사용 중 · ${Math.ceil((until - now) / 1000)}초`, d.from[0], d.from[1] - 70, '#ff7a59');
    }

    // 잠 안개 (빛 구역 밖) — 캐릭터 위에 덮어 흐릿하게 보이게
    drawFogZone(ctx, now, t, W, H, me ? 1 : 1.6);

    // 글자 효과
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      const k = (now - p.at) / 900;
      if (k >= 1) {
        popups.splice(i, 1);
        continue;
      }
      if (me && !seen(p.x, p.y)) continue;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = font(40 + k * 14);
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
  } // drawWorld 끝

    // 시야 제한: 가장자리에 안개 덩어리가 일렁이는 테두리
    if (me) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [cx, cy] = toScreen(me.x, me.y - 40);
      const blink = (t * 0.37) % 9 < 0.12 ? 0.9 : 1;
      const r = vis * scale * blink;
      const soft = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      soft.addColorStop(0, 'rgba(16,11,34,0)');
      soft.addColorStop(1, 'rgba(16,11,34,0.55)');
      ctx.fillStyle = soft;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0, 0, vw, vh);
      const n = 72;
      for (let i = n; i >= 0; i--) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (1 + Math.sin(a * 6 + t * 0.9) * 0.035 + Math.sin(a * 11 - t * 1.4) * 0.02);
        if (i === n) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(16,11,34,0.93)';
      ctx.fill('evenodd');
      // 안개 덩어리
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + t * 0.06;
        const br = r * (0.13 + Math.sin(t * 1.1 + i * 2.3) * 0.025);
        ctx.fillStyle = 'rgba(52,40,92,0.55)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 1.02, br, 0, Math.PI * 2);
        ctx.fill();
      }

      if (mafia && blackoutHitsMe() && blackoutActive(now)) {
        // 안개 뿌리기 시작: 보랏빛 안개가 두 번 훅 덮친다
        const e = (now - blackoutStart) / 1000;
        if (e < 0.6 && Math.floor(e * 10) % 3 === 0) {
          ctx.fillStyle = 'rgba(80,50,140,0.7)';
          ctx.fillRect(0, 0, vw, vh);
        }
        // 아직 안 켠 랜턴 불빛은 보인다 (찾아갈 수 있게)
        for (const tm of allLanterns) {
          if (mine.done.has(tm.id)) continue;
          const [sx, sy] = toScreen(tm.pos[0], tm.pos[1] - 20);
          if (sx < -40 || sy < -40 || sx > vw + 40 || sy > vh + 40) continue;
          const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, 34 * scale);
          glow.addColorStop(0, `rgba(255,181,71,${0.75 + Math.sin(t * 4 + tm.pos[0]) * 0.2})`);
          glow.addColorStop(1, 'rgba(255,181,71,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, sy, 34 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (mafia && ghostMe) {
        ctx.fillStyle = 'rgba(200,190,255,0.14)'; // 꿈속 화면: 옅은 보랏빛
        ctx.fillRect(0, 0, vw, vh);
      }
      if (mafia && me.morphAt && now - me.morphAt < 700) {
        ctx.fillStyle = `rgba(200,180,255,${0.7 * (1 - (now - me.morphAt) / 700)})`;
        ctx.fillRect(0, 0, vw, vh);
      }
      // 졸음: 화면 가장자리가 보랏빛으로 흐려진다
      const drowsy = !mafia ? Math.max(0, Math.min(1, info.drowsy || 0)) : 0;
      if (drowsy > 0.05 && !me.frozen) {
        const edge = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * (0.45 - drowsy * 0.2), vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
        edge.addColorStop(0, 'rgba(120,86,190,0)');
        edge.addColorStop(1, `rgba(120,86,190,${0.25 + drowsy * 0.5})`);
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, vw, vh);
      }

      // 잠귀신이 가까이 오면 화면 가장자리가 두근거린다 (학생만. 꿈도둑을 찾아라는 정체가 드러나므로 끈다)
      if (!mafia && me.role === 'student' && !over) {
        let nearest = Infinity;
        for (const q of players.values()) {
          if (q.role === 'chaser' && !q.cloak) nearest = Math.min(nearest, Math.hypot(q.x - me.x, q.y - me.y));
        }
        if (nearest < GAME.vision) {
          const danger = 1 - nearest / GAME.vision;
          const beat = 0.5 + Math.abs(Math.sin(t * (3 + danger * 5))) * 0.5;
          const edge = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
          edge.addColorStop(0, 'rgba(255,107,107,0)');
          edge.addColorStop(1, `rgba(255,107,107,${(0.2 + danger * 0.5) * beat})`);
          ctx.fillStyle = edge;
          ctx.fillRect(0, 0, vw, vh);
        }
      }
      if (me.frozen) {
        ctx.fillStyle = 'rgba(155,107,242,0.18)';
        ctx.fillRect(0, 0, vw, vh);
      }

      // 힌트 (연속 정답 보상): 방향 화살표, 정확한 자리면 시야 밖에서도 반짝임
      const [mx, my] = toScreen(me.x, me.y - 40);
      if (hint && now < hint.until && typeof hint.x === 'number') {
        const [hx, hy] = toScreen(hint.x, hint.y);
        if (hint.exact) {
          ctx.save();
          ctx.translate(vw / 2, vh / 2);
          ctx.scale(scale, scale);
          ctx.translate(-camX, -camY);
          const f = crates.find((k) => Math.hypot((k.x ?? 0) - hint.x, (k.y ?? 0) - hint.y) < 5);
          sparkle(f && f.rect ? f.rect : [hint.x - 40, hint.y - 40, 80, 80], t, true);
          ctx.restore();
        }
        if (hx < 30 || hy < 30 || hx > vw - 30 || hy > vh - 30 || Math.hypot(hx - mx, hy - my) > 120) edgeArrow(mx, my, hx, hy, vw, vh, '#ff9ec4', hint.room ? `상자: ${hint.room}` : '보급 상자');
      }
      // 손전등: 아직 안 켠 가장 가까운 랜턴 쪽 화살표
      if (fxOn('flashlight', now)) {
        let best = null;
        let bd = Infinity;
        for (const tm of allLanterns) {
          if (mine.done.has(tm.id)) continue;
          const d = Math.hypot(tm.pos[0] - me.x, tm.pos[1] - me.y);
          if (d < bd) (bd = d), (best = tm);
        }
        if (best && bd > 120) {
          const [lx, ly] = toScreen(best.pos[0], best.pos[1]);
          // 여러 층 맵: 다른 층 랜턴이면 어느 층인지 적는다 (화살표는 계단 쪽이 아니라 그 층 방향)
          const lf = floorAt(map, best.pos[0], best.pos[1]);
          const other = lf && lf !== floorAt(map, me.x, me.y);
          edgeArrow(mx, my, lx, ly, vw, vh, '#ffb547', other ? `랜턴 (${floorShort(lf)})` : '랜턴');
        }
      }
    }

    // 화면 조이스틱 (누르는 동안). 터치 화면에서 안 누를 때는 왼쪽 아래에 흐린 안내 원을 둔다
    const STICK_MAX = stickMax();
    const knob = STICK_MAX * 0.42;
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
      ctx.fillStyle = 'rgba(255,181,71,.9)';
      ctx.beginPath();
      ctx.arc(ox + stick.dx * k, oy + stick.dy * k, knob, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (me && coarse.matches && !paused && !meeting && !me.frozen) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ox = safeArea.l + STICK_MAX + 26;
      const oy = vh - safeArea.b - STICK_MAX - 26;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,246,229,.8)';
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(ox, oy, STICK_MAX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,246,229,.5)';
      ctx.beginPath();
      ctx.arc(ox, oy, knob, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (minimap) drawMinimap(minimap, t, now);
  }

  // ───── 그리기 도우미 ─────
  function protRing(q, s, t) {
    ctx.strokeStyle = `rgba(255,181,71,${0.55 + Math.sin(t * 10) * 0.3})`;
    ctx.lineWidth = 6;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath();
    ctx.ellipse(q.x, q.y - s * 0.5, s * 0.62, s * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 아이템 효과 (운동화·바람 망토·킥보드 꼬리, 킥보드 발판, 우산 방울, 손전등 빛줄기)
  function drawEffects(q, s, now, t) {
    const fx = q === me ? myFx : q.fx || {};
    const on = (k) => (fx[k] || 0) > now;
    if (on('kickboard') && !q.ride) drawKickboard(q, s, t);
    if (on('shoes') || on('windcape') || on('kickboard')) {
      const col = on('kickboard') ? '255,122,89' : on('shoes') ? '255,181,71' : '92,200,242';
      for (let i = 1; i <= 4; i++) {
        ctx.fillStyle = `rgba(${col},${0.45 - i * 0.09})`;
        ctx.beginPath();
        ctx.ellipse(q.x - (q.f || 1) * i * 16, q.y - 10 - Math.sin(t * 12 + i) * 3, 14 - i * 2, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (on('umbrella')) {
      ctx.strokeStyle = 'rgba(127,224,196,.85)';
      ctx.fillStyle = 'rgba(127,224,196,.15)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(q.x, q.y - s * 0.5, s * 0.6 + Math.sin(t * 4) * 2, s * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (on('flashlight') && q !== me) {
      const g = ctx.createRadialGradient(q.x, q.y - 40, 4, q.x, q.y - 40, 140);
      g.addColorStop(0, 'rgba(255,243,160,.35)');
      g.addColorStop(1, 'rgba(255,243,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 40);
      ctx.arc(q.x, q.y - 40, 140, (q.f === -1 ? Math.PI : 0) - 0.4, (q.f === -1 ? Math.PI : 0) + 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 킥보드: 발밑 발판 + 앞바퀴 쪽 손잡이 (캐릭터보다 먼저 그려서 발 아래에 깔린다)
  function drawKickboard(q, s, t) {
    const f = q.f === -1 ? -1 : 1;
    const k = s / GAME.charSize;
    const x = q.x;
    const y = q.y + 4 * k;
    const half = 30 * k;
    const spin = q.m ? t * 14 : 0;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    // 손잡이 기둥 (앞쪽)
    ctx.lineWidth = 7 * k;
    ctx.beginPath();
    ctx.moveTo(x + f * (half - 4 * k), y);
    ctx.lineTo(x + f * (half + 6 * k), y - 52 * k);
    ctx.stroke();
    ctx.strokeStyle = '#ff7a59';
    ctx.lineWidth = 4 * k;
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6 * k;
    ctx.beginPath();
    ctx.moveTo(x + f * (half - 6 * k), y - 52 * k);
    ctx.lineTo(x + f * (half + 18 * k), y - 52 * k);
    ctx.stroke();
    // 발판
    ctx.fillStyle = '#ff7a59';
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.roundRect(x - half, y - 5 * k, half * 2, 8 * k, 4 * k);
    ctx.fill();
    ctx.stroke();
    // 바퀴
    for (const wx of [x - half + 4 * k, x + half - 4 * k]) {
      ctx.fillStyle = '#2a2140';
      ctx.beginPath();
      ctx.arc(wx, y + 6 * k, 6 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff3a0';
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(wx, y + 6 * k);
      ctx.lineTo(wx + Math.cos(spin) * 5 * k, y + 6 * k + Math.sin(spin) * 5 * k);
      ctx.stroke();
    }
    ctx.restore();
  }
  function ghostBob(q, t) {
    return Math.sin(t * 2.4 + q.seed * 2) * 7 - 10;
  }
  function drawHorns(x, y) {
    ctx.fillStyle = '#9b6bf2';
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
  function drawMafiaPlayer(q, s, big, now, t, view) {
    const morphing = q.morphAt && now - q.morphAt < 1200; // 꿈에 빠지는 중
    const isGhost = q.ghost && !morphing;
    // 깨어 있는 사람 화면에는 꿈에 빠진 학생이 안 보인다. 끝나면 모두 보인다
    if (isGhost && q !== me && me && !view.iAmGhost && !over) return;
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
    drawCharacter(ctx, { kind: q.character, color: q.color, x: q.x + dx, y, size: s, t, seed: q.seed, moving: !!q.m && !morphing, facing: q.f, frozen: morphing, halo: isGhost });
    const head = y - s * (q.character === 'slime' ? 0.72 : 1);
    ctx.globalAlpha = 1;
    if (q.ride) return;
    if (now < q.protUntil && !isGhost) protRing(q, s, t);
    // 변신 표시 (선생님·꿈도둑 화면만 서버가 disguise 를 알려 준다)
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
      badge(q === me ? `변신 중 ${left}초` : '변신', q.x, q.y + 24 * big, '#9b6bf2');
    }
    if (isMate && !isGhost) drawHorns(q.x, head - 4);
    if (roleShown) badge(q.ejected ? '꿈도둑(추방)' : '꿈도둑', q.x, head - (isMate ? 40 : 22), '#9b6bf2');
  }
  // 문 막기: 문 칸을 감싼 덩굴 + 남은 시간 원
  function drawLock(lk, now) {
    const [x, y, w, h] = lk.rect;
    ctx.save();
    ctx.fillStyle = 'rgba(63,201,160,.3)';
    ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
    const along = w >= h;
    const len = along ? w : h;
    for (const off of [0.3, 0.7]) {
      ctx.strokeStyle = '#2f8f5b';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const k = i / 20;
        const wob = Math.sin(k * 9 + off * 7) * 0.22;
        const px = along ? x + k * len : x + w * (off + wob);
        const py = along ? y + h * (off + wob) : y + k * len;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const k = (i + 0.5) / 6;
      const px = along ? x + k * w : x + w / 2 + (i % 2 ? 8 : -8);
      const py = along ? y + h / 2 + (i % 2 ? 8 : -8) : y + k * h;
      ctx.fillStyle = '#7fe0c4';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, py, 8, 5, i, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const cx = x + w / 2;
    const cy = y + h / 2;
    const k = Math.max(0, Math.min(1, (lk.until - now) / (lk.total || MAF.lockMs)));
    ctx.fillStyle = 'rgba(255,246,229,.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2f8f5b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.restore();
  }
  // 작은 지도: 방·랜턴·장치 기호·빛 구역. 사람은 나만 표시
  function drawMinimap(cv, t, now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr)) (cv.width = Math.round(w * dpr)), (cv.height = Math.round(h * dpr));
    const c = cv.getContext('2d');
    const [W, H] = map.size;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    // 여러 층 맵은 층마다 한 칸 (층 이름 + 내 층은 노란 테두리). 한 층 맵은 맵 전체 한 칸
    const multi = !!(map.floors && map.floors.length);
    const top = multi ? 26 : 0;
    const myFl = me ? floorAt(map, me.x, me.y) : null;
    for (const p of floorPanels(map, w, h, { gap: 14, pad: multi ? 4 : 0, top })) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (p.floor) {
        const here = p.floor === myFl;
        c.font = font(18);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = INK;
        c.fillText(here ? `${p.floor.name} (나)` : p.floor.name, p.x + p.w / 2, p.y - top / 2);
        c.lineWidth = here ? 5 : 2;
        c.strokeStyle = here ? '#ffb547' : INK;
        c.strokeRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4);
      }
      c.save();
      c.beginPath();
      c.rect(p.x, p.y, p.w, p.h);
      c.clip();
      c.translate(p.x, p.y);
      c.scale(p.k, p.k);
      c.translate(-p.src[0], -p.src[1]);
      drawMinimapWorld(c, t, now, W, H);
      c.restore();
    }
  }
  function drawMinimapWorld(c, t, now, W, H) {
    c.drawImage(mapEntry.image, 0, 0);
    for (const tm of [...(map.terminals || []), ...bonus]) {
      const done = mine.done.has(tm.id);
      c.fillStyle = done ? '#ffd76a' : '#8f8aa8';
      c.strokeStyle = INK;
      c.lineWidth = 8;
      c.beginPath();
      c.arc(tm.pos[0], tm.pos[1] - 20, 30, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // 장치 기호: 입구 채운 동그라미, 출구 빈 동그라미, 미끄럼틀 화살표. 탈 수 없는 역할에게는 회색
    const chaser = myRole === 'chaser';
    for (const d of map.devices || []) {
      const who = (d.who && d.who[mode]) || (mafia ? ['student', 'chaser'] : ['student']);
      const ok = role === 'teacher' || who.includes(chaser ? 'chaser' : 'student');
      const col = ok ? '#5cc8f2' : '#9a96a8';
      c.lineWidth = 12;
      c.strokeStyle = INK;
      c.fillStyle = col;
      c.beginPath();
      c.arc(d.from[0], d.from[1], 44, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      const ends = pairDevice(d) ? [] : d.type === 'slide' ? [d.to] : d.exits || []; // 계단·엘리베이터는 도착점을 따로 표시하지 않는다
      for (const e of ends) {
        c.fillStyle = 'rgba(255,255,255,.85)';
        c.strokeStyle = col;
        c.lineWidth = 14;
        c.beginPath();
        c.arc(e[0], e[1], 38, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
      if (d.type === 'slide') {
        const [ax, ay] = d.to;
        const [bx, by] = (d.path && d.path.length ? d.path[d.path.length - 1] : d.from);
        const a = Math.atan2(ay - by, ax - bx);
        c.fillStyle = col;
        c.strokeStyle = INK;
        c.lineWidth = 8;
        c.beginPath();
        c.moveTo(ax - Math.cos(a) * 50 + Math.cos(a) * 70, ay - Math.sin(a) * 50 + Math.sin(a) * 70);
        c.lineTo(ax - Math.cos(a - 0.5) * 60, ay - Math.sin(a - 0.5) * 60);
        c.lineTo(ax - Math.cos(a + 0.5) * 60, ay - Math.sin(a + 0.5) * 60);
        c.closePath();
        c.fill();
        c.stroke();
      }
    }
    if (lock && now < lock.until) {
      c.fillStyle = 'rgba(63,201,160,.85)';
      const [x, y, rw, rh] = lock.rect;
      c.fillRect(x - 10, y - 10, rw + 20, rh + 20);
    }
    drawFogZone(c, now, t, W, H, 3);
    // 상자: 선생님은 모두, 학생은 정확한 힌트를 받았을 때만
    const crateMarks = role === 'teacher' ? crates.map((x) => [x.x, x.y]) : hint && hint.exact && now < hint.until ? [[hint.x, hint.y]] : [];
    for (const [x, y] of crateMarks) {
      if (typeof x !== 'number') continue;
      c.fillStyle = '#ff9ec4';
      c.strokeStyle = INK;
      c.lineWidth = 8;
      star(c, x, y, 46 + Math.sin(t * 6) * 6, t);
      c.fill();
      c.stroke();
    }
    if (me) {
      const big = map.floors && map.floors.length ? 1.5 : 1; // 여러 층 맵은 "나" 표시를 더 크게
      c.fillStyle = me.color;
      c.strokeStyle = '#fff';
      c.lineWidth = 10 * big;
      c.beginPath();
      c.arc(me.x, me.y - 20, (40 + Math.sin(t * 6) * 8) * big, 0, Math.PI * 2);
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
    setFog,
    fogInfo,
    setBonus(list) {
      bonus = Array.isArray(list) ? list.filter((b) => b && Array.isArray(b.pos)) : [];
    },
    setCrates(list) {
      crates = Array.isArray(list) ? list : [];
    },
    setWaking(id, ms) {
      waking = id ? { id, at: performance.now(), ms: Math.max(1, ms || 1) } : null;
    },
    setNotebook(v) {
      notebookOn = v !== false;
    },
    inFog() {
      return !!me && inFogAt(me.x, me.y, performance.now());
    },
    // ── 꿈도둑을 찾아라 ──
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
      canvas.removeEventListener('lostpointercapture', onUp);
      canvas.removeEventListener('contextmenu', noMenu);
    },
  };
}
export { FONT };
