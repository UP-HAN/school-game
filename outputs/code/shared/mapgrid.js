// 맵 데이터를 20px 격자로 바꾸고, 그 격자로 "여기 서 있을 수 있나"를 계산한다.
// 서버(위치 검사)와 화면(이동·그리기)이 같은 코드를 쓴다.
import { MODES, FOG, CHASE, MAFIA, LOOT } from './config.js';

export const VOID = 0; // 건물 밖
export const FLOOR = 1; // 걸을 수 있는 바닥
export const WALL = 2; // 벽
export const BLOCK = 3; // (예전 값) 가구는 이제 격자 칸이 아니라 g.foots 의 픽셀 사각형으로 막는다

// ───────────── 가구 막힘 영역 (발이 닿는 아랫부분) ─────────────
// 위에서 비스듬히 내려다보는 그림이라, 가구는 그림 전체가 아니라 바닥에 닿는 아랫부분만 막는다.
// 위쪽(윗면·등받이)은 캐릭터가 걸어 들어가 겹쳐 보여도 된다.
// DRAWN: 가구 종류별로 rect 안에서 실제로 그림이 그려지는 곳의 안쪽 여백 [왼, 위, 오른, 아래] (px, 음수면 rect 밖으로 나옴).
// client/maprender.js 의 FURNITURE 그림과 맞춘 값이다. 그림을 바꾸면 여기도 같이 고친다. 없는 종류는 rect 전체.
export const DRAWN = {
  cone: [3, 2, 3, 2],
  refchair: [6, 4, 6, 4],
  drum: [4, 8, 4, 4],
  mic: [7, 1, 7, 1],
  hurdle: [6, 2, 6, 2],
  skeleton: [5, 2, 5, 4],
  crates: [2, 2, 2, 2],
  table: [1, -11, 1, -11],
  basket: [4, 1, 4, 4],
  trampoline: [2, 2, 2, 2],
  blocks: [2, 2, 2, 2],
  teddy: [13, 3, 13, 2],
  horse: [6, 4, 6, 3],
  dumbbell: [4, 1, 4, 1],
  gymball: [3, 3, 3, 3],
  chair: [4, 2, 4, 4],
  plant: [3, 3, 3, 3],
  matpile: [0, 6, 0, 2],
};
export const FOOT_RULE = { side: 4, topShare: 0.35, topMax: 24, bottom: 2 };

// 가구 그림이 실제로 차지하는 사각형 [x, y, w, h]
export function drawnRect(f) {
  const [x, y, w, h] = f.rect;
  const [l, t, r, b] = DRAWN[f.kind] || [0, 0, 0, 0];
  return [x + l, y + t, w - l - r, h - t - b];
}
// 가구가 실제로 막는 사각형 [x, y, w, h]: 맵 데이터에 foot 가 있으면 그것, 없으면 그림에서
// 양옆 4px 안쪽, 위쪽은 그림 높이의 35%(최대 24px)를 빼고, 아래는 2px 안쪽.
export function footRect(f) {
  if (Array.isArray(f.foot)) return f.foot;
  const [x, y, w, h] = drawnRect(f);
  const side = Math.min(FOOT_RULE.side, Math.floor(w * 0.1));
  const top = Math.min(FOOT_RULE.topMax, Math.round(h * FOOT_RULE.topShare));
  return [x + side, y + top, w - side * 2, h - top - FOOT_RULE.bottom];
}

// 캐릭터 발 상자: 가로 반지름 r, 세로 반지름 r/2 (위에서 비스듬히 본 발바닥 그림자 모양)
export const footHalfHeight = (r) => r / 2;

export function buildGrid(map) {
  const cell = map.grid || 20;
  const cols = Math.ceil(map.size[0] / cell);
  const rows = Math.ceil(map.size[1] / cell);
  const cells = new Uint8Array(cols * rows);
  const fill = (r, v, inset = 0) => {
    const x0 = Math.round(r[0] / cell) + inset;
    const y0 = Math.round(r[1] / cell) + inset;
    const x1 = Math.round((r[0] + r[2]) / cell) - inset;
    const y1 = Math.round((r[1] + r[3]) / cell) - inset;
    for (let y = Math.max(0, y0); y < Math.min(rows, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(cols, x1); x++) cells[y * cols + x] = v;
    }
  };
  for (const c of map.corridors || []) fill(c.rect, FLOOR);
  for (const r of map.rooms || []) {
    fill(r.rect, WALL);
    fill(r.rect, FLOOR, 1);
  }
  for (const d of map.doors || []) fill(d.rect, FLOOR);
  // 그림 윗변이 벽에 거의 붙은(14px 안) 가구는 윗부분을 비우지 않고 그림 윗변까지 막는다.
  // 비워 두면 벽과 가구 사이에 발이 겨우 들어가는 좁은 틈이 생겨 끼거나 가구 속을 걷는 것처럼 보인다.
  // (그래도 막힘 영역은 항상 그림 안이다)
  const blocked = (x, y) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    return cx < 0 || cy < 0 || cx >= cols || cy >= rows || cells[cy * cols + cx] !== FLOOR;
  };
  const foots = (map.furniture || []).map((f) => {
    const F = footRect(f).slice();
    if (Array.isArray(f.foot)) return F;
    const D = drawnRect(f);
    const wallAt = (y) => {
      for (let x = F[0] + 1; x < F[0] + F[2]; x += cell / 2) if (blocked(x, y)) return true;
      return blocked(F[0] + F[2] - 1, y);
    };
    for (let y = D[1] - 1; y >= D[1] - WALL_SNAP; y--) {
      if (wallAt(y)) {
        F[3] += F[1] - D[1];
        F[1] = D[1];
        break;
      }
    }
    return F;
  });
  return { cell, cols, rows, cells, foots };
}
const WALL_SNAP = 14;

