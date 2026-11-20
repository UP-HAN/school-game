// 코믹 캐릭터 그리기. 이미지 파일 없이 캔버스에 직접 그린다.
// 좌표 기준: 발밑 가운데가 (0,0), 키는 약 120. size 는 화면에서의 키(px)에 가깝다.

const OUT = '#2a2140'; // 테두리 색
const SKIN = '#ffd9b5';
const PINK = '#ff9fb5';

function mix(hex, f) {
  // f < 0 이면 어둡게, f > 0 이면 밝게
  const n = parseInt(hex.slice(1), 16);
  const to = f < 0 ? 0 : 255;
  const k = Math.abs(f);
  const ch = (v) => Math.round(v + (to - v) * k);
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function ell(c, x, y, rx, ry, fill, rot = 0, stroke = true) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) c.stroke();
}
function poly(c, pts, fill) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  c.stroke();
}
function rrect(c, x, y, w, h, r, fill) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  c.stroke();
}
function dot(c, x, y, r, fill) {
  ell(c, x, y, r, r, fill, 0, false);
}
// 테두리가 있는 굵은 선 (꼬리, 팔)
function tube(c, draw, w, fill) {
  c.save();
  c.lineWidth = w + 8;
  c.strokeStyle = OUT;
  c.beginPath();
  draw();
  c.stroke();
  c.lineWidth = w;
  c.strokeStyle = fill;
  c.beginPath();
  draw();
  c.stroke();
  c.restore();
}
// 흰자가 있는 큰 눈
function bigEye(c, x, y, rx, ry, P, pupil = 0.5) {
  if (P.blink) {
    c.beginPath();
    c.moveTo(x - rx, y);
    c.quadraticCurveTo(x, y + ry * 0.6, x + rx, y);
    c.stroke();
    return;
  }
  ell(c, x, y, rx, ry, '#fff');
  dot(c, x + rx * 0.15, y + ry * 0.1, rx * pupil, OUT);
  dot(c, x + rx * 0.35, y - ry * 0.25, rx * 0.2, '#fff');
}
// 점 눈
function dotEye(c, x, y, r, P) {
  if (P.blink) {
    c.beginPath();
    c.moveTo(x - r, y);
    c.lineTo(x + r, y);
    c.stroke();
    return;
  }
  dot(c, x, y, r, OUT);
  dot(c, x + r * 0.3, y - r * 0.35, r * 0.35, '#fff');
}
function smile(c, x, y, w, depth = 0.6) {
  c.beginPath();
  c.moveTo(x - w, y);
  c.quadraticCurveTo(x, y + w * depth * 2, x + w, y);
  c.stroke();
}
function cheeks(c, x, y, dx, r = 5) {
  c.save();
  c.globalAlpha = 0.55;
  dot(c, x - dx, y, r, PINK);
  dot(c, x + dx, y, r, PINK);
  c.restore();
}
function feet(c, P, fill, dx = 13, rx = 11, ry = 7) {
  ell(c, -dx, -5 + P.liftL, rx, ry, fill);
  ell(c, dx, -5 + P.liftR, rx, ry, fill);
}

