// QR코드 만들기(client/qr.js) 자동 시험. 실행: node server/test-qr.js
// 1) 규격에 실린 알려진 값(형식 정보, 리드–솔로몬 예시)과 맞는지
// 2) 만든 무늬를 이 파일 안의 '읽는 쪽' 코드(만드는 쪽과 따로 쓴 것)로 다시 읽어 같은 글자가 나오는지
import { makeChecker } from './testkit.js';
import { qrMatrix, qrCodewords, rsRemainder, formatBits, gfMul, QR_MAX_BYTES } from '../client/qr.js';

const T = makeChecker('QR코드');
const { check } = T;

// ───── 1. 알려진 값 ─────
// 형식 정보: 오류 정정 M 의 마스크 0~7 (QR 규격 부록의 표)
const FORMAT_M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
check('형식 정보 15비트가 규격 표와 같다 (M, 마스크 0~7)', FORMAT_M.every((s, m) => formatBits(m).toString(2).padStart(15, '0') === s), FORMAT_M.map((_, m) => formatBits(m).toString(2).padStart(15, '0')).join());
// 리드–솔로몬: 널리 쓰이는 예시 (버전 1-M "HELLO WORLD" 의 데이터 16개 → 오류 정정 10개)
const HELLO = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
const HELLO_EC = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
check('리드–솔로몬 오류 정정 값이 알려진 예시와 같다', rsRemainder(HELLO, 10).join() === HELLO_EC.join(), rsRemainder(HELLO, 10).join());
check('GF(256) 곱셈: 2·128 = 29, 3·7 = 9', gfMul(2, 128) === 29 && gfMul(3, 7) === 9);
check('글자 용량: 버전 1~6 = 14·26·42·62·84·106 바이트', QR_MAX_BYTES.join() === '14,26,42,62,84,106');

// ───── 2. 읽는 쪽 (따로 쓴 코드) ─────
const EXP = [];
const LOG = [];
for (let i = 0, v = 1; i < 255; i++) {
  EXP[i] = v;
  LOG[v] = i;
  v <<= 1;
  if (v & 0x100) v ^= 0x11d;
}
const mul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);
// 코드워드 블록(데이터 + 오류 정정)이 올바르면 α^0..α^(n-1) 을 넣은 값이 모두 0
const syndromesZero = (block, n) => {
  for (let s = 0; s < n; s++) {
    let acc = 0;
    for (const c of block) acc = mul(acc, EXP[s]) ^ c;
    if (acc) return false;
  }
  return true;
};
const SPEC = { 1: [16, 10, 1], 2: [28, 16, 1], 3: [44, 26, 1], 4: [64, 18, 2], 5: [86, 24, 2], 6: [108, 16, 4] };
const MASK = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
function readQr(m) {
  const n = m.length;
  const v = (n - 17) / 4;
  if (!SPEC[v]) return { error: '크기 ' + n };
  const at = (r, c) => (m[r][c] ? 1 : 0);
  // 찾기 무늬 3개 (7×7) 와 둘레 흰 띠
  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (r0 + r < 0 || c0 + c < 0 || r0 + r >= n || c0 + c >= n) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        if (at(r0 + r, c0 + c) !== (ring === 2 || ring === 4 ? 0 : 1)) return false;
      }
    }
    return true;
  };
  if (!finder(0, 0) || !finder(0, n - 7) || !finder(n - 7, 0)) return { error: '찾기 무늬' };
  for (let i = 8; i < n - 8; i++) if (at(6, i) !== (i + 1) % 2 || at(i, 6) !== (i + 1) % 2) return { error: '타이밍 무늬' };
  if (!at(n - 8, 8)) return { error: '검은 칸' };
  // 형식 정보 두 벌 (가장 높은 비트부터 읽는 순서)
  const A = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const B = [[n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8], [8, n - 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1]];
  const fa = A.map(([r, c]) => at(r, c)).join('');
  const fb = B.map(([r, c]) => at(r, c)).join('');
  if (fa !== fb) return { error: '형식 정보 두 벌이 다름 ' + fa + ' ' + fb };
  const mask = FORMAT_M.indexOf(fa);
  if (mask < 0) return { error: '형식 정보 ' + fa };
  // 데이터가 아닌 칸
  const reserved = (r, c) => {
    if (r === 6 || c === 6) return true;
    if (r <= 8 && c <= 8) return true;
    if (r <= 8 && c >= n - 8) return true;
    if (r >= n - 8 && c <= 8) return true;
    if (v >= 2) {
      const a = n - 7;
      if (Math.abs(r - a) <= 2 && Math.abs(c - a) <= 2) return true;
    }
    return false;
  };
  if (v >= 2) {
    const a = n - 7;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (at(a + dr, a + dc) !== (Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1)) return { error: '정렬 무늬' };
  }
  // 오른쪽 아래부터 두 줄씩, 위로 갔다 아래로 갔다
  const bits = [];
  let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let k = 0; k < n; k++) {
      const r = up ? n - 1 - k : k;
      for (const cc of [c, c - 1]) if (!reserved(r, cc)) bits.push(at(r, cc) ^ (MASK[mask](r, cc) ? 1 : 0));
    }
    up = !up;
  }
  const [dataN, ecN, nb] = SPEC[v];
  const total = dataN + ecN * nb;
  if (bits.length < total * 8 || bits.length - total * 8 > 7) return { error: `칸 수 ${bits.length} / ${total * 8}` };
  const words = [];
  for (let i = 0; i < total; i++) words.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2));
  const per = dataN / nb;
  const blocks = Array.from({ length: nb }, () => []);
  let k = 0;
  for (let i = 0; i < per; i++) for (let b = 0; b < nb; b++) blocks[b].push(words[k++]);
  for (let i = 0; i < ecN; i++) for (let b = 0; b < nb; b++) blocks[b].push(words[k++]);
  if (!blocks.every((b) => syndromesZero(b, ecN))) return { error: '오류 정정 값이 맞지 않음' };
  const data = blocks.flatMap((b) => b.slice(0, per));
  const stream = data.map((w) => w.toString(2).padStart(8, '0')).join('');
  if (stream.slice(0, 4) !== '0100') return { error: '모드 ' + stream.slice(0, 4) };
  const len = parseInt(stream.slice(4, 12), 2);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(parseInt(stream.slice(12 + i * 8, 20 + i * 8), 2));
  return { text: new TextDecoder().decode(new Uint8Array(bytes)), version: v, mask };
}

