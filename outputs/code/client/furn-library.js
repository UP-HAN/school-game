// library 맵(달빛 대도서관) 전용 가구·바닥 그림. maprender.js 가 그리기 도구(kit)를 넘겨 주면 { FURN, FLOORS } 를 돌려준다.
// FURN[종류](c, x, y, w, h) 는 가구 그림, FLOORS[이름](c, x, y, w, h) 는 방 바닥 그림 (rooms 의 floor).
// 이미 있는 이름(maprender.js)은 다시 정의하지 말고, 새 이름만 만든다 (다른 맵과 겹치지 않게 모두 lib 로 시작).
// 모든 가구 그림은 rect 를 거의 꽉 채운다 → shared/mapgrid.js DRAWN 에 따로 적지 않아도 막힘 영역이 그림과 맞는다.
export default function make(kit) {
  const { rr, circle, lines, checker, label, INK } = kit;
  const BOOK = ['#f25c54', '#4a7bf0', '#f9d23c', '#3fae6a', '#9b6bf2', '#f582b8', '#ff9f6b', '#5cc8f2'];
  // 위치마다 같은 값이 나오는 가짜 난수 (그림이 매번 같도록)
  const rnd = (a, b) => {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  // 책등 줄: (x, y) 부터 폭 w, 높이 h 칸에 색색 책을 세운다
  function books(c, x, y, w, h, seed = 0) {
    let bx = x;
    let i = 0;
    while (bx < x + w - 6) {
      const bw = Math.min(8 + Math.floor(rnd(seed + i, x) * 7), x + w - bx);
      const bh = h - Math.floor(rnd(i, seed + y) * (h * 0.3));
      const lean = rnd(i + 3, seed) > 0.9;
      c.fillStyle = BOOK[Math.floor(rnd(i, seed + x) * BOOK.length)];
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      if (lean) {
        c.moveTo(bx, y + h);
        c.lineTo(bx + bw, y + h);
        c.lineTo(bx + bw + 5, y + h - bh + 2);
        c.lineTo(bx + 5, y + h - bh + 2);
        c.closePath();
      } else c.rect(bx, y + h - bh, bw, bh);
      c.fill();
      c.stroke();
      if (bw > 10) {
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.fillRect(bx + 2, y + h - bh + 4, bw - 4, 3);
      }
      bx += bw + (lean ? 6 : 0);
      i++;
    }
  }

  const FURN = {
    // 높은 책장 (앞에서 비스듬히 본 모습: 위판 + 칸 두 줄 책)
    libstack(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#7a4a2e');
      rr(c, x + 3, y + 3, w - 6, 12, 4, '#a8693f', 3); // 위판
      const top = y + 18;
      const rowH = (h - 24) / 2;
      for (let r = 0; r < 2; r++) {
        const ry = top + r * rowH;
        c.fillStyle = '#4a2a1a';
        c.fillRect(x + 6, ry, w - 12, rowH - 3);
        books(c, x + 8, ry + 2, w - 16, rowH - 5, r * 7 + x);
        c.fillStyle = '#a8693f';
        c.fillRect(x + 4, ry + rowH - 3, w - 8, 3);
      }
      // 칸막이
      c.strokeStyle = INK;
      c.lineWidth = 3;
      c.beginPath();
      for (let v = x + 120; v < x + w - 30; v += 120) (c.moveTo(v, top), c.lineTo(v, y + h - 4));
      c.stroke();
      rr(c, x, y, w, h, 6, null);
    },
    // 안내 데스크 (반달 모양 책상 + 컴퓨터 + "안내" 팻말)
    libinfodesk(c, x, y, w, h) {
      c.beginPath();
      c.moveTo(x + 10, y);
      c.lineTo(x + w - 10, y);
      c.quadraticCurveTo(x + w, y, x + w, y + 14);
      c.lineTo(x + w, y + h - 18);
      c.quadraticCurveTo(x + w / 2, y + h + 6, x, y + h - 18);
      c.lineTo(x, y + 14);
      c.quadraticCurveTo(x, y, x + 10, y);
      c.fillStyle = '#b8743f';
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.stroke();
      rr(c, x + 8, y + 6, w - 16, 22, 8, '#e8b97a', 3); // 윗판
      rr(c, x + 24, y + 8, 46, 30, 4, '#3b3252', 3); // 모니터
      rr(c, x + 29, y + 12, 36, 20, 2, '#7df0c8', 2);
      rr(c, x + w / 2 - 44, y + 34, 88, 30, 8, '#fff6e5', 3);
      label(c, '안내', x + w / 2, y + 50, 20, INK);
      books(c, x + w - 86, y + 10, 56, 18, 3);
      circle(c, x + w - 20, y + 48, 8, '#ffd94a', 3); // 호출 종
    },
    // 긴 열람 책상 (위·아래 의자, 초록 스탠드, 펼친 책)
    libtable(c, x, y, w, h) {
      const n = Math.max(2, Math.floor(w / 70));
      for (let i = 0; i < n; i++) {
        const cx = x + (w * (i + 0.5)) / n;
        rr(c, cx - 15, y, 30, 18, 6, '#4a7bf0', 3);
        rr(c, cx - 15, y + h - 18, 30, 18, 6, '#4a7bf0', 3);
      }
      rr(c, x, y + 12, w, h - 24, 10, '#d99a58');
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.fillRect(x + 8, y + 18, w - 16, 5);
      for (let i = 0; i < n; i++) {
        const cx = x + (w * (i + 0.5)) / n;
        // 펼친 책
        c.save();
        c.translate(cx, y + h / 2 + 4);
        c.rotate((rnd(i, x) - 0.5) * 0.5);
        rr(c, -16, -9, 15, 18, 2, '#fff', 2);
        rr(c, 1, -9, 15, 18, 2, '#fff', 2);
        c.restore();
      }
      // 초록 스탠드
      for (let i = 1; i < n; i += 2) {
        const sx = x + (w * i) / n;
        circle(c, sx, y + h / 2 - 6, 6, '#3b3252', 3);
        c.beginPath();
        c.ellipse(sx, y + h / 2 - 12, 15, 8, 0, 0, Math.PI * 2);
        c.fillStyle = '#3fae6a';
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = INK;
        c.stroke();
      }
    },
    // 지구본
    libglobe(c, x, y, w, h) {
      rr(c, x + 8, y + h - 14, w - 16, 12, 5, '#8a5a3c', 3);
      rr(c, x + w / 2 - 3, y + h - 26, 6, 14, 2, '#8a5a3c', 2);
      const r = Math.min(w / 2 - 4, (h - 24) / 2);
      const cx = x + w / 2;
      const cy = y + 4 + r;
      circle(c, cx, cy, r, '#5cc8f2');
      c.fillStyle = '#62c98a';
      c.beginPath();
      c.ellipse(cx - 8, cy - 6, 9, 6, 0.6, 0, Math.PI * 2);
      c.ellipse(cx + 9, cy + 8, 7, 9, -0.3, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = '#ffd94a';
      c.beginPath();
      c.arc(cx, cy, r + 3, Math.PI * 0.75, Math.PI * 1.9);
      c.stroke();
      circle(c, cx, cy, r, null, 3);
    },
    // 그림책 책장 (낮고 알록달록, 그림책 표지가 앞으로 보인다)
    libkidshelf(c, x, y, w, h) {
      rr(c, x, y, w, h, 10, '#ffb8cc');
      rr(c, x + 3, y + 3, w - 6, 10, 5, '#ffe38f', 3);
      const n = Math.max(2, Math.floor((w - 12) / 44));
      const cw = (w - 12) / n;
      for (let i = 0; i < n; i++) {
        const bx = x + 6 + i * cw;
        rr(c, bx + 3, y + 18, cw - 6, h - 24, 4, BOOK[(i * 3 + 1) % BOOK.length], 3);
        circle(c, bx + cw / 2, y + 18 + (h - 24) / 2, Math.min(8, cw / 4), i % 2 ? '#fff' : '#ffd94a', 2);
      }
    },
    // 빈백 (말랑한 콩주머니 의자)
    libbeanbag(c, x, y, w, h) {
      const col = BOOK[Math.floor(rnd(x, y) * BOOK.length)];
      c.beginPath();
      c.moveTo(x + w * 0.5, y + 3);
      c.bezierCurveTo(x + w + 2, y + 2, x + w, y + h - 2, x + w * 0.5, y + h - 2);
      c.bezierCurveTo(x, y + h - 2, x - 2, y + 2, x + w * 0.5, y + 3);
      c.fillStyle = col;
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.stroke();
      c.beginPath();
      c.ellipse(x + w / 2, y + h / 2 + 4, w * 0.26, h * 0.18, 0, 0, Math.PI * 2);
      c.fillStyle = 'rgba(0,0,0,.18)';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.6)';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x + w * 0.4, y + h * 0.35, w * 0.16, Math.PI * 1.1, Math.PI * 1.6);
      c.stroke();
    },
    // 만화책 꽂이 (흰 선반 + 얇은 만화책 줄)
    libcomic(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#f4f1e6');
      rr(c, x + 3, y + 3, w - 6, 10, 4, '#9b6bf2', 3);
      const rowH = (h - 18) / 2;
      for (let r = 0; r < 2; r++) {
        const ry = y + 15 + r * rowH;
        c.fillStyle = '#d8d2ea';
        c.fillRect(x + 6, ry, w - 12, rowH - 3);
        let bx = x + 8;
        let i = 0;
        while (bx < x + w - 14) {
          c.fillStyle = ['#ff5c8a', '#ffd94a', '#4a7bf0', '#7df0c8', '#ff9f6b'][(i + r * 2) % 5];
          c.fillRect(bx, ry + 2, 6, rowH - 7);
          c.strokeStyle = INK;
          c.lineWidth = 1.5;
          c.strokeRect(bx, ry + 2, 6, rowH - 7);
          bx += 7;
          i++;
        }
      }
      rr(c, x, y, w, h, 6, null);
    },
    // 컴퓨터 책상 (모니터 여러 대 + 자판)
    libpc(c, x, y, w, h) {
      rr(c, x, y + 10, w, h - 10, 8, '#c9d3df');
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fillRect(x + 8, y + 16, w - 16, 4);
      const n = Math.max(1, Math.floor(w / 90));
      for (let i = 0; i < n; i++) {
        const cx = x + (w * (i + 0.5)) / n;
        rr(c, cx - 8, y + 30, 16, 10, 2, '#8d99ae', 2);
        rr(c, cx - 30, y, 60, 36, 5, '#3b3252', 3);
        rr(c, cx - 25, y + 5, 50, 25, 3, i % 2 ? '#7df0c8' : '#5cc8f2', 2);
        label(c, '?', cx, y + 18, 16, '#fff');
        rr(c, cx - 26, y + h - 26, 40, 14, 3, '#fff', 2); // 자판
        lines(c, cx - 26, y + h - 26, 40, 14, 7, false, 'rgba(42,33,64,.35)', 1);
        circle(c, cx + 24, y + h - 19, 6, '#fff', 2); // 마우스
      }
    },
    // 책 반납함 (파란 우체통 모양 + "반납" 글씨)
    libreturn(c, x, y, w, h) {
      rr(c, x + 2, y + 10, w - 4, h - 12, 10, '#4a7bf0');
      c.beginPath();
      c.ellipse(x + w / 2, y + 14, w / 2 - 2, 12, 0, 0, Math.PI * 2);
      c.fillStyle = '#6f97f5';
      c.fill();
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.stroke();
      rr(c, x + 14, y + 10, w - 28, 8, 3, INK, 0);
      rr(c, x + 10, y + h / 2 + 2, w - 20, 22, 6, '#fff6e5', 3);
      label(c, '반납', x + w / 2, y + h / 2 + 14, 16, INK);
    },
    // 책 카트 (바퀴 달린 수레에 책 두 줄)
    libcart(c, x, y, w, h) {
      circle(c, x + 14, y + h - 7, 6, '#3b3252', 3);
      circle(c, x + w - 14, y + h - 7, 6, '#3b3252', 3);
      rr(c, x + 2, y + h - 22, w - 4, 12, 4, '#8d99ae', 3);
      books(c, x + 8, y + 4, w - 16, h - 26, 11);
      c.lineWidth = 4;
      c.strokeStyle = INK;
      c.beginPath();
      c.moveTo(x + w - 4, y + h - 18);
      c.lineTo(x + w - 2, y + 4);
      c.stroke();
    },
    // 고서 유리장 (나무 틀 + 유리 + 안에 낡은 책·두루마리)
    libglass(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#6b3f26');
      rr(c, x + 5, y + 5, w - 10, h - 10, 4, '#cfeeff', 3);
      const n = Math.max(1, Math.floor((w - 10) / 50));
      for (let i = 0; i < n; i++) {
        const cx = x + 5 + ((w - 10) * (i + 0.5)) / n;
        if (i % 2) {
          rr(c, cx - 16, y + h / 2 - 6, 32, 12, 6, '#f4e1c6', 2);
          circle(c, cx - 16, y + h / 2, 6, '#d9a066', 2);
          circle(c, cx + 16, y + h / 2, 6, '#d9a066', 2);
        } else {
          rr(c, cx - 14, y + h / 2 - 12, 28, 22, 3, '#8a3b2e', 2);
          c.fillStyle = '#ffd94a';
          c.fillRect(cx - 3, y + h / 2 - 12, 6, 22);
        }
      }
      c.strokeStyle = 'rgba(255,255,255,.85)';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + 12, y + h - 12);
      c.lineTo(x + 26, y + 10);
      c.moveTo(x + w - 30, y + h - 12);
      c.lineTo(x + w - 20, y + 14);
      c.stroke();
    },
    // 금고 (다이얼이 달린 무쇠 상자)
    libsafe(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#5a6378');
      rr(c, x + 6, y + 8, w - 12, h - 16, 5, '#7b8499', 3);
      circle(c, x + w / 2, y + h / 2 - 4, Math.min(12, w / 4), '#ffd94a', 3);
      circle(c, x + w / 2, y + h / 2 - 4, 3, INK, 0);
      rr(c, x + w / 2 - 10, y + h - 26, 20, 8, 3, '#c9d3df', 2);
    },
    // 두루마리 선반 (칸마다 말린 두루마리)
    libscroll(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#7a4a2e');
      rr(c, x + 3, y + 3, w - 6, 10, 4, '#a8693f', 3);
      const cols = Math.max(2, Math.floor((w - 12) / 26));
      const cw = (w - 12) / cols;
      for (let r = 0; r < 2; r++) {
        const ry = y + 18 + r * ((h - 24) / 2);
        c.fillStyle = '#4a2a1a';
        c.fillRect(x + 6, ry, w - 12, (h - 24) / 2 - 3);
        for (let i = 0; i < cols; i++) circle(c, x + 6 + cw * (i + 0.5), ry + (h - 24) / 4 - 1, Math.min(9, cw / 2 - 2), i % 3 ? '#f4e1c6' : '#e8c48a', 2);
      }
      rr(c, x, y, w, h, 6, null);
    },
  };

  const FLOORS = {
    // 중앙 열람홀: 짙은 빨간 카펫 + 금색 무늬 테두리
    libcarpet(c, x, y, w, h) {
      c.fillStyle = '#c95b5b';
      c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(255,255,255,.06)';
      for (let j = 0; j * 80 < h; j++) for (let i = 0; i * 80 < w; i++) if ((i + j) % 2) c.fillRect(x + i * 80, y + j * 80, 80, 80);
      c.strokeStyle = 'rgba(255,217,74,.55)';
      c.lineWidth = 6;
      c.strokeRect(x + 60, y + 60, w - 120, h - 120);
      c.lineWidth = 2;
      c.strokeRect(x + 72, y + 72, w - 144, h - 144);
      // 가운데 달 무늬 (금색 고리 + 초승달)
      const cx = x + w / 2;
      const cy = y + h / 2;
      c.lineWidth = 5;
      c.beginPath();
      c.arc(cx, cy, 150, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = 'rgba(255,217,74,.22)';
      c.beginPath();
      c.arc(cx, cy, 110, Math.PI * 0.3, Math.PI * 1.7);
      c.arc(cx + 55, cy, 90, Math.PI * 1.62, Math.PI * 0.38, true);
      c.closePath();
      c.fill();
    },
    // 서가: 마루 + 가운데 남색 통로 카펫 줄
    libstackfloor(c, x, y, w, h) {
      c.fillStyle = '#e3b57a';
      c.fillRect(x, y, w, h);
      lines(c, x, y, w, h, 30, false, 'rgba(150,90,30,.22)');
      c.strokeStyle = 'rgba(150,90,30,.18)';
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i * 30 < w; i++) {
        const off = (i % 3) * 50;
        for (let v = y + off; v < y + h; v += 150) (c.moveTo(x + i * 30, v), c.lineTo(x + i * 30 + 30, v));
      }
      c.stroke();
    },
    // 어린이 책방: 알록달록 퍼즐 매트
    libkidsfloor(c, x, y, w, h) {
      checker(c, x, y, w, h, 80, ['#ffe38f', '#a8dcff', '#ffb8cc', '#bfe89a']);
      c.fillStyle = 'rgba(255,255,255,.35)';
      for (let j = 0; j * 80 < h; j++) for (let i = 0; i * 80 < w; i++) circle(c, x + i * 80 + 40, y + j * 80 + 40, 10, 'rgba(255,255,255,.35)', 0);
    },
    // 컴퓨터실: 회색 파란 카펫 타일
    libpcfloor(c, x, y, w, h) {
      checker(c, x, y, w, h, 50, ['#b7c3dd', '#a9b6d3']);
      lines(c, x, y, w, h, 50, true, 'rgba(42,33,64,.08)');
      lines(c, x, y, w, h, 50, false, 'rgba(42,33,64,.08)');
    },
    // 북카페: 크림·갈색 체크 타일
    libcafefloor(c, x, y, w, h) {
      checker(c, x, y, w, h, 40, ['#fff3d6', '#e8c49a']);
    },
    // 고서 보관실: 어두운 돌바닥
    libvaultfloor(c, x, y, w, h) {
      c.fillStyle = '#a99fbf';
      c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(42,33,64,.25)';
      c.lineWidth = 3;
      c.beginPath();
      for (let j = 0; j * 60 < h; j++) {
        c.moveTo(x, y + j * 60);
        c.lineTo(x + w, y + j * 60);
        for (let v = x + (j % 2 ? 0 : 50); v < x + w; v += 100) (c.moveTo(v, y + j * 60), c.lineTo(v, y + j * 60 + 60));
      }
      c.stroke();
    },
  };
  return { FURN, FLOORS };
}