export function cellAt(g, x, y) {
  const cx = Math.floor(x / g.cell);
  const cy = Math.floor(y / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return VOID;
  return g.cells[cy * g.cols + cx];
}

// 발밑 가운데가 (x, y) 이고 반지름이 r 인 캐릭터가 서 있을 수 있는가.
// 발 상자는 가로 ±r, 세로 ±r/2. 벽·건물 밖은 20px 격자 칸으로, 가구는 막힘 사각형(g.foots)으로 검사한다.
// locked: 잠긴 문 rect 목록(선택). 잠긴 문 칸은 벽처럼 막힌다.
export function canStand(g, x, y, r, locked) {
  const ry = footHalfHeight(r);
  const x0 = Math.floor((x - r) / g.cell);
  const x1 = Math.floor((x + r) / g.cell);
  const y0 = Math.floor((y - ry) / g.cell);
  const y1 = Math.floor((y + ry) / g.cell);
  if (x0 < 0 || y0 < 0 || x1 >= g.cols || y1 >= g.rows) return false;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) if (g.cells[cy * g.cols + cx] !== FLOOR) return false;
  }
  for (const f of g.foots || []) {
    if (x + r > f[0] && x - r < f[0] + f[2] && y + ry > f[1] && y - ry < f[1] + f[3]) return false;
  }
  if (locked) for (const rect of locked) if (touchesRect(g, rect, x, y, r)) return false;
  return true;
}

// 캐릭터(가운데 x,y 반지름 r)가 차지하는 격자 칸이 rect(문 등)의 칸과 겹치는가. 격자 칠하기(buildGrid)와 같은 칸 계산.
export function touchesRect(g, rect, x, y, r) {
  const rx0 = Math.round(rect[0] / g.cell);
  const ry0 = Math.round(rect[1] / g.cell);
  const rx1 = Math.round((rect[0] + rect[2]) / g.cell);
  const ry1 = Math.round((rect[1] + rect[3]) / g.cell);
  const x0 = Math.floor((x - r) / g.cell);
  const x1 = Math.floor((x + r) / g.cell);
  const y0 = Math.floor((y - r) / g.cell);
  const y1 = Math.floor((y + r) / g.cell);
  return x0 < rx1 && x1 >= rx0 && y0 < ry1 && y1 >= ry0;
}

// 맵 장치의 who 에 쓸 수 있는 역할 값 (두 모드 모두 'student'·'chaser')
export const ROLES = ['student', 'chaser'];

export function zoneAt(map, x, y) {
  for (const z of map.zones || []) {
    const [zx, zy, zw, zh] = z.rect;
    if (x >= zx && x < zx + zw && y >= zy && y < zy + zh) return z;
  }
  return null;
}

// ───────────── 층 (여러 층 맵) ─────────────
// 맵 데이터에 floors: [{ id: 1, name: '1층 로비', short: '1층', rect: [x,y,w,h] }, ...] 가 있으면 여러 층 맵이다.
// 층은 한 좌표 위에 서로 FLOOR_GAP 이상 떨어져 있어서 카메라·시야·충돌·닿는 거리 규칙이 층을 넘지 않는다.
// floors 가 없는 맵은 한 층짜리 (floorAt 은 늘 null).
export const FLOOR_GAP = 1500;
export function floorAt(map, x, y) {
  for (const f of map.floors || []) {
    const [fx, fy, fw, fh] = f.rect;
    if (x >= fx && x < fx + fw && y >= fy && y < fy + fh) return f;
  }
  return null;
}
// 층 이름 짧게 ('1층'). short 가 없으면 이름의 첫 낱말
export const floorShort = (f) => (f ? f.short || String(f.name).split(' ')[0] : '');
// 여러 층을 한 화면(w×h)에 나란히 그릴 칸 나누기: [{ floor, src:[x,y,w,h](맵 좌표), x, y, w, h(화면 좌표), k(배율) }]
// 칸 수(가로 몇 칸)는 가장 크게 보이는 것을 고른다. 세로 한 줄이면 높은 층이 위에 온다. floors 가 없으면 맵 전체 한 칸.
// opts: { gap: 칸 사이, pad: 바깥 여백, top: 칸 위 이름 글씨 자리 }
export function floorPanels(map, w, h, opts = {}) {
  const gap = opts.gap ?? 12;
  const pad = opts.pad ?? 0;
  const top = opts.top ?? 0;
  const floors = map.floors && map.floors.length ? map.floors : null;
  if (!floors) {
    const [W, H] = map.size;
    const k = Math.min((w - pad * 2) / W, (h - pad * 2 - top) / H);
    return [{ floor: null, src: [0, 0, W, H], x: (w - W * k) / 2, y: (h - H * k + top) / 2, w: W * k, h: H * k, k }];
  }
  const FW = Math.max(...floors.map((f) => f.rect[2]));
  const FH = Math.max(...floors.map((f) => f.rect[3]));
  const n = floors.length;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const k = Math.min((w - pad * 2 - gap * (cols - 1)) / (cols * FW), (h - pad * 2 - gap * (rows - 1) - top * rows) / (rows * FH));
    if (k > 0 && (!best || k > best.k + 1e-9)) best = { cols, rows, k };
  }
  if (!best) best = { cols: n, rows: 1, k: 0.0001 };
  const { cols, rows, k } = best;
  const order = cols === 1 ? [...floors].reverse() : floors;
  const gw = cols * FW * k + gap * (cols - 1);
  const gh = rows * (FH * k + top) + gap * (rows - 1);
  const x0 = (w - gw) / 2;
  const y0 = (h - gh) / 2;
  return order.map((f, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const pw = f.rect[2] * k;
    const ph = f.rect[3] * k;
    return { floor: f, src: f.rect, x: x0 + c * (FW * k + gap) + (FW * k - pw) / 2, y: y0 + r * (FH * k + top + gap) + top, w: pw, h: ph, k };
  });
}

// 좌표가 들어 있는 방(rooms). 복도면 null
export function roomAt(map, x, y) {
  for (const r of map.rooms || []) {
    const [rx, ry, rw, rh] = r.rect;
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return r;
  }
  return null;
}

