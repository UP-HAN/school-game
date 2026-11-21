// 맵 데이터를 만화풍 그림 한 장으로 미리 그려 둔다 (게임 중에는 이 그림을 그대로 붙인다).
import { VOID, WALL, SIGN, signRect, deviceMarks, DEVICE_STYLES, floorPanels } from './shared/mapgrid.js';
import { FONT } from './mafiaconst.js';
import makeLibrary from './furn-library.js';
import makeSchool from './furn-school.js';
import makeAcademy from './furn-academy.js';

const INK = '#2a2140';
const WALL_FILL = '#8a78d8';
const WALL_TOP = '#a99bea';

function clipRect(c, r, fn) {
  c.save();
  c.beginPath();
  c.rect(r[0], r[1], r[2], r[3]);
  c.clip();
  fn(c, r[0], r[1], r[2], r[3]);
  c.restore();
}
function lines(c, x, y, w, h, step, horizontal, color, width = 2) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  if (horizontal) for (let v = y + step; v < y + h; v += step) (c.moveTo(x, v), c.lineTo(x + w, v));
  else for (let v = x + step; v < x + w; v += step) (c.moveTo(v, y), c.lineTo(v, y + h));
  c.stroke();
}
function checker(c, x, y, w, h, size, colors) {
  for (let j = 0; j * size < h; j++) {
    for (let i = 0; i * size < w; i++) {
      c.fillStyle = colors[(i + j * (colors.length > 2 ? 3 : 1)) % colors.length];
      c.fillRect(x + i * size, y + j * size, size, size);
    }
  }
}

const FLOORS = {
  corridor(c, x, y, w, h) {
    c.fillStyle = '#ffe9bd';
    c.fillRect(x, y, w, h);
    lines(c, x, y, w, h, 40, true, 'rgba(176,122,79,.16)');
    lines(c, x, y, w, h, 40, false, 'rgba(176,122,79,.16)');
  },
  wood(c, x, y, w, h) {
    c.fillStyle = '#f6c77e';
    c.fillRect(x, y, w, h);
    lines(c, x, y, w, h, 40, true, 'rgba(150,90,30,.28)');
    c.strokeStyle = 'rgba(150,90,30,.2)';
    c.lineWidth = 2;
    c.beginPath();
    for (let j = 0; j * 40 < h; j++) {
      for (let v = x + (j % 2 ? 90 : 30); v < x + w; v += 180) (c.moveTo(v, y + j * 40), c.lineTo(v, y + j * 40 + 40));
    }
    c.stroke();
  },
  stage(c, x, y, w, h) {
    c.fillStyle = '#d99a58';
    c.fillRect(x, y, w, h);
    lines(c, x, y, w, h, 30, false, 'rgba(110,60,20,.3)');
  },
  tile(c, x, y, w, h) {
    checker(c, x, y, w, h, 40, ['#e6f7ff', '#c8ecfb']);
  },
  mat(c, x, y, w, h) {
    checker(c, x, y, w, h, 60, ['#ffb8cc', '#bfe89a', '#a8dcff', '#ffe38f']);
    lines(c, x, y, w, h, 60, true, 'rgba(42,33,64,.12)');
    lines(c, x, y, w, h, 60, false, 'rgba(42,33,64,.12)');
  },
  concrete(c, x, y, w, h) {
    c.fillStyle = '#dedbe9';
    c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(42,33,64,.1)';
    for (let i = 0; i < (w * h) / 2600; i++) {
      // 위치가 매번 같도록 좌표로 만든 가짜 난수
      const a = Math.sin(i * 91.7 + x) * 43758.5;
      const b = Math.sin(i * 37.3 + y) * 24634.6;
      c.fillRect(x + (a - Math.floor(a)) * w, y + (b - Math.floor(b)) * h, 5, 5);
    }
  },
};

function rr(c, x, y, w, h, r, fill, lw = 4) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  c.lineWidth = lw;
  c.strokeStyle = INK;
  c.stroke();
}
function circle(c, x, y, r, fill, lw = 4) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (lw) {
    c.lineWidth = lw;
    c.strokeStyle = INK;
    c.stroke();
  }
}
function shadow(c, x, y, w, h) {
  c.fillStyle = 'rgba(42,33,64,.18)';
  c.beginPath();
  c.roundRect(x + 6, y + 8, w, h, 10);
  c.fill();
}

