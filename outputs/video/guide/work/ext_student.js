// 학생용 영상(student.html) 전용 부품. lib.js 는 고치지 않고 여기서 Q.* 를 더한다.
// 모든 움직임은 seek(lt) 의 순수 함수 (lt = 장면 안 시각, 초).
(function () {
  const { TOK, P, pop, set, mk, pic, cam, camPath, lerp, clamp, tent, text, swing, shake, F1, F2, OUT, INQ, IO, LIN, CALM } = MG;

  // ---------- 조절 토큰 (이 편 전용) ----------
  const ST = {
    keyPress: 0.22,   // 키 눌림 유지(초)
    keyDepth: 9,      // 키 눌림 깊이(px)
    swapFade: 0.22,   // 기기 화면 바뀜(초)
    swapZoom: 1.08,   // 바뀔 때 살짝 당겨지는 배율
    ringPulse: 0.03,  // 고리 숨쉬기 세기
  };
  window.ST_STUDENT = ST;

  // 학생 주소 QR (outputs/code/client/qr.js 의 qrMatrix('https://lab.ches.es.kr/lantern/') 결과, 29x29)
  const QR = ["11111110010000100111101111111", "10000010100101000011001000001", "10111010000010010001101011101", "10111010011001001011101011101", "10111010111011001111001011101", "10000010000100111111101000001", "11111110101010101010101111111", "00000000001110010100000000000", "10101010000100001101100010010", "01010100001001011100111001001", "10011010110100111010101000111", "11000000101001101110101010010", "01010110110010110101111001011", "00001001010100110000011101001", "00111111111011000100000001011", "00101100110000010100010101010", "10010010111000001100011001011", "00101000101111011110111001101", "10111110101110111000011110011", "01010101000101101101100101010", "10110010111110111100111110000", "00000000101100110101100010111", "11111110000111000001101011011", "10000010011100001110100011001", "10111010100110011100111110010", "10111010010011000111100110100", "10111010110011001111010111001", "10000010001000101101110100010", "11111110111100011100110100011"];

  // ---------- 작은 도구 ----------
  // 자판 키 (종이 카드 + 아래 두께). press: 누르는 시각들
  function keycap(parent, label, x, y, w = 110, h = 110, fs = 56) {
    const k = mk('div', 'jua', parent, label, {
      position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', borderRadius: '22px',
      background: 'var(--paper)', color: 'var(--ink)', border: '5px solid var(--ink)', boxShadow: `0 ${ST.keyDepth + 3}px 0 var(--ink)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs + 'px', lineHeight: '1',
    });
    return k;
  }
  // 키 눌림 정도 (0~1): times 중 가장 가까운 눌림
  const pressAmt = (lt, times) => { let v = 0; for (const t of times || []) v = Math.max(v, tent(lt, t - 0.02, ST.keyPress)); return clamp(v * 2); };
  function seekKey(k, lt, at, times, extra = {}) {
    const pr = pressAmt(lt, times);
    pop(k, lt, at, { dy: extra.dy ?? 60, s0: extra.s0 ?? 0.5, out: extra.out });
    k.style.transform += ` translateY(${pr * ST.keyDepth}px)`;
    k.style.boxShadow = `0 ${(1 - pr) * ST.keyDepth + 3}px 0 var(--ink)${pr > 0.3 ? ', 0 0 40px rgba(255,194,71,.9)' : ''}`;
    k.style.background = pr > 0.3 ? 'var(--lantern)' : 'var(--paper)';
  }
  // QR 카드 (캔버스에 한 번 그린다)
  function qrCard(parent, x, y, size, label) {
    const card = mk('div', 'paper', parent, null, { position: 'absolute', left: x + 'px', top: y + 'px', padding: '18px 18px 12px', borderRadius: '26px', textAlign: 'center' });
    const n = QR.length, q = 2, cell = Math.floor(size / (n + q * 2)), S = cell * (n + q * 2);
    const cv = mk('canvas', null, card, null, { display: 'block', width: S + 'px', height: S + 'px', imageRendering: 'pixelated' });
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#1a1530';
    QR.forEach((row, yy) => [...row].forEach((v, xx) => { if (v === '1') g.fillRect((xx + q) * cell, (yy + q) * cell, cell, cell); }));
    if (label) mk('div', 'jua', card, label, { fontSize: '36px', marginTop: '8px', color: 'var(--ink)' });
    return card;
  }
  // 연속 그림 묶음 (shots/seq/<name>/0001.png …). 돌려주는 함수(lt) 가 맞는 장을 보이고 그 장을 돌려준다
  function seqFrames(parent, o) {
    const N = o.frames, frames = Array.from({ length: N }, (_, i) => pic(parent, `@seq/${o.name}/${String(i + 1).padStart(4, '0')}.png`, '', { display: 'none' }));
    let last = -1;
    return lt => {
      const fps = (o.fps || 12) * (o.speed || 1);
      let k = Math.floor(Math.max(0, lt - (o.at || 0)) * fps);
      if (o.pingpong) { const m = 2 * N - 2 || 1; k %= m; if (k >= N) k = m - k; } else k = o.loop === false ? Math.min(N - 1, k) : k % N;
      if (k !== last) { frames.forEach((f, i) => { f.style.display = i === k ? 'block' : 'none'; }); last = k; }
      return frames[k];
    };
  }
  const badgeEl = (el, t) => t ? mk('div', 'badge jua', el, `<i></i>${t}`) : null;

  // ---------- 1) 무엇이든 위에 덧붙이기 ----------
  // Q.with(el, { base: el => Q.x(el, …), keys:[{t,x,y,w,h,fs,at,press:[…],out}], rings:[{x,y,w,h,at,out,br}],
  //              notes:[{t,x,y,at,out,tx}], chips:[{t,x,y,at,out}], texts:[{t, …MG.text 옵션}], qr:{x,y,at,size,label}, caps })
  Q.with = (el, o) => {
    const r = o.base ? o.base(el) : { seek() { }, events: [], caps: [] };
    const keys = (o.keys || []).map(k => ({ k, e: keycap(el, k.t, k.x, k.y, k.w, k.h, k.fs) }));
    const rings = (o.rings || []).map(r2 => ({ r: r2, e: mk('div', 'ring', el, null, { left: r2.x + 'px', top: r2.y + 'px', width: r2.w + 'px', height: r2.h + 'px', borderRadius: (r2.br ?? 40) + 'px' }) }));
    const notes = (o.notes || []).map(c => ({ c, e: mk('div', 'callout jua', el, c.t, { left: c.x + 'px', top: c.y + 'px', '--tx': (c.tx || 60) + 'px' }) }));
    const chips = (o.chips || []).map(c => ({ c, e: mk('div', 'chip', el, c.t, { left: c.x + 'px', top: c.y + 'px' }) }));
    const ts = (o.texts || []).map(t => text(el, t.t, t));
    const qr = o.qr ? qrCard(el, o.qr.x, o.qr.y, o.qr.size || 260, o.qr.label) : null;
    return {
      seek(lt) {
        r.seek(lt);
        keys.forEach(({ k, e }) => seekKey(e, lt, k.at, k.press, { out: k.out }));
        rings.forEach(({ r: q, e }) => { pop(e, lt, q.at, { out: q.out, dy: 0, s0: 1.4 }); if (lt > q.at + TOK.move) e.style.transform += ` scale(${1 + Math.sin((lt - q.at) * 7) * ST.ringPulse})`; });
        notes.forEach(({ c, e }) => pop(e, lt, c.at, { out: c.out, dy: 46, r0: c.r0 ?? -5 }));
        chips.forEach(({ c, e }) => pop(e, lt, c.at, { out: c.out, dy: 40 }));
        ts.forEach(t => t.seek(lt));
        if (qr) { pop(qr, lt, o.qr.at, { dy: 0, s0: 0.2, r0: 14, r: -3 }); }
      },
      events: [...(r.events || []),
        ...(o.keys || []).flatMap(k => [[k.at, 'pop2'], ...(k.press || []).map(t => [t, 'click'])]),
        ...(o.rings || []).map(q => [q.at, 'sparkle']), ...(o.notes || []).map(c => [c.at, 'pop']),
        ...(o.chips || []).map(c => [c.at, 'tick']), ...ts.flatMap(t => t.events), ...(o.qr ? [[o.qr.at, 'boing']] : [])],
      caps: o.caps || r.caps || [],
    };
  };

  // ---------- 2) 기기 하나에 화면 여러 장 (그림 → 그림 → 연속 그림) ----------
  // o: { device:'laptop'|'tablet', x, y, w, ratio, enter, shots:[{src | seq:{name,frames,fps,speed,loop,pingpong}, at, path}],
  //      notes, rings, chips, keys, texts, badge, caps }
  const PAD = { laptop: [18, 18, 34, 18], tablet: [24, 24, 24, 24] };
  Q.multi = (el, o) => {
    const kind = o.device || 'laptop', dw = o.w ?? 1160, ratio = o.ratio || (kind === 'tablet' ? 0.75 : 9 / 16), dh = Math.round(dw * ratio), pd = PAD[kind];
    const X = o.x ?? (960 - dw / 2 - pd[1]), Y = o.y ?? 160;
    const d = mk('div', 'dev ' + kind, el, null, { left: X + 'px', top: Y + 'px', width: dw + pd[1] + pd[3] + 'px', height: dh + pd[0] + pd[2] + 'px' });
    const scr = mk('div', 'scr', d);
    const SH = o.shots.map(s => {
      const lay = mk('div', 'layer', scr, null, { overflow: 'hidden' });
      if (s.seq) return { s, lay, f: seqFrames(lay, s.seq) };
      return { s, lay, img: pic(lay, s.src) };
    });
    const bdg = badgeEl(el, o.badge);
    const ent = { rise: { dy: 260, s0: 0.86 }, left: { dx: -900, dy: 0, s0: 0.95, r0: -6 }, right: { dx: 900, dy: 0, s0: 0.95, r0: 6 }, drop: { dy: -700, s0: 1, r0: 4 } }[o.enter || 'rise'];
    const over = Q.with(el, { keys: o.keys, rings: o.rings, notes: o.notes, chips: o.chips, texts: o.texts });
    return {
      seek(lt) {
        pop(d, lt, 0.05, { ...ent, e: F2, d: TOK.moveSlow });
        let cur = 0; SH.forEach((h, i) => { if (lt >= (h.s.at || 0)) cur = i; });
        SH.forEach((h, i) => {
          const t0 = h.s.at || 0, on = i === cur, nextAt = SH[i + 1] ? SH[i + 1].s.at : 1e9;
          // 들어오는 화면: 살짝 당겨진 상태에서 정착 + 투명도. 이전 화면은 다음 화면이 다 덮은 뒤 숨김
          const vis = on || (i === cur - 1 && lt < nextAt + ST.swapFade);
          h.lay.style.display = vis ? 'block' : 'none';
          if (!vis) return;
          const p = i === 0 ? 1 : P(lt, t0, ST.swapFade, LIN);
          h.lay.style.opacity = on ? p : 1; h.lay.style.zIndex = on ? 2 : 1;
          h.lay.style.transform = on && i > 0 ? `scale(${lerp(ST.swapZoom, 1, P(lt, t0, TOK.moveFast, OUT))})` : '';
          const path = h.s.path || [[0, 1, 0.5, 0.5]];
          if (h.f) { const fr = h.f(lt - t0); camPath(fr, dw, dh, path, lt); } else camPath(h.img, dw, dh, path, lt);
        });
        if (bdg) pop(bdg, lt, 0.08, { dx: -60, dy: 0, s0: 0.8 });
        over.seek(lt);
      },
      events: [[0.05, 'swish'], ...o.shots.slice(1).map(s => [s.at, 'flip']), ...over.events],
      caps: o.caps || [],
    };
  };
  // 기기 화면 안의 점(그림 비율 fx,fy)이 무대에서 어디인지 (카메라 z, cx, cy 기준)
  window.devPt = (dev, fx, fy, z = 1, cx = 0.5, cy = 0.5) => {
    const kind = dev.device || 'laptop', pd = PAD[kind], dw = dev.w ?? 1160, dh = Math.round(dw * (dev.ratio || (kind === 'tablet' ? 0.75 : 9 / 16)));
    const X = (dev.x ?? (960 - dw / 2 - pd[1])) + pd[3], Y = (dev.y ?? 160) + pd[0];
    const w = dw * z, h = dh * z, tx = clamp(dw / 2 - cx * w, dw - w, 0), ty = clamp(dh / 2 - cy * h, dh - h, 0);
    return [Math.round(X + tx + fx * w), Math.round(Y + ty + fy * h)];
  };

  // ---------- 3) 움직이기: 자판(WASD·방향키) + 태블릿(누른 채 끌기) ----------
  // o: { title, tablet:{img, x, y, w, ratio, touch:[fx,fy]}, press:[[시각, 'U'|'D'|'L'|'R'], …], dragAt, caps }
  Q.controls = (el, o) => {
    const T = text(el, o.title || '움직이기', { style: o.titleStyle || 'mask', y: 46, size: 96, at: 0.05 });
    const pc = mk('div', 'jua', el, '💻 컴퓨터', { position: 'absolute', left: '170px', top: '250px', width: '760px', textAlign: 'center', fontSize: '54px', color: 'var(--moon)' });
    const KX = 210, KY = 380, S = 118;
    const L = {
      W: keycap(el, 'W', KX + S, KY), A: keycap(el, 'A', KX, KY + S), S: keycap(el, 'S', KX + S, KY + S), D: keycap(el, 'D', KX + S * 2, KY + S),
      UP: keycap(el, '↑', KX + 460 + S, KY), LF: keycap(el, '←', KX + 460, KY + S), DN: keycap(el, '↓', KX + 460 + S, KY + S), RT: keycap(el, '→', KX + 460 + S * 2, KY + S),
    };
    const orw = mk('div', 'jua', el, '또는', { position: 'absolute', left: KX + 3 * S + 4 + 'px', width: '100px', top: KY + S + 30 + 'px', textAlign: 'center', fontSize: '38px', color: '#cfc6ff' });
    const map = { U: ['W', 'UP'], D: ['S', 'DN'], L: ['A', 'LF'], R: ['D', 'RT'] };
    const PR = o.press || [];
    const timesOf = name => PR.filter(([, d]) => map[d].includes(name)).map(([t]) => t);
    const tb = o.tablet || {};
    const dw = tb.w ?? 740, ratio = tb.ratio ?? 0.75, dh = Math.round(dw * ratio), TX = tb.x ?? 1060, TY = tb.y ?? 250;
    const tlab = mk('div', 'jua', el, '📱 태블릿', { position: 'absolute', left: TX + 'px', width: dw + 48 + 'px', top: '160px', textAlign: 'center', fontSize: '54px', color: 'var(--moon)' });
    const dev = mk('div', 'dev tablet', el, null, { left: TX + 'px', top: TY + 'px', width: dw + 48 + 'px', height: dh + 48 + 'px' });
    const scr = mk('div', 'scr', dev); const img = pic(scr, tb.img);
    const [fx, fy] = tb.touch || [0.22, 0.79];
    const ox = TX + 24 + fx * dw, oy = TY + 24 + fy * dh; // 손가락이 닿는 점(무대 좌표)
    const halo = mk('div', null, el, null, { position: 'absolute', left: ox - 70 + 'px', top: oy - 70 + 'px', width: '140px', height: '140px', borderRadius: '50%', border: '6px solid var(--lantern)', background: 'rgba(255,194,71,.25)', boxShadow: '0 0 40px rgba(255,194,71,.7)' });
    const dots = Array.from({ length: 6 }, () => mk('div', null, el, null, { position: 'absolute', left: '-9px', top: '-9px', width: '18px', height: '18px', borderRadius: '50%', background: 'var(--lantern)', boxShadow: '0 0 14px var(--lantern)' }));
    const hand = mk('div', null, el, '👆', { position: 'absolute', left: '0', top: '0', fontSize: '120px', filter: 'drop-shadow(0 10px 12px rgba(0,0,0,.5))' });
    const chip = mk('div', 'chip', el, '누른 채 끌기', { left: TX + dw / 2 - 120 + 'px', top: TY + dh + 76 + 'px' });
    const keychip = mk('div', 'chip', el, 'WASD · 방향키', { left: '370px', top: KY + S * 2 + 70 + 'px' });
    const DA = o.dragAt ?? 0.9;
    // 손가락 경로: 닿은 점에서 원을 그리며 끈다 (반지름 90)
    const fpos = lt => { const u = Math.max(0, lt - DA); const R = 90 * P(lt, DA, 0.3, OUT); const a = u * 3.2 - Math.PI / 2; return [ox + Math.cos(a) * R, oy + Math.sin(a) * R * 0.8]; };
    return {
      seek(lt) {
        T.seek(lt);
        pop(pc, lt, 0.15, { dy: 30, s0: 0.9 }); pop(orw, lt, 0.5, { dy: 0, s0: 0.5 }); pop(keychip, lt, 0.6, { dy: 30 });
        Object.entries(L).forEach(([nm, k], i) => seekKey(k, lt, 0.2 + i * TOK.stagFast, timesOf(nm)));
        pop(dev, lt, 0.1, { dx: 700, dy: 0, s0: 0.95, r0: 6, r: 0, e: F2, d: TOK.moveSlow });
        pop(tlab, lt, 0.3, { dy: 30, s0: 0.9 }); pop(chip, lt, DA + 0.3, { dy: 30 });
        cam(img, dw, dh, 1, 0.5, 0.5);
        const down = P(lt, DA - 0.25, TOK.fadeFast, LIN);
        const [hx, hy] = lt < DA ? [lerp(ox + 260, ox, P(lt, 0.45, 0.4, IO)), lerp(oy + 200, oy, P(lt, 0.45, 0.4, IO))] : fpos(lt);
        hand.style.opacity = P(lt, 0.45, TOK.fade, LIN);
        hand.style.transform = `translate(${hx - 40}px, ${hy - 10}px) scale(${lt > DA - 0.25 ? 0.92 : 1})`;
        halo.style.opacity = down; halo.style.transform = `translate(${hx - ox}px, ${hy - oy}px) scale(${lerp(0.4, 1, down)})`;
        dots.forEach((dd, i) => { const [x, y] = fpos(lt - (i + 1) * 0.07); dd.style.opacity = lt > DA ? 0.9 - i * 0.14 : 0; dd.style.transform = `translate(${x}px, ${y}px) scale(${1 - i * 0.1})`; });
      },
      events: [...T.events, [0.1, 'swish'], ...PR.map(([t]) => [t, 'click']), [DA - 0.25, 'tick']],
      caps: o.caps || [],
    };
  };

  // ---------- 4) 틀려도 괜찮아: 오답 → 잠깐 기다림 → 다시 풀어 정답 ----------
  // o: { title, line2, q, choices[4], wrong, answer, wrongAt, waitTo, rightAt, waitLabel, caps }
  Q.retry = (el, o) => {
    const T = text(el, o.title || '틀려도 괜찮아!', { style: 'wobble', y: 30, size: 100, at: 0.05 });
    const T2 = o.line2 ? text(el, o.line2, { style: 'glow', y: 150, size: 60, at: o.line2At ?? 2.5 }) : null;
    const wrap = mk('div', null, el, null, { position: 'absolute', left: '400px', top: '250px', width: '1120px' });
    const box = mk('div', 'quiz paper', wrap, null, { position: 'relative' });
    mk('div', 'qh', box, '❓ 퀴즈'); mk('div', 'qq', box, o.q);
    const grid = mk('div', 'grid', box);
    const NC = ['#9b6bf2', '#5cc8f2', '#ff9ec4', '#ffb547'];
    const chs = o.choices.map((c, i) => { const e = mk('div', 'ch', grid, `<span class="ok"></span><span class="n" style="background:${NC[i]}">${i + 1}</span><span>${c}</span>`); const x = mk('span', null, e, '✕', { position: 'absolute', right: '26px', top: '50%', marginTop: '-40px', font: "400 80px/80px 'Jua'", color: 'var(--warn)', opacity: 0 }); return { e, ok: e.querySelector('.ok'), x }; });
    const hand = mk('div', null, wrap, '👆', { position: 'absolute', left: 0, top: 0, fontSize: '96px', filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.4))', zIndex: 4 });
    const stamp = mk('div', 'stamp', wrap, '정답!', { left: (o.answer % 2) * 512 + 300 + 'px', top: Math.floor(o.answer / 2) * 130 + 260 + 'px', fontSize: '92px', zIndex: 3 });
    const pill = mk('div', 'jua', el, `<span class="hg" style="display:inline-block">⏳</span> ${o.waitLabel || '잠깐 쉬었다가…'}<span class="bar" style="position:absolute;left:0;bottom:0;height:10px;width:100%;background:var(--lantern);transform-origin:0 50%;border-radius:0 0 0 30px"></span>`,
      { position: 'absolute', left: '660px', top: '780px', width: '600px', padding: '16px 0 20px', textAlign: 'center', borderRadius: '30px', background: 'rgba(11,10,36,.9)', border: '4px solid var(--lantern)', fontSize: '50px', overflow: 'hidden' });
    const hg = pill.querySelector('.hg'), bar = pill.querySelector('.bar');
    const WA = o.wrongAt ?? 0.8, WT = o.waitTo ?? 2.0, RA = o.rightAt ?? 2.3;
    const at = (i, row) => [(i % 2) * 512 + 360, Math.floor(i / 2) * 124 + 300 + (row || 0)];
    return {
      seek(lt) {
        T.seek(lt); if (T2) T2.seek(lt);
        pop(box, lt, 0.15, { dy: 120, s0: 0.5 });
        const [sx] = shake(lt, WA + 0.05, 0.4, 18); box.style.transform += ` translateX(${sx}px)`;
        chs.forEach(({ e, ok, x }, i) => {
          pop(e, lt, 0.4 + i * TOK.stagFast, { dy: 30, s0: 0.7 });
          if (i === o.wrong) { const w = P(lt, WA, TOK.fadeFast, LIN); x.style.opacity = w; x.style.transform = `scale(${lerp(2, 1, P(lt, WA, TOK.moveFast, F1))})`; e.style.background = w > 0.5 ? '#ffd9d9' : ''; if (lt > WA) e.style.opacity = +e.style.opacity * (1 - 0.5 * P(lt, WT, TOK.fade, LIN)); }
          if (i === o.answer) { ok.style.opacity = P(lt, RA, TOK.fade, LIN); if (lt > RA) e.style.transform += ` scale(${lerp(0.92, 1, P(lt, RA, TOK.moveFast, F1))})`; }
        });
        // 손가락: 오답 → (대기) → 정답
        const [wx, wy] = at(o.wrong), [rx, ry] = at(o.answer);
        let hx, hy;
        if (lt < WA + 0.4) { const u = P(lt, WA - 0.5, TOK.move, IO); hx = lerp(1150, wx, u); hy = lerp(640, wy, u); }
        else { const u = P(lt, RA - 0.45, TOK.moveFast, IO); hx = lerp(wx, rx, u); hy = lerp(wy + 30, ry, u); }
        const tap = (lt > WA && lt < WA + 0.12) || (lt > RA && lt < RA + 0.12);
        hand.style.opacity = P(lt, WA - 0.5, TOK.fade, LIN) * (1 - P(lt, RA + 0.45, TOK.fade, LIN));
        hand.style.transform = `translate(${hx}px, ${hy}px) scale(${tap ? 0.86 : 1})`;
        pop(stamp, lt, RA + 0.2, { s0: 2.4, dy: 0, r0: -22, r: -8, d: TOK.moveFast });
        // 기다림 알약
        pop(pill, lt, WA + 0.2, { dy: 40, s0: 0.8, out: WT + 0.05 });
        bar.style.transform = `scaleX(${1 - P(lt, WA + 0.25, WT - WA - 0.25, LIN)})`;
        hg.style.transform = `rotate(${CALM ? 0 : Math.floor(Math.max(0, lt - WA) * 3) * 180}deg)`;
      },
      events: [...T.events, ...(T2 ? T2.events : []), [0.15, 'pop'], [WA, 'click'], [WA + 0.05, 'thud'], [WA + 0.2, 'tick'], [RA, 'click'], [RA + 0.2, 'correct']],
      caps: o.caps || [],
    };
  };

  // ---------- 5) 실제 게임 연속 그림 위에 좁아지는 잠 안개 ----------
  // o: { seq:{name,frames,…}, 그 밖은 Q.fogShrink 옵션 }
  Q.fogBook = (el, o) => {
    const lay = mk('div', 'layer', el, null, { overflow: 'hidden' });
    const f = seqFrames(lay, o.seq);
    const fs = Q.fogShrink(el, { ...o, img: null });
    el.querySelectorAll('.pic.full.missing').forEach(e => { e.style.display = 'none'; });
    el.querySelectorAll('.lan').forEach(e => { e.style.display = 'none'; }); // 실제 게임 위에서는 그린 랜턴을 숨긴다
    return {
      seek(lt) { const fr = f(lt); cam(fr, 1920, 1080, 1.06, 0.5, 0.5); fs.seek(lt); },
      events: fs.events, caps: o.caps || fs.caps || [],
    };
  };
})();