// 점에서 사각형까지 거리 (안이면 0)
export function distToRect(x, y, rect) {
  const dx = Math.max(rect[0] - x, 0, x - (rect[0] + rect[2]));
  const dy = Math.max(rect[1] - y, 0, y - (rect[1] + rect[3]));
  return Math.hypot(dx, dy);
}

// 보급 상자를 숨길 수 있는 가구 (06 명세 7-1절): 방(rooms) 사각형 안에 다 들어 있고(복도 가구는 뺌),
// 둘레 reach 안에 설 수 있는 칸이 있는 것. [{ index, room(방 id), roomName, rect, x, y(가운데), spot(설 수 있는 자리) }]
export function lootFurniture(map, g, reach, radius = 14) {
  const out = [];
  (map.furniture || []).forEach((f, index) => {
    const [x, y, w, h] = f.rect;
    const room = (map.rooms || []).find((r) => x >= r.rect[0] && y >= r.rect[1] && x + w <= r.rect[0] + r.rect[2] && y + h <= r.rect[1] + r.rect[3]);
    if (!room) return;
    let spot = null;
    for (let d = radius + 6; d <= reach - 10 && !spot; d += 10) {
      for (let t = 0; t <= Math.max(w, h) && !spot; t += 10) {
        const pts = [];
        if (t <= h) pts.push([x - d, y + t], [x + w + d, y + t]);
        if (t <= w) pts.push([x + t, y - d], [x + t, y + h + d]);
        spot = pts.find((p) => canStand(g, p[0], p[1], radius - 4)) || null;
      }
    }
    if (spot) out.push({ index, room: room.id, roomName: room.name, rect: f.rect, x: x + w / 2, y: y + h / 2, spot });
  });
  return out;
}

// 시작할 때 서는 자리: 시작 위치 둘레에 동그랗게
export function spawnPoint(map, index, total) {
  const [sx, sy] = map.spawn.pos;
  const a = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  const r = map.spawn.radius || 100;
  return [Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r)];
}

// ───────────── 걸어서 갈 수 있는 곳 (도달 가능성) ─────────────
// 10px 간격 점마다 "발 반지름 radius 인 캐릭터가 설 수 있나"를 보고, 시작 위치에서 이어진 점을 모두 칠한다.
// 발 상자(가로 28px·세로 14px)가 간격(10px)보다 넓어서, 이웃한 두 점 사이에 숨은 장애물이 끼어 있을 수 없다.
export function walkMap(map, g, radius = 14, step = 10) {
  const W = Math.floor((g.cols * g.cell) / step) + 1;
  const H = Math.floor((g.rows * g.cell) / step) + 1;
  const ok = new Uint8Array(W * H);
  const seen = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) ok[j * W + i] = canStand(g, i * step, j * step, radius) ? 1 : 0;
  const [sx, sy] = map.spawn.pos;
  let s0 = -1;
  let best = Infinity;
  for (let j = Math.floor(sy / step) - 1; j <= Math.ceil(sy / step) + 1; j++) {
    for (let i = Math.floor(sx / step) - 1; i <= Math.ceil(sx / step) + 1; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H || !ok[j * W + i]) continue;
      const d = Math.hypot(i * step - sx, j * step - sy);
      if (d < best) {
        best = d;
        s0 = j * W + i;
      }
    }
  }
  const stack = s0 >= 0 ? [s0] : [];
  if (s0 >= 0) seen[s0] = 1;
  const push = (n) => {
    if (ok[n] && !seen[n]) {
      seen[n] = 1;
      stack.push(n);
    }
  };
  const flood = () => {
    while (stack.length) {
      const k = stack.pop();
      const i = k % W;
      const j = (k - i) / W;
      if (i > 0) push(k - 1);
      if (i < W - 1) push(k + 1);
      if (j > 0) push(k - W);
      if (j < H - 1) push(k + W);
    }
  };
  flood();
  // 장치(계단·엘리베이터·개구멍·미끄럼틀)도 길이다: 걸어서 닿는 입구가 있으면 그 출구·도착점에서 다시 칠한다 (여러 층 맵).
  // 한 층 맵은 출구가 이미 다 칠해져 있어서 결과가 같다.
  const linked = new Set();
  for (let more = s0 >= 0; more; ) {
    more = false;
    (map.devices || []).forEach((d, di) => {
      if (linked.has(di) || !Array.isArray(d.from) || !near(d.from[0], d.from[1], Math.max(step, (CHASE.deviceReach || 80) - 10))) return;
      linked.add(di);
      const ends = d.type === 'slide' ? [d.to] : d.exits || [];
      for (const e of ends) {
        if (!Array.isArray(e)) continue;
        const i = Math.round(e[0] / step);
        const j = Math.round(e[1] / step);
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        push(j * W + i);
      }
      if (stack.length) more = true;
      flood();
    });
  }
  return { step, W, H, ok, seen, near, started: s0 >= 0 };
  // (x, y) 에서 d 안에 걸어서 갈 수 있는 점이 있는가. rect 를 주면 사각형 둘레까지의 거리로 잰다
  function near(x, y, d, rect) {
    const [ax, ay, bx, by] = rect ? [rect[0] - d, rect[1] - d, rect[0] + rect[2] + d, rect[1] + rect[3] + d] : [x - d, y - d, x + d, y + d];
    for (let j = Math.max(0, Math.ceil(ay / step)); j <= Math.min(H - 1, Math.floor(by / step)); j++) {
      for (let i = Math.max(0, Math.ceil(ax / step)); i <= Math.min(W - 1, Math.floor(bx / step)); i++) {
        if (!seen[j * W + i]) continue;
        const dist = rect ? distToRect(i * step, j * step, rect) : Math.hypot(i * step - x, j * step - y);
        if (dist <= d) return true;
      }
    }
    return false;
  }
}

