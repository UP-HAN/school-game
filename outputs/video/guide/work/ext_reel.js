// 한밤의 랜턴 대작전 — 인스타 릴스(세로 1080x1920, ?o=v) · 가로(1920x1080) 홍보 영상 엔진 + 효과 부품
// lib.js 의 MG 도구(이징·글자 등장·코드 랜턴)를 그대로 빌려 쓴다. lib.js 의 makeVideo 는 1920x1080 고정이라 쓰지 않는다.
// 규칙: window.seek(t) 는 순수 함수 (실시간 타이머·CSS animation 없음). 같은 t 면 언제나 같은 화면.
(function () {
  const { P, lerp, clamp, mk, F1, F2, OUT, INQ, IO, LIN, tent, swing } = MG;
  const V = /[?&]o=v/.test(location.search);
  const SQ = !V && /[?&]o=s/.test(location.search);   // (덧붙임) 정사각 1080x1080 판
  const W = V || SQ ? 1080 : 1920, H = V ? 1920 : 1080;
  const CALM = MG.CALM;
  // 배치값 고르기: O(세로, 가로, 정사각). 정사각 값을 안 주면 세로 값을 쓴다.
  const O = (v, h, s) => (SQ ? (s !== undefined ? s : v) : V ? v : h);

  // ================= 조절 토큰 (릴스 전용, 여기만 바꾸면 리듬이 바뀐다) =================
  const RT = window.RT = {
    punch: 0.034, punchK: 9,          // 박자 줌 펀치 세기·감쇠(클수록 빨리 꺼짐)
    flashK: 6.5,                       // 번쩍임 감쇠
    gloss: 0.55,                       // 금색 광택이 한 번 지나가는 시간(초)
    rays: 24,                          // 빛줄기 회전 속도(도/초)
    slam: 0.38, pop: 0.5, drop: 0.55,  // 글자 등장 시간
    trans: { lantern: 0.8, flash: 0.32, violet: 0.34, whip: 0.42, push: 0.45 },
  };

  // ================= 그림 =================
  const ROOT = MG.ROOT;
  const srcOf = s => { const m = String(s).match(/^@(\w+)\/(.*)$/); if (m) return (ROOT[m[1]] ?? '') + m[2]; if (/^(\.|\/|[a-z]+:)/i.test(s) || s.includes('/')) return s; return ROOT.shots + s; };
  const PEND = [];
  function img(parent, src, cls, style) {
    const e = mk('img', cls || null, parent, null, style);
    PEND.push(new Promise(r => { e.onload = r; e.onerror = () => { console.error('그림 없음: ' + src); e.classList.add('missing'); r(); }; }));
    e.src = srcOf(src); return e;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

  // ================= 무대 =================
  document.documentElement.classList.add(V ? 'is-v' : 'is-h');
  for (const e of [document.documentElement, document.body]) { e.style.width = W + 'px'; e.style.height = H + 'px'; }
  const root = mk('div', null, document.body, null, { position: 'absolute', left: 0, top: 0, width: W + 'px', height: H + 'px', overflow: 'hidden', background: '#050414' }); root.id = 'reel';
  const bgA = mk('div', 'layer', root), bgB = mk('div', 'layer', root);
  const sky = mk('div', 'layer', root);
  const R0 = rng(5);
  const STARS = Array.from({ length: V ? 110 : 90 }, () => { const s = 2 + R0() * 4; const e = mk('div', 'star', sky, null, { left: R0() * W + 'px', top: R0() * H * 0.8 + 'px', width: s + 'px', height: s + 'px' }); return { e, w: 0.8 + R0() * 2.4, ph: R0() * 6.28 }; });
  const moonEl = mk('div', 'moon', sky, null, { left: O(830, 1640, 880) + 'px', top: O(120, 70, 60) + 'px' });
  const scenesEl = mk('div', 'layer', root); scenesEl.id = 'rscenes';
  // 세로 전용: 아래 25%(인스타 버튼·설명글 자리)는 장식만 — 안개 + 이야기 진행에 따라 하나씩 켜지는 랜턴 줄
  const deco = mk('div', 'layer', root, null, { pointerEvents: 'none' });
  let garland = null;
  if (V) {
    mk('div', 'vfog', deco);
    const puffs = Array.from({ length: 5 }, (_, i) => mk('div', 'bgfog', deco, null, { left: [-500, 200, -200, 500, -700][i] + 'px', top: [1540, 1620, 1720, 1500, 1800][i] + 'px' }));
    const GY = 1580, N = 7, xs = Array.from({ length: N }, (_, i) => 90 + i * (900 / (N - 1)));
    const sag = x => GY + 70 * Math.sin(Math.PI * x / W);
    mk('div', null, deco, `<svg width="${W}" height="${H}" style="position:absolute;left:0;top:0"><path d="M -20 ${GY - 30} Q ${W / 2} ${GY + 170} ${W + 20} ${GY - 30}" stroke="#3a2f5c" stroke-width="6" fill="none"/></svg>`);
    const lans = xs.map(x => MG.lantern(deco, x, sag(x) - 10, 0.5, { glow: 0.75 }));
    garland = { el: deco, puffs, lans };
  }
  const fx = mk('div', 'layer', root, null, { pointerEvents: 'none' });
  const vig = mk('div', 'vig', fx);
  const leaks = [mk('div', 'leak', fx), mk('div', 'leak b', fx), mk('div', 'leak c', fx)];
  const trGlow = mk('div', 'trglow', fx), trRing = mk('div', 'trring2', fx);
  const flash = mk('div', 'layer', fx, null, { opacity: 0 });

  // ================= 효과 부품 (R.*) =================
  const R = window.R = { V, SQ, W, H, O, img, srcOf, RT };

  // 글자 등장 공통 (row 안 낱말·이모지)
  function anim(e, lt, t0, kind, o = {}) {
    let x = 0, y = 0, s = 1, r = 0, op = P(lt, t0, 0.12, LIN);
    if (kind === 'slam') { const p = P(lt, t0, RT.slam, F1); s = lerp(2.6, 1, p); r = lerp(-7, 0, p); op = P(lt, t0, 0.08, LIN); }
    else if (kind === 'pop') { const p = P(lt, t0, RT.pop, F1); s = lerp(0.3, 1, p); y = lerp(60, 0, p); }
    else if (kind === 'drop') { const p = P(lt, t0, RT.drop, F1); y = lerp(-300, 0, p); r = lerp(14, 0, P(lt, t0, RT.drop, OUT)); }
    else if (kind === 'rise') { const p = P(lt, t0, 0.45, OUT); y = lerp(90, 0, p); op = P(lt, t0, 0.2, LIN); }
    else if (kind === 'left') { const p = P(lt, t0, 0.45, F2); x = lerp(-420, 0, p); }
    else if (kind === 'right') { const p = P(lt, t0, 0.45, F2); x = lerp(420, 0, p); }
    else if (kind === 'spin') { const p = P(lt, t0, 0.55, F1); s = lerp(0, 1, p); r = lerp(-200, 0, P(lt, t0, 0.55, OUT)); }
    else if (kind === 'swing') { const p = P(lt, t0, 0.45, F1); s = lerp(0.2, 1, p); r = swing(Math.min(lt, o.stillAt ?? 1e9), t0 + 0.2, 16, 8, 2.2); }
    if (o.bob) { const tb = Math.min(lt, o.stillAt ?? 1e9); y += Math.sin(tb * (o.bobF || 3.2) + (o.ph || 0)) * o.bob * P(lt, t0 + 0.3, 0.3, LIN); }
    if (o.out != null) { const q = P(lt, o.out, 0.28, INQ); op *= 1 - q; y -= 60 * q; s *= lerp(1, 0.9, q); }
    e.style.opacity = op;
    e.style.transform = `translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`;
  }
  // 금색 광택: g 시각마다 띠가 왼쪽→오른쪽으로 지나간다
  function gloss(fr, lt, list) {
    let p = 0; for (const g of list) { const q = (lt - g) / RT.gloss; if (q >= 0 && q <= 1) p = 1 - IO(q); }
    fr.style.backgroundPosition = `${(p * 100).toFixed(2)}% 0, 0 0`;
  }
  // 한 줄 묶음: [{t|gold|emoji, size, c, w, font, at, anim, gloss, bob, out, dy}] — 이모지는 금색 글자 밖 따로
  R.row = function (parent, items, o = {}) {
    const box = mk('div', 'rrow', parent, null, { top: o.y + 'px', fontSize: (o.size || 120) + 'px', gap: (o.gap ?? 18) + 'px' });
    if (o.x != null) { box.style.left = o.x + 'px'; box.style.justifyContent = 'flex-start'; } else { box.style.left = '0'; box.style.right = '0'; box.style.justifyContent = 'center'; }
    const its = items.map(it => {
      const fs = (it.size || o.size || 120) + 'px';
      let e, fr = null;
      if (it.emoji) e = mk('span', 'emo', box, it.emoji, { fontSize: fs });
      else if (it.gold) { e = mk('span', 'gt jua', box, null, { fontSize: fs }); mk('span', 'bk', e, esc(it.gold)); fr = mk('span', 'fr', e, esc(it.gold)); }
      else e = mk('span', 'pt shadow-t ' + (it.font === 'body' ? 'body' : 'jua'), box, esc(it.t), { fontSize: fs, color: it.c || '#fff', fontWeight: it.w || null });
      if (it.dy) e.style.marginTop = it.dy + 'px';
      return { it, e, fr };
    });
    return {
      el: box,
      seek(lt) { its.forEach(({ it, e, fr }) => { anim(e, lt, it.at ?? o.at ?? 0, it.anim || o.anim || 'pop', { ...it, stillAt: o.stillAt }); if (fr) gloss(fr, lt, it.gloss || []); }); },
    };
  };
  // 회전 빛줄기 (글자 뒤)
  R.rays = function (parent, o) {
    const S = o.size || 1300;
    const e = mk('div', 'rays', parent, null, { left: o.x - S / 2 + 'px', top: o.y - S / 2 + 'px', width: S + 'px', height: S + 'px' });
    if (o.color) e.style.setProperty('--ray', o.color);
    return {
      el: e,
      seek(lt) {
        const tl = Math.min(lt, o.stillAt ?? 1e9);
        const on = P(lt, o.at || 0, 0.35, OUT) * (o.out != null ? 1 - P(lt, o.out, 0.3, LIN) : 1);
        e.style.opacity = on * (o.a ?? 0.9);
        e.style.transform = `rotate(${(CALM ? 0 : tl * RT.rays * (o.dir || 1))}deg) scale(${lerp(0.4, 1, P(lt, o.at || 0, 0.5, F2))})`;
      },
    };
  };
  // 색종이: 한 점에서 터져 공기 저항을 받으며 떨어진다 (시간의 순수 함수)
  R.confetti = function (parent, o) {
    const n = o.n || 60, rnd = rng(o.seed || 17), life = o.life || 1.6, at = o.at || 0;
    const COLS = o.colors || ['#ffc247', '#7fe0c4', '#ff9ec4', '#9b6bf2', '#5cc8f2', '#fff6e5', '#ff9a3c'];
    const ps = Array.from({ length: n }, (_, i) => {
      const a = ((o.dir ?? -90) + (rnd() - 0.5) * (o.spread ?? 120)) * Math.PI / 180, v = (o.power || 1800) * (0.45 + rnd() * 0.75);
      const w = 12 + rnd() * 14, h = rnd() < 0.3 ? w : w * (1.6 + rnd());
      const e = mk('div', 'cf', parent, null, { width: w + 'px', height: h + 'px', background: COLS[i % COLS.length], borderRadius: rnd() < 0.25 ? '50%' : '3px' });
      return { e, vx: Math.cos(a) * v, vy: Math.sin(a) * v, sp: (rnd() - 0.5) * 1400, fl: 6 + rnd() * 10, ph: rnd() * 6, x0: (o.x || 0) + (rnd() - 0.5) * (o.jitter || 40), y0: (o.y || 0) + (rnd() - 0.5) * (o.jitter || 40), d: rnd() * 0.08 };
    });
    const K = 2.6, G = o.g || 2400;
    return {
      seek(lt) {
        ps.forEach(p => {
          const tau = lt - at - p.d;
          if (tau < 0 || tau > life) { p.e.style.opacity = 0; return; }
          const ex = (1 - Math.exp(-K * tau)) / K;
          const x = p.x0 + p.vx * ex + Math.sin(tau * p.fl + p.ph) * 18 * clamp(tau * 2);
          const y = p.y0 + p.vy * ex + G / K * (tau - ex);
          p.e.style.opacity = 1 - P(tau, life - 0.35, 0.35, LIN);
          p.e.style.transform = `translate(${x}px, ${y}px) rotate(${p.sp * tau}deg) scaleY(${Math.cos(tau * p.fl + p.ph)})`;
        });
      },
    };
  };
  // 게임 화면 카드: shots:[{src | seq:{name,start,count,step,fps,loop}, at, path:[[t, 배율, cx, cy]]}]
  R.card = function (parent, o) {
    const { x, y, w, h } = o, ar = o.ar || 16 / 9;
    const el = mk('div', 'rscr', parent, null, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', borderRadius: (o.r ?? 40) + 'px' });
    if (o.glow) el.style.setProperty('--glow', o.glow);
    const shots = o.shots.map(s => {
      const a = s.ar || ar, [iw, ih] = w / h > a ? [w, w / a] : [h * a, h];
      const lay = mk('div', 'rclay', el, null, { width: iw + 'px', height: ih + 'px', display: 'none' });
      s = { ...s, iw, ih };
      let frames = null;
      if (s.seq) { const q = s.seq; frames = Array.from({ length: q.count }, (_, k) => img(lay, `@seq/${q.name}/${String(q.start + k * (q.step || 1)).padStart(4, '0')}.png`, null, { display: 'none' })); }
      else img(lay, s.src);
      return { s, lay, frames, last: -1 };
    });
    const tint = mk('div', 'rctint', el), fl = mk('div', 'rcflash', el);
    const camAt = (path, lt) => {
      if (!path || !path.length) return [1, 0.5, 0.5];
      let k = 0; while (k < path.length - 1 && lt >= path[k + 1][0]) k++;
      const a = path[k], b = path[Math.min(k + 1, path.length - 1)];
      if (a === b || lt <= a[0]) return [a[1], a[2], a[3]];
      const q = (a[4] || IO)(clamp((lt - a[0]) / (b[0] - a[0])));
      return [lerp(a[1], b[1], q), lerp(a[2], b[2], q), lerp(a[3], b[3], q)];
    };
    let cur = { z: 1, X: 0, Y: 0, iw: w, ih: h };
    const swaps = shots.slice(1).map(S => S.s.at);
    const ent = { rise: { y: 260, s: 0.88 }, drop: { y: -500, s: 1 }, zoom: { y: 0, s: 1.25 }, left: { x: -900, y: 0, s: 0.95 }, right: { x: 900, y: 0, s: 0.95 }, none: null }[o.enter || 'rise'];
    return {
      el,
      seek(lt) {
        if (ent) { const p = P(lt, o.at || 0, 0.55, F2); el.style.opacity = P(lt, o.at || 0, 0.15, LIN); el.style.transform = `translate(${lerp(ent.x || 0, 0, p)}px, ${lerp(ent.y, 0, p)}px) scale(${lerp(ent.s, 1, p)})`; }
        if (o.out != null) { const q = P(lt, o.out, 0.3, INQ); el.style.opacity = +el.style.opacity * (1 - q); el.style.transform += ` scale(${lerp(1, 0.85, q)})`; }
        let ci = 0; shots.forEach((S, i) => { if (lt >= (S.s.at || 0)) ci = i; });
        shots.forEach((S, i) => {
          const on = i === ci; S.lay.style.display = on ? 'block' : 'none';
          if (!on) return;
          let [z, cx, cy] = camAt(S.s.path, lt);
          if (S.s.at) z *= lerp(S.s.kick ?? 1.12, 1, P(lt, S.s.at, 0.4, OUT));
          const { iw, ih } = S.s;
          const X = clamp(w / 2 - cx * iw * z, w - iw * z, 0), Y = clamp(h / 2 - cy * ih * z, h - ih * z, 0);
          S.lay.style.transform = `translate(${X}px, ${Y}px) scale(${z})`;
          cur = { z, X, Y, iw, ih };
          if (S.frames) {
            const q = S.s.seq, n = S.frames.length;
            let k = Math.floor(Math.max(0, lt - (S.s.at || 0)) * (q.fps || 12));
            k = q.loop ? k % n : Math.min(n - 1, k);
            if (k !== S.last) { S.frames.forEach((f, j) => { f.style.display = j === k ? 'block' : 'none'; }); S.last = k; }
          }
        });
        let f = 0; for (const t of swaps) if (lt >= t) f = Math.max(f, Math.exp(-(lt - t) * 9));
        fl.style.opacity = CALM ? 0 : f * 0.75;
        tint.style.opacity = o.tint ? o.tint(lt) : 0;
        if (o.tintColor) tint.style.background = o.tintColor;
      },
      // 그림 안 비율 좌표(u,v) → 무대 좌표 (현재 카메라 기준)
      pt(u, v) { return [x + cur.X + u * cur.iw * cur.z, y + cur.Y + v * cur.ih * cur.z]; },
      scale() { return cur.z * cur.iw; },
    };
  };
  // 캐릭터 얼굴 빠르게 넘기기: m_meeting.png 의 캐릭터 카드 8장을 원 안에 차례로
  const FACES = [[0.264, 0.483], [0.382, 0.483], [0.5, 0.483], [0.618, 0.483], [0.736, 0.483], [0.264, 0.644], [0.382, 0.644], [0.5, 0.644]];
  R.FACES = FACES;
  R.face = function (parent, o) {
    const S = o.size || 300, src = srcOf(o.src || 'm_meeting.png'), k = S / (o.win || 190);
    const el = mk('div', 'rface', parent, null, { left: o.x - S / 2 + 'px', top: o.y - S / 2 + 'px', width: S + 'px', height: S + 'px' });
    const inner = mk('div', 'in', el, null, { backgroundImage: `url("${src}")`, backgroundSize: `${1600 * k}px ${900 * k}px` });
    const setF = i => { const [u, v] = FACES[i]; inner.style.backgroundPosition = `${-(u * 1600 * k - S / 2)}px ${-(v * 900 * k - S / 2 + (o.dy || 0) * k)}px`; };
    let last = -1;
    return {
      el,
      seek(lt) {
        const at = o.at || 0, st = o.step || 0.12;
        let i = o.order ? o.order[Math.floor(Math.max(0, lt - at) / st) % o.order.length] : Math.floor(Math.max(0, lt - at) / st) % 8;
        if (o.stopAt != null && lt >= o.stopAt) i = o.final ?? i;
        if (i !== last) { setF(i); last = i; }
        const p = P(lt, at, 0.45, F1), hit = o.stopAt != null ? tent(lt, o.stopAt, 0.3) : 0;
        let op = P(lt, at, 0.12, LIN), s = lerp(0.2, 1, p) * (1 + 0.12 * hit) * (o.s || 1), yy = 0;
        if (o.out != null) { const q = P(lt, o.out, 0.3, INQ); op *= 1 - q; s *= lerp(1, 0.6, q); }
        if (o.bob) yy = Math.sin(lt * 4 + (o.ph || 0)) * o.bob;
        el.style.opacity = op; el.style.transform = `translateY(${yy}px) scale(${s}) rotate(${(o.rot || 0) * (1 - p)}deg)`;
        el.style.boxShadow = `0 0 0 8px #2a2140, 0 0 ${30 + 60 * (o.stopAt != null ? P(lt, o.stopAt, 0.2, LIN) : 0)}px rgba(255,194,71,.8)`;
      },
    };
  };
  // 이름표(칩) + 도장 배지(✓ 또는 ✕)
  R.chip = function (parent, text, o) {
    const e = mk('div', 'rchip', parent, `<span class="ct">${esc(text)}</span>`, o.x == null ? { position: 'relative', fontSize: (o.size || 44) + 'px' } : { left: o.x + 'px', top: o.y + 'px', fontSize: (o.size || 44) + 'px' });
    const b = o.badge ? mk('span', 'bdg ' + (o.badge === '✕' ? 'no' : 'ok'), e, o.badge) : null;
    if (o.center) e.style.transform = 'translateX(-50%)';
    return {
      el: e,
      seek(lt) {
        const p = P(lt, o.at, 0.45, F1);
        e.style.opacity = P(lt, o.at, 0.12, LIN);
        e.style.transform = `${o.center ? 'translateX(-50%) ' : ''}translateY(${lerp(50, 0, p)}px) scale(${lerp(0.5, 1, p)}) rotate(${lerp(o.r0 ?? -8, 0, p)}deg)`;
        if (b) { const q = P(lt, o.at + 0.18, 0.3, F1); b.style.opacity = P(lt, o.at + 0.18, 0.08, LIN); b.style.transform = `scale(${lerp(2.6, 1, q)}) rotate(${lerp(-30, -8, q)}deg)`; }
      },
    };
  };
  // 새벽빛 게이지 (숫자 없이 막대만)
  R.gauge = function (parent, o) {
    const e = mk('div', 'rgauge', parent, `<span class="ic">🌅</span><span class="lb jua">${esc(o.label || '새벽빛')}</span><span class="bar"><span class="fill"></span><span class="head"></span></span>`, { left: o.x + 'px', top: o.y + 'px', width: o.w + 'px' });
    const fill = e.querySelector('.fill'), head = e.querySelector('.head');
    return {
      el: e,
      seek(lt) {
        const p = P(lt, o.at, 0.45, F2); e.style.opacity = P(lt, o.at, 0.15, LIN); e.style.transform = `translateY(${lerp(60, 0, p)}px) scale(${lerp(0.85, 1, p)})`;
        const v = lerp(o.from ?? 0.12, o.to ?? 0.8, P(lt, o.fillAt, o.dur || 0.9, OUT));
        fill.style.transform = `scaleX(${v})`; head.style.left = (v * 100) + '%';
        head.style.opacity = lt > o.fillAt ? 1 : 0; head.style.transform = `translate(-50%,-50%) scale(${1 + 0.25 * Math.sin(lt * 18) * (1 - P(lt, o.fillAt + (o.dur || 0.9), 0.3, LIN))})`;
      },
    };
  };
  // 물음표·Z 같은 작은 기호 팝 (장식)
  R.marks = function (parent, list, o = {}) {
    const es = list.map(m => mk('div', 'rmark jua', parent, esc(m.t || '?'), { left: m.x + 'px', top: m.y + 'px', fontSize: (m.size || 110) + 'px', color: m.c || 'var(--lantern)' }));
    return {
      seek(lt) {
        list.forEach((m, i) => {
          const e = es[i], p = P(lt, m.at, 0.4, F1);
          let op = P(lt, m.at, 0.1, LIN); if (m.out != null) op *= 1 - P(lt, m.out, 0.25, LIN);
          const fl = m.float ? -((lt - m.at) * m.float) : 0;
          e.style.opacity = op;
          e.style.transform = `translate(-50%, ${fl}px) scale(${lerp(0, 1, p)}) rotate(${lerp(m.r0 ?? -40, m.r ?? 0, P(lt, m.at, 0.4, OUT)) + (m.wob ? Math.sin(lt * 6 + i) * m.wob : 0)}deg)`;
        });
      },
    };
  };

  // ================= 영상 조립 =================
  // makeReel({ bpm, mood, scenes:[{ name, beats, bg, trans, tx, ty, tsfx, moon, stars, vig, leak, punch, still, section, thumbs, build:(el, c)=>({seek, events}) }] })
  window.makeReel = function ({ bpm, mood = 'promo', scenes }) {
    const beat = 60 / bpm, BAR = beat * 4;
    let b = 0;
    const FL = [], SH = [], PU = [];
    const list = scenes.map((s, i) => {
      const el = mk('div', 'scene', scenesEl), inner = mk('div', 'scene-in', el);
      const start = b * beat; b += s.beats; const end = b * beat;
      return { ...s, no: i + 1, el, inner, start, end, td: s.trans && i > 0 ? (s.td ?? RT.trans[s.trans] ?? 0.4) : 0 };
    });
    list.forEach(s => {
      const c = {
        dur: s.end - s.start, beat, bar: BAR, start: s.start, V, W, H, O,
        flash: (t, color = '#fff3d0', a = 0.6, k) => FL.push({ t: s.start + t, color, a, k: k || RT.flashK }),
        shake: (t, d = 0.35, amp = 18) => SH.push({ t: s.start + t, d, amp }),
        punch: (t, amp = 0.06) => PU.push({ t: s.start + t, amp }),
      };
      s.el.style.display = 'block';
      s.inst = s.build(s.inner, c);
      s.el.style.display = 'none';
    });
    const TOTAL = b * beat;
    const TRSFX = { lantern: 'lantern', flash: 'thud', violet: 'thud', whip: 'whoosh', push: 'swish' };
    window.TOTAL = TOTAL; window.BPM = bpm; window.BAR = BAR; window.MOOD = mood;
    window.SB = list.map(s => ({ no: s.no, name: s.name, start: s.start, end: s.end, bars: s.beats / 4, b0: +(s.start / BAR).toFixed(4), trans: s.trans || 'cut', thumbs: s.thumbs }));
    const ev = list.flatMap(s => [...(s.inst.events || []).map(([t, k]) => [+(s.start + t).toFixed(3), k]), ...(s.td ? [[+s.start.toFixed(3), s.tsfx || TRSFX[s.trans]]] : [])]);
    window.EVENTS = ev.filter(e => e[0] >= 0 && e[0] < TOTAL && e[1]).sort((a, c) => a[0] - c[0]);
    window.SECTIONS = Object.fromEntries(list.filter(s => s.section).map(s => [s.section, +(s.start / BAR).toFixed(4)]));
    window.SECTIONS.total = b / 4;
    const bgCss = k => { const [a, c] = MG.BG[k] || MG.BG.night; return `linear-gradient(180deg, ${a}, ${c})`; };
    const TR = {
      // 어둠에서 랜턴 불빛이 퍼지는 전환: 나가는 장면이 어두워지고 → 한 점에 불이 켜지고 → 빛 원이 번지며 새 장면이 드러난다
      lantern(p, I, Oe, s) {
        const x = s.tx ?? W / 2, y = s.ty ?? H / 2;
        Oe.style.filter = `brightness(${lerp(1, 0.05, P(p, 0, 0.35, LIN))})`;
        const q = P(p, 0.3, 0.7, IO), r = lerp(0, Math.hypot(W, H) * 1.1, q);
        I.style.opacity = q > 0 ? 1 : 0;
        I.style.webkitMaskImage = I.style.maskImage = `radial-gradient(circle at ${x}px ${y}px, #000 ${r * 0.78}px, transparent ${r + 1}px)`;
        trGlow.style.display = 'block';
        trGlow.style.transform = `translate(${x}px, ${y}px) scale(${lerp(0.02, 1, P(p, 0.08, 0.3, F1)) * lerp(1, 2.6, q)})`;
        trGlow.style.opacity = P(p, 0.08, 0.1, LIN) * (1 - P(p, 0.55, 0.45, LIN));
        trRing.style.display = 'block';
        trRing.style.transform = `translate(${x}px, ${y}px) scale(${r / 500})`;
        trRing.style.opacity = q > 0 ? 1 - P(p, 0.75, 0.25, LIN) : 0;
      },
      flash(p, I, Oe) { Oe.style.display = 'none'; I.style.transform = `scale(${lerp(1.2, 1, P(p, 0, 1, OUT))})`; },
      violet(p, I, Oe) { Oe.style.display = 'none'; I.style.transform = `scale(${lerp(1.3, 1, P(p, 0, 1, OUT))}) rotate(${lerp(-3, 0, P(p, 0, 1, OUT))}deg)`; },
      whip(p, I, Oe) {
        const q = IO(p), D = V ? W * 1.1 : W;
        Oe.style.transform = `translateX(${lerp(0, -D, q)}px) skewX(${12 * tent(p, 0, 1)}deg)`;
        I.style.transform = `translateX(${lerp(D, 0, q)}px) skewX(${12 * tent(p, 0, 1)}deg)`;
      },
      push(p, I, Oe) {
        const q = IO(p);
        if (V) { Oe.style.transform = `translateY(${lerp(0, -H, q)}px)`; I.style.transform = `translateY(${lerp(H, 0, q)}px)`; }
        else { Oe.style.transform = `translateX(${lerp(0, -W, q)}px)`; I.style.transform = `translateX(${lerp(W, 0, q)}px)`; }
      },
    };
    // 장면 첫 순간 번쩍임 (전환 종류별)
    list.forEach(s => {
      if (s.trans === 'flash') FL.push({ t: s.start, color: s.flashColor || '#ffffff', a: 0.85, k: 7 });
      if (s.trans === 'violet') { FL.push({ t: s.start, color: '#b48cff', a: 0.8, k: 6 }); SH.push({ t: s.start, d: 0.4, amp: 22 }); }
      if (s.trans === 'lantern') FL.push({ t: s.start + s.td * 0.32, color: '#ffd98a', a: 0.35, k: 8 });
    });
    window.seek = function (t) {
      t = clamp(t, 0, TOTAL - 1e-4);
      let ci = list.findIndex(s => t >= s.start && t < s.end); if (ci < 0) ci = list.length - 1;
      const cur = list[ci], prev = ci > 0 ? list[ci - 1] : null;
      const p = cur.td ? (t - cur.start) / cur.td : 1, inTr = prev && cur.td && p < 1;
      trGlow.style.display = trRing.style.display = 'none';
      for (const s of list) { const on = s === cur || (inTr && s === prev); s.el.style.display = on ? 'block' : 'none'; s.el.style.transform = ''; s.el.style.opacity = 1; s.el.style.filter = ''; s.el.style.webkitMaskImage = s.el.style.maskImage = ''; s.el.style.zIndex = s === cur ? 2 : 1; }
      if (inTr) prev.inst.seek(t - prev.start);
      cur.inst.seek(t - cur.start);
      if (inTr) TR[cur.trans](clamp(p), cur.el, prev.el, cur);
      // 멈춤(엔드카드): still 이후로는 배경도 멈춘다
      const bt = cur.still != null ? Math.min(t, cur.start + cur.still) : t;
      const kPrev = prev ? (prev.bg || 'night') : (cur.bg || 'night'), kCur = cur.bg || 'night';
      if (bgA.dataset.k !== kPrev) { bgA.style.background = bgCss(kPrev); bgA.dataset.k = kPrev; }
      if (bgB.dataset.k !== kCur) { bgB.style.background = bgCss(kCur); bgB.dataset.k = kCur; }
      bgB.style.opacity = inTr ? P(t, cur.start, Math.max(0.3, cur.td), LIN) : 1;
      STARS.forEach(({ e, w, ph }) => { e.style.opacity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(bt * w + ph)); });
      sky.style.opacity = cur.stars === false ? 0 : 1;
      moonEl.style.display = cur.moon ? 'block' : 'none';
      // 비네팅·빛 번짐 (장면마다 세기, 전환 동안 섞음)
      const mix = (k, d) => { const a = prev ? (prev[k] ?? d) : (cur[k] ?? d), c = cur[k] ?? d; return inTr ? lerp(a, c, clamp(p)) : c; };
      vig.style.opacity = mix('vig', 0.55);
      const lk = mix('leak', 0.35);
      leaks.forEach((e, i) => {
        const a = bt * [0.35, 0.27, 0.22][i] + i * 2.1;
        const bx = [0.05, 0.98, 0.5][i] * W + Math.sin(a) * W * 0.12, by = [0.12, 0.62, 1.02][i] * H + Math.cos(a * 1.3) * H * 0.08;
        e.style.transform = `translate(${bx}px, ${by}px) scale(${1 + 0.15 * Math.sin(a * 1.7)})`;
        e.style.opacity = lk * [1, 0.85, 0.7][i];
      });
      // 번쩍임: 지금까지 터진 것 중 가장 센 것
      let fa = 0, fc = '#fff'; for (const f of FL) if (t >= f.t) { const v = f.a * Math.exp(-(t - f.t) * f.k); if (v > fa) { fa = v; fc = f.color; } }
      flash.style.opacity = CALM ? 0 : fa; flash.style.background = fc;
      // 화면 흔들림 + 박자 줌 펀치
      let sx = 0, sy = 0; if (!CALM) for (const s of SH) if (t >= s.t && t < s.t + s.d) { const u = (t - s.t) / s.d; sx += Math.sin((t - s.t) * 83) * s.amp * (1 - u); sy += Math.cos((t - s.t) * 67) * s.amp * 0.6 * (1 - u); }
      let pz = 0;
      if (!CALM) {
        if (cur.punch) { const lt = t - cur.start, tb = Math.floor(lt / beat) * beat; pz += RT.punch * Math.exp(-(lt - tb) * RT.punchK); }
        for (const u of PU) if (t >= u.t) pz = Math.max(pz, u.amp * Math.exp(-(t - u.t) * RT.punchK));
      }
      scenesEl.style.transform = `translate(${sx}px, ${sy}px) scale(${1 + pz})`;
      // 세로: 아래 장식 (랜턴 줄은 지금까지 지나온 장면 수만큼 켜진다)
      if (garland) {
        const g = mix('garland', 1); garland.el.style.opacity = g;
        garland.puffs.forEach((f, i) => { f.style.transform = `translateX(${Math.sin(bt * 0.3 + i * 2) * 90}px)`; });
        garland.lans.forEach((L, i) => {
          const s = list[i]; const on = s ? P(t, s.start + 0.15, 0.25, LIN) : 0;
          const hit = s ? tent(t, s.start + 0.15, 0.5) : 0;
          L.set(on, Math.sin(bt * 1.6 + i) * 4, `translateY(0px) scale(${1 + 0.25 * hit})`);
        });
      }
    };
    window.ready = Promise.race([document.fonts.ready.then(() => Promise.all(PEND)), new Promise(r => setTimeout(r, 20000))]);
    if (/[?&]ui=1/.test(location.search)) {
      const bar = mk('input', null, document.body, null, { position: 'fixed', left: '20px', bottom: '8px', width: W - 40 + 'px', zIndex: 99 });
      bar.type = 'range'; bar.min = 0; bar.max = TOTAL; bar.step = 1 / 30; bar.value = 0; bar.oninput = () => window.seek(+bar.value);
    }
    window.seek(0);
  };
})();
