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

// 로딩·끝 화면 배경 그림을 미리 받아 둔다 (처음 띄울 때 깜빡임 방지)
for (const n of ['loading', 'win', 'lose']) {
  try { new Image().src = 'art/bg-' + n + '.jpg'; } catch { /* 무시 */ }
}

let loadingRun = 0;
/** 시작 로딩 화면. 끝나면 resolve. { mode, modeName, mapName, ms } */
export function showLoading({ mode, modeName, mapName, mapTips, chaserSpeed, ms = 3500 }) {
  const run = ++loadingRun;
  const el = $('g-loading');
  const cv = $('g-loading-canvas');
  $('g-loading-mode').textContent = modeName || '';
  $('g-loading-map').textContent = mapName || '';
  const tips = tipsFor(mode, chaserSpeed, mapTips);
  let tipIndex = 0;
  $('g-loading-tip').textContent = tips[0] || '';
  el.hidden = false;
  const start = performance.now();
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
      if (!reduced()) fitCanvas(cv); // 배경 그림은 CSS(art/bg-loading.jpg). 캔버스는 쓰지 않음
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
      c.clearRect(0, 0, w, h); // 배경 그림은 CSS(art/bg-*.jpg), 여기서는 꽃가루만 그린다
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
