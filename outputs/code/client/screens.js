// 시작 로딩 화면(showLoading)과 끝 연출 화면(showEnding). 그림은 캐릭터 그리기 코드를 다시 써서 캔버스로 그린다.
import { CHARACTERS, COLORS } from './shared/config.js';
import { drawCharacter, drawMoon } from './characters.js';
import { drawLantern } from './maprender.js';
import { tipsFor } from './tips.js';

const $ = (id) => document.getElementById(id);
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}
function sky(c, w, h, top, bottom) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}
function starsBg(c, w, h, t, alpha = 1) {
  for (let i = 0; i < 70; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 24634.6345;
    const x = (a - Math.floor(a)) * w;
    const y = (b - Math.floor(b)) * h * 0.65;
    c.globalAlpha = alpha * (0.4 + Math.abs(Math.sin(t * 1.5 + i)) * 0.6);
    c.fillStyle = '#fff6e5';
    c.fillRect(x, y, 2.5, 2.5);
  }
  c.globalAlpha = 1;
}
function ground(c, w, h, color) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, h * 0.8);
  c.quadraticCurveTo(w / 2, h * 0.72, w, h * 0.8);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.closePath();
  c.fill();
}

let loadingRun = 0;
/** 시작 로딩 화면. 끝나면 resolve. { mode, modeName, mapName, ms } */
export function showLoading({ mode, modeName, mapName, ms = 3500 }) {
  const run = ++loadingRun;
  const el = $('g-loading');
  const cv = $('g-loading-canvas');
  $('g-loading-mode').textContent = modeName || '';
  $('g-loading-map').textContent = mapName || '';
  const tips = tipsFor(mode);
  let tipIndex = 0;
  $('g-loading-tip').textContent = tips[0] || '';
  el.hidden = false;
  const start = performance.now();
  const crew = CHARACTERS.map((ch, i) => ({ kind: ch.id, color: COLORS[(i * 3 + 2) % COLORS.length].hex, seed: i * 0.7 }));
  return new Promise((resolve) => {
    let lastTip = start;
    function frame(now) {
      if (run !== loadingRun) return resolve();
      const k = Math.min(1, (now - start) / ms);
      $('g-loading-fill').style.width = Math.round(k * 100) + '%';
      if (now - lastTip > 2000 && tips.length > 1) {
        lastTip = now;
        tipIndex = (tipIndex + 1) % tips.length;
        $('g-loading-tip').textContent = tips[tipIndex];
      }
      const { c, w, h } = fitCanvas(cv);
      const t = reduced() ? 0 : now / 1000;
      sky(c, w, h, '#1f2a52', '#3b3f7a');
      starsBg(c, w, h, t);
      drawMoon(c, w * 0.85, h * 0.14, Math.min(w, h) * 0.06, 0.4);
      ground(c, w, h, '#2b2a5c');
      // 랜턴을 든 친구들이 줄지어 걸어간다
      const size = Math.max(70, Math.min(120, h * 0.14));
      const span = w + size * 3;
      crew.forEach((p, i) => {
        const x = ((t * 60 + (i / crew.length) * span) % span) - size;
        const y = h * 0.93;
        drawCharacter(c, { kind: p.kind, color: p.color, x, y, size, t, seed: p.seed, moving: true });
        drawLantern(c, x + size * 0.32, y - size * 0.32, true, size / 150);
      });
      if (k < 1) requestAnimationFrame(frame);
      else {
        el.hidden = true;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
export function hideLoading() {
  loadingRun++;
  $('g-loading').hidden = true;
}

let endingRun = 0;
/**
 * 끝 연출 화면. { result: 'win'|'lose'|'neutral', title, sub, chars: [{ kind, color(hex) }], horns, ms }
 * 이긴 쪽이면 새벽빛 배경 + 통통 뛰는 캐릭터 + 꽃가루, 진 쪽이면 어두운 배경 + 풀 죽은 캐릭터.
 */
export function showEnding({ result, title, sub, chars = [], horns = false, ms = 3800 }) {
  const run = ++endingRun;
  const el = $('g-ending');
  const cv = $('g-ending-canvas');
  el.classList.toggle('lose', result === 'lose');
  el.classList.toggle('neutral', result === 'neutral');
  $('g-ending-title').textContent = title || '';
  $('g-ending-sub').textContent = sub || '';
  el.hidden = false;
  const start = performance.now();
  const bright = result !== 'lose';
  const confetti = Array.from({ length: bright ? 90 : 0 }, (_, i) => ({
    x: Math.random(),
    d: 0.4 + Math.random() * 0.8,
    s: 5 + Math.random() * 7,
    c: ['#ffb547', '#7fe0c4', '#ff9ec4', '#5cc8f2', '#ffd84d', '#9b6bf2'][i % 6],
    r: Math.random() * 6,
  }));
  return new Promise((resolve) => {
    function frame(now) {
      if (run !== endingRun) return resolve();
      const e = now - start;
      const { c, w, h } = fitCanvas(cv);
      const t = reduced() ? 0 : now / 1000;
      if (bright) {
        sky(c, w, h, '#ffb98a', '#fff1c9'); // 새벽빛
        const sun = c.createRadialGradient(w / 2, h * 0.78, 10, w / 2, h * 0.78, h * 0.6);
        sun.addColorStop(0, 'rgba(255,246,229,1)');
        sun.addColorStop(1, 'rgba(255,246,229,0)');
        c.fillStyle = sun;
        c.fillRect(0, 0, w, h);
        ground(c, w, h, '#ffd29a');
      } else {
        sky(c, w, h, '#14182f', '#2e2a55');
        starsBg(c, w, h, t, 0.6);
        c.fillStyle = 'rgba(155,107,242,0.18)'; // 안개
        for (let i = 0; i < 6; i++) {
          c.beginPath();
          c.ellipse(((i * 0.23 + t * 0.02) % 1.2) * w, h * (0.6 + (i % 3) * 0.08), w * 0.25, h * 0.06, 0, 0, Math.PI * 2);
          c.fill();
        }
        ground(c, w, h, '#1d1b3d');
      }
      const list = chars.length ? chars : [{ kind: 'kid', color: '#ffb547' }];
      // 가로로 눕힌 휴대폰처럼 낮은 화면에서는 캐릭터가 글자를 가리지 않게 높이에 맞춰 줄인다
      const size = Math.max(Math.min(70, h * 0.2), Math.min(140, h * 0.26, (w * 0.8) / Math.max(4, list.length)));
      const gap = Math.min(size * 1.1, (w * 0.86) / list.length);
      list.forEach((p, i) => {
        const x = w / 2 + (i - (list.length - 1) / 2) * gap;
        const jump = bright && result === 'win' ? Math.abs(Math.sin(t * 6 + i * 0.7)) * size * 0.22 : 0;
        const y = h * 0.86 - jump;
        if (!bright) {
          // 풀 죽은 모습: 고개를 숙이고 살짝 기운다
          c.save();
          c.translate(x, y);
          c.rotate(Math.sin(i) * 0.08 + 0.12);
          c.globalAlpha = 0.85;
          drawCharacter(c, { kind: p.kind, color: p.color, x: 0, y: 0, size: size * 0.92, t: 0, seed: i, moving: false });
          c.restore();
          c.globalAlpha = 1;
        } else drawCharacter(c, { kind: p.kind, color: p.color, x, y, size, t, seed: i, moving: result === 'win' });
        if (horns) {
          const top = y - size * (p.kind === 'slime' ? 0.72 : 1) - 2;
          c.fillStyle = '#9b6bf2';
          c.strokeStyle = '#2a2140';
          c.lineWidth = 3;
          for (const s of [-1, 1]) {
            c.beginPath();
            c.moveTo(x + s * 10, top);
            c.lineTo(x + s * 24, top);
            c.lineTo(x + s * 20, top - 22);
            c.closePath();
            c.fill();
            c.stroke();
          }
        }
      });
      // 꽃가루
      for (const f of confetti) {
        const y = ((e / 1000) * f.d * 0.35 + f.x * 0.7) % 1.1;
        c.save();
        c.translate(f.x * w + Math.sin(t * 2 + f.r) * 20, y * h - 20);
        c.rotate(t * 3 + f.r);
        c.fillStyle = f.c;
        c.fillRect(-f.s / 2, -f.s / 4, f.s, f.s / 2);
        c.restore();
      }
      if (e < ms) requestAnimationFrame(frame);
      else {
        el.hidden = true;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
export function hideEnding() {
  endingRun++;
  $('g-ending').hidden = true;
}