// ───────────── 가구 둘레 틈 점검 ─────────────
// 가구마다 네 방향으로 가장 가까운 장애물(다른 가구의 막힘 영역, 벽·건물 밖 칸)과의 틈을 잰다.
//  - invisible: 그림 틈이 발 크기 이상으로 보이는데 실제로는 못 지나감 (보이지 않는 벽)
//  - tight: 지나가기는 하지만 발 크기 + 여유(가로 12px·세로 8px)보다 좁아 끼기 쉬움
//  - seethrough: 두 가구 그림이 붙어 있는데(6px 이하) 그 사이로 지나감 (그림은 막혔는데 지나감)
// 가로 틈은 발 폭(2r), 세로 틈은 발 높이(r)를 기준으로 본다. 돌려주는 값: [{ type, text, at:[x,y] }]
export function inspectMap(map, g, radius = 14) {
  const out = [];
  const furn = map.furniture || [];
  const ry = footHalfHeight(radius);
  const need = { x: radius * 2, y: ry * 2 };
  const margin = { x: 12, y: 8 };
  furn.forEach((f, fi) => {
    const F = g.foots[fi];
    const D = drawnRect(f);
    const obstacles = [];
    furn.forEach((o, oi) => {
      if (oi !== fi) obstacles.push({ foot: g.foots[oi], drawn: drawnRect(o), name: o.name, furniture: true });
    });
    const pad = 70;
    const cx0 = Math.max(0, Math.floor((F[0] - pad) / g.cell));
    const cx1 = Math.min(g.cols - 1, Math.floor((F[0] + F[2] + pad) / g.cell));
    const cy0 = Math.max(0, Math.floor((F[1] - pad) / g.cell));
    const cy1 = Math.min(g.rows - 1, Math.floor((F[1] + F[3] + pad) / g.cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (g.cells[cy * g.cols + cx] === FLOOR) continue;
        const rc = [cx * g.cell, cy * g.cell, g.cell, g.cell];
        obstacles.push({ foot: rc, drawn: rc, name: '벽', furniture: false });
      }
    }
    const sides = [
      { key: '왼쪽', axis: 'x', gap: (o) => F[0] - (o[0] + o[2]), vgap: (o) => D[0] - (o[0] + o[2]), at: (o) => [(F[0] + o[0] + o[2]) / 2, F[1] + F[3] / 2] },
      { key: '오른쪽', axis: 'x', gap: (o) => o[0] - (F[0] + F[2]), vgap: (o) => o[0] - (D[0] + D[2]), at: (o) => [(F[0] + F[2] + o[0]) / 2, F[1] + F[3] / 2] },
      { key: '위', axis: 'y', gap: (o) => F[1] - (o[1] + o[3]), vgap: (o) => D[1] - (o[1] + o[3]), at: (o) => [F[0] + F[2] / 2, (F[1] + o[1] + o[3]) / 2] },
      { key: '아래', axis: 'y', gap: (o) => o[1] - (F[1] + F[3]), vgap: (o) => o[1] - (D[1] + D[3]), at: (o) => [F[0] + F[2] / 2, (F[1] + F[3] + o[1]) / 2] },
    ];
    for (const s of sides) {
      // 그 방향으로 마주 보는(가로 틈이면 세로 범위가, 세로 틈이면 가로 범위가 겹치는) 장애물 중 가장 가까운 것
      let best = null;
      for (const o of obstacles) {
        const a = o.foot;
        const overlap = s.axis === 'x' ? a[1] < F[1] + F[3] && a[1] + a[3] > F[1] : a[0] < F[0] + F[2] && a[0] + a[2] > F[0];
        if (!overlap) continue;
        const gap = s.gap(a);
        if (gap < 0 || gap > need[s.axis] + margin[s.axis] + 30) continue;
        if (!best || gap < best.gap) best = { o, gap };
      }
      if (!best) continue;
      const { o, gap } = best;
      const vg = Math.max(0, Math.round(s.vgap(o.drawn)));
      const n = need[s.axis];
      const where = `${f.name}(${f.rect[0]},${f.rect[1]}) ${s.key} ↔ ${o.name}`;
      const at = s.at(o.foot).map(Math.round);
      if (gap < n && gap > 0 && vg >= n) out.push({ type: 'invisible', at, text: `보이지 않는 벽: ${where} — 그림 틈 ${vg}px 인데 막힘 틈 ${gap}px 라 못 지나감` });
      else if (gap >= n && gap < n + margin[s.axis]) out.push({ type: 'tight', at, text: `좁은 틈: ${where} — 막힘 틈 ${gap}px (발 ${n}px + 여유 ${margin[s.axis]}px 보다 좁음)` });
      else if (gap >= n && vg <= 6 && o.furniture && (s.axis === 'x' || s.key === '아래')) out.push({ type: 'seethrough', at, text: `그림은 막혔는데 지나감: ${where} — 그림 틈 ${vg}px, 막힘 틈 ${gap}px` });
    }
  });
  // 같은 틈이 양쪽 가구에서 두 번 잡히면 하나만
  const dup = new Set();
  return out.filter((p) => {
    const k = p.type + p.at.map((v) => Math.round(v / 10)).join(',');
    if (dup.has(k)) return false;
    dup.add(k);
    return true;
  });
}

