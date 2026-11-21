// school 맵(한밤의 학교, maps/night-school.json) 전용 가구·바닥 그림.
// maprender.js 가 그리기 도구(kit)를 넘겨 주면 { FURN, FLOORS } 를 돌려준다.
// FURN[종류](c, x, y, w, h) 는 가구 그림, FLOORS[이름](c, x, y, w, h) 는 방 바닥 그림 (rooms 의 floor).
// 다른 맵 파일과 이름이 겹치지 않도록 모두 'sch' 로 시작한다. (이미 있는 이름은 maprender.js 가 덮어쓰지 않는다)
// 가구가 막는 곳은 그림 rect 의 아랫부분(shared/mapgrid.js footRect)이다. 나무처럼 그림과 막는 곳이 크게 다르면
// 맵 데이터에 foot: [x, y, w, h] 를 적는다.
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
  const grass = (c, x, y, w, h, base, tuft, seed) => {
    c.fillStyle = base;
    c.fillRect(x, y, w, h);
    c.fillStyle = tuft;
    const n = Math.floor((w * h) / 9000);
    for (let i = 0; i < n; i++) {
      const tx = x + rnd(i, seed) * w;
      const ty = y + rnd(i, seed + 7) * h;
      c.fillRect(tx, ty, 4, 11);
      c.fillRect(tx + 7, ty + 3, 4, 8);
    }
  };

  const FLOORS = {
    // 운동장: 잔디 줄무늬 + 붉은 트랙(방 rect 안쪽 100·120px) + 가운데 축구장 선
    schField(c, x, y, w, h) {
      grass(c, x, y, w, h, '#93cc78', 'rgba(52,140,80,.22)', 3);
      c.fillStyle = 'rgba(255,255,255,.08)';
      for (let i = 0; i * 120 < w; i += 2) c.fillRect(x + i * 120, y, 120, h);
      const tx = x + 100;
      const ty = y + 120;
      const tw = w - 200;
      const th = h - 240;
      const R = Math.min(th / 2, 420);
      const lane = 70;
      c.beginPath();
      c.roundRect(tx, ty, tw, th, R);
      c.fillStyle = '#e07a52';
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = INK;
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 3;
      for (const k of [lane / 3, (lane * 2) / 3]) {
        c.beginPath();
        c.roundRect(tx + k, ty + k, tw - k * 2, th - k * 2, R - k);
        c.stroke();
      }
      const ix = tx + lane;
      const iy = ty + lane;
      const iw = tw - lane * 2;
      const ih = th - lane * 2;
      c.beginPath();
      c.roundRect(ix, iy, iw, ih, R - lane);
      c.fillStyle = '#86c46b';
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = INK;
      c.stroke();
      c.save();
      c.clip();
      c.fillStyle = 'rgba(255,255,255,.1)';
      for (let i = 0; i * 100 < iw; i += 2) c.fillRect(ix + i * 100, iy, 100, ih);
      c.restore();
      // 축구장 선
      const px = ix + 40;
      const py = iy + 40;
      const pw = iw - 80;
      const ph = ih - 80;
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      c.strokeStyle = 'rgba(255,255,255,.92)';
      c.lineWidth = 6;
      c.strokeRect(px, py, pw, ph);
      c.beginPath();
      c.moveTo(cx, py);
      c.lineTo(cx, py + ph);
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, 120, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.beginPath();
      c.arc(cx, cy, 8, 0, Math.PI * 2);
      c.fill();
      for (const side of [0, 1]) {
        const bw = 200;
        const bh = Math.min(400, ph * 0.55);
        c.strokeRect(side ? px + pw - bw : px, cy - bh / 2, bw, bh);
        c.strokeRect(side ? px + pw - 80 : px, cy - 90, 80, 180);
      }
    },
    // 화단·연못: 짙은 잔디 + 작은 꽃 + 징검돌
    schGrass(c, x, y, w, h) {
      grass(c, x, y, w, h, '#7fc26c', 'rgba(40,120,70,.25)', 11);
      const cols = ['#ff9ec4', '#ffd84d', '#fff', '#b79cff'];
      const n = Math.floor((w * h) / 14000);
      for (let i = 0; i < n; i++) {
        const fx = x + 30 + rnd(i, 21) * (w - 60);
        const fy = y + 30 + rnd(i, 22) * (h - 60);
        c.fillStyle = cols[i % cols.length];
        for (let k = 0; k < 4; k++) {
          c.beginPath();
          c.arc(fx + Math.cos(k * 1.57) * 4, fy + Math.sin(k * 1.57) * 4, 3.5, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = '#f8961e';
        c.beginPath();
        c.arc(fx, fy, 2.5, 0, Math.PI * 2);
        c.fill();
      }
      // 징검돌 (가운데 세로 길)
      for (let j = 0; j * 90 < h - 60; j++) {
        const sx = x + w / 2 + Math.sin(j * 1.3) * 60;
        const sy = y + 60 + j * 90;
        ellipse(c, sx, sy, 26, 15, '#d9d3e6', 3);
      }
    },
    // 놀이터: 초록 고무 바닥 + 모래밭(방 rect 왼쪽·오른쪽 60, 아래 60 안쪽, 높이 400 — 맵의 '모래밭' 구역과 같은 자리)
    schPlay(c, x, y, w, h) {
      c.fillStyle = '#6cc7a6';
      c.fillRect(x, y, w, h);
      const n = Math.floor((w * h) / 700);
      for (let i = 0; i < n; i++) {
        c.fillStyle = ['rgba(255,255,255,.22)', 'rgba(42,33,64,.12)', 'rgba(255,154,60,.3)'][i % 3];
        c.fillRect(x + rnd(i, 31) * w, y + rnd(i, 32) * h, 4, 4);
      }
      const sx = x + 60;
      const sy = y + h - 460;
      const sw = w - 120;
      const sh = 400;
      c.beginPath();
      c.roundRect(sx, sy, sw, sh, 40);
      c.fillStyle = '#f3d58c';
      c.fill();
      c.lineWidth = 14;
      c.strokeStyle = '#b07a4f';
      c.stroke();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.beginPath();
      c.roundRect(sx - 7, sy - 7, sw + 14, sh + 14, 46);
      c.stroke();
      c.fillStyle = 'rgba(176,122,79,.35)';
      for (let i = 0; i < (sw * sh) / 500; i++) c.fillRect(sx + 10 + rnd(i, 41) * (sw - 20), sy + 10 + rnd(i, 42) * (sh - 20), 3, 3);
      // 모래성 하나
      rr(c, sx + sw - 110, sy + 40, 60, 34, 6, '#e8b96a', 3);
      rr(c, sx + sw - 98, sy + 22, 36, 22, 5, '#e8b96a', 3);
    },
    // 현관: 돌 타일 + 발판
    schEntry(c, x, y, w, h) {
      checker(c, x, y, w, h, 60, ['#dcd7ea', '#c9c3dc']);
      lines(c, x, y, w, h, 60, true, 'rgba(42,33,64,.12)');
      lines(c, x, y, w, h, 60, false, 'rgba(42,33,64,.12)');
    },
  };

  const FURN = {
    // ───── 운동장 ─────
    // 축구 골대 (세로로 긴 것: 골문이 옆을 본다)
    schGoal(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, 'rgba(255,255,255,.35)', 3);
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      c.strokeStyle = 'rgba(42,33,64,.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let v = x - h; v < x + w + h; v += 12) {
        c.moveTo(v, y);
        c.lineTo(v + h, y + h);
        c.moveTo(v + h, y);
        c.lineTo(v, y + h);
      }
      c.stroke();
      c.restore();
      const vertical = h >= w;
      if (vertical) {
        rr(c, x + w / 2 - 5, y - 4, 10, h + 8, 4, '#fff', 3);
        circle(c, x + w / 2, y, 8, '#fff', 3);
        circle(c, x + w / 2, y + h, 8, '#fff', 3);
      } else {
        rr(c, x - 4, y + h / 2 - 5, w + 8, 10, 4, '#fff', 3);
        circle(c, x, y + h / 2, 8, '#fff', 3);
        circle(c, x + w, y + h / 2, 8, '#fff', 3);
      }
    },
    // 철봉 (높이가 다른 세 칸)
    schPullup(c, x, y, w, h) {
      const posts = [x + 8, x + w / 3, x + (w * 2) / 3, x + w - 8];
      const tops = [y + 18, y + 6, y + 18];
      for (let i = 0; i < 3; i++) rr(c, posts[i], tops[i], posts[i + 1] - posts[i], 8, 4, '#ffd84d', 3);
      posts.forEach((px) => {
        rr(c, px - 5, y + 2, 10, h - 8, 4, '#c9d3df', 3);
        rr(c, px - 9, y + h - 12, 18, 10, 4, '#8d99ae', 3);
      });
    },
    // 스탠드 (계단식 관람석)
    schStands(c, x, y, w, h) {
      const n = 3;
      const sh = h / n;
      for (let i = 0; i < n; i++) {
        rr(c, x, y + i * sh, w, sh + 2, 6, ['#c9c3dc', '#d8d3e8', '#e6e2f2'][i], 4);
        c.fillStyle = ['#5a6ff0', '#f25c6e', '#ffd84d'][i];
        for (let s = x + 14; s < x + w - 30; s += 44) c.fillRect(s, y + i * sh + 6, 30, 7);
      }
    },
    // 조회대 (나무 단상 + 계단 + 마이크)
    schStage(c, x, y, w, h) {
      rr(c, x, y, w, h - 22, 10, '#c98a55');
      rr(c, x + 10, y + 8, w - 20, h - 44, 8, '#e3a868', 3);
      lines(c, x + 10, y + 8, w - 20, h - 44, 30, false, 'rgba(110,60,20,.3)', 2);
      rr(c, x + w / 2 - 50, y + h - 26, 100, 13, 3, '#b07a4f', 3);
      rr(c, x + w / 2 - 40, y + h - 14, 80, 13, 3, '#b07a4f', 3);
      // 마이크
      c.strokeStyle = INK;
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(x + w / 2, y + 46);
      c.lineTo(x + w / 2, y + 22);
      c.stroke();
      circle(c, x + w / 2, y + 18, 7, '#3b3252', 3);
      // 깃대 받침
      circle(c, x + 26, y + 26, 9, '#8d99ae', 3);
      circle(c, x + w - 26, y + 26, 9, '#8d99ae', 3);
    },
    // ───── 화단·연못 ─────
    // 나무: 그림은 크고 막는 곳은 줄기 둘레만 (맵 데이터 foot)
    schTree(c, x, y, w, h) {
      c.fillStyle = 'rgba(42,33,64,.2)';
      c.beginPath();
      c.ellipse(x + w / 2 + 6, y + h - 8, w * 0.38, 10, 0, 0, Math.PI * 2);
      c.fill();
      rr(c, x + w / 2 - 9, y + h * 0.55, 18, h * 0.45 - 6, 5, '#8a5a3c', 3);
      const R = w * 0.3;
      circle(c, x + w * 0.3, y + h * 0.42, R, '#3fae6a');
      circle(c, x + w * 0.7, y + h * 0.42, R, '#3fae6a');
      circle(c, x + w / 2, y + h * 0.26, R * 1.1, '#62c98a');
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.beginPath();
      c.arc(x + w * 0.42, y + h * 0.2, R * 0.35, 0, Math.PI * 2);
      c.fill();
    },
    // 꽃 화단 (벽돌 테두리)
    schFlowerbed(c, x, y, w, h) {
      rr(c, x, y, w, h, 10, '#c96b4f');
      rr(c, x + 8, y + 8, w - 16, h - 16, 6, '#7a5236', 3);
      const cols = ['#ff9ec4', '#ffd84d', '#f25c6e', '#b79cff', '#fff'];
      let i = 0;
      for (let fx = x + 22; fx < x + w - 14; fx += 26) {
        const fy = y + h / 2 + (i % 2 ? 6 : -6);
        c.strokeStyle = '#3fae6a';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(fx, fy);
        c.lineTo(fx, fy + 10);
        c.stroke();
        circle(c, fx, fy, 7, cols[i % cols.length], 2);
        circle(c, fx, fy, 2.5, '#f8961e', 0);
        i++;
      }
    },
    // 연못 (돌 테두리 + 연잎 + 개구리)
    schPond(c, x, y, w, h) {
      ellipse(c, x + w / 2, y + h / 2, w / 2 - 2, h / 2 - 2, '#a9a3bd', 4);
      ellipse(c, x + w / 2, y + h / 2, w / 2 - 16, h / 2 - 16, '#5cc8f2', 3);
      c.strokeStyle = 'rgba(255,255,255,.6)';
      c.lineWidth = 3;
      for (const k of [0.45, 0.7]) {
        c.beginPath();
        c.ellipse(x + w * 0.4, y + h * 0.55, w * 0.12 * k * 2, h * 0.06 * k * 2, 0, 0, Math.PI * 2);
        c.stroke();
      }
      for (const [lx, ly] of [[0.66, 0.35], [0.3, 0.38], [0.6, 0.68]]) {
        c.beginPath();
        c.moveTo(x + w * lx, y + h * ly);
        c.arc(x + w * lx, y + h * ly, 17, 0.4, Math.PI * 2 - 0.1);
        c.closePath();
        c.fillStyle = '#3fae6a';
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = INK;
        c.stroke();
      }
      // 개구리
      const fx = x + w * 0.66;
      const fy = y + h * 0.33;
      circle(c, fx, fy, 9, '#a8e05f', 3);
      circle(c, fx - 5, fy - 7, 4, '#fff', 2);
      circle(c, fx + 5, fy - 7, 4, '#fff', 2);
    },
    // 정원 창고
    schShed(c, x, y, w, h) {
      rr(c, x + 10, y + 34, w - 20, h - 34, 6, '#d9a066');
      lines(c, x + 10, y + 34, w - 20, h - 34, 22, false, 'rgba(110,60,20,.35)', 2);
      c.beginPath();
      c.moveTo(x, y + 40);
      c.lineTo(x + w / 2, y + 2);
      c.lineTo(x + w, y + 40);
      c.closePath();
      c.fillStyle = '#e5484d';
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.stroke();
      rr(c, x + w / 2 - 22, y + h - 50, 44, 48, 4, '#8a5a3c', 3);
      circle(c, x + w / 2 + 12, y + h - 26, 3, '#ffd84d', 2);
    },
    // ───── 놀이터 ─────
    schSwing(c, x, y, w, h) {
      rr(c, x, y + 6, w, 12, 5, '#f25c6e', 3);
      for (const px of [x + 8, x + w - 8]) rr(c, px - 6, y + 6, 12, h - 10, 4, '#f25c6e', 3);
      for (const k of [0.32, 0.68]) {
        const sx = x + w * k;
        c.strokeStyle = '#8d99ae';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(sx - 16, y + 18);
        c.lineTo(sx - 16, y + h - 30);
        c.moveTo(sx + 16, y + 18);
        c.lineTo(sx + 16, y + h - 30);
        c.stroke();
        rr(c, sx - 24, y + h - 34, 48, 14, 5, '#ffd84d', 3);
      }
    },
    schSeesaw(c, x, y, w, h) {
      c.beginPath();
      c.moveTo(x + w / 2 - 18, y + h - 4);
      c.lineTo(x + w / 2, y + h / 2 - 4);
      c.lineTo(x + w / 2 + 18, y + h - 4);
      c.closePath();
      c.fillStyle = '#5a6ff0';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = INK;
      c.stroke();
      c.save();
      c.translate(x + w / 2, y + h / 2 - 6);
      c.rotate(-0.12);
      rr(c, -w / 2 + 4, -7, w - 8, 14, 6, '#ffd84d', 3);
      rr(c, -w / 2 + 12, -16, 8, 14, 3, '#f25c6e', 3);
      rr(c, w / 2 - 20, -16, 8, 14, 3, '#f25c6e', 3);
      c.restore();
    },
    // ───── 교실 ─────
    // 학생 책상 두 개 + 의자 (책상 줄)
    schDesks(c, x, y, w, h) {
      const n = Math.max(1, Math.round(w / 80));
      const dw = w / n;
      for (let i = 0; i < n; i++) {
        const dx = x + i * dw;
        rr(c, dx + 12, y + h - 22, dw - 24, 20, 8, '#4a7bf0', 3); // 의자
        rr(c, dx + 4, y + 2, dw - 8, h - 26, 5, '#f6c77e', 4); // 책상
        rr(c, dx + 14, y + 8, 18, 14, 2, i % 2 ? '#fff' : '#ff9ec4', 2); // 공책
      }
    },
    // 교탁
    schLectern(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#b07a4f');
      rr(c, x + 8, y + 6, w - 16, h * 0.4, 5, '#d9a066', 3);
      rr(c, x + w / 2 - 22, y + 10, 30, 16, 2, '#5a6ff0', 2); // 출석부
      circle(c, x + w - 24, y + 18, 6, '#f25c54', 2); // 사과
    },
    // 칠판
    schBoard(c, x, y, w, h) {
      rr(c, x, y, w, h - 8, 6, '#b07a4f');
      rr(c, x + 6, y + 5, w - 12, h - 20, 4, '#2f6b4f', 3);
      label(c, '1 + 1 = ?', x + w * 0.35, y + (h - 14) / 2 + 2, 16, 'rgba(255,255,255,.85)');
      c.strokeStyle = 'rgba(255,255,255,.7)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x + w * 0.75, y + (h - 14) / 2 + 2, 7, 0, Math.PI * 2);
      c.stroke();
      rr(c, x + 20, y + h - 8, w - 40, 7, 3, '#d9a066', 2); // 분필 받침
      c.fillStyle = '#fff';
      c.fillRect(x + 40, y + h - 7, 12, 4);
      c.fillStyle = '#ffd84d';
      c.fillRect(x + 60, y + h - 7, 12, 4);
    },
    // ───── 급식실 ─────
    schLunchTable(c, x, y, w, h) {
      for (let sx = x + 26; sx < x + w - 10; sx += 50) {
        circle(c, sx, y + 9, 8, '#ff9a3c', 3);
        circle(c, sx, y + h - 9, 8, '#ff9a3c', 3);
      }
      rr(c, x + 2, y + 16, w - 4, h - 32, 8, '#eef1f6');
      for (let tx = x + 14; tx < x + w - 40; tx += 50) {
        rr(c, tx, y + 22, 36, h - 44, 4, '#c9d3df', 2);
        circle(c, tx + 10, y + h / 2, 5, '#fff', 2);
        circle(c, tx + 25, y + h / 2, 5, '#f25c54', 2);
      }
    },
    // 배식대 (큰 솥들)
    schServing(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#c9d3df');
      rr(c, x + 6, y + h - 16, w - 12, 10, 4, '#8d99ae', 3);
      const cols = ['#fff', '#ff9a3c', '#a8e05f', '#ffd84d'];
      const n = Math.max(1, Math.floor((w - 20) / 70));
      for (let i = 0; i < n; i++) {
        const cx = x + 20 + (w - 40) * ((i + 0.5) / n);
        circle(c, cx, y + h / 2 - 6, 18, '#8d99ae', 3);
        circle(c, cx, y + h / 2 - 6, 12, cols[i % cols.length], 2);
      }
    },
    // 식판 수납대
    schTrayRack(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#a9a3bd');
      const cols = ['#5cc8f2', '#ffd84d', '#f25c6e', '#a8e05f'];
      for (let i = 0; i < 4; i++) rr(c, x + 8, y + 6 + i * ((h - 16) / 4), w - 16, (h - 16) / 4 - 2, 3, cols[i], 2);
    },
    // ───── 과학실 ─────
    schLabTable(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#3b3252');
      rr(c, x + 6, y + 6, w - 12, h - 18, 6, '#5b4b8a', 3);
      rr(c, x + w - 46, y + 14, 32, 22, 6, '#c9d3df', 3); // 개수대
      // 플라스크
      c.beginPath();
      c.moveTo(x + 34, y + 12);
      c.lineTo(x + 34, y + 22);
      c.lineTo(x + 22, y + 44);
      c.lineTo(x + 54, y + 44);
      c.lineTo(x + 42, y + 22);
      c.lineTo(x + 42, y + 12);
      c.closePath();
      c.fillStyle = '#a8e05f';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = INK;
      c.stroke();
      rr(c, x + 66, y + 20, 18, 24, 3, '#ff9ec4', 3); // 비커
      circle(c, x + 100, y + 32, 9, '#5cc8f2', 3); // 현미경 접시
    },
    // ───── 보건실 ─────
    schBed(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#c9d3df');
      rr(c, x + 6, y + 6, w - 12, h - 12, 6, '#fff', 3);
      rr(c, x + 12, y + 12, w - 24, 26, 10, '#e6f7ff', 3); // 베개
      rr(c, x + 6, y + 48, w - 12, h - 54, 6, '#a8dcff', 3); // 이불
      lines(c, x + 6, y + 48, w - 12, h - 54, 18, true, 'rgba(42,33,64,.15)', 2);
    },
    schMedCabinet(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#fff');
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + w / 2, y + 4);
      c.lineTo(x + w / 2, y + h - 4);
      c.stroke();
      c.fillStyle = '#e5484d';
      c.fillRect(x + w / 4 - 3, y + h / 2 - 9, 6, 18);
      c.fillRect(x + w / 4 - 9, y + h / 2 - 3, 18, 6);
      c.fillRect(x + (w * 3) / 4 - 3, y + h / 2 - 9, 6, 18);
      c.fillRect(x + (w * 3) / 4 - 9, y + h / 2 - 3, 18, 6);
    },
    // ───── 교무실 ─────
    schCopier(c, x, y, w, h) {
      rr(c, x, y + 10, w, h - 10, 8, '#c9d3df');
      rr(c, x + 10, y, w - 20, 24, 5, '#eef1f6', 3);
      rr(c, x + 14, y + 4, w - 28, 10, 2, '#fff', 2);
      rr(c, x + w - 34, y + 34, 20, 12, 3, '#3fae6a', 2);
      rr(c, x + 10, y + h - 26, w - 20, 16, 4, '#a9a3bd', 3);
    },
    // ───── 현관 ─────
    // 가로로 긴 신발장
    schShoeCubby(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#d9a066');
      const cols = ['#f25c54', '#4a7bf0', '#fff', '#f9d23c', '#3fae6a'];
      const n = Math.max(1, Math.floor(w / 40));
      for (let i = 0; i < n; i++) {
        const cx = x + 6 + i * ((w - 12) / n);
        rr(c, cx, y + 6, (w - 12) / n - 4, h - 12, 3, '#b07a4f', 2);
        rr(c, cx + 5, y + h / 2 - 5, (w - 12) / n - 14, 10, 5, cols[i % cols.length], 2);
      }
    },
  };
  return { FURN, FLOORS };
}
