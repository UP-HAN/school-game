// 홍보 영상(promo) 전용 부품. lib.js 는 고치지 않고 여기서 Q.* 를 더한다.
// 규칙은 lib.js 와 같다: 모든 움직임은 seek(lt) 의 순수 함수.
(function () {
  const { TOK, P, pop, mk, pic, cam, camPath, lerp, clamp, tent, text, F1, F2, OUT, INQ, IO, LIN, CALM } = MG;

  // 이 영상에서만 쓰는 조절값 (여기만 바꾸면 리듬이 바뀐다)
  const PT = {
    focusMove: 0.7,    // 모드 비교: 한쪽 확대에 걸리는 시간
    focusX: 900,       // 모드 비교: 확대 때 가운데 선이 움직이는 거리(px)
    cutZoom: 1.16,     // 빠른 컷: 컷마다 확대에서 시작하는 배율
    cutZoomDur: 0.35,  // 빠른 컷: 확대가 풀리는 시간
    flashMax: 0.55,    // 빠른 컷: 번쩍임 세기 (모션 축소면 0)
    slam: 0.4,         // 큰 글자표 쾅 박히는 시간
  };
  const seqSrc = (name, i) => `@seq/${name}/${String(i).padStart(4, '0')}.png`;

  // ── 1) 두 모드 비교 + 한쪽씩 확대하며 실제 화면 ──
  // o: { left/right:{icon,title,line,items[],color, screen:{img,img2,swap,path,callouts,rings}, tagline}, itemsAt, itemStep, vsAt, focusL, focusR, focusC, caps }
  Q.promoSplit = (el, o) => {
    const SD = { left: o.left, right: o.right };
    const cols = { left: SD.left.color || 'var(--lantern)', right: SD.right.color || 'var(--mint)' };
    const panels = ['left', 'right'].map(side => {
      const s = SD[side];
      const pn = mk('div', 'panel', el, null, { background: side === 'left' ? 'linear-gradient(160deg, #3a1f6b, #17143f 70%)' : 'linear-gradient(200deg, #12345a, #17143f 70%)' });
      const cnt = mk('div', 'cnt', pn, null, { left: side === 'left' ? '0' : '960px' });
      const ic = mk('div', 'ic', cnt, s.icon);
      const tt = mk('div', 'tt jua', cnt, s.title, { color: cols[side] });
      const ln = mk('div', 'ln', cnt, s.line || '');
      const its = (s.items || []).map(t => mk('div', 'it', cnt, `<b style="color:${cols[side]}">✦</b>${t}`));
      return { side, pn, cnt, ic, tt, ln, its };
    });
    const seam = mk('div', 'seam', el), vs = mk('div', 'vs', el, 'VS');
    // 실제 화면(노트북 틀) + 한마디 띠
    const FL = o.focusL ?? 3.0, FR = o.focusR ?? 5.6, FC = o.focusC ?? 8.3;
    const screens = ['left', 'right'].map(side => {
      const s = SD[side], layer = mk('div', 'layer', el);
      const r = Q.device(layer, { device: 'laptop', x: 990, y: 170, w: 830, enter: side === 'left' ? 'right' : 'right', ...s.screen });
      const tg = mk('div', 'jua', layer, s.tagline, { position: 'absolute', left: '990px', width: '866px', top: '735px', textAlign: 'center', fontSize: '50px', color: cols[side], textShadow: '0 4px 0 rgba(11,10,36,.6)' });
      return { layer, r, tg, t0: side === 'left' ? FL : FR, t1: side === 'left' ? FR : FC };
    });
    const IA = o.itemsAt ?? 0.9, IS = o.itemStep ?? 0.26, VA = o.vsAt ?? 0.55;
    const order = []; const nmax = Math.max(panels[0].its.length, panels[1].its.length);
    for (let i = 0; i < nmax; i++) for (const p of panels) if (p.its[i]) order.push([p, i]);
    const SK = 70;
    return {
      seek(lt) {
        const a = P(lt, FL, PT.focusMove, IO), b = P(lt, FR, PT.focusMove + 0.05, IO), c = P(lt, FC, PT.focusMove, IO);
        const fL = Math.max(0, a - b), fR = Math.max(0, b - c);
        const X = 960 + PT.focusX * fL - PT.focusX * fR;
        const pl = P(lt, 0.05, TOK.moveSlow, F2), pr = P(lt, 0.05 + TOK.stag, TOK.moveSlow, F2);
        panels[0].pn.style.clipPath = `polygon(0 0, ${X + SK}px 0, ${X - SK}px 100%, 0 100%)`;
        panels[1].pn.style.clipPath = `polygon(${X + SK}px 0, 100% 0, 100% 100%, ${X - SK}px 100%)`;
        panels[0].pn.style.transform = `translateX(${lerp(-1100, 0, pl)}px)`; panels[1].pn.style.transform = `translateX(${lerp(1100, 0, pr)}px)`;
        // 확대 쪽이 바뀌는 동안 두 글 묶음이 겹치지 않도록: 나가는 쪽은 빨리 사라지고, 들어오는 쪽은 절반 지나서 나타난다
        const opL = lt < FR ? 1 : lt < FC ? 1 - clamp(b * 2.5) : clamp((c - 0.6) * 2.5);
        const opR = lt < FR ? 1 - fL : lt < FC ? clamp((b - 0.5) * 2) : 1;
        panels[0].cnt.style.transform = `translateX(${-40 * fL}px)`; panels[0].cnt.style.opacity = opL;
        panels[1].cnt.style.transform = `translateX(${-900 * fR}px)`; panels[1].cnt.style.opacity = opR;
        panels.forEach((p, j) => { const t0 = 0.3 + j * TOK.stag; pop(p.ic, lt, t0, { dy: 60, s0: 0.3 }); pop(p.tt, lt, t0 + TOK.stag, { dx: j ? 120 : -120, dy: 0, s0: 1.2 }); pop(p.ln, lt, t0 + TOK.stagSlow * 2, { dy: 24, s0: 1 }); });
        order.forEach(([p, i], k) => pop(p.its[i], lt, IA + k * IS, { dx: p.side === 'left' ? -160 : 160, dy: 0, s0: 0.9 }));
        seam.style.left = '0';
        seam.style.transform = `translateX(${X}px) skewX(${-Math.atan2(2 * SK, 1080) * 57.3}deg) scaleY(${P(lt, 0.25, TOK.move, OUT)})`;
        pop(vs, lt, VA, { dy: 0, s0: 0.2, r0: -30 }); vs.style.left = X + 'px';
        vs.style.opacity = +vs.style.opacity * (1 - Math.max(fL, fR));
        screens.forEach(S => {
          const on = lt >= S.t0 - 0.05 && lt < S.t1 + 0.5;
          S.layer.style.display = on ? 'block' : 'none';
          if (!on) return;
          S.r.seek(lt - S.t0 - 0.1);
          S.layer.style.opacity = 1 - P(lt, S.t1, TOK.fadeSlow, LIN);
          pop(S.tg, lt, S.t0 + 0.75, { dy: 30, s0: 0.85 });
        });
      },
      events: [[0.05, 'swish'], [VA, 'thud'], ...order.map((_, k) => [IA + k * IS, k % 2 ? 'tick' : 'pop']),
        ...screens.flatMap(S => S.r.events.map(([t, k]) => [+(t + S.t0 + 0.1).toFixed(3), k]).filter(([t]) => t < S.t1)), [FC, 'swish']],
      caps: o.caps || [],
    };
  };

  // ── 2) 빠른 컷 릴: 실제 게임 연속 장면을 박자에 맞춰 끊고, 컷마다 확대 펀치 + 번쩍 + 큰 글자표 ──
  // o: { clips:[{name, frames, fps, start, dur, zoom:[[시각, 배율, cx, cy], ...](컷처럼 바로 바뀜), label, labelColor}], tagText, caps }
  Q.cutReel = (el, o) => {
    let t = 0;
    const C = o.clips.map(c => {
      const box = mk('div', 'layer', el, null, { overflow: 'hidden', display: 'none' });
      const inner = mk('div', 'layer', box, null, { transformOrigin: '50% 50%' });
      const frames = Array.from({ length: c.frames }, (_, i) => pic(inner, seqSrc(c.name, i + 1), '', { display: 'none' }));
      mk('div', 'shade', box, null, { background: 'radial-gradient(ellipse 70% 70% at 50% 45%, rgba(5,4,20,0) 60%, rgba(5,4,20,.6))' });
      const lab = c.label ? mk('div', 'jua', box, `<span style="display:inline-block;padding:18px 54px 10px;border-radius:30px;background:var(--paper);color:var(--ink);border:7px solid var(--ink);box-shadow:10px 10px 0 var(--ink)">${c.label}</span>`, { position: 'absolute', left: 0, right: 0, top: (c.labelY ?? 820) + 'px', textAlign: 'center', fontSize: (c.labelSize || 84) + 'px', transformOrigin: '50% 50%' }) : null;
      const r = { ...c, n: c.frames, box, inner, frames, lab, t0: t, last: -1 };
      t += c.dur; return r;
    });
    const tag = mk('div', 'chip', el, o.tagText || '🎮 실제 게임 화면', { left: '70px', top: '56px', background: 'var(--lantern)' });
    const fl = mk('div', 'shade', el, null, { background: '#fff1c9', opacity: 0 });
    return {
      seek(lt) {
        let k = 0; C.forEach((c, i) => { if (lt >= c.t0) k = i; });
        C.forEach((c, i) => {
          c.box.style.display = i === k ? 'block' : 'none';
          if (i !== k) return;
          const u = lt - c.t0, fps = c.fps || 12;
          const f = clamp(Math.floor(u * fps) + (c.start || 0), 0, c.n - 1);
          if (f !== c.last) { c.frames.forEach((e, j) => { e.style.display = j === f ? 'block' : 'none'; }); c.last = f; }
          // 컷처럼 바로 바뀌는 확대(박자마다)
          const Z = c.zoom || [[0, 1.1, 0.5, 0.5]]; let z = Z[0]; for (const q of Z) if (u >= q[0]) z = q;
          const zi = Z.indexOf(z);
          cam(c.frames[f], 1920, 1080, z[1], z[2], z[3]);
          c.inner.style.transform = `scale(${lerp(PT.cutZoom, 1, P(u, z[0], PT.cutZoomDur, OUT))})`;
          if (c.lab) { const p = P(u, 0.12, PT.slam, F1); c.lab.style.opacity = P(u, 0.12, TOK.fadeFast, LIN); c.lab.style.transform = `scale(${lerp(1.9, 1, p)}) rotate(${lerp(-9, zi % 2 ? 2 : -2, P(u, 0.12, PT.slam, OUT))}deg)`; }
        });
        const cutT = C.flatMap(c => (c.zoom || [[0]]).map(q => c.t0 + q[0]));
        fl.style.opacity = CALM ? 0 : Math.max(...cutT.map(ct => tent(lt, ct - 0.02, 0.2))) * PT.flashMax;
        pop(tag, lt, 0.1, { dx: -60, dy: 0, s0: 0.8 });
      },
      events: C.flatMap((c, i) => [...(i ? [[c.t0, 'thud']] : []), ...(c.lab ? [[c.t0 + 0.12, 'stamp']] : []), ...(c.zoom || []).slice(1).map(q => [c.t0 + q[0], 'whoosh'])]),
      caps: o.caps || [],
    };
  };

  // ── 3) 새벽빛 100% → 아침 일러스트가 열리며 "아침이 왔다!" ──
  // o: gauge 옵션 + { win(그림), winAt, winText, winSub }
  Q.dawnWin = (el, o) => {
    const g = Q.gauge(el, { ...o, caps: null });
    const win = pic(el, o.win, 'full');
    const sh = mk('div', 'shade', el, null, { background: 'linear-gradient(180deg, rgba(11,10,36,.0) 40%, rgba(11,10,36,.55))' });
    const WA = o.winAt ?? 2.0;
    const T = text(el, o.winText || '아침이 왔다!', { style: 'wobble', at: WA + 0.15, y: 150, size: 150 });
    const S = o.winSub ? mk('div', 'chip', el, o.winSub, { left: '50%', top: '360px', marginLeft: '-190px', width: '380px', textAlign: 'center', fontSize: '44px' }) : null;
    return {
      seek(lt) {
        g.seek(lt);
        const p = P(lt, WA, 0.6, IO);
        win.style.opacity = p; sh.style.opacity = p;
        win.style.clipPath = `circle(${lerp(0, 1300, p)}px at 960px 1000px)`;
        win.style.transform = `scale(${lerp(1.15, 1.03, P(lt, WA, 1.6, OUT))})`;
        T.seek(lt);
        if (S) pop(S, lt, WA + 0.6, { dy: 40, s0: 0.6 });
      },
      events: [...g.events, [WA, 'rise'], ...T.events, ...(S ? [[WA + 0.6, 'chime']] : [])],
      caps: o.caps || [],
    };
  };
})();