// ───────────── 캐릭터별 그림 ─────────────
const DRAW = {
  kid(c, P) {
    feet(c, P, '#fff');
    c.translate(0, P.bob);
    rrect(c, -31, -54, 14, 30, 6, P.dark); // 책가방
    ell(c, -25, -34, 7, 11, P.main, 0.2); // 팔
    ell(c, 25, -34, 7, 11, P.main, -0.2);
    dot(c, -27, -24, 5.5, SKIN);
    dot(c, 27, -24, 5.5, SKIN);
    rrect(c, -22, -54, 44, 46, 14, P.main); // 옷
    rrect(c, -8, -54, 16, 9, 4, '#fff'); // 옷깃
    ell(c, 0, -76, 28, 26, SKIN); // 머리
    c.beginPath(); // 머리카락
    c.moveTo(-28, -76);
    c.bezierCurveTo(-30, -112, 30, -112, 28, -76);
    c.quadraticCurveTo(18, -92, 6, -88);
    c.quadraticCurveTo(-4, -84, -10, -90);
    c.quadraticCurveTo(-20, -84, -28, -76);
    c.fillStyle = '#5b3a29';
    c.fill();
    c.stroke();
    dotEye(c, -10, -72, 4, P);
    dotEye(c, 10, -72, 4, P);
    cheeks(c, 0, -65, 17);
    smile(c, 0, -64, 6);
  },

  kid2(c, P) {
    feet(c, P, '#fff');
    c.translate(0, P.bob);
    ell(c, -31, -92, 9, 9, '#33283f'); // 양갈래 머리
    ell(c, 31, -92, 9, 9, '#33283f');
    ell(c, -25, -34, 7, 11, P.main, 0.2);
    ell(c, 25, -34, 7, 11, P.main, -0.2);
    dot(c, -27, -24, 5.5, SKIN);
    dot(c, 27, -24, 5.5, SKIN);
    rrect(c, -22, -54, 44, 46, 14, P.main); // 운동복
    c.save();
    c.strokeStyle = '#fff';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(-18, -32);
    c.lineTo(18, -32);
    c.stroke();
    c.restore();
    ell(c, 0, -76, 28, 26, SKIN);
    c.beginPath(); // 앞머리
    c.moveTo(-28, -78);
    c.bezierCurveTo(-30, -112, 30, -112, 28, -78);
    c.quadraticCurveTo(0, -96, -28, -78);
    c.fillStyle = '#33283f';
    c.fill();
    c.stroke();
    c.save(); // 머리띠
    c.lineWidth = 7;
    c.strokeStyle = OUT;
    c.beginPath();
    c.moveTo(-26, -86);
    c.quadraticCurveTo(0, -100, 26, -86);
    c.stroke();
    c.lineWidth = 4;
    c.strokeStyle = P.light;
    c.stroke();
    c.restore();
    dotEye(c, -10, -72, 4, P);
    dotEye(c, 10, -72, 4, P);
    cheeks(c, 0, -65, 17);
    c.beginPath(); // 활짝 웃는 입
    c.moveTo(-7, -64);
    c.quadraticCurveTo(0, -52, 7, -64);
    c.closePath();
    c.fillStyle = '#7a2b3c';
    c.fill();
    c.stroke();
  },

  cat(c, P) {
    const sway = Math.sin(P.t * 3) * 5;
    tube(c, () => {
      c.moveTo(18, -16);
      c.bezierCurveTo(44, -14, 44 + sway, -40, 34 + sway, -56);
    }, 7, P.main);
    feet(c, P, P.main);
    c.translate(0, P.bob);
    ell(c, 0, -28, 23, 23, P.main);
    ell(c, 0, -24, 12, 14, P.light, 0, false);
    poly(c, [-29, -80, -24, -110, -5, -94], P.main); // 귀
    poly(c, [29, -80, 24, -110, 5, -94], P.main);
    poly(c, [-23, -88, -21, -101, -12, -93], PINK);
    poly(c, [23, -88, 21, -101, 12, -93], PINK);
    ell(c, 0, -68, 33, 27, P.main);
    bigEye(c, -13, -70, 8, 9.5, P, 0.45);
    bigEye(c, 13, -70, 8, 9.5, P, 0.45);
    poly(c, [-4, -60, 4, -60, 0, -55], PINK); // 코
    c.beginPath(); // 입
    c.moveTo(-8, -52);
    c.quadraticCurveTo(-4, -47, 0, -54);
    c.quadraticCurveTo(4, -47, 8, -52);
    c.stroke();
    c.save(); // 수염
    c.lineWidth = 2.5;
    c.beginPath();
    for (const s of [-1, 1]) {
      c.moveTo(s * 22, -58);
      c.lineTo(s * 40, -62);
      c.moveTo(s * 22, -53);
      c.lineTo(s * 40, -50);
    }
    c.stroke();
    c.restore();
  },

  rabbit(c, P) {
    dot(c, 20, -16, 9, '#fff');
    ell(c, 20, -16, 9, 9, null);
    feet(c, P, P.main, 13, 12, 7);
    c.translate(0, P.bob);
    const flop = Math.sin(P.t * 3) * 0.06;
    ell(c, -13, -112, 9, 24, P.main, -0.18 + flop); // 귀
    ell(c, 13, -112, 9, 24, P.main, 0.18 - flop);
    ell(c, -13, -110, 4, 15, PINK, -0.18 + flop, false);
    ell(c, 13, -110, 4, 15, PINK, 0.18 - flop, false);
    ell(c, 0, -28, 22, 23, P.main);
    ell(c, 0, -24, 12, 14, P.light, 0, false);
    ell(c, 0, -68, 30, 27, P.main);
    dotEye(c, -12, -72, 5, P);
    dotEye(c, 12, -72, 5, P);
    cheeks(c, 0, -62, 19, 6);
    dot(c, 0, -63, 3.5, PINK);
    rrect(c, -5, -58, 10, 9, 2, '#fff'); // 앞니
    c.beginPath();
    c.moveTo(0, -58);
    c.lineTo(0, -49);
    c.stroke();
  },

  dino(c, P) {
    poly(c, [-14, -34, -50, -10, -12, -8], P.main); // 꼬리
    feet(c, P, P.main);
    c.translate(0, P.bob);
    ell(c, -24, -36, 6, 9, P.main, 0.4);
    ell(c, 24, -36, 6, 9, P.main, -0.4);
    ell(c, 0, -30, 25, 26, P.main);
    ell(c, 0, -25, 14, 16, P.light, 0, false);
    for (const x of [-16, 0, 16]) {
      // 등 가시
      const top = x === 0 ? -112 : -105;
      poly(c, [x - 8, top + 16, x, top, x + 8, top + 16], P.dark);
    }
    ell(c, 0, -70, 32, 26, P.main);
    bigEye(c, -13, -78, 8.5, 9.5, P);
    bigEye(c, 13, -78, 8.5, 9.5, P);
    dot(c, -5, -62, 2, OUT);
    dot(c, 5, -62, 2, OUT);
    smile(c, 0, -56, 14, 0.25);
    poly(c, [-9, -54, -5, -53, -7, -48], '#fff'); // 송곳니
    poly(c, [9, -54, 5, -53, 7, -48], '#fff');
  },

  cyclops(c, P) {
    feet(c, P, P.dark);
    c.translate(0, P.bob);
    const wave = Math.sin(P.t * 4) * 4;
    tube(c, () => {
      c.moveTo(-30, -44);
      c.quadraticCurveTo(-46, -40, -46, -56 + wave);
    }, 7, P.main);
    tube(c, () => {
      c.moveTo(30, -44);
      c.quadraticCurveTo(46, -40, 46, -56 - wave);
    }, 7, P.main);
    poly(c, [-24, -86, -20, -108, -8, -92], '#fff3d6'); // 뿔
    poly(c, [24, -86, 20, -108, 8, -92], '#fff3d6');
    ell(c, 0, -50, 34, 43, P.main);
    dot(c, -20, -26, 5, P.dark);
    dot(c, 22, -34, 4, P.dark);
    dot(c, -24, -70, 3.5, P.dark);
    if (P.blink) {
      c.beginPath();
      c.moveTo(-16, -64);
      c.quadraticCurveTo(0, -56, 16, -64);
      c.stroke();
    } else {
      ell(c, 0, -64, 17, 17, '#fff');
      dot(c, 2, -63, 9, P.dark);
      dot(c, 2, -63, 4.5, OUT);
      dot(c, 6, -68, 3, '#fff');
    }
    c.beginPath(); // 큰 입
    c.moveTo(-17, -36);
    c.quadraticCurveTo(0, -12, 17, -36);
    c.closePath();
    c.fillStyle = '#5a1f33';
    c.fill();
    c.stroke();
    poly(c, [-5, -35, 5, -35, 0, -26], '#fff'); // 이빨 하나
  },

  slime(c, P) {
    const w = Math.sin(P.t * (P.moving ? 12 : 3)) * (P.moving ? 5 : 2.5);
    c.beginPath();
    c.moveTo(-38 - w, 0);
    c.bezierCurveTo(-46 - w, -34, -26, -76 + w, 0, -78 + w);
    c.bezierCurveTo(26, -76 + w, 46 + w, -34, 38 + w, 0);
    c.quadraticCurveTo(0, 8, -38 - w, 0);
    c.closePath();
    c.fillStyle = P.main;
    c.fill();
    c.stroke();
    c.save();
    c.globalAlpha = 0.5;
    ell(c, -16, -56 + w, 6, 11, '#fff', 0.5, false); // 반짝임
    dot(c, -24, -40 + w, 3, '#fff');
    c.restore();
    const y = -34 + w * 0.5;
    bigEye(c, -12, y, 8, 9, P);
    bigEye(c, 12, y, 8, 9, P);
    cheeks(c, 0, y + 12, 22, 5);
    ell(c, 0, y + 15, 5, 6, '#5a1f33'); // 동그란 입
    ell(c, 30, -8, 4, 5, P.light, 0, false);
  },

  alien(c, P) {
    feet(c, P, P.dark, 10, 9, 6);
    c.translate(0, P.bob);
    const sway = Math.sin(P.t * 4) * 3;
    c.beginPath(); // 더듬이
    c.moveTo(-10, -96);
    c.quadraticCurveTo(-14, -108, -20 + sway, -116);
    c.moveTo(10, -96);
    c.quadraticCurveTo(14, -108, 20 + sway, -116);
    c.stroke();
    ell(c, -20 + sway, -118, 5.5, 5.5, P.light);
    ell(c, 20 + sway, -118, 5.5, 5.5, P.light);
    tube(c, () => {
      c.moveTo(-14, -34);
      c.lineTo(-26, -22);
    }, 5, P.main);
    tube(c, () => {
      c.moveTo(14, -34);
      c.lineTo(26, -22);
    }, 5, P.main);
    ell(c, 0, -26, 16, 21, P.main);
    ell(c, 0, -22, 8, 11, P.light, 0, false);
    c.beginPath(); // 거꾸로 된 물방울 머리
    c.moveTo(0, -44);
    c.bezierCurveTo(-44, -52, -42, -102, 0, -102);
    c.bezierCurveTo(42, -102, 44, -52, 0, -44);
    c.closePath();
    c.fillStyle = P.main;
    c.fill();
    c.stroke();
    if (P.blink) {
      smile(c, -14, -74, 8, 0.2);
      smile(c, 14, -74, 8, 0.2);
    } else {
      ell(c, -14, -74, 9, 13, '#1c1530', 0.4);
      ell(c, 14, -74, 9, 13, '#1c1530', -0.4);
      dot(c, -11, -80, 3, '#fff');
      dot(c, 17, -80, 3, '#fff');
    }
    smile(c, 0, -55, 5, 0.4);
  },
};

