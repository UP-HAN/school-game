// QR코드 만들기 (선생님 대기방의 초대 주소용). 바깥 라이브러리 없이 QR 규격(ISO/IEC 18004)을 보고 직접 쓴 코드.
// 지원 범위: 바이트 모드, 오류 정정 M, 버전 1~6 (글자 106바이트까지). 초대 주소는 40~60바이트라 넉넉하다.

// 버전 1~6 · 오류 정정 M 의 표 (index 0 = 버전 1)
const DATA_WORDS = [16, 28, 44, 64, 86, 108]; // 데이터 코드워드 수
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16]; // 블록 하나의 오류 정정 코드워드 수
const BLOCKS = [1, 1, 1, 2, 2, 4]; // 블록 수
export const QR_MAX_BYTES = DATA_WORDS.map((d) => d - 2); // 모드 4비트 + 길이 8비트 = 2바이트를 뺀 글자 용량

// ───── GF(256) 곱셈과 리드–솔로몬 ─────
export function gfMul(a, b) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z;
}
// 생성 다항식 (x-α^0)(x-α^1)…(x-α^(n-1)) 의 계수 (최고차 1 은 빼고 n개)
function rsDivisor(n) {
  const out = new Array(n).fill(0);
  out[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < n) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}
/** 데이터 코드워드 → 오류 정정 코드워드 n개 */
export function rsRemainder(data, n) {
  const div = rsDivisor(n);
  const out = new Array(n).fill(0);
  for (const b of data) {
    const f = b ^ out.shift();
    out.push(0);
    for (let i = 0; i < n; i++) out[i] ^= gfMul(div[i], f);
  }
  return out;
}

/** 형식 정보 15비트 (오류 정정 M = 00, 마스크 0~7). BCH(15,5) + 0x5412 */
export function formatBits(mask) {
  const data = mask & 7; // M 의 두 비트는 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** 글자 → 코드워드 전체(데이터 + 오류 정정, 섞어 놓은 순서)와 버전 */
export function qrCodewords(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  const vi = QR_MAX_BYTES.findIndex((c) => bytes.length <= c);
  if (vi < 0) throw new Error('QR코드에 담기에는 글자가 너무 길어요.');
  const total = DATA_WORDS[vi];
  const bits = [];
  const put = (v, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(4, 4); // 바이트 모드
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, total * 8 - bits.length)); // 끝 표시
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad);
  // 블록으로 나눠 오류 정정을 붙이고, 블록끼리 한 칸씩 번갈아 섞는다
  const nb = BLOCKS[vi];
  const per = total / nb;
  const blocks = [];
  for (let b = 0; b < nb; b++) {
    const d = data.slice(b * per, (b + 1) * per);
    blocks.push({ d, e: rsRemainder(d, EC_PER_BLOCK[vi]) });
  }
  const out = [];
  for (let i = 0; i < per; i++) for (const b of blocks) out.push(b.d[i]);
  for (let i = 0; i < EC_PER_BLOCK[vi]; i++) for (const b of blocks) out.push(b.e[i]);
  return { version: vi + 1, codewords: out, data };
}

// 벌점 (규격의 네 가지 규칙). 낮을수록 잘 읽힌다
function penalty(m) {
  const n = m.length;
  let p = 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    // 규칙 1: 같은 색이 5칸 이상 이어짐
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    // 규칙 3: 찾기 무늬처럼 보이는 1:1:3:1:1 (앞이나 뒤에 흰 칸 4개)
    for (let i = 0; i + 11 <= n; i++) {
      const s = line.slice(i, i + 11).map((v) => (v ? 1 : 0)).join('');
      if (s === '10111010000' || s === '00001011101') p += 40;
    }
  }
  // 규칙 2: 2×2 같은 색
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  // 규칙 4: 검은 칸 비율이 50% 에서 멀수록
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/**
 * 글자 → QR 무늬. 돌려주는 값: true(검은 칸)/false(흰 칸) 의 정사각 배열 [행][열]. 둘레 여백은 들어 있지 않다.
 * forceMask: 시험용 (0~7 을 주면 그 마스크로 고정)
 */
export function qrMatrix(text, forceMask) {
  const { version, codewords } = qrCodewords(text);
  const n = 17 + 4 * version;
  const base = Array.from({ length: n }, () => new Array(n).fill(false));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false)); // 데이터가 들어가지 않는 칸
  const setF = (x, y, v) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    base[y][x] = v;
    fn[y][x] = true;
  };
  // 타이밍 무늬
  for (let i = 0; i < n; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }
  // 찾기 무늬 3개 (둘레 흰 띠 포함)
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setF(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  // 정렬 무늬 (버전 2~6 은 오른쪽 아래 하나)
  if (version >= 2) {
    const c = 4 * version + 10;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // 형식 정보 자리를 미리 잡아 둔다 (값은 마스크를 고른 뒤 채움)
  const putFormat = (m, mask) => {
    const bits = formatBits(mask);
    const bit = (i) => ((bits >>> i) & 1) === 1;
    const set = (x, y, v) => {
      m[y][x] = v;
      fn[y][x] = true;
    };
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(i));
    set(8, n - 8, true); // 항상 검은 칸
  };
  putFormat(base, 0);
  // 데이터: 오른쪽 아래에서 두 줄씩 지그재그로 올라갔다 내려온다 (세로 타이밍 줄은 건너뜀)
  let k = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? n - 1 - v : v;
        if (fn[y][x]) continue;
        if (k < codewords.length * 8) base[y][x] = ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
  }
  // 마스크 8가지를 모두 해 보고 벌점이 가장 낮은 것을 고른다
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask != null && mask !== forceMask) continue;
    const m = base.map((row) => row.slice());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    putFormat(m, mask);
    const p = penalty(m);
    if (!best || p < best.p) best = { m, p, mask };
  }
  best.m.mask = best.mask;
  best.m.version = version;
  return best.m;
}

/** 캔버스에 QR코드를 그린다 (흰 바탕 + 둘레 여백 4칸). 못 그리면 false */
export function drawQr(canvas, text, { quiet = 4, scale = 8 } = {}) {
  let m;
  try {
    m = qrMatrix(text);
  } catch {
    return false;
  }
  const n = m.length + quiet * 2;
  canvas.width = n * scale;
  canvas.height = n * scale;
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#000000';
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) c.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  return true;
}
