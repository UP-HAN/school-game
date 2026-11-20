// 맵 데이터를 20px 격자로 바꾸고, 그 격자로 "여기 서 있을 수 있나"를 계산한다.
// 서버(위치 검사)와 화면(이동·그리기)이 같은 코드를 쓴다.

export const VOID = 0; // 건물 밖
export const FLOOR = 1; // 걸을 수 있는 바닥
export const WALL = 2; // 벽
export const BLOCK = 3; // 가구 (바닥 위에 놓인 막힌 칸)

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
  for (const f of map.furniture || []) fill(f.rect, BLOCK);
  return { cell, cols, rows, cells };
}

export function cellAt(g, x, y) {
  const cx = Math.floor(x / g.cell);
  const cy = Math.floor(y / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return VOID;
  return g.cells[cy * g.cols + cx];
}

// 발밑 가운데가 (x, y) 이고 반지름이 r 인 캐릭터가 서 있을 수 있는가
export function canStand(g, x, y, r) {
  const x0 = Math.floor((x - r) / g.cell);
  const x1 = Math.floor((x + r) / g.cell);
  const y0 = Math.floor((y - r) / g.cell);
  const y1 = Math.floor((y + r) / g.cell);
  if (x0 < 0 || y0 < 0 || x1 >= g.cols || y1 >= g.rows) return false;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) if (g.cells[cy * g.cols + cx] !== FLOOR) return false;
  }
  return true;
}

export function zoneAt(map, x, y) {
  for (const z of map.zones || []) {
    const [zx, zy, zw, zh] = z.rect;
    if (x >= zx && x < zx + zw && y >= zy && y < zy + zh) return z;
  }
  return null;
}

// 시작할 때 서는 자리: 시작 위치 둘레에 동그랗게
export function spawnPoint(map, index, total) {
  const [sx, sy] = map.spawn.pos;
  const a = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  const r = map.spawn.radius || 100;
  return [Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r)];
}

// 맵 검사: 문제가 있으면 설명 문장 목록을 돌려준다 (없으면 빈 목록)
export function validateMap(map, g = buildGrid(map), radius = 14) {
  const problems = [];
  const start = map.spawn.pos;
  if (!canStand(g, start[0], start[1], radius)) problems.push('시작 위치가 막힌 곳이다');
  // 시작 위치에서 걸어서 갈 수 있는 칸을 모두 칠한다
  const seen = new Uint8Array(g.cells.length);
  const idx = (x, y) => Math.floor(y / g.cell) * g.cols + Math.floor(x / g.cell);
  const stack = [idx(start[0], start[1])];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop();
    const cx = i % g.cols;
    const cy = (i - cx) / g.cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows) continue;
      const n = ny * g.cols + nx;
      if (!seen[n] && g.cells[n] === FLOOR) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  const reach = (p, what) => {
    if (cellAt(g, p[0], p[1]) !== FLOOR) problems.push(`${what}: 막힌 곳에 있다`);
    else if (!seen[idx(p[0], p[1])]) problems.push(`${what}: 걸어서 갈 수 없다`);
  };
  for (const t of map.terminals || []) reach(t.pos, `단말기 ${t.id}`);
  if (map.meetingButton) reach(map.meetingButton.pos, '긴급회의 버튼');
  for (const d of map.devices || []) {
    reach(d.from, `장치 ${d.id} 입구`);
    if (d.type === 'teleport') {
      if (!d.exits || !d.exits.length) problems.push(`장치 ${d.id}: 출구가 없다`);
      (d.exits || []).forEach((e, i) => reach(e, `장치 ${d.id} 출구 ${i + 1}`));
    }
    if (d.type === 'slide') reach(d.to, `장치 ${d.id} 도착점`);
  }
  for (const r of map.rooms || []) {
    const c = [r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2];
    let ok = false;
    for (let y = r.rect[1]; y < r.rect[1] + r.rect[3] && !ok; y += g.cell) {
      for (let x = r.rect[0]; x < r.rect[0] + r.rect[2] && !ok; x += g.cell) ok = !!seen[idx(x, y)];
    }
    if (!ok) problems.push(`방 ${r.name}: 들어갈 문이 없다 (${c})`);
  }
  return problems;
}