const SAMPLES = [
  ['a', 1],
  ['https://x.kr/', 1],
  ['https://lab.ches.es.kr/lantern/', 3],
  ['https://lab.ches.es.kr/lantern/?room=1234', 3],
  ['http://localhost:3210/?room=0042', 3],
  ['https://example-school-site.kr/some/longer/path/lantern/?room=9876', 5],
  ['한밤의 랜턴 대작전 https://lab.ches.es.kr/lantern/?room=1234 놀러 와요', 5],
  ['x'.repeat(106), 6],
];
for (const [text, wantV] of SAMPLES) {
  const m = qrMatrix(text);
  const r = readQr(m);
  check(`다시 읽으면 같은 글자 (버전 ${wantV}, ${new TextEncoder().encode(text).length}바이트)`, r.text === text && r.version === wantV && m.length === 17 + 4 * wantV, JSON.stringify(r).slice(0, 160));
}
// 마스크 8가지 모두 읽힌다
{
  const text = 'https://lab.ches.es.kr/lantern/?room=1234';
  const bad = [];
  for (let k = 0; k < 8; k++) {
    const r = readQr(qrMatrix(text, k));
    if (r.text !== text || r.mask !== k) bad.push(k + ':' + JSON.stringify(r));
  }
  check('마스크 0~7 어느 것으로 만들어도 읽힌다', bad.length === 0, bad.join(' / '));
}
// 방 번호 1만 개를 다 만들어 보지는 않고 200개만: 모두 버전 3, 다시 읽힘
{
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const text = `https://lab.ches.es.kr/lantern/?room=${String((i * 53) % 10000).padStart(4, '0')}`;
    const r = readQr(qrMatrix(text));
    if (r.text !== text || r.version !== 3) bad++;
  }
  check('방 번호 200개의 초대 주소가 모두 다시 읽힌다', bad === 0, String(bad));
}
check('데이터 코드워드 수: 버전 3 은 44개 + 오류 정정 26개', qrCodewords('https://lab.ches.es.kr/lantern/?room=1234').codewords.length === 70);
let threw = false;
try {
  qrMatrix('x'.repeat(107));
} catch {
  threw = true;
}
check('너무 긴 글자(107바이트)는 오류로 알린다', threw);
T.finish();