// ───────────── 장치 팻말·글씨 자리 ─────────────
// 개구멍·미끄럼틀의 그림(구멍·출구 뚜껑·타는 곳 동그라미), 이름 글씨, "누가 탈 수 있나" 팻말이 차지하는 사각형.
// client/maprender.js 는 이 자리에 그리고, validateMap 은 이 자리가 가구·벽·문·랜턴·다른 팻말과 겹치지 않는지 본다.
// 맵 데이터의 장치에 marks 를 적으면 자리를 옮길 수 있다 (모두 장치 기준점에서의 [dx, dy] px, 없으면 아래 기본값):
//   marks.sign       팻말 기둥이 땅에 박힌 곳 (개구멍: 입구 기준 [125, 38], 미끄럼틀: 타는 곳 기준 [-100, 34])
//   marks.label      입구(타는 곳) 이름 글씨 가운데 (개구멍 [0, 44], 미끄럼틀 [0, 52])
//   marks.exitLabels 개구멍 출구마다 글씨 가운데 [[dx, dy], ...] (기본 [0, 40])
//   marks.toLabel    미끄럼틀 도착점 글씨 가운데 (기본 [0, 52])
export const SIGN = { w: 180, h: 46, foot: 16, post: 18 };
// 순간이동(teleport) 장치의 모양 (맵 데이터 style). 없으면 개구멍 모양 (예전 그대로).
//   art: 입구 그림 사각형 [dx, dy, w, h] (입구 기준), label: 이름 글씨 기본 자리, sign: 팻말 기본 자리 (null 이면 팻말 없음),
//   exitArt: 출구 그림 사각형 (null 이면 출구 그림·글씨 없음 — 계단·엘리베이터는 도착한 곳에 짝 장치가 있다)
// 맵 데이터 marks.sign 이 false 면 그 장치는 팻말을 그리지 않는다 (같은 팻말을 두 번 세우지 않게).
export const DEVICE_STYLES = {
  'stairs-up': { what: '올라가는 계단', art: [-50, -90, 100, 110], label: [0, 44], sign: null, exitArt: null },
  'stairs-down': { what: '내려가는 계단', art: [-50, -20, 100, 110], label: [0, -44], sign: null, exitArt: null },
  elevator: { what: '엘리베이터 문', art: [-46, -100, 92, 112], label: [0, 40], sign: [150, 30], exitArt: null },
  tube: { what: '미끄럼 통로 입구', art: [-40, -40, 80, 80], label: [0, 58], sign: [-140, 34], exitArt: [-40, -40, 80, 80], exitLabel: [0, 60] },
};
// 팻말 사각형: 기둥이 박힌 곳 (bx, by), 아래 작은 글씨 foot 가 있으면 그만큼 높다
export function signRect(bx, by, foot) {
  const h = SIGN.h + (foot ? SIGN.foot : 0);
  return [bx - SIGN.w / 2, by - SIGN.post - h, SIGN.w, h + SIGN.post];
}
// 글씨 폭 어림값 (한글은 글자 크기만큼, 빈칸·영문·기호는 더 좁게) — 서버에는 글씨 재는 도구가 없어서 어림한다
export function textWidth(text, size) {
  let w = 0;
  for (const ch of String(text)) w += ch === ' ' ? size * 0.3 : /[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? size : size * 0.6;
  return w;
}
export function textRect(text, cx, cy, size) {
  const w = textWidth(text, size);
  return [cx - w / 2, cy - size * 0.6, w, size * 1.2];
}
// 장치 하나의 그림·글씨·팻말: [{ kind: 'art'|'label'|'sign', what, rect, x, y, text?, size?, foot? }]
export function deviceMarks(d) {
  const m = d.marks || {};
  const at = (p, off) => [p[0] + off[0], p[1] + off[1]];
  const out = [];
  const label = (what, text, p, off, size) => {
    const [x, y] = at(p, off);
    out.push({ kind: 'label', what, text, size, x, y, rect: textRect(text, x, y, size) });
  };
  if (d.type === 'teleport' && DEVICE_STYLES[d.style]) {
    // 모양이 정해진 순간이동 (계단·엘리베이터·미끄럼 통로). 출구가 하나뿐이고 양쪽에 짝 장치가 있으면 출구 그림·글씨는 없다
    const S = DEVICE_STYLES[d.style];
    const [x, y] = d.from;
    const a = S.art;
    out.push({ kind: 'art', what: S.what, x, y, rect: [x + a[0], y + a[1], a[2], a[3]] });
    label('이름 글씨', d.name, d.from, m.label || S.label, 18);
    if (S.sign && m.sign !== false) {
      const [bx, by] = at(d.from, m.sign || S.sign);
      out.push({ kind: 'sign', what: '팻말', x: bx, y: by, foot: '', rect: signRect(bx, by, '') });
    }
    if (S.exitArt) {
      (d.exits || []).forEach((e, i) => {
        const b = S.exitArt;
        out.push({ kind: 'art', what: `출구 ${i + 1}`, x: e[0], y: e[1], rect: [e[0] + b[0], e[1] + b[1], b[2], b[3]] });
        label(`출구 ${i + 1} 글씨`, d.exitName || `${d.name} 출구`, e, (m.exitLabels && m.exitLabels[i]) || S.exitLabel || [0, 60], 18);
      });
    }
    return out;
  }
  if (d.type === 'teleport') {
    const [x, y] = d.from;
    out.push({ kind: 'art', what: '입구 구멍', x, y, rect: [x - 40, y - 26, 80, 52] });
    label('입구 글씨', `${d.name} 입구`, d.from, m.label || [0, 44], 18);
    const n = (d.exits || []).length;
    const foot = n > 1 ? `출구 ${n}곳 중 한 곳으로` : '';
    const [bx, by] = at(d.from, m.sign || [125, 38]);
    out.push({ kind: 'sign', what: '팻말', x: bx, y: by, foot, rect: signRect(bx, by, foot) });
    (d.exits || []).forEach((e, i) => {
      out.push({ kind: 'art', what: `출구 ${i + 1} 뚜껑`, x: e[0], y: e[1], rect: [e[0] - 38, e[1] - 62, 76, 86] });
      label(`출구 ${i + 1} 글씨`, d.exitName || `${d.name} 출구`, e, (m.exitLabels && m.exitLabels[i]) || [0, 40], 18);
    });
  }
  if (d.type === 'slide') {
    const [x, y] = d.from;
    out.push({ kind: 'art', what: '타는 곳', x, y, rect: [x - 34, y - 34, 68, 68] });
    label('타는 곳 글씨', '타는 곳', d.from, m.label || [0, 52], 20);
    const [bx, by] = at(d.from, m.sign || [-100, 34]);
    out.push({ kind: 'sign', what: '팻말', x: bx, y: by, foot: '', rect: signRect(bx, by, '') });
    out.push({ kind: 'art', what: '도착점', x: d.to[0], y: d.to[1], rect: [d.to[0] - 34, d.to[1] - 34, 68, 68] });
    label('도착 글씨', '도착 (타는 곳 아님)', d.to, m.toLabel || [0, 52], 18);
  }
  return out;
}
const rectsOverlap = (a, b, gap = 0) => a[0] < b[0] + b[2] + gap && b[0] < a[0] + a[2] + gap && a[1] < b[1] + b[3] + gap && b[1] < a[1] + a[3] + gap;
// 선분 (ax,ay)-(bx,by) 을 굵기 2*half 로 칠한 띠가 사각형과 겹치는가 (띠 둘레를 점으로 훑는다)
function bandHits(a, b, half, rect) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / 8));
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n;
    const y = a[1] + ((b[1] - a[1]) * i) / n;
    if (distToRect(x, y, rect) < half) return true;
  }
  return false;
}
// 장치 그림·글씨·팻말 겹침 점검: 문제 문장 목록
// 글씨·팻말은 벽·건물 밖·문(앞뒤 20px 포함)·가구 그림(그림자 포함)·랜턴·회의 종·방 이름·다른 장치 글씨/팻말/그림·미끄럼틀 띠와 4px 이상 떨어져야 한다.
// 장치 그림(구멍·뚜껑·동그라미)은 자리가 게임 규칙이라 벽은 보지 않고, 가구·랜턴·다른 글씨와만 겹치지 않으면 된다.
export function inspectDeviceMarks(map, g) {
  const problems = [];
  const GAP = 4;
  const obstacles = [];
  for (const f of map.furniture || []) {
    const D = drawnRect(f);
    obstacles.push({ name: `가구 ${f.name}(${f.rect[0]},${f.rect[1]})`, rect: [D[0], D[1], D[2] + 6, D[3] + 8] });
  }
  for (const d of map.doors || []) obstacles.push({ name: `문 ${d.id}`, rect: [d.rect[0] - 20, d.rect[1] - 20, d.rect[2] + 40, d.rect[3] + 40], door: true });
  for (const t of map.terminals || []) obstacles.push({ name: `랜턴 ${t.id}`, rect: [t.pos[0] - 26, t.pos[1] - 50, 52, 78] });
  const bell = map.bell || map.meetingButton;
  if (bell) obstacles.push({ name: '회의 종', rect: [bell.pos[0] - 42, bell.pos[1] - 80, 84, 146] });
  for (const r of map.rooms || []) {
    if (r.decor === 'court') continue;
    obstacles.push({ name: `방 이름 ${r.name}`, rect: textRect(r.name, r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2, 40), label: true });
  }
  // 방 구석 거미줄 (maprender.js: 왼쪽 위·오른쪽 위·왼쪽 아래, 크기 s·0.8s·0.6s 의 부채꼴). 촘촘한 안쪽 3/4 만 본다
  for (const r of map.rooms || []) {
    const [x, y, w, h] = r.rect;
    const s = Math.min(90, w / 5, h / 3);
    for (const [cx, cy, sx, sy, k] of [[x + 20, y + 20, 1, 1, 1], [x + w - 20, y + 20, -1, 1, 0.8], [x + 20, y + h - 20, 1, -1, 0.6]]) {
      const z = s * k * 0.75;
      obstacles.push({ name: `${r.name} 구석 거미줄`, rect: [sx > 0 ? cx : cx - z, sy > 0 ? cy : cy - z, z, z], label: true });
    }
  }
  for (const z of map.zones || []) {
    if (z.name) obstacles.push({ name: `구역 이름 ${z.name}`, rect: textRect(z.name, z.rect[0] + z.rect[2] / 2, z.rect[1] + z.rect[3] / 2, 30), label: true });
  }
  const marks = [];
  const slides = [];
  for (const d of map.devices || []) {
    for (const mk of deviceMarks(d)) marks.push({ ...mk, device: d.id, name: `장치 ${d.id} ${mk.what}` });
    if (d.type === 'slide') slides.push({ d, pts: [d.from, ...(d.path || []), d.to] });
  }
  marks.forEach((mk, i) => {
    const text = mk.kind !== 'art';
    const gap = text ? GAP : 0;
    if (text) {
      const [x, y, w, h] = mk.rect;
      let wall = false;
      for (let cy = Math.floor(y / g.cell); cy <= Math.floor((y + h - 1) / g.cell) && !wall; cy++) {
        for (let cx = Math.floor(x / g.cell); cx <= Math.floor((x + w - 1) / g.cell) && !wall; cx++) {
          if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows || g.cells[cy * g.cols + cx] !== FLOOR) wall = true;
        }
      }
      if (wall) problems.push(`${mk.name}: 벽이나 건물 밖에 걸린다 (${mk.rect.map(Math.round)})`);
    }
    for (const o of obstacles) {
      if (!text && (o.door || o.label)) continue;
      if (rectsOverlap(mk.rect, o.rect, gap)) problems.push(`${mk.name}: ${o.name} 에 겹친다`);
    }
    for (let k = i + 1; k < marks.length; k++) {
      const o = marks[k];
      if (!text && o.kind === 'art') continue;
      if (rectsOverlap(mk.rect, o.rect, text || o.kind !== 'art' ? GAP : 0)) problems.push(`${mk.name}: ${o.name} 에 겹친다`);
    }
    for (const s of slides) {
      if (s.d.id === mk.device && mk.kind === 'art') continue;
      for (let k = 0; k + 1 < s.pts.length; k++) {
        if (bandHits(s.pts[k], s.pts[k + 1], 32 + gap, mk.rect)) {
          problems.push(`${mk.name}: 미끄럼틀 ${s.d.id} 길에 겹친다`);
          break;
        }
      }
    }
  });
  // 미끄럼틀 길이 랜턴·가구를 덮지 않는가
  for (const s of slides) {
    for (const o of obstacles) {
      if (o.door || o.label) continue;
      for (let k = 0; k + 1 < s.pts.length; k++) {
        if (bandHits(s.pts[k], s.pts[k + 1], 32, o.rect)) {
          problems.push(`미끄럼틀 ${s.d.id} 길: ${o.name} 에 겹친다`);
          break;
        }
      }
    }
  }
  return problems;
}

