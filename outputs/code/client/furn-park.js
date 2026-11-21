// park 맵(한밤의 놀이공원, maps/night-park.json) 전용 가구·바닥 그림.
// maprender.js 가 그리기 도구(kit)를 넘겨 주면 { FURN, FLOORS } 를 돌려준다.
// FURN[종류](c, x, y, w, h) 는 가구 그림, FLOORS[이름](c, x, y, w, h) 는 방 바닥 그림 (rooms 의 floor).
// 다른 맵 파일과 이름이 겹치지 않도록 모두 'pk' 로 시작한다. (이미 있는 이름은 maprender.js 가 덮어쓰지 않는다)
// 가구가 막는 곳은 그림 rect 의 아랫부분(shared/mapgrid.js footRect)이다. 큰 놀이기구(회전목마·미끄럼틀 탑·대관람차·
// 무지개 미끄럼틀)는 맵 데이터에 foot: [x, y, w, h] 로 바닥에 닿는 곳만 적는다.
// 밤 분위기(푸르스름한 어둠)는 maprender.js 가 맨 끝에 한꺼번에 입히므로 여기서는 밝은 색으로 그린다. 무섭지 않게, 코믹하게.
export default function make(kit) {
  const { rr, circle, lines, checker, label, INK } = kit;

  // 좌표로 만든 가짜 난수 (그릴 때마다 같은 자리)
  const rnd = (i, s) => {
    const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const ellipse = (c, cx, cy, rx, ry, fill, lw = 4) => {
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (lw) {
      c.lineWidth = lw;
      c.strokeStyle = INK;
      c.stroke();
    }
  };
  // 다각형 채우기 + 테두리
  const poly = (c, pts, fill, lw = 4) => {
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (lw) {
      c.lineWidth = lw;
      c.strokeStyle = INK;
      c.stroke();
    }
  };
  // 별 (다섯 뾰족)
  const star = (c, cx, cy, r, fill, lw = 2) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const k = i % 2 ? r * 0.45 : r;
      pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
    }
    poly(c, pts, fill, lw);
  };
  // 반짝이 전구 한 줄 (x0,y0 → x1,y1, 늘어진 줄 + 알록달록 전구)
  const bulbs = (c, x0, y0, x1, y1, n, sag = 10) => {
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag * 2, x1, y1);
    c.stroke();
    const cols = ['#ffd84d', '#ff7a9c', '#7fe0c4', '#9ad0ff'];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2) + t * t * x1;
      const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2 + sag * 2) + t * t * y1;
      circle(c, bx, by + 3, 4, cols[i % cols.length], 1.5);
    }
  };
  // 줄무늬 천막 지붕 (가게·매표소 위)
  const awning = (c, x, y, w, h, colA, colB) => {
    const n = Math.max(3, Math.round(w / 26));
    const sw = w / n;
    for (let i = 0; i < n; i++) {
      c.beginPath();
      c.moveTo(x + i * sw, y);
      c.lineTo(x + (i + 1) * sw, y);
      c.lineTo(x + (i + 1) * sw, y + h - 6);
      c.quadraticCurveTo(x + (i + 0.5) * sw, y + h + 6, x + i * sw, y + h - 6);
      c.closePath();
      c.fillStyle = i % 2 ? colB : colA;
      c.fill();
    }
    c.lineWidth = 4;
    c.strokeStyle = INK;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    for (let i = n; i > 0; i--) {
      c.lineTo(x + i * sw, y + h - 6);
      c.quadraticCurveTo(x + (i - 0.5) * sw, y + h + 6, x + (i - 1) * sw, y + h - 6);
    }
    c.closePath();
    c.stroke();
  };
  // 솜사탕 한 덩이 (막대 + 구름)
  const candyFloss = (c, cx, cy, s, col) => {
    rr(c, cx - 2, cy, 4, s * 1.3, 2, '#fff6e5', 2);
    circle(c, cx - s * 0.45, cy - s * 0.1, s * 0.55, col, 2.5);
    circle(c, cx + s * 0.45, cy - s * 0.1, s * 0.55, col, 2.5);
    circle(c, cx, cy - s * 0.5, s * 0.6, col, 2.5);
  };

  const FLOORS = {
    // 놀이공원 보도: 붉은 벽돌 헤링본 느낌 (엇갈린 벽돌) + 가장자리 테
    pkPlaza(c, x, y, w, h) {
      c.fillStyle = '#e9b48f';
      c.fillRect(x, y, w, h);
      const bw = 60;
      const bh = 30;
      for (let j = 0; j * bh < h; j++) {
        for (let i = -1; i * bw < w; i++) {
          const bx = x + i * bw + (j % 2 ? bw / 2 : 0);
          const by = y + j * bh;
          c.fillStyle = (i + j) % 3 === 0 ? '#e3a47d' : (i + j) % 3 === 1 ? '#efc19e' : '#e8ae88';
          c.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
        }
      }
      lines(c, x, y, w, h, bh, true, 'rgba(120,60,40,.18)', 2);
    },
    // 중앙 광장: 밝은 돌판 + 가운데 커다란 별 무늬 + 둘레 동그라미 길
    pkStarPlaza(c, x, y, w, h) {
      checker(c, x, y, w, h, 60, ['#f3e2c4', '#ead5b1']);
      lines(c, x, y, w, h, 60, true, 'rgba(120,80,40,.12)');
      lines(c, x, y, w, h, 60, false, 'rgba(120,80,40,.12)');
      const cx = x + w / 2;
      const cy = y + h / 2 + 10;
      c.lineWidth = 26;
      c.strokeStyle = '#d9a5d8';
      c.beginPath();
      c.ellipse(cx, cy, Math.min(w * 0.36, 560), Math.min(h * 0.38, 250), 0, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(42,33,64,.35)';
      for (const k of [-13, 13]) {
        c.beginPath();
        c.ellipse(cx, cy, Math.min(w * 0.36, 560) + k, Math.min(h * 0.38, 250) + k, 0, 0, Math.PI * 2);
        c.stroke();
      }
      // 별 무늬 타일 (둘레에 작은 별)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        star(c, cx + Math.cos(a) * Math.min(w * 0.36, 560), cy + Math.sin(a) * Math.min(h * 0.38, 250), 11, i % 2 ? '#ffd84d' : '#fff6e5', 2);
      }
      // 구석 별 몇 개
      for (let i = 0; i < 10; i++) star(c, x + 60 + rnd(i, 5) * (w - 120), y + 50 + rnd(i, 6) * (h - 100), 8, 'rgba(255,216,77,.75)', 0);
    },
    // 놀이기구 아래 고무 바닥 (주황·하늘 얼룩)
    pkRubber(c, x, y, w, h) {
      c.fillStyle = '#7fc8e8';
      c.fillRect(x, y, w, h);
      const n = Math.floor((w * h) / 600);
      for (let i = 0; i < n; i++) {
        c.fillStyle = ['rgba(255,255,255,.3)', 'rgba(42,33,64,.12)', 'rgba(255,154,60,.45)'][i % 3];
        c.fillRect(x + rnd(i, 51) * w, y + rnd(i, 52) * h, 4, 4);
      }
      // 큰 물방울 무늬
      for (let i = 0; i < 6; i++) ellipse(c, x + 80 + rnd(i, 53) * (w - 160), y + 80 + rnd(i, 54) * (h - 160), 50, 30, 'rgba(255,216,77,.35)', 0);
    },
    // 오락실: 짙은 남색 카펫 + 네온 도형 (삼각·동그라미·번개)
    pkArcadeFloor(c, x, y, w, h) {
      c.fillStyle = '#3b3270';
      c.fillRect(x, y, w, h);
      const cols = ['#ff5fa8', '#5ff0ff', '#ffe14d', '#8bff7a'];
      for (let i = 0; i < (w * h) / 9000; i++) {
        const px = x + rnd(i, 61) * w;
        const py = y + rnd(i, 62) * h;
        c.strokeStyle = cols[i % 4];
        c.lineWidth = 3;
        c.beginPath();
        if (i % 3 === 0) c.arc(px, py, 9, 0, Math.PI * 2);
        else if (i % 3 === 1) (c.moveTo(px, py - 10), c.lineTo(px + 10, py + 8), c.lineTo(px - 10, py + 8), c.closePath());
        else (c.moveTo(px - 4, py - 10), c.lineTo(px + 4, py - 2), c.lineTo(px - 3, py + 1), c.lineTo(px + 5, py + 10));
        c.stroke();
      }
    },
    // 유령의 집: 낡은 보라색 마루 + 삐걱 못 자국
    pkGhostFloor(c, x, y, w, h) {
      c.fillStyle = '#7a6aa8';
      c.fillRect(x, y, w, h);
      lines(c, x, y, w, h, 40, false, 'rgba(30,20,60,.35)', 2);
      c.fillStyle = 'rgba(30,20,60,.35)';
      for (let i = 0; i * 40 < w; i++) {
        for (let j = 0; j * 120 < h; j++) {
          const py = y + ((j * 120 + (i % 2) * 60) % h);
          c.fillRect(x + i * 40 + 3, py, 34, 2);
          c.fillRect(x + i * 40 + 6, py + 8, 3, 3);
          c.fillRect(x + i * 40 + 31, py + 8, 3, 3);
        }
      }
      // 귀여운 발자국 (유령은 발이 없어서 동그라미)
      for (let i = 0; i < 8; i++) circle(c, x + 60 + rnd(i, 71) * (w - 120), y + 60 + rnd(i, 72) * (h - 120), 6, 'rgba(255,255,255,.25)', 0);
    },
    // 범퍼카장: 은색 철판 바닥 + 노랑·검정 테두리 줄 + 천장 전기 그물 그림자
    pkBumperFloor(c, x, y, w, h) {
      checker(c, x, y, w, h, 40, ['#b9c2d6', '#a9b3c9']);
      c.fillStyle = 'rgba(255,255,255,.35)';
      for (let j = 0; j * 40 < h; j++) for (let i = 0; i * 40 < w; i++) c.fillRect(x + i * 40 + 18, y + j * 40 + 18, 4, 4);
      // 경기장 테두리 (노랑·검정 사선)
      const m = 50;
      c.save();
      c.beginPath();
      c.rect(x + m - 14, y + m - 14, w - (m - 14) * 2, h - (m - 14) * 2);
      c.rect(x + m, y + m, w - m * 2, h - m * 2);
      c.clip('evenodd');
      c.fillStyle = '#ffd84d';
      c.fillRect(x, y, w, h);
      c.strokeStyle = '#2a2140';
      c.lineWidth = 7;
      c.beginPath();
      for (let v = -h; v < w + h; v += 24) (c.moveTo(x + v, y), c.lineTo(x + v + h, y + h));
      c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(42,33,64,.15)';
      c.lineWidth = 2;
      c.beginPath();
      for (let v = x + 80; v < x + w; v += 80) (c.moveTo(v, y), c.lineTo(v, y + h));
      for (let v = y + 80; v < y + h; v += 80) (c.moveTo(x, v), c.lineTo(x + w, v));
      c.stroke();
    },
    // 어린이 놀이터: 알록달록 고무 매트
    pkKids(c, x, y, w, h) {
      checker(c, x, y, w, h, 80, ['#ffb8cc', '#bfe89a', '#a8dcff', '#ffe38f']);
      lines(c, x, y, w, h, 80, true, 'rgba(42,33,64,.12)');
      lines(c, x, y, w, h, 80, false, 'rgba(42,33,64,.12)');
      // 퍼즐 이음새 동그라미
      c.fillStyle = 'rgba(255,255,255,.35)';
      for (let j = 1; j * 80 < h; j++) {
        for (let i = 1; i * 80 < w; i++) {
          c.beginPath();
          c.arc(x + i * 80, y + j * 80 - 40, 8, 0, Math.PI * 2);
          c.fill();
        }
      }
    },
    // 간식 거리: 분홍·하양 줄무늬 길 + 흩어진 사탕
    pkCandyFloor(c, x, y, w, h) {
      c.fillStyle = '#ffd6e6';
      c.fillRect(x, y, w, h);
      c.fillStyle = '#fff1f6';
      for (let i = 0; i * 60 < w + h; i += 2) {
        c.beginPath();
        c.moveTo(x + i * 60, y);
        c.lineTo(x + i * 60 + 60, y);
        c.lineTo(x + i * 60 + 60 - h, y + h);
        c.lineTo(x + i * 60 - h, y + h);
        c.closePath();
        c.fill();
      }
      const cols = ['#ff7a9c', '#7fe0c4', '#ffd84d', '#9ad0ff'];
      for (let i = 0; i < (w * h) / 12000; i++) {
        const px = x + 30 + rnd(i, 81) * (w - 60);
        const py = y + 30 + rnd(i, 82) * (h - 60);
        circle(c, px, py, 5, cols[i % 4], 2);
      }
    },
  };

  const FURN = {
    // ───── 회전목마 ─────
    // 위에서 비스듬히 본 둥근 회전목마: 원판 + 기둥 + 말 6마리 + 줄무늬 원뿔 천막 + 꼭대기 깃발 + 전구
    pkCarousel(c, x, y, w, h) {
      const cx = x + w / 2;
      const R = w / 2 - 4;
      const base = y + h - R * 0.42 - 6; // 원판 가운데 높이
      // 원판 (옆면 + 윗면)
      ellipse(c, cx, base + 14, R, R * 0.42, '#b05fd0', 4);
      ellipse(c, cx, base, R, R * 0.42, '#ffd6f0', 4);
      ellipse(c, cx, base, R * 0.82, R * 0.34, null, 2);
      // 뒤쪽 말 (위쪽 반)
      const horses = 6;
      const horse = (a) => {
        const hx = cx + Math.cos(a) * R * 0.66;
        const hy = base + Math.sin(a) * R * 0.27;
        const bob = Math.sin(a * 3) * 6;
        c.strokeStyle = '#ffd84d';
        c.lineWidth = 5;
        c.beginPath();
        c.moveTo(hx, hy - 70);
        c.lineTo(hx, hy);
        c.stroke();
        c.strokeStyle = INK;
        c.lineWidth = 1.5;
        c.stroke();
        const cols = ['#fff', '#ffb8cc', '#a8dcff'];
        const col = cols[Math.abs(Math.round(a * 10)) % 3];
        ellipse(c, hx, hy - 30 + bob, 20, 11, col, 3); // 몸
        ellipse(c, hx + 16, hy - 42 + bob, 8, 10, col, 3); // 머리
        rr(c, hx - 16, hy - 24 + bob, 5, 14, 2, col, 2); // 다리
        rr(c, hx + 10, hy - 24 + bob, 5, 14, 2, col, 2);
        c.fillStyle = '#f25c6e';
        c.fillRect(hx - 6, hy - 42 + bob, 10, 6); // 안장
        circle(c, hx + 19, hy - 44 + bob, 1.8, INK, 0); // 눈
      };
      const order = [];
      for (let i = 0; i < horses; i++) order.push(-Math.PI / 2 + (i * Math.PI * 2) / horses + 0.3);
      order.sort((a, b) => Math.sin(a) - Math.sin(b)); // 뒤쪽(위)부터 그린다
      // 가운데 기둥
      rr(c, cx - 14, base - 110, 28, 110, 6, '#ffd84d', 4);
      for (const a of order) horse(a);
      // 천막 지붕 (원뿔: 줄무늬 부채꼴)
      const top = y + 8;
      const roofY = base - 100;
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a0 = Math.PI + (i / n) * Math.PI;
        const a1 = Math.PI + ((i + 1) / n) * Math.PI;
        poly(c, [[cx, top + 10], [cx + Math.cos(a0) * R, roofY + Math.sin(a0) * -R * 0.0], [cx + Math.cos(a1) * R, roofY]], i % 2 ? '#fff6e5' : '#f25c6e', 0);
      }
      // 지붕 아래 테두리 (물결)
      c.beginPath();
      c.moveTo(cx - R, roofY);
      for (let i = 0; i < 10; i++) {
        const x0 = cx - R + (i * 2 * R) / 10;
        c.quadraticCurveTo(x0 + R / 10, roofY + 22, x0 + (2 * R) / 10, roofY);
      }
      c.lineTo(cx, top + 10);
      c.closePath();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.stroke();
      c.fillStyle = '#ffd84d';
      for (let i = 0; i < 10; i++) {
        const bx = cx - R + ((i + 0.5) * 2 * R) / 10;
        circle(c, bx, roofY + 12, 4.5, i % 2 ? '#ffd84d' : '#7fe0c4', 2);
      }
      // 꼭대기 깃발
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(cx, top + 12);
      c.lineTo(cx, y - 6);
      c.stroke();
      poly(c, [[cx, y - 6], [cx + 22, y + 1], [cx, y + 8]], '#ffd84d', 2.5);
      circle(c, cx, top + 10, 6, '#ffd84d', 3);
      // 앞쪽 원판 가장자리 전구
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI;
        circle(c, cx + Math.cos(a) * R * 0.97, base + 7 + Math.sin(a) * R * 0.41, 3.5, i % 2 ? '#ffd84d' : '#ff7a9c', 1.5);
      }
    },
    // ───── 대왕 미끄럼틀 탑 ─────
    // 높은 탑 (층층 발판 + 사다리 + 꼭대기 지붕 + 깃발). 미끄럼 띠는 장치가 그린다
    pkSlideTower(c, x, y, w, h) {
      const tw = w * 0.7;
      const tx = x + (w - tw) / 2;
      const bottom = y + h;
      // 기둥 네 개
      for (const px of [tx + 6, tx + tw - 16]) rr(c, px, y + 70, 10, h - 74, 4, '#5a6ff0', 3);
      for (const px of [tx + 22, tx + tw - 32]) rr(c, px, y + 80, 10, h - 84, 4, '#4a5bd0', 3);
      // 층 발판 3개
      const floors = [y + 90, y + 160, y + 230];
      floors.forEach((fy, i) => {
        rr(c, tx - 4, fy, tw + 8, 22, 6, ['#ffd84d', '#ff9a3c', '#f25c6e'][i], 4);
        // 난간
        c.strokeStyle = INK;
        c.lineWidth = 3;
        c.beginPath();
        for (let px = tx + 4; px <= tx + tw - 4; px += 18) (c.moveTo(px, fy), c.lineTo(px, fy - 18));
        c.moveTo(tx, fy - 18);
        c.lineTo(tx + tw, fy - 18);
        c.stroke();
      });
      // 사다리 (가운데 아래)
      const lx = x + w / 2 - 22;
      rr(c, lx, y + 250, 8, h - 254, 3, '#c98a55', 3);
      rr(c, lx + 36, y + 250, 8, h - 254, 3, '#c98a55', 3);
      for (let ly = y + 264; ly < bottom - 8; ly += 16) rr(c, lx + 4, ly, 36, 5, 2, '#e3a868', 2);
      // 꼭대기 지붕 (뾰족 줄무늬)
      poly(c, [[x + w / 2, y + 2], [tx - 12, y + 72], [tx + tw + 12, y + 72]], '#7fe0c4', 4);
      poly(c, [[x + w / 2, y + 2], [x + w / 2 - 14, y + 72], [x + w / 2 + 14, y + 72]], '#fff6e5', 3);
      circle(c, x + w / 2, y + 4, 7, '#ffd84d', 3);
      // 꼭대기 위 "SLIDE" 간판 대신 별
      star(c, tx + 18, y + 54, 9, '#ffd84d', 2);
      star(c, tx + tw - 18, y + 54, 9, '#ffd84d', 2);
      // 바닥 받침
      rr(c, tx - 10, bottom - 14, tw + 20, 12, 5, '#8d99ae', 3);
    },
    // ───── 무지개 미끄럼틀 (어린이용 작은 미끄럼틀) ─────
    pkRainbowSlide(c, x, y, w, h) {
      // 무지개 아치 (반원 여러 겹)
      const cx = x + w / 2;
      const by = y + h - 10;
      const R = Math.min(w / 2 - 6, h - 20);
      const cols = ['#f25c6e', '#ff9a3c', '#ffd84d', '#7fd36a', '#5cc8f2', '#9b6bf2'];
      const band = R / (cols.length + 1.5);
      cols.forEach((col, i) => {
        c.beginPath();
        c.arc(cx, by, R - i * band, Math.PI, 0);
        c.arc(cx, by, R - (i + 1) * band, 0, Math.PI, true);
        c.closePath();
        c.fillStyle = col;
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = INK;
        c.stroke();
      });
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.beginPath();
      c.arc(cx, by, R, Math.PI, 0);
      c.stroke();
      // 아치 발 받침
      rr(c, cx - R - 8, by - 6, 26, 14, 5, '#fff6e5', 3);
      rr(c, cx + R - 18, by - 6, 26, 14, 5, '#fff6e5', 3);
      // 구름 두 개
      for (const [kx, ky] of [[-R * 0.75, -R * 0.15], [R * 0.7, -R * 0.2]]) {
        circle(c, cx + kx - 9, by + ky, 10, '#fff', 2.5);
        circle(c, cx + kx + 9, by + ky, 10, '#fff', 2.5);
        circle(c, cx + kx, by + ky - 8, 11, '#fff', 2.5);
      }
    },
    // ───── 대관람차 (큰 장식) ─────
    pkFerrisWheel(c, x, y, w, h) {
      const cx = x + w / 2;
      const R = w / 2 - 26;
      const cy = y + R + 26;
      const bottom = y + h;
      // A자 다리
      c.lineCap = 'round';
      for (const [dx0, dx1] of [[-14, -R * 0.75], [14, R * 0.75]]) {
        c.strokeStyle = INK;
        c.lineWidth = 16;
        c.beginPath();
        c.moveTo(cx + dx0, cy);
        c.lineTo(cx + dx1, bottom - 16);
        c.stroke();
        c.strokeStyle = '#8d99ae';
        c.lineWidth = 9;
        c.stroke();
      }
      // 바퀴 테 + 살
      circle(c, cx, cy, R, null, 8);
      c.strokeStyle = '#ff7a9c';
      c.lineWidth = 5;
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.stroke();
      circle(c, cx, cy, R * 0.62, null, 3);
      const n = 10;
      c.strokeStyle = 'rgba(255,246,229,.9)';
      c.lineWidth = 3;
      c.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      c.stroke();
      // 테두리 전구
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2;
        circle(c, cx + Math.cos(a) * R, cy + Math.sin(a) * R, 3.5, i % 2 ? '#ffd84d' : '#fff6e5', 1.5);
      }
      // 칸 (곤돌라) — 항상 아래로 매달림
      const cols = ['#f25c6e', '#ffd84d', '#5cc8f2', '#7fd36a', '#b79cff'];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.31;
        const gx = cx + Math.cos(a) * R;
        const gy = cy + Math.sin(a) * R;
        c.strokeStyle = INK;
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(gx, gy);
        c.lineTo(gx, gy + 8);
        c.stroke();
        rr(c, gx - 15, gy + 8, 30, 24, 8, cols[i % cols.length], 3);
        rr(c, gx - 10, gy + 12, 20, 9, 3, '#e6f7ff', 2);
      }
      // 가운데 축
      circle(c, cx, cy, 16, '#ffd84d', 4);
      star(c, cx, cy, 9, '#ff7a9c', 2);
      // 바닥 받침 + 탑승장
      rr(c, cx - R * 0.85, bottom - 30, R * 1.7, 26, 8, '#c98a55', 4);
      lines(c, cx - R * 0.85, bottom - 30, R * 1.7, 26, 24, false, 'rgba(110,60,20,.35)', 2);
      rr(c, cx - 26, bottom - 52, 52, 26, 6, '#5a6ff0', 3);
    },
    // ───── 범퍼카 ─────
    pkBumperCar(c, x, y, w, h) {
      const cols = ['#f25c6e', '#5cc8f2', '#ffd84d', '#7fd36a', '#b79cff'];
      const col = cols[Math.round(x / 20 + y / 20) % cols.length];
      // 전기 막대
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + w * 0.7, y + 18);
      c.lineTo(x + w * 0.7, y - 4);
      c.stroke();
      circle(c, x + w * 0.7, y - 6, 4, '#ffd84d', 2);
      // 고무 범퍼 + 몸통
      rr(c, x, y + 14, w, h - 14, 18, '#3b3252', 4);
      rr(c, x + 6, y + 10, w - 12, h - 22, 14, col, 4);
      rr(c, x + w * 0.22, y + 16, w * 0.46, h - 36, 8, '#fff6e5', 3); // 의자
      circle(c, x + w * 0.3, y + 26, 6, '#2a2140', 2.5); // 핸들
      circle(c, x + 14, y + h - 18, 4, '#fff', 1.5);
      circle(c, x + w - 14, y + h - 18, 4, '#fff', 1.5);
    },
    // ───── 간식 거리 ─────
    // 솜사탕 수레 (바퀴 + 분홍 솜사탕 기계 + 막대 꽂이)
    pkCottonCandy(c, x, y, w, h) {
      rr(c, x + 4, y + h * 0.45, w - 8, h * 0.45, 8, '#ff9ec4');
      lines(c, x + 4, y + h * 0.45, w - 8, h * 0.45, 14, false, 'rgba(255,255,255,.45)', 4);
      circle(c, x + 18, y + h - 8, 8, '#3b3252', 3);
      circle(c, x + w - 18, y + h - 8, 8, '#3b3252', 3);
      ellipse(c, x + w * 0.38, y + h * 0.42, w * 0.22, h * 0.12, '#c9d3df', 3); // 기계 통
      candyFloss(c, x + w * 0.38, y + h * 0.3, 14, '#ffc7e1');
      candyFloss(c, x + w * 0.75, y + h * 0.26, 10, '#b8e2ff');
      candyFloss(c, x + w * 0.88, y + h * 0.33, 8, '#ffc7e1');
    },
    // 팝콘 수레 (빨강·하양 줄무늬 + 유리 상자 속 팝콘)
    pkPopcorn(c, x, y, w, h) {
      rr(c, x + 4, y + h * 0.5, w - 8, h * 0.4, 6, '#f25c6e');
      c.save();
      c.beginPath();
      c.rect(x + 4, y + h * 0.5, w - 8, h * 0.4);
      c.clip();
      c.fillStyle = '#fff';
      for (let px = x + 10; px < x + w; px += 16) c.fillRect(px, y + h * 0.5, 7, h * 0.4);
      c.restore();
      rr(c, x + 4, y + h * 0.5, w - 8, h * 0.4, 6, null);
      rr(c, x + 8, y + 12, w - 16, h * 0.4, 5, 'rgba(230,247,255,.85)', 3);
      for (let i = 0; i < 10; i++) circle(c, x + 16 + rnd(i, x) * (w - 32), y + 18 + h * 0.2 + rnd(i, y) * h * 0.18, 4.5, i % 3 ? '#fff6c8' : '#ffd84d', 1.5);
      rr(c, x + 2, y + 2, w - 4, 12, 5, '#f25c6e', 3);
      circle(c, x + 16, y + h - 6, 6, '#3b3252', 2.5);
      circle(c, x + w - 16, y + h - 6, 6, '#3b3252', 2.5);
    },
    // 간식 가게 (줄무늬 천막 + 계산대 + 간판 그림: 이름에 따라 바꾸지 않고 칸마다 다른 간식)
    pkFoodStall(c, x, y, w, h) {
      const cols = [['#f25c6e', '#fff6e5'], ['#5cc8f2', '#fff6e5'], ['#7fd36a', '#fff6e5'], ['#ff9a3c', '#fff6e5']];
      const [a, b] = cols[Math.round(x / 20 + y / 40) % cols.length];
      rr(c, x + 8, y + 30, w - 16, h - 32, 8, '#d9a066'); // 가게 몸통
      lines(c, x + 8, y + 30, w - 16, h - 32, 22, false, 'rgba(110,60,20,.3)', 2);
      rr(c, x + 2, y + h - 40, w - 4, 26, 6, '#fff6e5', 4); // 계산대
      // 진열된 간식 (핫도그·아이스크림·도넛)
      const sx = x + 22;
      for (let i = 0; i * 44 < w - 50; i++) {
        const px = sx + i * 44;
        const py = y + h - 34;
        if (i % 3 === 0) {
          rr(c, px, py + 2, 30, 12, 6, '#e3a868', 2);
          rr(c, px + 4, py + 4, 22, 7, 3, '#c0504a', 1.5);
        } else if (i % 3 === 1) {
          poly(c, [[px + 8, py + 8], [px + 22, py + 8], [px + 15, py + 18]], '#e3a868', 2);
          circle(c, px + 15, py + 4, 8, '#ffc7e1', 2);
        } else {
          circle(c, px + 15, py + 8, 9, '#ff9ec4', 2);
          circle(c, px + 15, py + 8, 3.5, '#d9a066', 1.5);
        }
      }
      awning(c, x, y + 4, w, 34, a, b);
      // 지붕 위 작은 간판
      rr(c, x + w / 2 - 26, y - 4, 52, 16, 6, '#ffd84d', 3);
      star(c, x + w / 2, y + 4, 6, '#f25c6e', 1.5);
    },
    // 파라솔 식탁 (위에서 본 둥근 파라솔 + 의자)
    pkPicnic(c, x, y, w, h) {
      for (const [dx, dy] of [[0.1, 0.75], [0.9, 0.75], [0.5, 0.95]]) circle(c, x + w * dx, y + h * dy - 6, 9, '#7fe0c4', 3);
      rr(c, x + w * 0.2, y + h * 0.55, w * 0.6, h * 0.3, 8, '#fff6e5', 3); // 식탁
      rr(c, x + w / 2 - 3, y + h * 0.3, 6, h * 0.35, 2, '#8d99ae', 2); // 기둥
      // 파라솔 (반쪽 원 줄무늬)
      const cx = x + w / 2;
      const cy = y + h * 0.34;
      const R = w / 2 - 4;
      for (let i = 0; i < 6; i++) {
        c.beginPath();
        c.moveTo(cx, cy - R * 0.55);
        c.lineTo(cx - R + (i * 2 * R) / 6, cy);
        c.lineTo(cx - R + ((i + 1) * 2 * R) / 6, cy);
        c.closePath();
        c.fillStyle = i % 2 ? '#fff6e5' : '#ff7a9c';
        c.fill();
      }
      poly(c, [[cx, cy - R * 0.55], [cx - R, cy], [cx + R, cy]], null, 3);
      circle(c, cx, cy - R * 0.55, 4, '#ffd84d', 2);
    },
    // ───── 오락실 ─────
    // 게임기 (오락기 한 대: 화면 + 조이스틱 + 버튼)
    pkArcade(c, x, y, w, h) {
      const cols = ['#5a6ff0', '#f25c6e', '#3fae6a', '#9b6bf2'];
      const col = cols[Math.round(x / 80 + y / 100) % cols.length];
      rr(c, x + 4, y, w - 8, h - 4, 8, col);
      rr(c, x + 10, y + 6, w - 20, 14, 4, '#ffd84d', 2.5); // 위 간판
      label(c, 'GAME', x + w / 2, y + 13, 10, INK);
      rr(c, x + 12, y + 24, w - 24, h * 0.34, 4, '#1c1530', 3); // 화면
      // 화면 속 귀여운 우주선·별
      c.fillStyle = '#7fe0c4';
      c.fillRect(x + w / 2 - 6, y + 24 + h * 0.24, 12, 5);
      c.fillRect(x + w / 2 - 2, y + 24 + h * 0.2, 4, 5);
      c.fillStyle = '#ff5fa8';
      c.fillRect(x + 20, y + 32, 5, 5);
      c.fillRect(x + w - 26, y + 36, 5, 5);
      rr(c, x + 6, y + h * 0.62, w - 12, h * 0.16, 4, '#d9e1ea', 3); // 조작판
      circle(c, x + 20, y + h * 0.7, 4, '#2a2140', 2);
      circle(c, x + w - 26, y + h * 0.7, 4, '#ff5fa8', 2);
      circle(c, x + w - 16, y + h * 0.7, 4, '#ffd84d', 2);
    },
    // 인형 뽑기 기계 (유리 상자 + 집게 + 인형)
    pkClaw(c, x, y, w, h) {
      rr(c, x + 4, y, w - 8, h - 4, 10, '#ff9ec4');
      rr(c, x + 12, y + 8, w - 24, h * 0.55, 6, 'rgba(230,247,255,.9)', 3);
      // 인형 더미
      const cols = ['#ffd84d', '#a8dcff', '#bfe89a', '#fff'];
      for (let i = 0; i < 5; i++) {
        const px = x + 24 + i * ((w - 48) / 4);
        const py = y + h * 0.5;
        circle(c, px, py, 9, cols[i % 4], 2);
        circle(c, px - 5, py - 8, 3.5, cols[i % 4], 1.5);
        circle(c, px + 5, py - 8, 3.5, cols[i % 4], 1.5);
      }
      // 집게
      c.strokeStyle = INK;
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(x + w * 0.6, y + 8);
      c.lineTo(x + w * 0.6, y + 26);
      c.moveTo(x + w * 0.6 - 9, y + 36);
      c.lineTo(x + w * 0.6, y + 26);
      c.lineTo(x + w * 0.6 + 9, y + 36);
      c.stroke();
      rr(c, x + 10, y + h * 0.68, w - 20, h * 0.18, 4, '#fff6e5', 3);
      circle(c, x + 26, y + h * 0.77, 5, '#2a2140', 2);
      circle(c, x + w - 28, y + h * 0.77, 6, '#f25c6e', 2);
    },
    // 경품 진열대 (곰인형·풍선 상품)
    pkPrize(c, x, y, w, h) {
      rr(c, x, y + 10, w, h - 10, 8, '#c98a55');
      rr(c, x + 6, y + 14, w - 12, 12, 4, '#e3a868', 2);
      const cols = ['#ffd84d', '#ff9ec4', '#a8dcff', '#bfe89a'];
      for (let i = 0; i * 34 < w - 20; i++) {
        const px = x + 22 + i * 34;
        circle(c, px, y + 10, 10, cols[i % 4], 2.5);
        circle(c, px - 7, y + 1, 4, cols[i % 4], 2);
        circle(c, px + 7, y + 1, 4, cols[i % 4], 2);
        circle(c, px, y + 13, 2, INK, 0);
      }
      label(c, '경품', x + w / 2, y + h - 16, 15, '#fff6e5');
    },
    // ───── 매표소·기념품 ─────
    pkTicketBooth(c, x, y, w, h) {
      rr(c, x + 10, y + 36, w - 20, h - 38, 8, '#7fe0c4');
      rr(c, x + 24, y + 50, w - 48, h * 0.32, 6, '#e6f7ff', 3); // 창구 유리
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x + w / 2, y + 50 + h * 0.32, 12, Math.PI, 0);
      c.stroke();
      rr(c, x + 4, y + h - 34, w - 8, 18, 5, '#fff6e5', 3); // 받침대
      rr(c, x + w / 2 - 34, y + h - 32, 26, 12, 3, '#ffd84d', 2); // 표
      awning(c, x, y + 8, w, 34, '#9b6bf2', '#fff6e5');
      rr(c, x + w / 2 - 34, y - 6, 68, 20, 6, '#ffd84d', 3);
      label(c, '매표소', x + w / 2, y + 4, 13, INK);
    },
    // 기념품 진열대 (머리띠·풍선·인형)
    pkSouvenir(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#b07a4f');
      rr(c, x + 6, y + 6, w - 12, h - 16, 5, '#e3a868', 3);
      for (let i = 0; i * 36 < w - 24; i++) {
        const px = x + 22 + i * 36;
        if (i % 3 === 0) {
          // 토끼 머리띠
          c.strokeStyle = INK;
          c.lineWidth = 3;
          c.beginPath();
          c.arc(px, y + h / 2 + 2, 10, Math.PI, 0);
          c.stroke();
          ellipse(c, px - 6, y + h / 2 - 12, 4, 9, '#ff9ec4', 2);
          ellipse(c, px + 6, y + h / 2 - 12, 4, 9, '#ff9ec4', 2);
        } else if (i % 3 === 1) {
          circle(c, px, y + h / 2, 10, '#ffd84d', 2.5);
          star(c, px, y + h / 2, 6, '#f25c6e', 1.5);
        } else {
          rr(c, px - 9, y + h / 2 - 10, 18, 20, 5, '#a8dcff', 2.5);
          label(c, '♥', px, y + h / 2, 11, '#f25c6e');
        }
      }
    },
    // 개찰구 (작은 회전 막대)
    pkTurnstile(c, x, y, w, h) {
      rr(c, x + 4, y + 4, w - 8, h - 6, 6, '#c9d3df');
      rr(c, x + 8, y + 2, 14, 10, 3, '#3fae6a', 2);
      c.strokeStyle = INK;
      c.lineWidth = 5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x + w / 2, y + h / 2);
      c.lineTo(x + w - 2, y + h / 2 - 6);
      c.stroke();
      c.strokeStyle = '#ffd84d';
      c.lineWidth = 2.5;
      c.stroke();
    },
    // ───── 거리 소품 ─────
    // 벤치 (빨간 나무 벤치 + 철 다리)
    pkBench(c, x, y, w, h) {
      rr(c, x + 6, y + h - 12, 8, 12, 2, '#3b3252', 2);
      rr(c, x + w - 14, y + h - 12, 8, 12, 2, '#3b3252', 2);
      rr(c, x, y, w, h * 0.42, 6, '#f25c6e', 3.5); // 등받이
      rr(c, x, y + h * 0.4, w, h * 0.38, 6, '#ff8a8a', 3.5); // 앉는 곳
      lines(c, x, y, w, h * 0.42, 20, false, 'rgba(42,33,64,.25)', 2);
    },
    // 가로등 (둥근 등 + 별 장식, 노란 불빛)
    pkLamp(c, x, y, w, h) {
      const cx = x + w / 2;
      const glow = c.createRadialGradient(cx, y + 18, 2, cx, y + 18, 40);
      glow.addColorStop(0, 'rgba(255,230,140,.75)');
      glow.addColorStop(1, 'rgba(255,230,140,0)');
      c.fillStyle = glow;
      c.fillRect(cx - 40, y - 22, 80, 80);
      rr(c, cx - 4, y + 26, 8, h - 34, 3, '#3b3252', 3);
      rr(c, cx - 12, y + h - 12, 24, 10, 4, '#3b3252', 3);
      circle(c, cx, y + 18, 13, '#fff3b0', 3.5);
      rr(c, cx - 10, y + 2, 20, 6, 3, '#3b3252', 2.5);
      star(c, cx, y - 2, 5, '#ffd84d', 1.5);
    },
    // 풍선 수레 (풍선 다발 + 작은 손수레)
    pkBalloon(c, x, y, w, h) {
      const cx = x + w / 2;
      const by = y + h - 26;
      const cols = ['#f25c6e', '#ffd84d', '#5cc8f2', '#7fd36a', '#b79cff', '#ff9ec4'];
      const spots = [[-14, 16], [12, 12], [0, 30], [-20, 38], [18, 36], [-4, 6]];
      c.strokeStyle = 'rgba(42,33,64,.6)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (const [dx, dy] of spots) (c.moveTo(cx, by), c.lineTo(cx + dx, y + dy + 12));
      c.stroke();
      spots.forEach(([dx, dy], i) => {
        ellipse(c, cx + dx, y + dy, 10, 12, cols[i % cols.length], 2.5);
        c.fillStyle = 'rgba(255,255,255,.6)';
        c.beginPath();
        c.arc(cx + dx - 3, y + dy - 4, 2.5, 0, Math.PI * 2);
        c.fill();
      });
      rr(c, x + 6, by, w - 12, 16, 5, '#5a6ff0', 3);
      circle(c, x + 14, y + h - 6, 5, '#3b3252', 2);
      circle(c, x + w - 14, y + h - 6, 5, '#3b3252', 2);
    },
    // 분수 (둥근 돌 테두리 + 물 + 가운데 물줄기)
    pkFountain(c, x, y, w, h) {
      const cx = x + w / 2;
      const cy = y + h * 0.62;
      ellipse(c, cx, cy + 6, w / 2 - 2, h * 0.36, '#a9a3bd', 4);
      ellipse(c, cx, cy, w / 2 - 2, h * 0.36, '#d8d3e8', 4);
      ellipse(c, cx, cy, w / 2 - 18, h * 0.36 - 14, '#5cc8f2', 3);
      c.strokeStyle = 'rgba(255,255,255,.65)';
      c.lineWidth = 3;
      for (const k of [0.35, 0.6]) {
        c.beginPath();
        c.ellipse(cx, cy, (w / 2 - 18) * k * 1.4, (h * 0.36 - 14) * k * 1.4, 0, 0, Math.PI * 2);
        c.stroke();
      }
      // 가운데 받침 + 위 접시
      rr(c, cx - 10, y + h * 0.3, 20, h * 0.34, 5, '#d8d3e8', 3);
      ellipse(c, cx, y + h * 0.3, 36, 11, '#d8d3e8', 3);
      ellipse(c, cx, y + h * 0.3, 26, 7, '#5cc8f2', 2);
      // 물줄기
      c.strokeStyle = '#bfeaff';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      for (const s of [-1, 1]) {
        c.moveTo(cx, y + h * 0.24);
        c.quadraticCurveTo(cx + s * 30, y - 2, cx + s * 52, y + h * 0.42);
      }
      c.moveTo(cx, y + h * 0.24);
      c.lineTo(cx, y + 4);
      c.stroke();
      circle(c, cx, y + 4, 6, '#e6f7ff', 2);
      // 동전 몇 개
      for (let i = 0; i < 5; i++) circle(c, cx - 70 + rnd(i, 91) * 140, cy + 6 + rnd(i, 92) * 18, 3.5, '#ffd84d', 1.5);
    },
    // 꽃 화분 (네모 나무 화분 + 꽃)
    pkFlower(c, x, y, w, h) {
      rr(c, x, y + h * 0.35, w, h * 0.65, 8, '#c98a55');
      lines(c, x, y + h * 0.35, w, h * 0.65, 20, false, 'rgba(110,60,20,.3)', 2);
      const cols = ['#ff9ec4', '#ffd84d', '#f25c6e', '#b79cff', '#fff'];
      let i = 0;
      for (let fx = x + 14; fx < x + w - 8; fx += 20) {
        const fy = y + h * 0.3 + (i % 2 ? 6 : -4);
        circle(c, fx, fy, 7, cols[i % cols.length], 2);
        circle(c, fx, fy, 2.5, '#f8961e', 0);
        i++;
      }
    },
    // 울타리 (놀이공원 하얀 말뚝 울타리, 가로·세로 모두)
    pkFence(c, x, y, w, h) {
      const horiz = w >= h;
      if (horiz) {
        rr(c, x, y + h * 0.35, w, 7, 3, '#fff6e5', 2.5);
        rr(c, x, y + h * 0.65, w, 7, 3, '#fff6e5', 2.5);
        for (let px = x + 4; px < x + w - 6; px += 18) poly(c, [[px, y + h], [px, y + 6], [px + 5, y], [px + 10, y + 6], [px + 10, y + h]], '#fff6e5', 2.5);
      } else {
        rr(c, x + w * 0.3, y, 7, h, 3, '#fff6e5', 2.5);
        for (let py = y + 2; py < y + h - 10; py += 18) rr(c, x + 2, py, w - 4, 10, 3, '#fff6e5', 2.5);
      }
    },
    // ───── 어린이 놀이터 ─────
    // 흔들 말 (스프링 위 작은 말)
    pkSpringHorse(c, x, y, w, h) {
      ellipse(c, x + w / 2, y + h - 6, w / 2 - 6, 6, '#8d99ae', 3);
      c.strokeStyle = INK;
      c.lineWidth = 2.5;
      c.beginPath();
      for (let k = 0; k < 4; k++) {
        c.moveTo(x + w / 2 - 7, y + h - 10 - k * 6);
        c.lineTo(x + w / 2 + 7, y + h - 13 - k * 6);
      }
      c.stroke();
      const col = x % 40 === 0 ? '#ffd84d' : '#7fe0c4';
      ellipse(c, x + w / 2, y + h * 0.42, w / 2 - 8, h * 0.17, col, 3);
      ellipse(c, x + w - 14, y + h * 0.2, 8, 10, col, 3);
      circle(c, x + w - 12, y + h * 0.17, 2, INK, 0);
      rr(c, x + w / 2 - 6, y + h * 0.3, 12, 6, 2, '#f25c6e', 2);
    },
    // 찻잔 놀이기구 (커다란 찻잔 + 손잡이 + 무늬)
    pkTeacup(c, x, y, w, h) {
      ellipse(c, x + w / 2, y + h - 12, w / 2 - 4, 10, '#b79cff', 3);
      c.beginPath();
      c.moveTo(x + 10, y + 26);
      c.quadraticCurveTo(x + 12, y + h - 8, x + w / 2, y + h - 10);
      c.quadraticCurveTo(x + w - 12, y + h - 8, x + w - 10, y + 26);
      c.closePath();
      c.fillStyle = '#ffb8cc';
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.stroke();
      ellipse(c, x + w / 2, y + 26, w / 2 - 10, 14, '#fff6e5', 4);
      ellipse(c, x + w / 2, y + 28, w / 2 - 22, 8, '#c0504a', 2);
      c.lineWidth = 6;
      c.strokeStyle = INK;
      c.beginPath();
      c.arc(x + w - 8, y + 50, 12, -1.2, 1.2);
      c.stroke();
      c.lineWidth = 3;
      c.strokeStyle = '#ffb8cc';
      c.stroke();
      for (let i = 0; i < 4; i++) circle(c, x + 26 + i * ((w - 52) / 3), y + h * 0.62, 5, '#fff', 2);
    },
    // ───── 유령의 집 소품 (무섭지 않게, 웃는 얼굴) ─────
    // 관 (가로·세로 모두. 뚜껑이 살짝 열려 있고 웃는 유령이 빼꼼)
    pkCoffin(c, x, y, w, h) {
      const vert = h > w;
      const cx = x + w / 2;
      const cy = y + h / 2;
      c.save();
      c.translate(cx, cy);
      if (!vert) c.rotate(-Math.PI / 2);
      const L = vert ? h : w;
      const W = vert ? w : h;
      const pts = [[-W * 0.32, -L / 2], [W * 0.32, -L / 2], [W / 2, -L * 0.22], [W * 0.36, L / 2], [-W * 0.36, L / 2], [-W / 2, -L * 0.22]];
      poly(c, pts, '#8a5a3c', 4);
      poly(c, pts.map(([px, py]) => [px * 0.78, py * 0.84 - 2]), '#b07a4f', 2.5);
      // 십자 대신 별
      star(c, 0, -L * 0.05, Math.min(W, L) * 0.14, '#ffd84d', 2);
      c.restore();
      // 빼꼼 유령 (그림 위쪽)
      const gx = vert ? x + w * 0.72 : x + w * 0.78;
      const gy = vert ? y + 14 : y + 8;
      c.beginPath();
      c.arc(gx, gy, 10, Math.PI, 0);
      c.lineTo(gx + 10, gy + 10);
      c.lineTo(gx + 5, gy + 6);
      c.lineTo(gx, gy + 10);
      c.lineTo(gx - 5, gy + 6);
      c.lineTo(gx - 10, gy + 10);
      c.closePath();
      c.fillStyle = '#fff';
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = INK;
      c.stroke();
      circle(c, gx - 3.5, gy - 1, 1.8, INK, 0);
      circle(c, gx + 3.5, gy - 1, 1.8, INK, 0);
    },
    // 호박 등불 (웃는 얼굴)
    pkPumpkin(c, x, y, w, h) {
      const cx = x + w / 2;
      const cy = y + h * 0.58;
      const R = Math.min(w, h) / 2 - 3;
      ellipse(c, cx - R * 0.45, cy, R * 0.6, R * 0.78, '#ff9a3c', 3);
      ellipse(c, cx + R * 0.45, cy, R * 0.6, R * 0.78, '#ff9a3c', 3);
      ellipse(c, cx, cy, R * 0.62, R * 0.82, '#ffb347', 3);
      rr(c, cx - 3, cy - R * 0.82 - 9, 6, 11, 2, '#3fae6a', 2.5);
      // 눈·입 (노란 빛)
      poly(c, [[cx - 11, cy - 3], [cx - 5, cy - 11], [cx - 1, cy - 3]], '#ffe680', 2);
      poly(c, [[cx + 1, cy - 3], [cx + 5, cy - 11], [cx + 11, cy - 3]], '#ffe680', 2);
      c.beginPath();
      c.moveTo(cx - 12, cy + 4);
      c.quadraticCurveTo(cx, cy + 16, cx + 12, cy + 4);
      c.closePath();
      c.fillStyle = '#ffe680';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = INK;
      c.stroke();
    },
    // 거미줄 장식 기둥 (작은 틀에 걸린 큰 거미줄 + 동글동글 거미)
    pkCobweb(c, x, y, w, h) {
      rr(c, x + 2, y + 2, 8, h - 4, 3, '#5b4b8a', 2.5);
      rr(c, x + w - 10, y + 2, 8, h - 4, 3, '#5b4b8a', 2.5);
      rr(c, x + 2, y + 2, w - 4, 8, 3, '#5b4b8a', 2.5);
      const cx = x + w / 2;
      const cy = y + h * 0.45;
      const R = Math.min(w, h) / 2 - 10;
      c.strokeStyle = 'rgba(255,255,255,.9)';
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      for (const k of [0.35, 0.65, 0.95]) {
        for (let i = 0; i < 8; i++) {
          const a0 = (i / 8) * Math.PI * 2;
          const a1 = ((i + 1) / 8) * Math.PI * 2;
          c.moveTo(cx + Math.cos(a0) * R * k, cy + Math.sin(a0) * R * k);
          c.quadraticCurveTo(cx + Math.cos((a0 + a1) / 2) * R * k * 0.8, cy + Math.sin((a0 + a1) / 2) * R * k * 0.8, cx + Math.cos(a1) * R * k, cy + Math.sin(a1) * R * k);
        }
      }
      c.stroke();
      circle(c, cx + R * 0.3, cy + R * 0.25, 7, '#2a2140', 2);
      circle(c, cx + R * 0.3 - 2.5, cy + R * 0.25 - 2, 1.8, '#fff', 0);
      circle(c, cx + R * 0.3 + 2.5, cy + R * 0.25 - 2, 1.8, '#fff', 0);
    },
    // 비석 (둥근 돌 + "쉿" 글씨)
    pkTomb(c, x, y, w, h) {
      ellipse(c, x + w / 2, y + h - 6, w / 2 - 2, 6, '#7fd36a', 2.5);
      c.beginPath();
      c.moveTo(x + 8, y + h - 6);
      c.lineTo(x + 8, y + 22);
      c.arc(x + w / 2, y + 22, w / 2 - 8, Math.PI, 0);
      c.lineTo(x + w - 8, y + h - 6);
      c.closePath();
      c.fillStyle = '#c9c3dc';
      c.fill();
      c.lineWidth = 3.5;
      c.strokeStyle = INK;
      c.stroke();
      label(c, '쉿', x + w / 2, y + h / 2 + 2, 14, '#5b4b8a');
    },
    // 유령의 집 칸막이 (세로로 긴 벽: 보라 판자 + 커튼 + 웃는 유령 그림)
    pkGhostWall(c, x, y, w, h) {
      const vert = h >= w;
      rr(c, x, y, w, h, 6, '#4a3a78');
      if (vert) {
        lines(c, x, y, w, h, 40, true, 'rgba(255,255,255,.12)', 2);
        // 물결 커튼 가장자리
        c.fillStyle = '#9b6bf2';
        for (let py = y + 10; py < y + h - 20; py += 60) {
          c.beginPath();
          c.arc(x + w / 2, py + 10, w / 2 - 6, 0, Math.PI * 2);
          c.fill();
        }
        // 작은 유령 그림 두 개
        for (const k of [0.3, 0.72]) {
          const gx = x + w / 2;
          const gy = y + h * k;
          c.beginPath();
          c.arc(gx, gy, 11, Math.PI, 0);
          c.lineTo(gx + 11, gy + 13);
          c.lineTo(gx + 5, gy + 9);
          c.lineTo(gx, gy + 13);
          c.lineTo(gx - 5, gy + 9);
          c.lineTo(gx - 11, gy + 13);
          c.closePath();
          c.fillStyle = '#fff';
          c.fill();
          c.lineWidth = 2.5;
          c.strokeStyle = INK;
          c.stroke();
          circle(c, gx - 4, gy - 1, 2, INK, 0);
          circle(c, gx + 4, gy - 1, 2, INK, 0);
          c.beginPath();
          c.arc(gx, gy + 3, 3, 0, Math.PI);
          c.stroke();
        }
      } else {
        lines(c, x, y, w, h, 40, false, 'rgba(255,255,255,.12)', 2);
      }
      rr(c, x, y, w, h, 6, null);
    },
  };
  return { FURN, FLOORS };
}