// 가구 그림. 그림이 rect 를 꽉 채우지 않는 종류는 shared/mapgrid.js 의 DRAWN 에 그려지는 범위를 적어 둔다
// (막힘 영역 = 그 범위의 아랫부분). 그림 크기·위치를 바꾸면 DRAWN 도 같이 고치고 `node tools/map-check.mjs` 로 확인한다.
const FURNITURE = {
  piano(c, x, y, w, h) {
    rr(c, x, y, w, h, 10, '#3b3252');
    rr(c, x + 10, y + h - 26, w - 20, 18, 3, '#fff', 3);
    lines(c, x + 10, y + h - 26, w - 20, 18, 10, false, INK, 2);
  },
  vault(c, x, y, w, h) {
    rr(c, x, y, w, h, 12, '#c98a55');
    rr(c, x + 6, y + 4, w - 12, 20, 9, '#f25c54', 3);
    lines(c, x + 4, y + 26, w - 8, h - 30, 12, true, 'rgba(42,33,64,.45)', 3);
  },
  ballcart(c, x, y, w, h) {
    rr(c, x, y, w, h, 12, '#9ad0ff');
    const balls = [['#f8961e', 22, 24], ['#f25c54', 54, 22], ['#fff', 24, 56], ['#f9d23c', 56, 54]];
    for (const [col, bx, by] of balls) circle(c, x + bx, y + by, 15, col, 3);
  },
  counter(c, x, y, w, h) {
    rr(c, x, y, w, h, 10, '#ff9f6b');
    for (let i = 0; i * 40 < w - 30; i++) {
      c.fillStyle = i % 2 ? '#fff' : '#f25c54';
      c.fillRect(x + 6 + i * 40, y + 5, Math.min(40, w - 12 - i * 40), 14);
    }
    rr(c, x, y, w, h, 10, null);
    circle(c, x + 50, y + 40, 11, '#ffd94a', 3);
    circle(c, x + 100, y + 40, 11, '#f582b8', 3);
    rr(c, x + 150, y + 30, 34, 20, 5, '#a7d948', 3);
  },
  lockers(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#6fb7e8');
    lines(c, x, y, w, h, 40, true, INK, 3);
    c.fillStyle = INK;
    for (let v = y + 20; v < y + h; v += 40) c.fillRect(x + w - 12, v - 3, 6, 6);
  },
  bench(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#c98a55');
    lines(c, x, y, w, h, 13, true, 'rgba(42,33,64,.4)', 2);
  },
  junglegym(c, x, y, w, h) {
    rr(c, x, y, w, h, 14, 'rgba(255,255,255,.35)');
    const cols = ['#f25c54', '#4a7bf0', '#f9d23c', '#3fae6a'];
    c.lineWidth = 9;
    c.lineCap = 'round';
    for (let i = 1; i < 4; i++) {
      for (const horizontal of [true, false]) {
        const v = (i * w) / 4;
        c.strokeStyle = INK;
        c.lineWidth = 13;
        c.beginPath();
        if (horizontal) (c.moveTo(x + 8, y + v), c.lineTo(x + w - 8, y + v));
        else (c.moveTo(x + v, y + 8), c.lineTo(x + v, y + h - 8));
        c.stroke();
        c.strokeStyle = cols[(i + (horizontal ? 0 : 2)) % 4];
        c.lineWidth = 7;
        c.stroke();
      }
    }
  },
  matpile(c, x, y, w, h) {
    const cols = ['#4a7bf0', '#f25c54', '#3fae6a'];
    cols.forEach((col, i) => rr(c, x + i * 6, y + h - 30 - i * 22, w - i * 12, 28, 8, col));
  },
  desk(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#c98a55');
    rr(c, x + 16, y + 12, 54, 38, 5, '#fff', 3);
    rr(c, x + 96, y + 16, 44, 30, 5, '#5cc8f2', 3);
    circle(c, x + w - 14, y + h - 14, 8, '#f25c54', 3);
  },

  // ── 큰 체육관 ──
  cone(c, x, y, w, h) {
    rr(c, x + 3, y + h - 12, w - 6, 10, 3, '#f8961e', 3);
    c.beginPath();
    c.moveTo(x + w / 2, y + 2);
    c.lineTo(x + w - 8, y + h - 10);
    c.lineTo(x + 8, y + h - 10);
    c.closePath();
    c.fillStyle = '#f8961e';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = INK;
    c.stroke();
    c.fillStyle = '#fff';
    c.fillRect(x + 13, y + 16, w - 26, 6);
  },
  ballrack(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#8d99ae');
    ['#f8961e', '#fff', '#f25c54', '#f9d23c'].forEach((col, i) => circle(c, x + 15 + i * 23, y + h / 2, 11, col, 3));
  },
  scoretable(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#3b3252');
    c.font = `700 26px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ff5c5c';
    c.fillText('13', x + 26, y + h / 2 + 1);
    c.fillStyle = '#7df0c8';
    c.fillText('13', x + w - 26, y + h / 2 + 1);
    c.fillStyle = '#fff';
    c.fillText(':', x + w / 2, y + h / 2 - 1);
  },
  refchair(c, x, y, w, h) {
    rr(c, x + 6, y + 4, w - 12, h - 8, 8, '#f25c54');
    rr(c, x + 12, y + 10, w - 24, 20, 5, '#fff', 3);
    lines(c, x + 10, y + 34, w - 20, h - 40, 8, true, INK, 3);
  },

  // ── 무대 ──
  drum(c, x, y, w, h) {
    circle(c, x + w / 2, y + h / 2 + 6, 30, '#f25c54');
    circle(c, x + w / 2, y + h / 2 + 6, 21, '#fff', 3);
    circle(c, x + 20, y + 24, 16, '#f9d23c', 3);
    circle(c, x + w - 20, y + 24, 16, '#f9d23c', 3);
    circle(c, x + 20, y + 24, 3, INK, 0);
    circle(c, x + w - 20, y + 24, 3, INK, 0);
  },
  speaker(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#3b3252');
    circle(c, x + w / 2, y + 18, 9, '#8d99ae', 3);
    circle(c, x + w / 2, y + 42, 13, '#8d99ae', 3);
    circle(c, x + w / 2, y + 42, 4, INK, 0);
  },
  mic(c, x, y, w, h) {
    circle(c, x + w / 2, y + h / 2 + 6, 13, '#8d99ae', 3);
    c.lineWidth = 5;
    c.strokeStyle = INK;
    c.beginPath();
    c.moveTo(x + w / 2, y + h / 2 + 6);
    c.lineTo(x + w / 2 + 8, y + 8);
    c.stroke();
    circle(c, x + w / 2 + 9, y + 7, 6, '#3b3252', 3);
  },

  // ── 체육 창고 ──
  shelf(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#c98a55');
    lines(c, x, y, w, h, 35, true, INK, 3);
    const cols = ['#f25c54', '#4a7bf0', '#f9d23c', '#3fae6a'];
    for (let i = 0; i * 35 < h - 10; i++) {
      rr(c, x + 8, y + 8 + i * 35, 18, 20, 3, cols[i % 4], 2);
      circle(c, x + w - 16, y + 18 + i * 35, 9, cols[(i + 2) % 4], 2);
    }
  },
  hurdle(c, x, y, w, h) {
    for (let i = 0; i < 3; i++) {
      const hx = x + 6 + i * ((w - 12) / 3);
      rr(c, hx, y + 2, (w - 12) / 3 - 8, h - 4, 4, i % 2 ? '#fff' : '#f25c54', 3);
    }
  },
  skeleton(c, x, y, w, h) {
    // 과학실에서 빌려 온 해골 모형 (웃는 얼굴)
    rr(c, x + 10, y + 30, w - 20, h - 34, 6, '#f4f1e6', 3);
    lines(c, x + 10, y + 30, w - 20, h - 34, 7, true, INK, 2);
    circle(c, x + w / 2, y + 17, 15, '#f4f1e6', 3);
    circle(c, x + w / 2 - 6, y + 15, 4, INK, 0);
    circle(c, x + w / 2 + 6, y + 15, 4, INK, 0);
    c.lineWidth = 2;
    c.strokeStyle = INK;
    c.beginPath();
    c.moveTo(x + w / 2 - 7, y + 24);
    c.quadraticCurveTo(x + w / 2, y + 29, x + w / 2 + 7, y + 24);
    c.stroke();
  },
  crates(c, x, y, w, h) {
    const half = w / 2;
    for (const [cx, cw] of [[x, half], [x + half, w - half]]) {
      rr(c, cx + 2, y + 2, cw - 4, h - 4, 5, '#d9a066');
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(42,33,64,.55)';
      c.beginPath();
      c.moveTo(cx + 6, y + 6);
      c.lineTo(cx + cw - 6, y + h - 6);
      c.moveTo(cx + cw - 6, y + 6);
      c.lineTo(cx + 6, y + h - 6);
      c.stroke();
    }
  },

  // ── 매점 ──
  fridge(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#e6f7ff');
    lines(c, x, y, w, h, h * 0.42, true, INK, 3);
    c.fillStyle = INK;
    c.fillRect(x + w - 14, y + 10, 5, 16);
    c.fillRect(x + w - 14, y + h * 0.42 + 8, 5, 22);
  },
  vending(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#f25c54');
    rr(c, x + 5, y + 6, w - 10, h * 0.55, 3, '#bfe8ff', 2);
    const cols = ['#f9d23c', '#3fae6a', '#f582b8', '#fff'];
    for (let i = 0; i < 4; i++) circle(c, x + 12 + (i % 2) * (w - 24), y + 16 + Math.floor(i / 2) * 18, 5, cols[i], 2);
    rr(c, x + 8, y + h - 20, w - 16, 12, 3, INK, 0);
  },
  table(c, x, y, w, h) {
    for (const [sx, sy] of [[10, -2], [w - 10, -2], [10, h + 2], [w - 10, h + 2]]) circle(c, x + sx, y + sy, 9, '#8d99ae', 3);
    rr(c, x + 2, y + 6, w - 4, h - 12, 12, '#fff3d6');
    circle(c, x + w / 2 - 14, y + h / 2, 9, '#ff9f6b', 3);
    rr(c, x + w / 2 + 6, y + h / 2 - 8, 14, 16, 3, '#a8dcff', 3);
  },
  icebox(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#a8dcff');
    rr(c, x + 6, y + 6, w - 12, h - 12, 5, '#e6f7ff', 3);
    circle(c, x + 20, y + 24, 8, '#f582b8', 2);
    circle(c, x + 38, y + 30, 8, '#f9d23c', 2);
    circle(c, x + 26, y + 42, 8, '#b07a4f', 2);
  },

  // ── 탈의실 ──
  lockersH(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#6fb7e8');
    lines(c, x, y, w, h, 40, false, INK, 3);
    c.fillStyle = INK;
    for (let v = x + 20; v < x + w; v += 40) c.fillRect(v - 3, y + h - 12, 6, 6);
  },
  basket(c, x, y, w, h) {
    rr(c, x + 4, y + 14, w - 8, h - 18, 8, '#d9a066');
    lines(c, x + 4, y + 14, w - 8, h - 18, 10, false, 'rgba(42,33,64,.4)', 2);
    circle(c, x + 20, y + 14, 12, '#fff', 3);
    circle(c, x + 38, y + 12, 11, '#f582b8', 3);
  },
  sink(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#fff');
    for (const sx of [w * 0.28, w * 0.72]) {
      c.beginPath();
      c.ellipse(x + sx, y + h / 2 + 3, 20, 11, 0, 0, Math.PI * 2);
      c.fillStyle = '#bfe8ff';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = INK;
      c.stroke();
      c.fillStyle = '#8d99ae';
      c.fillRect(x + sx - 3, y + 3, 6, 10);
    }
  },
  shower(c, x, y, w, h) {
    rr(c, x, y, w, h, 10, '#d8f1ff');
    c.fillStyle = 'rgba(92,200,242,.35)';
    for (let i = 0; i < 5; i++) c.fillRect(x + 6 + i * 19, y + 6, 10, h - 12);
    rr(c, x, y, w, h, 10, null);
    circle(c, x + w / 2, y + h / 2, 13, '#8d99ae', 3);
    for (let a = 0; a < 6; a++) circle(c, x + w / 2 + Math.cos(a) * 7, y + h / 2 + Math.sin(a) * 7, 1.6, INK, 0);
    circle(c, x + 22, y + h - 20, 9, '#f9d23c', 3); // 오리 장난감
    circle(c, x + 30, y + h - 28, 5, '#f9d23c', 2);
  },

  // ── 몬스터 놀이방 ──
  trampoline(c, x, y, w, h) {
    c.beginPath();
    c.ellipse(x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
    c.fillStyle = '#4a7bf0';
    c.fill();
    c.lineWidth = 4;
    c.strokeStyle = INK;
    c.stroke();
    c.beginPath();
    c.ellipse(x + w / 2, y + h / 2, w / 2 - 14, h / 2 - 12, 0, 0, Math.PI * 2);
    c.fillStyle = '#3b3252';
    c.fill();
    c.lineWidth = 3;
    c.stroke();
  },
  blocks(c, x, y, w, h) {
    rr(c, x + 2, y + h - 30, 28, 28, 4, '#f25c54', 3);
    rr(c, x + 30, y + h - 30, 28, 28, 4, '#4a7bf0', 3);
    rr(c, x + 16, y + h - 56, 28, 28, 4, '#f9d23c', 3);
    rr(c, x + 16, y + 2, 28, 24, 4, '#3fae6a', 3);
  },
  teddy(c, x, y, w, h) {
    circle(c, x + 22, y + 12, 9, '#b07a4f', 3);
    circle(c, x + w - 22, y + 12, 9, '#b07a4f', 3);
    circle(c, x + w / 2, y + h / 2 + 2, 26, '#c98a55');
    circle(c, x + w / 2, y + h / 2 + 10, 11, '#f4e1c6', 3);
    circle(c, x + w / 2 - 9, y + h / 2 - 5, 3.5, INK, 0);
    circle(c, x + w / 2 + 9, y + h / 2 - 5, 3.5, INK, 0);
    circle(c, x + w / 2, y + h / 2 + 7, 3, INK, 0);
  },
  horse(c, x, y, w, h) {
    c.lineWidth = 7;
    c.strokeStyle = INK;
    c.beginPath();
    c.moveTo(x + 6, y + h - 12);
    c.quadraticCurveTo(x + w / 2, y + h + 6, x + w - 6, y + h - 12);
    c.stroke();
    rr(c, x + 16, y + 20, w - 34, 22, 9, '#f582b8');
    rr(c, x + w - 30, y + 4, 22, 26, 8, '#f582b8');
    circle(c, x + w - 15, y + 13, 2.5, INK, 0);
    rr(c, x + 10, y + 16, 12, 14, 4, '#f9d23c', 3);
  },

  // ── 기구실 ──
  dumbbell(c, x, y, w, h) {
    for (const dy of [10, h - 10]) {
      c.fillStyle = '#8d99ae';
      c.fillRect(x + 14, y + dy - 3, w - 28, 6);
      rr(c, x + 4, y + dy - 9, 14, 18, 4, '#3b3252', 3);
      rr(c, x + w - 18, y + dy - 9, 14, 18, 4, '#3b3252', 3);
    }
  },
  gymball(c, x, y, w, h) {
    circle(c, x + w / 2, y + h / 2, w / 2 - 3, '#9b6bf2');
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(x + w / 2, y + h / 2, w / 2 - 12, Math.PI * 1.1, Math.PI * 1.55);
    c.stroke();
  },
  treadmill(c, x, y, w, h) {
    rr(c, x, y + 8, w - 26, h - 16, 8, '#3b3252');
    lines(c, x, y + 8, w - 26, h - 16, 12, false, 'rgba(255,255,255,.25)', 2);
    rr(c, x + w - 30, y, 28, h, 8, '#8d99ae');
    rr(c, x + w - 24, y + h / 2 - 12, 16, 24, 4, '#7df0c8', 3);
  },

  // ── 체육 선생님 방 · 복도 ──
  bookcase(c, x, y, w, h) {
    rr(c, x, y, w, h, 5, '#8a5a3c');
    const cols = ['#f25c54', '#4a7bf0', '#f9d23c', '#3fae6a', '#9b6bf2', '#f582b8'];
    for (let i = 0; i * 14 < w - 14; i++) rr(c, x + 6 + i * 14, y + 6, 12, h - 12, 2, cols[i % 6], 2);
  },
  trophy(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#8a5a3c');
    rr(c, x + 5, y + 5, w - 10, h - 10, 4, '#bfe8ff', 3);
    const n = Math.max(1, Math.round(Math.max(w, h) / 40));
    for (let i = 0; i < n; i++) {
      const tx = w > h ? x + (w * (i + 0.5)) / n : x + w / 2;
      const ty = w > h ? y + h / 2 : y + (h * (i + 0.5)) / n;
      circle(c, tx, ty - 3, 8, '#ffd94a', 3);
      c.fillStyle = INK;
      c.fillRect(tx - 5, ty + 6, 10, 4);
    }
  },
  chair(c, x, y, w, h) {
    circle(c, x + w / 2, y + h / 2, w / 2 - 4, '#4a7bf0');
    rr(c, x + 6, y + 2, w - 12, 10, 5, '#3b3252', 3);
  },
  sofa(c, x, y, w, h) {
    rr(c, x, y, w, h, 14, '#3fae6a');
    rr(c, x + 14, y + 16, w - 28, h - 22, 10, '#62c98a', 3);
    lines(c, x + 14, y + 16, w - 28, h - 22, (w - 28) / 2, false, INK, 3);
  },
  plant(c, x, y, w, h) {
    circle(c, x + w / 2, y + h / 2, w / 2 - 3, '#b07a4f');
    for (let a = 0; a < 6; a++) {
      c.beginPath();
      c.ellipse(x + w / 2 + Math.cos(a * 1.05) * 8, y + h / 2 + Math.sin(a * 1.05) * 8, 9, 5, a * 1.05, 0, Math.PI * 2);
      c.fillStyle = a % 2 ? '#3fae6a' : '#62c98a';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = INK;
      c.stroke();
    }
  },
  fountain(c, x, y, w, h) {
    rr(c, x, y, w, h, 8, '#c9d3df');
    circle(c, x + w / 2, y + h / 2, 12, '#bfe8ff', 3);
    circle(c, x + w / 2, y + h / 2, 3, '#8d99ae', 0);
  },
  shoerack(c, x, y, w, h) {
    rr(c, x, y, w, h, 6, '#d9a066');
    lines(c, x, y, w, h, 30, true, INK, 3);
    const cols = ['#f25c54', '#4a7bf0', '#fff', '#f9d23c'];
    for (let i = 0; i * 30 < h - 10; i++) rr(c, x + 8, y + 8 + i * 30, w - 16, 14, 6, cols[i % 4], 2);
  },
};

// 맵 전용 가구·바닥 (furn-*.js). 이미 있는 이름은 덮어쓰지 않는다.
const KIT = { rr, circle, shadow, lines, checker, label, clipRect, INK };
for (const make of [makeLibrary, makeSchool, makeAcademy]) {
  const extra = make(KIT);
  for (const [k, fn] of Object.entries(extra.FURN || {})) if (!FURNITURE[k]) FURNITURE[k] = fn;
  for (const [k, fn] of Object.entries(extra.FLOORS || {})) if (!FLOORS[k]) FLOORS[k] = fn;
}

// ───────────── 살짝 무서운 장식 (지나다닐 때 걸리지 않는 그림) ─────────────
// 방 구석의 거미줄
function cobweb(c, x, y, sx, sy, size) {
  c.save();
  c.translate(x, y);
  c.scale(sx, sy);
  c.strokeStyle = 'rgba(255,255,255,.75)';
  c.lineWidth = 2.5;
  c.beginPath();
  for (const a of [0, 0.4, 0.8, 1.2, Math.PI / 2]) {
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a) * size, Math.sin(a) * size);
  }
  for (const r of [0.35, 0.62, 0.9]) {
    for (let i = 0; i < 4; i++) {
      const a0 = [0, 0.4, 0.8, 1.2, Math.PI / 2][i];
      const a1 = [0, 0.4, 0.8, 1.2, Math.PI / 2][i + 1];
      const mid = (a0 + a1) / 2;
      c.moveTo(Math.cos(a0) * size * r, Math.sin(a0) * size * r);
      c.quadraticCurveTo(Math.cos(mid) * size * r * 0.82, Math.sin(mid) * size * r * 0.82, Math.cos(a1) * size * r, Math.sin(a1) * size * r);
    }
  }
  c.stroke();
  c.restore();
}
// 바닥의 금
function crack(c, x, y, seed) {
  const rnd = (i) => {
    const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  c.strokeStyle = 'rgba(42,33,64,.4)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x, y);
  let px = x;
  let py = y;
  for (let i = 0; i < 5; i++) {
    px += (rnd(i) - 0.3) * 46;
    py += (rnd(i + 9) - 0.3) * 40;
    c.lineTo(px, py);
    if (i === 2) {
      c.moveTo(px, py);
      c.lineTo(px + (rnd(20) - 0.5) * 50, py + 24);
      c.moveTo(px, py);
    }
  }
  c.stroke();
}
// 몬스터가 할퀸 자국
function claw(c, x, y, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.lineCap = 'round';
  for (const dx of [-16, 0, 16]) {
    c.strokeStyle = INK;
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(dx - 6, -30);
    c.quadraticCurveTo(dx + 6, 0, dx - 4, 32);
    c.stroke();
    c.strokeStyle = '#7a1f3d';
    c.lineWidth = 4;
    c.stroke();
  }
  c.restore();
}
// 작은 발자국 줄
function footprints(c, x, y, dx, dy, n) {
  c.fillStyle = 'rgba(92,40,110,.38)';
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 9 : -9;
    const fx = x + dx * i + (dy ? side : 0);
    const fy = y + dy * i + (dx ? side : 0);
    c.beginPath();
    c.ellipse(fx, fy, 9, 12, Math.atan2(dy, dx) + Math.PI / 2, 0, Math.PI * 2);
    c.fill();
    for (const k of [-7, 0, 7]) {
      c.beginPath();
      c.arc(fx + (dx ? Math.sign(dx) * 15 : k), fy + (dy ? Math.sign(dy) * 15 : k), 3.2, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function drawCourt(c, r) {
  const [x, y, w, h] = [r[0] + 80, r[1] + 80, r[2] - 160, r[3] - 160];
  c.strokeStyle = '#fff';
  c.lineWidth = 7;
  c.strokeRect(x, y, w, h);
  c.beginPath();
  c.moveTo(x + w / 2, y);
  c.lineTo(x + w / 2, y + h);
  c.stroke();
  c.beginPath();
  c.arc(x + w / 2, y + h / 2, 110, 0, Math.PI * 2);
  c.stroke();
  for (const side of [0, 1]) {
    const gx = side ? x + w : x;
    const dir = side ? -1 : 1;
    c.strokeRect(side ? gx - 150 : gx, y + h / 2 - 110, 150, 220);
    c.beginPath();
    c.arc(gx + dir * 150, y + h / 2, 70, -Math.PI / 2, Math.PI / 2, !!side);
    c.stroke();
    // 농구대
    c.fillStyle = '#fff';
    c.fillRect(gx + dir * 14 - 5, y + h / 2 - 44, 10, 88);
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.strokeRect(gx + dir * 14 - 5, y + h / 2 - 44, 10, 88);
    circle(c, gx + dir * 42, y + h / 2, 20, null, 9);
    c.strokeStyle = '#f8961e';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(gx + dir * 42, y + h / 2, 20, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#fff';
    c.lineWidth = 7;
  }
}

function label(c, text, cx, cy, size, color = 'rgba(42,33,64,.28)') {
  c.font = `700 ${size}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(text, cx, cy);
}

// 퀴즈 랜턴 (꺼진 모습: 회색 유리 + "?"). 켠 랜턴의 불빛은 게임 화면이 내 기록대로 덧그린다.
export function drawLantern(c, x, y, lit = false, s = 1) {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.fillStyle = 'rgba(42,33,64,.2)';
  c.beginPath();
  c.ellipse(4, 26, 26, 8, 0, 0, Math.PI * 2);
  c.fill();
  // 손잡이 고리
  c.lineWidth = 4;
  c.strokeStyle = INK;
  c.beginPath();
  c.arc(0, -40, 9, Math.PI, 0);
  c.stroke();
  rr(c, -20, -38, 40, 10, 4, '#5b4b8a', 3); // 뚜껑
  rr(c, -17, -28, 34, 42, 8, lit ? '#ffd76a' : '#8f8aa8', 4); // 유리 몸통
  if (lit) {
    const g = c.createRadialGradient(0, -8, 2, 0, -8, 18);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(1, 'rgba(255,181,71,0)');
    c.fillStyle = g;
    c.fillRect(-15, -26, 30, 38);
  }
  // 창살
  c.strokeStyle = 'rgba(42,33,64,.45)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(-6, -28);
  c.lineTo(-6, 14);
  c.moveTo(6, -28);
  c.lineTo(6, 14);
  c.stroke();
  rr(c, -21, 12, 42, 10, 4, '#5b4b8a', 3); // 받침
  if (!lit) label(c, '?', 0, -6, 24, '#fff6e5');
  c.restore();
}
// 회의 종 (놋쇠 종 + 받침대). 꿈도둑을 찾아라 모드에서만 그린다
function drawBell(c, x, y) {
  circle(c, x, y + 30, 40, 'rgba(42,33,64,.18)', 0);
  rr(c, x - 34, y - 70, 8, 98, 3, '#8a5a3c', 3);
  rr(c, x + 26, y - 70, 8, 98, 3, '#8a5a3c', 3);
  rr(c, x - 40, y - 78, 80, 12, 5, '#8a5a3c', 3);
  c.beginPath();
  c.moveTo(x - 22, y + 12);
  c.quadraticCurveTo(x - 24, y - 52, x, y - 58);
  c.quadraticCurveTo(x + 24, y - 52, x + 22, y + 12);
  c.quadraticCurveTo(x, y + 20, x - 22, y + 12);
  c.fillStyle = '#e0a43a';
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = INK;
  c.stroke();
  c.strokeStyle = 'rgba(255,246,229,.7)';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(x - 10, y - 40);
  c.quadraticCurveTo(x - 14, y - 16, x - 12, y);
  c.stroke();
  circle(c, x, y + 18, 7, '#8a5a3c', 3);
  label(c, '회의 종', x, y + 52, 22, INK);
}
// 나무 팻말: (x, y) = 기둥이 땅에 박힌 곳, lines = [{ text, color }] (한 줄에 나란히), foot = 아래 작은 글씨
// 크기·자리는 shared/mapgrid.js 의 signRect 와 같다 (맵 검사가 이 사각형으로 겹침을 본다)
function drawSign(c, x, y, lines, foot) {
  const [bx, by, w, hh] = signRect(x, y, foot);
  const h = hh - SIGN.post;
  rr(c, x - 5, by + h - 6, 10, SIGN.post + 6, 3, '#8a5a3c', 3); // 기둥
  rr(c, bx, by, w, h, 8, '#e8b97a', 4);
  const pad = 12;
  const gap = 8;
  const pw = (w - pad * 2 - gap * (lines.length - 1)) / lines.length;
  lines.forEach((ln, i) => {
    const px = bx + pad + i * (pw + gap);
    rr(c, px, by + 11, pw, 24, 10, ln.color, 3);
    label(c, ln.text, px + pw / 2, by + 24, 15, '#fff');
  });
  if (foot) label(c, foot, x, by + h - 12, 14, INK);
}
// 장치 who 에서 지금 모드의 팻말 글씨
function whoLines(d, mode) {
  const who = (d.who && d.who[mode]) || (mode === 'mafia' ? ['student', 'chaser'] : ['student']);
  if (who.includes('student') && who.includes('chaser')) return [{ text: '모두 O', color: '#3fae6a' }];
  const chaser = mode === 'mafia' ? '꿈도둑' : '잠귀신';
  return [
    { text: `학생 ${who.includes('student') ? 'O' : 'X'}`, color: who.includes('student') ? '#3fae6a' : '#e5484d' },
    { text: `${chaser} ${who.includes('chaser') ? 'O' : 'X'}`, color: who.includes('chaser') ? '#3fae6a' : '#e5484d' },
  ];
}
function drawHole(c, x, y) {
  c.fillStyle = '#b07a4f';
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(x, y, 40, 26, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = '#1c1530';
  c.beginPath();
  c.ellipse(x, y + 2, 29, 17, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  for (const [dx, dy] of [[-44, -14], [40, -20], [48, 12]]) circle(c, x + dx, y + dy, 6, '#b07a4f', 3);
}
// 개구멍 출구: 반쯤 덮은 나무 뚜껑 + 밖으로 나가는 화살표 + 글씨
function drawHoleExit(c, x, y) {
  c.fillStyle = '#b07a4f';
  c.strokeStyle = INK;
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(x, y, 36, 22, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = '#3a2c20';
  c.beginPath();
  c.ellipse(x, y + 2, 26, 14, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(x + 6, y - 2);
  c.rotate(-0.18);
  rr(c, -20, -18, 46, 34, 10, '#d9a066', 4); // 뚜껑
  c.strokeStyle = 'rgba(110,60,20,.45)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(-14, -6);
  c.lineTo(20, -6);
  c.moveTo(-14, 5);
  c.lineTo(20, 5);
  c.stroke();
  c.restore();
  // 밖으로 나가는 화살표
  c.fillStyle = '#7fe0c4';
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x - 6, y - 30);
  c.lineTo(x + 6, y - 30);
  c.lineTo(x + 6, y - 44);
  c.lineTo(x + 14, y - 44);
  c.lineTo(x, y - 60);
  c.lineTo(x - 14, y - 44);
  c.lineTo(x - 6, y - 44);
  c.closePath();
  c.fill();
  c.stroke();
}
function drawSlide(c, d) {
  const pts = [d.from, ...(d.path || []), d.to];
  const stroke = (w, col) => {
    c.lineWidth = w;
    c.strokeStyle = col;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      c.arcTo(a[0], a[1], b[0], b[1], 90);
    }
    c.lineTo(pts.at(-1)[0], pts.at(-1)[1]);
    c.stroke();
  };
  stroke(64, INK);
  stroke(54, '#ff7a59');
  stroke(30, '#ffb199');
  c.setLineDash([4, 44]);
  stroke(54, 'rgba(42,33,64,.35)');
  c.setLineDash([]);
  circle(c, d.from[0], d.from[1], 34, '#ff7a59');
  circle(c, d.from[0], d.from[1], 22, '#1c1530');
  circle(c, d.to[0], d.to[1], 34, '#ff7a59');
  circle(c, d.to[0], d.to[1], 22, '#ffd94a');
}
// 장치 글씨·팻말: 자리는 shared/mapgrid.js deviceMarks (맵 데이터 marks 로 옮길 수 있고, 맵 검사가 겹침을 본다)
function drawMarks(c, d, mode) {
  for (const mk of deviceMarks(d)) {
    if (mk.kind === 'label') label(c, mk.text, mk.x, mk.y, mk.size, INK);
    if (mk.kind === 'sign') drawSign(c, mk.x, mk.y, whoLines(d, mode), mk.foot);
  }
}

/** opts: { mode } — 'sleep-tag' 이면 회의 종을 그리지 않고, 팻말 글씨도 모드에 맞춘다 */
export function renderMap(map, grid, opts = {}) {
  const mode = opts.mode || 'sleep-tag';
  const cv = document.createElement('canvas');
  cv.width = map.size[0];
  cv.height = map.size[1];
  const c = cv.getContext('2d');
  const [W, H] = map.size;

  // 1. 운동장 잔디 (밤 분위기는 맨 끝에서 한꺼번에 입힌다)
  //    여러 층 맵(floors)은 층 사이가 땅이 아니라 밤하늘이다: 별이 뜬 하늘 + 층마다 건물 바닥판
  if (map.floors && map.floors.length) drawFloorSlabs(c, map, W, H);
  else {
    c.fillStyle = '#9fcf84';
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(63,174,106,.28)';
    for (let i = 0; i < 520; i++) {
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const b = Math.sin(i * 78.233) * 24634.6345;
      const x = (a - Math.floor(a)) * W;
      const y = (b - Math.floor(b)) * H;
      c.fillRect(x, y, 4, 12);
      c.fillRect(x + 7, y + 3, 4, 9);
    }
  }

  // 2. 바닥
  for (const k of map.corridors || []) clipRect(c, k.rect, FLOORS.corridor);
  for (const r of map.rooms || []) {
    clipRect(c, r.rect, FLOORS[r.floor] || FLOORS.corridor);
    if (r.decor === 'court') drawCourt(c, r.rect);
  }
  for (const d of map.doors || []) {
    clipRect(c, d.rect, FLOORS.corridor);
    c.fillStyle = 'rgba(255,122,89,.35)';
    c.fillRect(...d.rect);
  }
  for (const z of map.zones || []) {
    c.fillStyle = 'rgba(155,107,242,.3)';
    c.strokeStyle = 'rgba(42,33,64,.5)';
    c.lineWidth = 3;
    c.setLineDash([12, 10]);
    c.beginPath();
    c.roundRect(z.rect[0], z.rect[1], z.rect[2], z.rect[3], 16);
    c.fill();
    c.stroke();
    c.setLineDash([]);
    label(c, z.name || '', z.rect[0] + z.rect[2] / 2, z.rect[1] + z.rect[3] / 2, 30, 'rgba(42,33,64,.45)');
  }

  // 2-1. 바닥의 금, 수상한 발자국, 할퀸 자국
  (map.rooms || []).forEach((r, i) => {
    const [x, y, w, h] = r.rect;
    crack(c, x + w * 0.25, y + h * 0.3, i + 1);
    crack(c, x + w * 0.7, y + h * 0.62, i + 11);
  });
  (map.corridors || []).forEach((k, i) => {
    const [x, y, w, h] = k.rect;
    crack(c, x + w * 0.4, y + h * 0.35, i + 31);
    if (h > w) footprints(c, x + w * 0.5, y + h * 0.55, 0, 46, 7);
    else footprints(c, x + w * 0.25, y + h * 0.4, 46, 0, 8);
  });
  for (const r of map.rooms || []) {
    if (r.decor === 'court') {
      claw(c, r.rect[0] + r.rect[2] * 0.22, r.rect[1] + r.rect[3] * 0.24, 0.5);
      claw(c, r.rect[0] + r.rect[2] * 0.8, r.rect[1] + r.rect[3] * 0.76, -0.4);
    }
  }

  // 3. 벽 칸 칠하기
  const { cell, cols, rows, cells } = grid;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (cells[y * cols + x] !== WALL) continue;
      c.fillStyle = WALL_FILL;
      c.fillRect(x * cell, y * cell, cell, cell);
      c.fillStyle = WALL_TOP;
      c.fillRect(x * cell, y * cell, cell, 7);
    }
  }

  // 4. 굵은 테두리: 종류가 다른 칸이 만나는 곳마다 선을 긋는다
  const kind = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return VOID;
    const v = cells[y * cols + x];
    return v === WALL ? 2 : v === VOID ? 0 : 1;
  };
  c.strokeStyle = INK;
  c.lineWidth = 5;
  c.lineCap = 'square';
  c.beginPath();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = kind(x, y);
      if (k !== kind(x + 1, y)) (c.moveTo((x + 1) * cell, y * cell), c.lineTo((x + 1) * cell, (y + 1) * cell));
      if (k !== kind(x, y + 1)) (c.moveTo(x * cell, (y + 1) * cell), c.lineTo((x + 1) * cell, (y + 1) * cell));
    }
  }
  c.stroke();

  // 5. 방 이름, 가구, 장치
  for (const r of map.rooms || []) {
    if (r.decor === 'court') continue;
    label(c, r.name, r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2, 40);
  }
  for (const f of map.furniture || []) {
    shadow(c, ...f.rect);
    (FURNITURE[f.kind] || ((cc, x, y, w, h) => rr(cc, x, y, w, h, 10, '#c98a55')))(c, ...f.rect);
  }
  // 방 구석마다 거미줄
  for (const r of map.rooms || []) {
    const [x, y, w, h] = r.rect;
    const s = Math.min(90, w / 5, h / 3);
    cobweb(c, x + 20, y + 20, 1, 1, s);
    cobweb(c, x + w - 20, y + 20, -1, 1, s * 0.8);
    cobweb(c, x + 20, y + h - 20, 1, -1, s * 0.6);
  }
  for (const d of map.devices || []) {
    if (d.type === 'slide') drawSlide(c, d);
    if (d.type === 'teleport' && DEVICE_STYLES[d.style]) drawStyledDevice(c, d);
    else if (d.type === 'teleport') {
      drawHole(c, d.from[0], d.from[1]);
      for (const e of d.exits || []) drawHoleExit(c, e[0], e[1]);
    }
  }
  // 글씨·팻말은 모든 장치 그림(미끄럼틀 띠 포함) 위에
  for (const d of map.devices || []) drawMarks(c, d, mode);
  const bell = map.bell || map.meetingButton;
  if (bell && mode === 'mafia') drawBell(c, ...bell.pos);

  // 6. 밤 분위기: 전체에 푸르스름한 어둠을 입히고, 달빛이 든 것처럼 가운데만 조금 밝게 둔다
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = '#bcb7ea';
  c.fillRect(0, 0, W, H);
  // 달빛: 맵 가운데 (여러 층 맵은 층마다 가운데)
  const pools = map.floors && map.floors.length ? map.floors.map((f) => f.rect) : [[0, 0, W, H]];
  for (const [px, py, pw, ph] of pools) {
    const cx = px + pw / 2;
    const cy = py + ph / 2;
    const dusk = c.createRadialGradient(cx, cy, 200, cx, cy, Math.max(pw, ph) * 0.7);
    dusk.addColorStop(0, 'rgba(255,255,255,1)');
    dusk.addColorStop(1, 'rgba(160,152,210,1)');
    c.fillStyle = dusk;
    c.fillRect(px, py, pw, ph);
  }
  c.globalCompositeOperation = 'source-over';

  // 7. 꺼진 퀴즈 랜턴 (어둠 속에서 희미한 호박빛)
  for (const t of map.terminals || []) {
    const [tx, ty] = t.pos;
    const glow = c.createRadialGradient(tx, ty - 10, 6, tx, ty - 10, 90);
    glow.addColorStop(0, 'rgba(255,181,71,.28)');
    glow.addColorStop(1, 'rgba(255,181,71,0)');
    c.fillStyle = glow;
    c.fillRect(tx - 90, ty - 100, 180, 180);
    drawLantern(c, tx, ty, false);
  }

  // 8. 맵 이름 팻말 (여러 층 맵은 층마다 층 이름을 건물 위 하늘에)
  const titles = map.floors && map.floors.length
    ? map.floors.map((f) => [`${f.name}`, f.rect[0] + f.rect[2] / 2, Math.max(40, f.rect[1] - 50), 52])
    : [[map.name, W / 2, 90, 64]];
  for (const [text, tx, ty, size] of titles) {
    c.lineWidth = 10;
    c.lineJoin = 'round';
    c.strokeStyle = INK;
    c.font = `700 ${size}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.strokeText(text, tx, ty);
    label(c, text, tx, ty, size, '#c8f56a');
  }
  return cv;
}

// ───────────── 여러 층 맵 ─────────────
// 층 사이 밤하늘 (별) + 층마다 건물 바닥판. 방·복도는 이 위에 그린다.
function drawFloorSlabs(c, map, W, H) {
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#141032');
  sky.addColorStop(1, '#2a2350');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 9000; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 24634.6345;
    const s = i % 7 === 0 ? 3.2 : 1.6;
    c.fillStyle = i % 11 === 0 ? 'rgba(255,236,160,.9)' : 'rgba(255,255,255,.75)';
    c.beginPath();
    c.arc((a - Math.floor(a)) * W, (b - Math.floor(b)) * H, s, 0, Math.PI * 2);
    c.fill();
  }
  for (const f of map.floors) {
    const [x, y, w, h] = f.rect;
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath();
    c.roundRect(x + 14, y + 18, w, h, 26);
    c.fill();
    rr(c, x, y, w, h, 26, '#5d5390', 6);
    // 바닥판 무늬 (콘크리트 줄눈)
    clipRect(c, [x + 6, y + 6, w - 12, h - 12], (cc, X, Y, ww, hh) => {
      lines(cc, X, Y, ww, hh, 60, true, 'rgba(255,255,255,.07)', 3);
      lines(cc, X, Y, ww, hh, 120, false, 'rgba(255,255,255,.05)', 3);
    });
  }
}
// 계단 (dir 'up': 입구 위쪽으로 올라가는 계단 / 'down': 아래쪽으로 내려가는 계단). 자리는 shared/mapgrid.js DEVICE_STYLES 의 art
function drawStairs(c, x, y, dir) {
  const up = dir === 'up';
  const top = up ? y - 90 : y - 20;
  rr(c, x - 50, top, 100, 110, 10, '#8a78d8', 4);
  const n = 6;
  for (let i = 0; i < n; i++) {
    // 올라가는 계단은 위로 갈수록 밝게, 내려가는 계단은 아래로 갈수록 어둡게
    const k = up ? 1 - i / n : i / n;
    const light = Math.round(250 - k * 70);
    const sy = top + 8 + i * 16;
    c.fillStyle = up ? `rgb(${light},${light - 10},${light - 40})` : `rgb(${light - 60},${light - 70},${light - 30})`;
    c.fillRect(x - 42, sy, 84, 14);
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.strokeRect(x - 42, sy, 84, 14);
  }
  // 화살표
  c.fillStyle = up ? '#c8f56a' : '#ffb547';
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.beginPath();
  const ay = up ? top + 30 : top + 80;
  const s = up ? -1 : 1;
  c.moveTo(x, ay + s * 22);
  c.lineTo(x + 18, ay);
  c.lineTo(x + 7, ay);
  c.lineTo(x + 7, ay - s * 18);
  c.lineTo(x - 7, ay - s * 18);
  c.lineTo(x - 7, ay);
  c.lineTo(x - 18, ay);
  c.closePath();
  c.fill();
  c.stroke();
}
// 엘리베이터 문 (벽에 붙은 은색 문 + 위쪽 층 표시등 + 버튼)
function drawElevator(c, x, y, to) {
  const top = y - 100;
  rr(c, x - 46, top, 92, 112, 8, '#8d99ae', 4);
  rr(c, x - 36, top + 22, 72, 84, 4, '#d9e1ea', 3);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(x, top + 22);
  c.lineTo(x, top + 106);
  c.stroke();
  rr(c, x - 22, top + 4, 44, 16, 5, '#2a2140', 2);
  label(c, to ? `${to}층` : '▲▼', x, top + 12, 13, '#ffd84d');
  circle(c, x + 40, top + 64, 5, '#ffd84d', 2);
}
// 미끄럼틀 통로: 입구는 위에서 본 소용돌이 구멍, 출구는 짧은 통로 끝 + 착지 매트
function drawTube(c, x, y) {
  circle(c, x, y, 38, '#ff7a59');
  circle(c, x, y, 27, '#ffb199', 3);
  c.strokeStyle = '#1c1530';
  c.lineWidth = 5;
  c.beginPath();
  for (let a = 0; a < Math.PI * 4; a += 0.2) {
    const r = 22 - a * 1.6;
    if (a === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.stroke();
}
function drawTubeExit(c, x, y) {
  rr(c, x - 38, y - 10, 76, 44, 14, '#ffd94a', 4); // 착지 매트
  c.lineWidth = 30;
  c.lineCap = 'round';
  c.strokeStyle = INK;
  c.beginPath();
  c.moveTo(x - 30, y - 34);
  c.lineTo(x - 4, y - 8);
  c.stroke();
  c.lineWidth = 22;
  c.strokeStyle = '#ff7a59';
  c.stroke();
  c.lineWidth = 8;
  c.strokeStyle = '#ffb199';
  c.stroke();
  circle(c, x - 34, y - 36, 12, '#1c1530', 3);
}
function drawStyledDevice(c, d) {
  const [x, y] = d.from;
  if (d.style === 'stairs-up') drawStairs(c, x, y, 'up');
  else if (d.style === 'stairs-down') drawStairs(c, x, y, 'down');
  else if (d.style === 'elevator') {
    const m = /(\d+)층/.exec(d.name || '');
    drawElevator(c, x, y, m ? m[1] : '');
  } else if (d.style === 'tube') {
    drawTube(c, x, y);
    for (const e of d.exits || []) drawTubeExit(c, e[0], e[1]);
  }
}

// 여러 층 맵 미리보기 (선생님 맵 고르기 그림 등): 층마다 한 칸씩 나란히. floors 가 없으면 맵 전체를 줄여 그린다.
// image = renderMap 결과. 돌려주는 값: w×h 캔버스
export function renderOverview(map, image, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = '#1b1638';
  c.fillRect(0, 0, w, h);
  const top = map.floors && map.floors.length ? Math.max(14, Math.round(h * 0.07)) : 0;
  for (const p of floorPanels(map, w, h, { gap: Math.round(w * 0.025), pad: Math.round(w * 0.02), top })) {
    c.drawImage(image, p.src[0], p.src[1], p.src[2], p.src[3], p.x, p.y, p.w, p.h);
    if (!p.floor) continue;
    c.lineWidth = 3;
    c.strokeStyle = '#fff6e5';
    c.strokeRect(p.x, p.y, p.w, p.h);
    label(c, p.floor.name, p.x + p.w / 2, p.y - top / 2, Math.round(top * 0.8), '#c8f56a');
  }
  return cv;
}