/**
 * 캐릭터 한 명을 그린다.
 * o: { kind, color(hex), x, y, size, t(초), moving, facing(1 또는 -1), frozen }
 */
export function drawCharacter(ctx, o) {
  const draw = DRAW[o.kind] || DRAW.kid;
  const t = o.t || 0;
  const s = (o.size || 120) / 124;
  const step = o.moving ? Math.sin(t * 13) : 0;
  const P = {
    main: o.color,
    dark: mix(o.color, -0.28),
    light: mix(o.color, 0.45),
    t,
    moving: !!o.moving && !o.frozen,
    blink: !o.frozen && (t + (o.seed || 0)) % 3.7 < 0.13,
    liftL: -Math.max(0, step) * 7,
    liftR: -Math.max(0, -step) * 7,
    bob: o.frozen ? 0 : o.moving ? -Math.abs(step) * 3 : Math.sin(t * 2.6) * 1.4,
  };
  if (o.frozen) P.liftL = P.liftR = 0;

  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(s, s);
  // 바닥 그림자
  ctx.fillStyle = 'rgba(42,33,64,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 34, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.scale(o.facing === -1 ? -1 : 1, 1);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = OUT;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx, P);
  ctx.restore();

  if (o.frozen) {
    // 얼음 덩어리
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#7cc8f5';
    ctx.fillStyle = 'rgba(170,225,255,0.5)';
    ctx.beginPath();
    ctx.roundRect(-46, -124, 92, 128, 16);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-32, -96);
    ctx.lineTo(-14, -112);
    ctx.moveTo(-34, -78);
    ctx.lineTo(-4, -106);
    ctx.stroke();
  }
  ctx.restore();
}