// 맵 검사: 문제가 있으면 설명 문장 목록을 돌려준다 (없으면 빈 목록)
// 시작 위치에서 실제 캐릭터 크기(발 반지름 radius)로 걸어서 랜턴·회의 종·장치·문 양쪽·보급 상자 후보 가구에 닿는지,
// 가구 사이에 끼는 틈·보이지 않는 벽이 없는지까지 본다. 닿는 거리는 서버 허용 거리보다 10px 짧게 잡는다.
export function validateMap(map, g = buildGrid(map), radius = 14) {
  const problems = [];
  const start = map.spawn.pos;
  if (!canStand(g, start[0], start[1], radius)) problems.push('시작 위치가 막힌 곳이다');
  const walk = walkMap(map, g, radius);
  if (!walk.started) problems.push('시작 위치 둘레에 설 곳이 없다');
  // d = 0: 그 자리에 서야 하는 곳 (장치 출구·도착점). d > 0: 그 거리 안까지 걸어가면 되는 곳
  const reach = (p, what, d = 0) => {
    if (d === 0 ? !canStand(g, p[0], p[1], radius) : cellAt(g, p[0], p[1]) !== FLOOR) problems.push(`${what}: 막힌 곳에 있다`);
    else if (!walk.near(p[0], p[1], Math.max(d, walk.step))) problems.push(`${what}: 걸어서 갈 수 없다${d ? ` (${d}px 안까지 못 감)` : ''}`);
  };
  const TERM = 95 - 10; // server/index.js 의 TERMINAL_REACH(95)보다 10px 짧게
  for (const t of map.terminals || []) reach(t.pos, `랜턴 ${t.id}`, TERM);
  if (map.bell) reach(map.bell.pos, '회의 종', (MAFIA.buttonReach || 90) - 10);
  if (map.meetingButton) problems.push('meetingButton 은 bell 로 이름이 바뀌었다');
  // 잠 안개 후보 (06 명세 6-2절): ① 중심이 설 수 있고 갈 수 있는 곳
  // ② 임시 랜턴 자리가 갈 수 있는 곳이고 마지막 반지름 안 ③ 마지막 반지름 안에 갈 수 있는 칸이 있다
  const fog = map.fog;
  // 층: 이름·사각형, 서로 겹치지 않고 FLOOR_GAP 이상 떨어져 있는가. 방·복도·랜턴·장치가 모두 어느 층 안에 있는가
  const floors = map.floors || [];
  if (map.floors && !Array.isArray(map.floors)) problems.push('floors 는 목록이어야 한다');
  floors.forEach((f, i) => {
    if (f.id == null || !f.name || !Array.isArray(f.rect) || f.rect.length !== 4) problems.push(`층 ${i + 1}: id·name·rect 가 필요하다`);
    if (floors.findIndex((o) => o.id === f.id) !== i) problems.push(`층 ${f.id}: id 가 겹친다`);
    for (let k = i + 1; k < floors.length; k++) {
      const o = floors[k];
      if (!Array.isArray(f.rect) || !Array.isArray(o.rect)) continue;
      const gx = Math.max(o.rect[0] - (f.rect[0] + f.rect[2]), f.rect[0] - (o.rect[0] + o.rect[2]));
      const gy = Math.max(o.rect[1] - (f.rect[1] + f.rect[3]), f.rect[1] - (o.rect[1] + o.rect[3]));
      if (Math.max(gx, gy) < FLOOR_GAP) problems.push(`층 ${f.id}·${o.id}: 서로 ${FLOOR_GAP}px 이상 떨어져야 한다 (지금 ${Math.max(gx, gy)}px)`);
    }
  });
  if (floors.length) {
    const inside = (r) => floors.some((f) => r[0] >= f.rect[0] && r[1] >= f.rect[1] && r[0] + r[2] <= f.rect[0] + f.rect[2] && r[1] + r[3] <= f.rect[1] + f.rect[3]);
    for (const r of map.rooms || []) if (!inside(r.rect)) problems.push(`방 ${r.name}: 어느 층에도 다 들어 있지 않다`);
    for (const k of map.corridors || []) if (!inside(k.rect)) problems.push(`복도 ${k.id}: 어느 층에도 다 들어 있지 않다`);
    const pts = [...(map.terminals || []).map((t) => [`랜턴 ${t.id}`, t.pos]), ['시작 위치', start]];
    for (const d of map.devices || []) {
      pts.push([`장치 ${d.id} 입구`, d.from]);
      for (const e of d.type === 'slide' ? [d.to] : d.exits || []) pts.push([`장치 ${d.id} 출구`, e]);
    }
    for (const [what, p] of pts) if (Array.isArray(p) && !floorAt(map, p[0], p[1])) problems.push(`${what}: 어느 층에도 없다`);
  }
  if (fog && fog.mode === 'floors') {
    // 층 단위 안개: safe[i] = (i+1)단계가 시작된 뒤 안전한 층 id 목록. bonus = 마지막 밤 임시 랜턴 자리 (마지막 단계에 안전한 층)
    if (!floors.length) problems.push('fog: 층 단위 안개(mode floors)인데 floors 가 없다');
    const ids = floors.map((f) => f.id);
    if (!Array.isArray(fog.safe) || fog.safe.length !== FOG.stages.length) problems.push(`fog.safe: 단계 수(${FOG.stages.length})만큼 안전한 층 목록이 있어야 한다`);
    (fog.safe || []).forEach((list, i) => {
      if (!Array.isArray(list) || !list.length) problems.push(`fog.safe ${i + 1}단계: 안전한 층이 하나는 있어야 한다`);
      else if (list.some((id) => !ids.includes(id))) problems.push(`fog.safe ${i + 1}단계: 모르는 층 id (${list.join(',')})`);
      if (i && Array.isArray(list) && Array.isArray(fog.safe[i - 1]) && list.some((id) => !fog.safe[i - 1].includes(id))) problems.push(`fog.safe ${i + 1}단계: 앞 단계에 어두웠던 층이 다시 안전해진다`);
    });
    const lastSafe = (fog.safe || []).at(-1) || [];
    if (!Array.isArray(fog.bonus) || fog.bonus.length < FOG.bonusCount) problems.push(`fog: 임시 랜턴 자리가 ${FOG.bonusCount}개보다 적다`);
    (fog.bonus || []).forEach((b, k) => {
      reach(b, `층 안개 임시 랜턴 ${k + 1}`, TERM);
      const fl = floorAt(map, b[0], b[1]);
      if (!fl || !lastSafe.includes(fl.id)) problems.push(`층 안개 임시 랜턴 ${k + 1}: 마지막 단계에 안전한 층 밖이다`);
    });
  } else if (fog) {
    const radii = fog.radii || FOG.radii;
    const lastR = radii[radii.length - 1];
    if (!Array.isArray(fog.centers) || !fog.centers.length) problems.push('fog: 후보 중심(centers)이 없다');
    (fog.centers || []).forEach((c, i) => {
      const what = `안개 후보 ${i + 1}`;
      if (!canStand(g, c.pos[0], c.pos[1], radius)) problems.push(`${what}: 중심에 설 수 없다`);
      reach(c.pos, `${what} 중심`, TERM);
      if (!Array.isArray(c.bonus) || c.bonus.length < FOG.bonusCount) problems.push(`${what}: 임시 랜턴 자리가 ${FOG.bonusCount}개보다 적다`);
      (c.bonus || []).forEach((b, k) => {
        reach(b, `${what} 임시 랜턴 ${k + 1}`, TERM);
        if (Math.hypot(b[0] - c.pos[0], b[1] - c.pos[1]) > lastR) problems.push(`${what} 임시 랜턴 ${k + 1}: 마지막 빛 구역(반지름 ${lastR}) 밖이다`);
      });
      if (!walk.near(c.pos[0], c.pos[1], lastR)) problems.push(`${what}: 마지막 빛 구역 안에 걸어서 갈 수 있는 칸이 없다`);
    });
  }
  for (const d of map.devices || []) {
    for (const [mode, list] of Object.entries(d.who || {})) {
      if (!MODES.some((x) => x.id === mode)) problems.push(`장치 ${d.id}: who 에 모르는 모드 '${mode}' (${MODES.map((x) => x.id).join('·')} 만 쓴다)`);
      for (const role of list || []) {
        if (!ROLES.includes(role)) problems.push(`장치 ${d.id}: who.${mode} 에 모르는 역할 '${role}' (student·chaser 만 쓴다)`);
      }
    }
    reach(d.from, `장치 ${d.id} 입구`, (CHASE.deviceReach || 80) - 10);
    if (d.type === 'teleport') {
      if (!d.exits || !d.exits.length) problems.push(`장치 ${d.id}: 출구가 없다`);
      (d.exits || []).forEach((e, i) => reach(e, `장치 ${d.id} 출구 ${i + 1}`));
    }
    if (d.type === 'slide') reach(d.to, `장치 ${d.id} 도착점`);
  }
  // 문: 양쪽 모두 걸어서 닿아야 한다 (문 앞이 가구로 막히지 않았나)
  for (const d of map.doors || []) {
    const [x, y, w, h] = d.rect;
    // 문 양옆(왼쪽·오른쪽 칸)이 모두 바닥이면 가로로 지나는 문, 아니면 세로로 지나는 문
    const across = cellAt(g, x - 10, y + h / 2) === FLOOR && cellAt(g, x + w + 10, y + h / 2) === FLOOR;
    const pts = across ? [[x - 20, y + h / 2], [x + w + 20, y + h / 2]] : [[x + w / 2, y - 20], [x + w / 2, y + h + 20]];
    pts.forEach((p, i) => {
      if (!walk.near(p[0], p[1], 20)) problems.push(`문 ${d.id}: ${across ? (i ? '오른쪽' : '왼쪽') : i ? '아래쪽' : '위쪽'} 문 앞에 갈 수 없다`);
    });
  }
  for (const r of map.rooms || []) {
    const c = [r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2];
    if (!walk.near(0, 0, 0, r.rect)) problems.push(`방 ${r.name}: 들어갈 문이 없다 (${c})`);
  }
  // 보급 상자 후보 (방 안 가구): 둘레에 걸어서 닿아야 한다
  const lootReach = (LOOT.openReach || 90) - 10;
  (map.furniture || []).forEach((f) => {
    const [x, y, w, h] = f.rect;
    const inRoom = (map.rooms || []).some((r) => x >= r.rect[0] && y >= r.rect[1] && x + w <= r.rect[0] + r.rect[2] && y + h <= r.rect[1] + r.rect[3]);
    if (inRoom && !walk.near(0, 0, lootReach, f.rect)) problems.push(`가구 ${f.name}(${x},${y}): ${lootReach}px 안까지 걸어서 갈 수 없다 (보급 상자를 못 연다)`);
  });
  // 가구 둘레 틈 (보이지 않는 벽·끼는 틈·그림은 막혔는데 지나가는 틈)
  for (const p of inspectMap(map, g, radius)) problems.push(p.text);
  // 장치 팻말·글씨가 가구·벽·문·랜턴·다른 팻말과 겹치지 않는가
  for (const p of inspectDeviceMarks(map, g)) problems.push(p);
  return problems;
}

