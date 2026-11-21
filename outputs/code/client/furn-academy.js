// academy 맵(한밤의 별빛 학원) 전용 가구·바닥 그림. maprender.js 가 그리기 도구(kit)를 넘겨 주면 { FURN, FLOORS } 를 돌려준다.
// FURN[종류](c, x, y, w, h) 는 가구 그림, FLOORS[이름](c, x, y, w, h) 는 방 바닥 그림 (rooms 의 floor).
// 이미 있는 이름(maprender.js)은 다시 정의하지 말고, 새 이름만 만든다. 이 맵 이름은 모두 ac 로 시작한다.
// 그림은 rect 를 꽉 채운다 (그래서 shared/mapgrid.js 의 DRAWN 에 따로 적지 않는다).
export default function make(kit) {
  const { rr, circle, lines, checker, label, INK } = kit;
  const FURN = {
    // ── 1층 ──
    // 접수 데스크: 나무 카운터 + 하늘색 윗판 + "접수" 명패 + 펜꽂이·서류
    acFrontDesk(c, x, y, w, h) {
      rr(c, x, y, w, h, 12, '#c98a55');
      rr(c, x + 6, y + 4, w - 12, 20, 8, '#9fe0ff', 3);
      lines(c, x + 4, y + 26, w - 8, h - 30, 26, false, 'rgba(42,33,64,.35)', 3);
      rr(c, x + w / 2 - 34, y + 30, 68, 22, 6, '#fff6e5', 3);
      label(c, '접수', x + w / 2, y + 42, 15, INK);
      rr(c, x + 18, y + 6, 34, 14, 3, '#fff', 2);
      circle(c, x + w - 30, y + 13, 7, '#f25c54', 3);
    },
    // 컵라면·과자 선반
    acSnack(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#8a5a3c');
      const cols = ['#f25c54', '#ffd84d', '#3fae6a', '#ff9ec4', '#5cc8f2'];
      for (let i = 0; i * 26 < w - 20; i++) {
        rr(c, x + 8 + i * 26, y + 6, 20, h - 12, 5, cols[i % cols.length], 2);
        c.fillStyle = '#fff';
        c.fillRect(x + 12 + i * 26, y + 10, 12, 5);
      }
    },
    // 우산꽂이 (알록달록 우산 손잡이)
    acUmbrella(c, x, y, w, h) {
      const cols = ['#f25c54', '#5cc8f2', '#ffd84d'];
      cols.forEach((col, i) => {
        c.strokeStyle = INK;
        c.lineWidth = 6;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x + 10 + i * 10, y + 24);
        c.lineTo(x + 8 + i * 10, y + 6);
        c.stroke();
        c.strokeStyle = col;
        c.lineWidth = 3;
        c.stroke();
      });
      rr(c, x + 2, y + 22, w - 4, h - 24, 8, '#7a8cc8');
      lines(c, x + 2, y + 22, w - 4, h - 24, 12, true, 'rgba(255,255,255,.35)', 2);
    },
    // ── 2층 ──
    // 화이트보드 (벽에 붙은 판 + 낙서 + 마커 받침)
    acBoard(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#8d99ae');
      rr(c, x + 6, y + 4, w - 12, h - 14, 4, '#fdfdff', 3);
      c.strokeStyle = '#4a7bf0';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x + 18, y + 18);
      c.quadraticCurveTo(x + 30, y + 8, x + 42, y + 20);
      c.moveTo(x + 52, y + 12);
      c.lineTo(x + 80, y + 12);
      c.stroke();
      label(c, 'A+B', x + w - 46, y + 15, 16, '#f25c54');
      c.fillStyle = '#f25c54';
      c.fillRect(x + w / 2 - 20, y + h - 8, 14, 5);
      c.fillStyle = '#3fae6a';
      c.fillRect(x + w / 2, y + h - 8, 14, 5);
    },
    // 학원 책상 (펼친 책 + 연필)
    acDesk(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#e0a96d');
      rr(c, x + 14, y + 8, 30, h - 16, 3, '#fff', 2);
      rr(c, x + 44, y + 8, 30, h - 16, 3, '#fff', 2);
      lines(c, x + 16, y + 10, 56, h - 20, 6, true, 'rgba(42,33,64,.3)', 1.5);
      c.save();
      c.translate(x + w - 14, y + h / 2);
      c.rotate(0.6);
      rr(c, -3, -12, 6, 24, 2, '#ffd84d', 2);
      c.restore();
    },
    // 과학 실험대 (검은 윗판 + 비커·플라스크)
    acLab(c, x, y, w, h) {
      rr(c, x, y, w, h, 10, '#3b3252');
      rr(c, x + 6, y + 6, w - 12, h - 12, 6, '#4f4670', 3);
      rr(c, x + 18, y + 16, 22, 28, 5, '#bfe8ff', 3);
      c.fillStyle = '#7df0c8';
      c.fillRect(x + 21, y + 30, 16, 11);
      c.beginPath();
      c.moveTo(x + 66, y + 14);
      c.lineTo(x + 74, y + 14);
      c.lineTo(x + 86, y + 44);
      c.lineTo(x + 54, y + 44);
      c.closePath();
      c.fillStyle = '#ff9ec4';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = INK;
      c.stroke();
      circle(c, x + w - 26, y + h / 2, 10, '#ffd84d', 3);
    },
    // ── 3층 ──
    // 보면대
    acStand(c, x, y, w, h) {
      c.strokeStyle = INK;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(x + w / 2, y + 26);
      c.lineTo(x + w / 2, y + h - 6);
      c.moveTo(x + 8, y + h - 4);
      c.lineTo(x + w - 8, y + h - 4);
      c.stroke();
      rr(c, x + 2, y + 2, w - 4, 26, 4, '#fff6e5', 3);
      label(c, '♪', x + w / 2, y + 15, 16, INK);
    },
    // 컴퓨터 책상 (모니터 2대 + 자판)
    acPc(c, x, y, w, h) {
      rr(c, x, y, w, h, 8, '#c9d3df');
      for (const mx of [x + 12, x + w / 2 + 6]) {
        rr(c, mx, y + 5, w / 2 - 18, 24, 4, '#3b3252', 3);
        c.fillStyle = '#5cc8f2';
        c.fillRect(mx + 4, y + 9, w / 2 - 26, 16);
        rr(c, mx + 6, y + 33, w / 2 - 30, 9, 3, '#fff', 2);
      }
    },
    // 물감 선반 (물감 통)
    acPaints(c, x, y, w, h) {
      rr(c, x, y, w, h, 6, '#c98a55');
      const cols = ['#f25c54', '#ffd84d', '#3fae6a', '#4a7bf0', '#9b6bf2'];
      for (let i = 0; i * 22 < w - 16; i++) circle(c, x + 15 + i * 22, y + h / 2, 8, cols[i % cols.length], 3);
    },
    // 이젤 + 그림
    acEasel(c, x, y, w, h) {
      c.strokeStyle = INK;
      c.lineWidth = 6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x + w / 2, y + 6);
      c.lineTo(x + 8, y + h - 4);
      c.moveTo(x + w / 2, y + 6);
      c.lineTo(x + w - 8, y + h - 4);
      c.stroke();
      c.strokeStyle = '#c98a55';
      c.lineWidth = 3;
      c.stroke();
      rr(c, x + 4, y + 10, w - 8, 44, 4, '#fff', 3);
      circle(c, x + 20, y + 26, 7, '#ffd84d', 2);
      c.fillStyle = '#3fae6a';
      c.beginPath();
      c.moveTo(x + 8, y + 50);
      c.lineTo(x + 28, y + 32);
      c.lineTo(x + 52, y + 50);
      c.fill();
    },
    // 별 관측대 망원경 (삼각대 + 하늘로 향한 통)
    acScope(c, x, y, w, h) {
      circle(c, x + w / 2, y + h - 14, 20, '#5b4b8a', 3);
      c.strokeStyle = INK;
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(x + w / 2, y + h / 2);
      c.lineTo(x + 14, y + h - 6);
      c.moveTo(x + w / 2, y + h / 2);
      c.lineTo(x + w - 14, y + h - 6);
      c.moveTo(x + w / 2, y + h / 2);
      c.lineTo(x + w / 2, y + h - 4);
      c.stroke();
      c.save();
      c.translate(x + w / 2, y + h / 2);
      c.rotate(-0.7);
      rr(c, -12, -12, 44, 22, 6, '#4a7bf0');
      rr(c, 28, -14, 12, 26, 4, '#ffd84d', 3);
      c.restore();
      // 작은 별
      c.fillStyle = '#fff3a0';
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 ? 3 : 7;
        c.lineTo(x + w - 12 + Math.cos(a) * r, y + 12 + Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      c.stroke();
    },
    // 옥상 꽃밭 (나무 틀 + 흙 + 꽃)
    acFlowers(c, x, y, w, h) {
      rr(c, x, y, w, h, 10, '#a8714a');
      rr(c, x + 6, y + 6, w - 12, h - 14, 6, '#6b4a33', 3);
      const cols = ['#ff9ec4', '#ffd84d', '#fff', '#f25c54'];
      for (let i = 0; i * 24 < w - 24; i++) {
        const fx = x + 18 + i * 24;
        const fy = y + 18 + (i % 2) * 12;
        c.fillStyle = '#3fae6a';
        c.fillRect(fx - 2, fy, 4, 12);
        circle(c, fx, fy, 7, cols[i % cols.length], 2);
        circle(c, fx, fy, 2.5, '#f8961e', 0);
      }
    },
  };

  const FLOORS = {
    // 휴게실: 따뜻한 체크 타일
    acLounge(c, x, y, w, h) {
      checker(c, x, y, w, h, 40, ['#ffe0b8', '#ffd0a0']);
    },
    // 현관: 회색 돌바닥 + 발판
    acEntry(c, x, y, w, h) {
      checker(c, x, y, w, h, 40, ['#d6d3e3', '#c8c4d8']);
      lines(c, x, y, w, h, 40, true, 'rgba(42,33,64,.12)');
    },
    // 로비: 반들반들한 큰 타일 + 가운데 별 무늬
    acLobby(c, x, y, w, h) {
      checker(c, x, y, w, h, 80, ['#f3ecff', '#e6dcff']);
      c.strokeStyle = 'rgba(155,107,242,.35)';
      c.lineWidth = 6;
      c.beginPath();
      c.arc(x + w / 2, y + h / 2 - 20, 110, 0, Math.PI * 2);
      c.stroke();
    },
    // 교실: 연한 나무 마루
    acClass(c, x, y, w, h) {
      c.fillStyle = '#f4d6a0';
      c.fillRect(x, y, w, h);
      lines(c, x, y, w, h, 30, true, 'rgba(150,90,30,.22)');
    },
    // 자습실: 조용한 초록 카펫
    acCarpet(c, x, y, w, h) {
      c.fillStyle = '#9fd6b5';
      c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(42,33,64,.06)';
      for (let j = 0; j * 20 < h; j++) for (let i = (j % 2) * 10; i < w; i += 20) c.fillRect(x + i, y + j * 20, 4, 4);
    },
    // 컴퓨터실: 회색 타일 + 전선 홈
    acPcFloor(c, x, y, w, h) {
      checker(c, x, y, w, h, 40, ['#dfe6ee', '#d2dae4']);
      lines(c, x, y, w, h, 120, false, 'rgba(42,33,64,.18)', 4);
    },
    // 미술실: 물감이 튄 바닥
    acArt(c, x, y, w, h) {
      c.fillStyle = '#fff3dc';
      c.fillRect(x, y, w, h);
      const cols = ['rgba(242,92,84,.35)', 'rgba(74,123,240,.3)', 'rgba(255,216,77,.45)', 'rgba(63,174,106,.3)'];
      for (let i = 0; i < (w * h) / 9000; i++) {
        const a = Math.sin(i * 51.3 + x) * 43758.5;
        const b = Math.sin(i * 17.9 + y) * 24634.6;
        c.fillStyle = cols[i % cols.length];
        c.beginPath();
        c.arc(x + (a - Math.floor(a)) * w, y + (b - Math.floor(b)) * h, 8 + (i % 3) * 5, 0, Math.PI * 2);
        c.fill();
      }
    },
    // 옥상 정원: 인조 잔디 + 디딤돌
    acRoof(c, x, y, w, h) {
      c.fillStyle = '#8fd17a';
      c.fillRect(x, y, w, h);
      lines(c, x, y, w, h, 24, false, 'rgba(47,143,91,.18)', 3);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = 'rgba(255,246,229,.7)';
        c.beginPath();
        c.ellipse(x + 80 + i * 90, y + h / 2 + (i % 2 ? 20 : -20), 26, 16, 0, 0, Math.PI * 2);
        c.fill();
      }
    },
  };
  return { FURN, FLOORS };
}
