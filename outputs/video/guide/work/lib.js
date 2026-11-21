// 한밤의 랜턴 대작전 — 안내 영상 엔진 + 장면 부품
// 규칙: window.seek(t) 는 순수 함수다 (실시간 타이머·CSS animation 없음). 같은 t 면 언제나 같은 화면.
// 장면 부품 Q.이름(el, 옵션) 은 { seek(lt), events:[[초, 효과음]] } 를 돌려준다. lt = 장면 안 시각(초).
(function () {
  // ================= 0. 조절 토큰 (여기만 바꾸면 전체 리듬이 바뀐다) =================
  const TOK = window.TOK = {
    move: 0.55, moveFast: 0.4, moveSlow: 0.7,   // 공간 이동 (규칙 0.35~0.75초)
    fade: 0.2, fadeSlow: 0.3, fadeFast: 0.15,   // 색·투명도 (규칙 0.15~0.3초)
    stag: 0.1, stagFast: 0.06, stagSlow: 0.14,  // 스태거 (규칙 0.05~0.15초)
    shake: 16,                                   // 화면 흔들림 세기(px)
  };
  // 전환 길이(초)
  const TRD = { lantern: 0.7, fog: 0.6, slide: 0.65, door: 0.9, flip: 0.6, punch: 0.5, push: 0.6, cut: 0 };
  // 모션 축소: ?calm=1 → 흔들림·번쩍임·빙글 회전 줄임
  const CALM = /[?&]calm=1/.test(location.search) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches && !/[?&]render=1/.test(location.search));
  // 그림 경로: 'x.png' → ../shots/x.png, '@art/illust/win.png' → outputs/art/..., '@demo/..' → work/demo_assets/..
  const ROOT = { shots: '../shots/', art: '../../../art/', demo: 'demo_assets/', seq: '../shots/seq/' };

  // ================= 1. 수학·이징 =================
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  function bez(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => { if (x <= 0) return 0; if (x >= 1) return 1; let t = x; for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-5 || !d) break; t -= e / d; } return sy(clamp(t)); };
  }
  // F1: 오버슈트(위치·크기 전용) / F2: 살짝 튀는 정착 / OUT: 부드러운 감속 / INQ: 가속 / IO: 양끝 부드럽게
  const F1 = bez(0.34, 1.45, 0.4, 1.0), F2 = bez(0.22, 1.08, 0.3, 1.0), OUT = bez(0.16, 1, 0.3, 1), INQ = bez(0.55, 0, 0.9, 0.45), IO = bez(0.65, 0, 0.35, 1), LIN = x => clamp(x);
  const P = (t, t0, d, e = OUT) => e(clamp((t - t0) / Math.max(1e-6, d)));
  const tent = (t, t0, d) => { const x = (t - t0) / d; return x <= 0 || x >= 1 ? 0 : 1 - Math.abs(x * 2 - 1); };
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // 이모지가 흐리게 보이는 아이콘은 코드로 그린 SVG 로 바꾼다 (지금은 킥보드만). 게임 drawKickboard 모양 참고: 발판·앞 기둥·손잡이·바퀴 2개
  // 어두운 배경에서도 보이도록 종이색 테두리(바깥) → 잉크 외곽선 → 색 순서로 겹쳐 그린다
  const KICK_SHAPES = (w, c1, c2) => `<path d="M88 84 L100 22" stroke-width="${18 + w}" stroke="${c1}"/><path d="M84 20 L118 20" stroke-width="${16 + w}" stroke="${c1}"/>`
    + `<rect x="8" y="74" width="92" height="22" rx="11" fill="${c2}" stroke="${c1}" stroke-width="${7 + w}"/>`
    + `<circle cx="24" cy="102" r="14" fill="${c2}" stroke="${c1}" stroke-width="${7 + w}"/><circle cx="90" cy="102" r="14" fill="${c2}" stroke="${c1}" stroke-width="${7 + w}"/>`;
  const KICK_SVG = s => `<svg class="ico-kick" width="${s}" height="${s}" viewBox="0 0 120 120" style="display:block;overflow:visible"><g stroke-linecap="round" stroke-linejoin="round">`
    + KICK_SHAPES(8, '#fff6e5', '#fff6e5') + KICK_SHAPES(0, '#2a2140', '#2a2140')
    + `<path d="M88 84 L100 22" stroke="#ffc247" stroke-width="8"/><path d="M84 20 L118 20" stroke="#7fe0c4" stroke-width="6"/>`
    + `<rect x="8" y="74" width="92" height="22" rx="11" fill="#ffc247" stroke="#2a2140" stroke-width="7"/>`
    + `<circle cx="24" cy="102" r="14" fill="#7fe0c4" stroke="#2a2140" stroke-width="7"/><circle cx="90" cy="102" r="14" fill="#7fe0c4" stroke="#2a2140" stroke-width="7"/>`
    + `<circle cx="24" cy="102" r="4.5" fill="#2a2140" stroke="none"/><circle cx="90" cy="102" r="4.5" fill="#2a2140" stroke="none"/></g></svg>`;
  const ICON = (em, size) => em === '🛴' ? KICK_SVG(size) : em;

  // ================= 2. DOM 도우미 =================
  const PENDING = []; let UID = 0;
  const mk = (tag, cls, parent, html, style) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (style) for (const k in style) { if (k.startsWith('--')) e.style.setProperty(k, style[k]); else e.style[k] = style[k]; } if (parent) parent.appendChild(e); return e; };
  const px = v => typeof v === 'number' ? v + 'px' : v;
  const set = (e, o) => { e.style.opacity = o.o ?? 1; e.style.transform = `translate(${o.x || 0}px, ${o.y || 0}px) scale(${o.s ?? 1}${o.sy != null ? ',' + o.sy : ''}) rotate(${o.r || 0}deg)${o.ry ? ` rotateY(${o.ry}deg)` : ''}`; };
  // 기본 등장: 투명도는 fade, 위치·크기는 move (+F1 오버슈트)
  function pop(e, lt, t0, opt = {}) {
    const p = P(lt, t0, opt.d || TOK.move, opt.e || F1), po = P(lt, t0, opt.fd || TOK.fade, LIN);
    const out = opt.out != null ? P(lt, opt.out, TOK.fadeSlow, INQ) : 0;
    set(e, { o: po * (1 - out), x: lerp(opt.dx || 0, 0, p) + (opt.ox || 0) * out, y: lerp(opt.dy ?? 40, 0, p) + (opt.oy || 0) * out, s: lerp(opt.s0 ?? 0.6, opt.s1 ?? 1, p), r: lerp(opt.r0 || 0, opt.r || 0, P(lt, t0, opt.d || TOK.move, OUT)) });
  }
  function srcOf(s) {
    if (!s) return null;
    const m = String(s).match(/^@(\w+)\/(.*)$/); if (m) return (ROOT[m[1]] ?? '') + m[2];
    if (/^(\.|\/|[a-z]+:)/i.test(s) || s.includes('/')) return s;
    return ROOT.shots + s;
  }
  // 그림: 래퍼 div 를 돌려준다(카메라 이동은 래퍼에). 그림이 없으면 회색 자리표시.
  function pic(parent, src, cls = '', style) {
    const w = mk('div', 'pic ' + cls, parent, null, style);
    mk('div', 'ph', w, `<span>그림 자리</span><small>${esc(src || '(지정 안 됨)')}</small>`);
    const s = srcOf(src);
    if (!s) { w.classList.add('missing'); return w; }
    const img = mk('img', null, w);
    PENDING.push(new Promise(r => { img.onload = r; img.onerror = () => { img.remove(); w.classList.add('missing'); r(); }; }));
    img.src = s;
    return w;
  }
  // 카메라: 래퍼를 배율 z, 중심 (cx,cy)(0~1)로
  function cam(img, W, H, z, cx, cy) {
    const w = W * z, h = H * z;
    img.style.transform = `translate(${clamp(W / 2 - cx * w, W - w, 0)}px, ${clamp(H / 2 - cy * h, H - h, 0)}px) scale(${z})`;
  }
  // 카메라 경로: [[시각, 배율, cx, cy], ...] — 구간 이동은 최대 0.75초
  function camPath(img, W, H, path, lt) {
    let k = 0; while (k < path.length - 1 && lt >= path[k + 1][0]) k++;
    const a = path[k], b = path[Math.min(k + 1, path.length - 1)];
    const span = b[0] - a[0], d = Math.min(0.75, Math.max(0.01, span));
    const p = b === a ? 0 : IO(clamp((lt - (b[0] - d)) / d));
    const q = lt >= b[0] ? 1 : p;
    if (k === path.length - 1) return cam(img, W, H, a[1], a[2], a[3]);
    cam(img, W, H, lerp(a[1], b[1], q), lerp(a[2], b[2], q), lerp(a[3], b[3], q));
  }
  // 코드로 그린 랜턴. set(켜짐 0~1, 흔들림 각도)
  function lantern(parent, x, y, size = 1, o = {}) {
    const el = mk('div', 'lan', parent, null, { left: x + 'px', top: y + 'px' });
    if (o.rope) mk('div', 'rope', el);
    const glow = mk('div', 'glow', el);
    mk('div', 'hook', el); mk('div', 'cap', el);
    const body = mk('div', 'body', el); const light = mk('div', 'light', body); mk('div', 'base', el);
    return {
      el, glow,
      set(lit, r = 0, extra = '') {
        light.style.opacity = lerp(0.12, 1, lit);
        glow.style.opacity = lit; glow.style.transform = `scale(${lerp(0.2, 1, lit) * (o.glow || 1)})`;
        el.style.transform = `${extra} scale(${size}) rotate(${r}deg)`;
      },
    };
  }
  // 흔들림(감쇠 진동, 진자 운동): 각도
  const swing = (lt, t0, amp = 10, f = 5, k = 2.2) => lt < t0 ? 0 : amp * Math.exp(-(lt - t0) * k) * Math.sin((lt - t0) * f);
  // 화면 흔들림 (모션 축소면 없음)
  const shake = (lt, t0, dur = 0.4, amp = TOK.shake) => CALM || lt < t0 || lt > t0 + dur ? [0, 0] : [Math.sin((lt - t0) * 83) * amp * (1 - (lt - t0) / dur), Math.cos((lt - t0) * 67) * amp * 0.6 * (1 - (lt - t0) / dur)];

  // ================= 3. 글자 등장 7종 =================
  // spec: '문장' 또는 ['단어', ['단어', {s:크기, w:굵기, c:색, f:'body'|'jua'}], ...]
  // o: { style:'pop'|'type'|'mask'|'wobble'|'stack'|'marker'|'glow', at, x, y, size, color, align, font:'jua'|'body', weight, stag, mark:[단어번호], markColor, width }
  const STYLES = ['pop', 'type', 'mask', 'wobble', 'stack', 'marker', 'glow'];
  const STACK_K = [1, 1.5, 0.72, 1.22, 0.9];
  function text(parent, spec, o = {}) {
    const st = o.style || 'pop', at = o.at ?? 0, stg = o.stag ?? (st === 'wobble' || st === 'glow' || st === 'type' ? TOK.stagFast : TOK.stag);
    const size = o.size || 96;
    const style = { fontSize: size + 'px', color: o.color || '#fff', top: px(o.y ?? 400) };
    if (o.weight) style.fontWeight = o.weight;
    if (o.x != null) { style.left = px(o.x); style.textAlign = o.align || 'left'; } else { style.left = '0'; style.right = '0'; style.textAlign = 'center'; }
    if (o.markColor) style['--mark'] = o.markColor;
    const box = mk('div', `tx tx-${st} ${o.font === 'body' ? 'body' : 'jua'} ${o.shadow === false ? '' : 'shadow-t'}`, parent, null, style);
    const W = (typeof spec === 'string' ? spec.split(' ') : spec).map(x => typeof x === 'string' ? [x, {}] : x);
    const perChar = st === 'type' || st === 'wobble' || st === 'glow';
    const items = W.map(([t, ws], i) => {
      const s = ws.s || (st === 'stack' ? Math.round(size * STACK_K[i % STACK_K.length]) : null);
      const w = mk('span', 'w', box, null, { fontSize: s ? s + 'px' : null, color: ws.c || null, fontWeight: ws.w || (st === 'stack' && o.font === 'body' ? [900, 500, 800, 700][i % 4] : null) });
      if (ws.f === 'body') w.classList.add('body'); if (ws.f === 'jua') w.classList.add('jua');
      let inner = w;
      if (st === 'mask') { w.classList.add('mask'); inner = mk('span', 'in', w); }
      const chars = perChar ? [...t].map(c => mk('span', 'c', inner, c === ' ' ? '&nbsp;' : esc(c))) : (inner.innerHTML = t, null);
      const hl = st === 'marker' && (o.mark ? o.mark.includes(i) : i === W.length - 1) ? mk('span', 'hl', w) : null; // 기본: 마지막 단어
      return { w, inner, chars, hl, i };
    });
    const allChars = perChar ? items.flatMap(it => it.chars) : [];
    const caret = st === 'type' ? mk('span', 'caret', box) : null;
    const cps = o.cps || 16; // 타자 속도 (글자/초)
    const n = perChar ? allChars.length : items.length;
    const end = st === 'type' ? at + n / cps : at + (n - 1) * stg + TOK.move;
    let hlk = 0; items.forEach(it => { if (it.hl) it.hlAt = end - 0.1 + (hlk++) * TOK.stagSlow; });
    function seek(lt) {
      if (st === 'pop') items.forEach(({ w }, i) => { const t0 = at + i * stg, p = P(lt, t0, TOK.move, F1); w.style.opacity = P(lt, t0, TOK.fade, LIN); w.style.transform = `translateY(${lerp(i % 2 ? -60 : 70, 0, p)}px) scale(${lerp(i % 3 === 1 ? 1.9 : 0.3, 1, p)})`; });
      else if (st === 'type') { const k = Math.floor((lt - at) * cps); allChars.forEach((c, j) => { c.style.display = j < k ? 'inline-block' : 'none'; }); caret.style.opacity = lt < at - 0.3 ? 0 : lt < end + 0.6 ? (Math.floor(lt * 3) % 2 ? 0.2 : 1) : 0; }
      else if (st === 'mask') items.forEach(({ inner }, i) => { const t0 = at + i * stg; inner.style.transform = `translateY(${lerp(i % 2 ? -115 : 115, 0, P(lt, t0, TOK.move, OUT))}%)`; });
      else if (st === 'wobble') allChars.forEach((c, j) => { const t0 = at + j * stg, p = P(lt, t0, TOK.moveSlow, F2), q = clamp((lt - t0) / TOK.moveSlow); c.style.opacity = P(lt, t0, TOK.fadeFast, LIN); c.style.transform = `translate(${Math.sin((lt - t0) * 38 + j) * 22 * (1 - q) * (lt > t0 ? 1 : 0)}px, ${lerp(-90, 0, p)}px) rotate(${lerp([-24, 18, -12, 26][j % 4], 0, P(lt, t0, TOK.moveSlow, OUT))}deg)`; });
      else if (st === 'stack') items.forEach(({ w }, i) => { const t0 = at + i * stg, p = P(lt, t0, TOK.moveFast, F1); w.style.opacity = P(lt, t0, TOK.fade, LIN); w.style.transform = `translateX(${lerp(i % 2 ? 320 : -320, 0, p)}px)`; });
      else if (st === 'marker') items.forEach(({ w, hl, hlAt }, i) => { const t0 = at + i * stg; w.style.opacity = P(lt, t0, TOK.fade, LIN); w.style.transform = `translateY(${lerp(28, 0, P(lt, t0, TOK.moveFast, OUT))}px)`; if (hl) { const hp = P(lt, hlAt, 0.45, OUT); hl.style.transform = `scaleX(${hp})`; w.style.color = hp > 0.5 ? 'var(--ink)' : ''; w.style.textShadow = hp > 0.5 ? 'none' : ''; } });
      else if (st === 'glow') allChars.forEach((c, j) => { const t0 = at + j * stg, lit = P(lt, t0, TOK.fadeSlow, LIN); c.style.opacity = lerp(0.12, 1, lit); c.style.textShadow = `0 0 ${36 * lit}px rgba(255,194,71,${0.85 * lit}), 0 6px 0 rgba(11,10,36,.5)`; c.style.transform = `scale(${lerp(0.9, 1, P(lt, t0, TOK.move, F1))})`; });
    }
    const ev = { pop: 'pop', type: 'type', mask: 'swish', wobble: 'pop2', stack: 'pop', marker: 'marker', glow: 'sparkle' }[st];
    return { el: box, seek, end, events: [[at, ev]] };
  }

  // ================= 4. 무대·배경·자막 =================
  const stage = document.getElementById('stage');
  const bgA = mk('div', 'bgk', stage), bgB = mk('div', 'bgk', stage);
  const sky = mk('div', 'layer', stage);
  seed = 5;
  const STARS = Array.from({ length: 80 }, (_, i) => { const s = 2 + rnd() * 4; const e = mk('div', 'star', sky, null, { left: rnd() * 1920 + 'px', top: rnd() * 760 + 'px', width: s + 'px', height: s + 'px' }); return { e, w: 0.8 + rnd() * 2.4, ph: rnd() * 6.28 }; });
  const moonEl = mk('div', 'moon', sky, null, { left: '1610px', top: '70px' });
  const bfog = [0, 1, 2].map(i => mk('div', 'bgfog', sky, null, { left: [-300, 600, 1200][i] + 'px', top: [800, 860, 790][i] + 'px' }));
  const scenesEl = mk('div', 'layer', stage); scenesEl.id = 'scenes';
  const fx = mk('div', 'layer', stage); fx.id = 'fx';
  const cap = mk('div', null, stage); cap.id = 'cap';
  const flash = mk('div', null, stage); flash.id = 'flash';
  // 배경 종류: [위, 아래] 그라디언트
  const BG = {
    night: ['#0b0a24', '#2b2163'], violet: ['#17143f', '#4b2f8f'], deep: ['#050414', '#120f30'],
    dawn: ['#17143f', '#a0508a'], ember: ['#1a1030', '#5a2a4a'], mint: ['#0d1a33', '#1f4a5c'],
  };
  const bgCss = k => { const [a, b] = BG[k] || BG.night; return `linear-gradient(180deg, ${a}, ${b})`; };
  function caption(lt, list) {
    let cur = null; for (const c of list || []) if (lt >= c[0] && lt < c[1]) cur = c;
    if (!cur) { cap.style.opacity = 0; return; }
    const [a, b, txt] = cur;
    if (cap.dataset.txt !== txt) { cap.innerHTML = txt; cap.dataset.txt = txt; }
    cap.style.opacity = Math.min(P(lt, a, TOK.fade, LIN), 1 - P(lt, b - TOK.fadeSlow, TOK.fadeSlow, LIN));
    cap.style.transform = `translate(-50%, ${lerp(36, 0, P(lt, a, TOK.moveFast))}px)`;
  }

  // 공개 도구 (구성 파일이나 다른 비율 영상에서 쓰기)
  window.MG = { TOK, P, pop, set, mk, pic, cam, camPath, lerp, clamp, tent, text, lantern, swing, shake, F1, F2, OUT, INQ, IO, LIN, ROOT, BG, STYLES, CALM };
  const Q = window.Q = {};
  // 부품 등록: 모든 부품에 공통 옵션 badge(단계 이름표)·caps(자막)를 붙인다
  function def(name, fn) {
    Q[name] = (el, o = {}) => {
      const r = fn(el, o) || {};
      const b = o.badge ? mk('div', 'badge jua', el, `<i></i>${o.badge}`) : null;
      const s0 = r.seek || (() => { });
      r.seek = lt => { s0(lt); if (b) pop(b, lt, o.badgeAt ?? 0.08, { dx: -60, dy: 0, s0: 0.8 }); };
      r.events = (r.events || []).concat(b ? [] : []);
      r.caps = o.caps || r.caps || [];
      return r;
    };
  }
  const textsSeek = (ts, lt) => ts.forEach(t => t.seek(lt));
  const textsEv = ts => ts.flatMap(t => t.events);

  // ================= 5. 기존 부품 (밤 테마) =================
  // 로고 오프닝: 랜턴이 내려와 켜지고, 빛이 그림을 드러내며 제목이 흔들려 정착
  def('logo', (el, o) => {
    const bgi = pic(el, o.bg || '@art/illust/landing.png', 'full');
    const dark = mk('div', 'shade', el, null, { background: '#050414' });
    const LX = o.lx ?? 960, LY = o.ly ?? 40, LIT = o.litAt ?? 0.9;
    const L = lantern(el, LX, LY, 0.9, { rope: true, glow: 1.4 });
    const tag = o.tag ? mk('div', 'jua', el, o.tag, { position: 'absolute', left: 0, right: 0, top: '262px', textAlign: 'center', fontSize: '50px', color: 'var(--mint)' }) : null;
    const T = text(el, o.title || [['한밤의', { s: 120 }], ['랜턴', { s: 210, c: 'var(--lantern)' }], ['대작전', { s: 170 }]], { style: 'wobble', at: LIT + 0.35, y: o.ty ?? 330, size: 170 });
    const S = o.sub ? text(el, o.sub, { style: 'type', at: LIT + 1.4, y: (o.ty ?? 330) + 270, size: 62, font: 'body', weight: 800 }) : null;
    return {
      seek(lt) {
        const lit = P(lt, LIT, TOK.fadeSlow, LIN);
        L.set(lit, swing(lt, 0.35, 9, 6, 2.0), `translateY(${lerp(-420, 0, P(lt, 0, TOK.moveSlow, F2))}px)`);
        const R = lerp(0, 1500, P(lt, LIT, 1.4, OUT));
        dark.style.webkitMaskImage = dark.style.maskImage = `radial-gradient(circle at ${LX}px ${LY + 100}px, transparent ${R * 0.45}px, #000 ${R}px)`;
        dark.style.opacity = lerp(1, 0.25, P(lt, LIT + 0.8, 1.2, LIN));
        bgi.style.transform = `scale(${lerp(1.14, 1.04, P(lt, 0, 6, OUT))})`;
        if (tag) pop(tag, lt, LIT + 0.15, { dy: -24, s0: 0.85 });
        T.seek(lt); if (S) S.seek(lt);
      },
      events: [[0.2, 'swish'], [LIT, 'lantern'], ...T.events, ...(S ? S.events : [])],
    };
  });

  // 큰 문장 + 칩 (배경 그림 위). lines: [{t, style, y, x, size, color, at, mark, font}]
  def('hero', (el, o) => {
    const bgi = o.bg ? pic(el, o.bg, 'full') : null;
    if (bgi) mk('div', 'shade', el, null, { background: o.shade || 'linear-gradient(180deg, rgba(11,10,36,.75), rgba(11,10,36,.35) 45%, rgba(11,10,36,.8))' });
    const ts = (o.lines || []).map(l => text(el, l.t, l));
    const cs = (o.chips || []).map(c => mk('div', 'chip', el, c.t, { left: c.x + 'px', top: c.y + 'px', background: c.bg || null }));
    const D = o.dur || 6;
    return {
      seek(lt) {
        if (bgi) bgi.style.transform = `scale(${lerp(1.06, 1.16, lt / D)}) translateX(${lerp(0, -36, lt / D)}px)`;
        textsSeek(ts, lt);
        (o.chips || []).forEach((c, i) => pop(cs[i], lt, c.at, { dy: 50, r0: i % 2 ? 6 : -6 }));
      },
      events: [...textsEv(ts), ...(o.chips || []).map(c => [c.at, 'tick'])],
    };
  });
  Q.title = Q.hero; // 글자만 있는 장면도 같은 부품

  // 장점 카드: 위쪽 줄에 매달린 카드가 차례로 떨어져 정착
  def('tiles', (el, o) => {
    const n = o.tiles.length, cw = 380, gap = n > 3 ? 50 : 90, x0 = (1920 - (cw * n + gap * (n - 1))) / 2, Y = o.y ?? 300;
    const T = o.title ? text(el, o.title, { style: o.titleStyle || 'mask', y: 120, size: 80, at: 0.1 }) : null;
    const svg = mk('div', null, el, `<svg width="1920" height="400" style="position:absolute;left:0;top:0"><path d="M-20 ${Y - 30} Q 960 ${Y + 60} 1940 ${Y - 30}" stroke="#ffc247" stroke-opacity=".7" stroke-width="5" fill="none" stroke-dasharray="2400" /></svg>`);
    const path = svg.querySelector('path');
    const tiles = o.tiles.map(([ic, t, d], i) => { const e = mk('div', 'tile paper', el, `<div class="pin"></div><div class="ic">${ic}</div><div class="tt jua">${t}</div><div class="dd">${d}</div>`, { left: x0 + i * (cw + gap) + 'px', top: Y + 'px' }); return e; });
    const at = o.at ?? 0.35, step = o.step ?? 0.14;
    return {
      seek(lt) {
        if (T) T.seek(lt);
        path.style.strokeDashoffset = lerp(2400, 0, P(lt, 0, TOK.moveSlow, OUT));
        tiles.forEach((t, i) => { const t0 = at + i * step; const p = P(lt, t0, TOK.move, F1); set(t, { o: P(lt, t0, TOK.fade, LIN), y: lerp(-520, 0, p), r: lerp([-8, 6, -5, 7][i % 4], [-1.5, 1, -1, 1.5][i % 4], P(lt, t0, TOK.moveSlow, OUT)) }); });
      },
      events: [...(T ? T.events : []), ...tiles.map((_, i) => [at + i * step + 0.3, i % 2 ? 'pop' : 'pop2'])],
    };
  });

  // 기기 틀 만들기: device = 'laptop' | 'tablet' | 'phone'
  const RATIO = { laptop: 9 / 16, tablet: 768 / 1024, phone: 812 / 375 };
  function device(parent, kind, x, y, w, ratio) {
    const h = Math.round(w * (ratio || RATIO[kind] || RATIO.laptop));
    const pad = { laptop: [18, 18, 34, 18], tablet: [24, 24, 24, 24], phone: [18, 18, 18, 18] }[kind] || [18, 18, 34, 18];
    const d = mk('div', 'dev ' + kind, parent, null, { left: x + 'px', top: y + 'px', width: w + pad[1] + pad[3] + 'px', height: h + pad[0] + pad[2] + 'px' });
    const scr = mk('div', 'scr', d);
    return { d, scr, w, h };
  }
  // 연속 그림 재생기 (flipbook 내부): dir 의 0001.png… 를 lt 에 맞춰 한 장씩
  function flip(scr, W, H, o) {
    const dir = o.dir ? srcOf(o.dir) : srcOf('@seq/' + (o.name || 'demo'));
    const N = o.frames || 1, pad = o.pad ?? 4, ext = o.ext || 'png';
    const frames = Array.from({ length: N }, (_, i) => { const f = pic(scr, (dir.endsWith('/') ? dir : dir + '/') + String((o.first ?? 1) + i).padStart(pad, '0') + '.' + ext, '', { display: 'none' }); f.querySelector('.ph small').textContent = `${o.name || o.dir} ${i + 1}/${N}`; return f; });
    let last = -1;
    return lt => {
      const fps = (o.fps || 12) * (o.speed || 1);
      let k = Math.floor(Math.max(0, lt - (o.at || 0)) * fps) + (o.start || 0);
      if (o.pingpong) { const m = 2 * N - 2 || 1; k = k % m; if (k >= N) k = m - k; } else k = o.loop === false ? Math.min(N - 1, k) : k % N;
      if (k !== last) { frames.forEach((f, i) => { f.style.display = i === k ? 'block' : 'none'; }); last = k; }
      if (o.path) camPath(frames[k], W, H, o.path, lt);
    };
  }
  // 기기 화면 + 카메라 이동 + 말풍선·칩·고리
  // o: { device, img, img2, swap, x, y, w, ratio, path, path2, enter:'rise'|'left'|'right'|'drop', callouts:[{t,x,y,at,out,tx}], chips:[{t,x,y,at,out}], rings:[{x,y,w,h,at,out,br}], seq:{dir|name,frames,fps,...}, label }
  def('device', (el, o) => {
    const kind = o.device || 'laptop';
    const dw = o.w ?? (kind === 'phone' ? 340 : kind === 'tablet' ? 880 : 1160);
    const D = device(el, kind, o.x ?? (960 - dw / 2 - 18), o.y ?? (kind === 'phone' ? 110 : kind === 'tablet' ? 150 : 160), dw, o.ratio);
    const img = o.seq ? null : pic(D.scr, o.img);
    const fl = o.seq ? flip(D.scr, D.w, D.h, o.seq) : null;
    const img2 = o.img2 ? pic(D.scr, o.img2) : null;
    if (o.label) mk('div', 'devlbl jua', D.d, o.label);
    const cos = (o.callouts || []).map(c => mk('div', 'callout jua', el, c.t, { left: c.x + 'px', top: c.y + 'px', '--tx': (c.tx || 60) + 'px' }));
    const cs = (o.chips || []).map(c => mk('div', 'chip', el, c.t, { left: c.x + 'px', top: c.y + 'px', background: c.bg || null }));
    const rings = (o.rings || []).map(r => mk('div', 'ring', el, null, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', borderRadius: (r.br ?? 40) + 'px' }));
    const ent = { rise: { dy: 260, s0: 0.86 }, left: { dx: -900, dy: 0, s0: 0.95, r0: -6 }, right: { dx: 900, dy: 0, s0: 0.95, r0: 6 }, drop: { dy: -700, s0: 1, r0: 4 } }[o.enter || 'rise'];
    return {
      seek(lt) {
        pop(D.d, lt, 0.05, { ...ent, e: F2, d: TOK.moveSlow });
        if (img) camPath(img, D.w, D.h, o.path || [[0, 1, 0.5, 0.5]], lt);
        if (fl) fl(lt);
        if (img2) { img2.style.opacity = P(lt, o.swap, TOK.fade, LIN); camPath(img2, D.w, D.h, o.path2 || o.path || [[0, 1, 0.5, 0.5]], lt); }
        (o.callouts || []).forEach((c, i) => pop(cos[i], lt, c.at, { out: c.out, dy: 46, r0: c.r0 ?? -5 }));
        (o.chips || []).forEach((c, i) => pop(cs[i], lt, c.at, { out: c.out, dy: 46 }));
        (o.rings || []).forEach((r, i) => { pop(rings[i], lt, r.at, { out: r.out, dy: 0, s0: 1.35 }); if (lt > r.at + TOK.move) rings[i].style.transform += ` scale(${1 + Math.sin((lt - r.at) * 6) * 0.025})`; });
      },
      events: [[0.05, 'swish'], ...(o.swap ? [[o.swap, 'flip']] : []), ...(o.callouts || []).map(c => [c.at, 'pop']), ...(o.chips || []).map(c => [c.at, 'tick']), ...(o.rings || []).map(r => [r.at, 'sparkle'])],
    };
  });
  Q.laptop = (el, o) => Q.device(el, { ...o, device: 'laptop' });
  Q.tablet = (el, o) => Q.device(el, { ...o, device: 'tablet' });
  Q.phone = (el, o) => Q.device(el, { ...o, device: 'phone' });

  // 컴퓨터 + 휴대폰 나란히. o: { pc, mob, pathPc, pathMob, callouts, chips }
  def('dual', (el, o) => {
    const L = device(el, 'laptop', 110, 200, 1100), M = device(el, 'phone', 1420, 120, 340);
    const i1 = pic(L.scr, o.pc), i2 = pic(M.scr, o.mob);
    const cos = (o.callouts || []).map(c => mk('div', 'callout jua', el, c.t, { left: c.x + 'px', top: c.y + 'px', '--tx': (c.tx || 60) + 'px' }));
    const cs = (o.chips || []).map(c => mk('div', 'chip', el, c.t, { left: c.x + 'px', top: c.y + 'px' }));
    return {
      seek(lt) {
        pop(L.d, lt, 0.05, { dx: -700, dy: 0, e: F2, d: TOK.moveSlow, s0: 0.95 });
        pop(M.d, lt, 0.17, { dx: 600, dy: 0, e: F2, d: TOK.moveSlow, r0: 8, r: -3, s0: 0.95 });
        camPath(i1, L.w, L.h, o.pathPc || [[0, 1, 0.5, 0.5]], lt); camPath(i2, M.w, M.h, o.pathMob || [[0, 1, 0.5, 0.5]], lt);
        (o.callouts || []).forEach((c, i) => pop(cos[i], lt, c.at, { out: c.out, dy: -40 }));
        (o.chips || []).forEach((c, i) => pop(cs[i], lt, c.at, { out: c.out, dy: 46 }));
      },
      events: [[0.05, 'swish'], ...(o.callouts || []).map(c => [c.at, 'pop']), ...(o.chips || []).map(c => [c.at, 'tick'])],
    };
  });

  // 주소 안내: 기기 + 주소 줄. 줄이 들어오면 앞의 전구(랜턴)가 켜진다
  // o: { img, device, rows:[[누구, 주소, 색]], ring:{x,y,w,h,at}, path, urlSize }
  def('address', (el, o) => {
    const kind = o.device || 'laptop', dw = kind === 'phone' ? 360 : 820;
    const D = device(el, kind, kind === 'phone' ? 220 : 80, kind === 'phone' ? 130 : 250, dw);
    const img = pic(D.scr, o.img);
    const rows = o.rows.map(([who, url, c], i) => { const r = mk('div', 'addr paper', el, `<span class="bulb"></span><span class="who jua" style="background:${c || 'var(--lantern)'}">${who}</span><span class="url" style="font-size:${o.urlSize || 50}px">${url}</span>`, { left: (kind === 'phone' ? 760 : 980) + 'px', top: (o.rowY ?? 350) + i * 170 + 'px' }); return { r, bulb: r.querySelector('.bulb') }; });
    const ring = o.ring ? mk('div', 'ring', el, null, { left: o.ring.x + 'px', top: o.ring.y + 'px', width: o.ring.w + 'px', height: o.ring.h + 'px' }) : null;
    const at = o.at ?? 0.6, step = o.step ?? 0.45;
    return {
      seek(lt) {
        pop(D.d, lt, 0.05, { dx: -500, dy: 0, e: F2, d: TOK.moveSlow, s0: 0.95 });
        camPath(img, D.w, D.h, o.path || [[0, 1, 0.5, 0.5]], lt);
        rows.forEach(({ r, bulb }, i) => { const t0 = at + i * step; pop(r, lt, t0, { dx: 200, dy: 0, s0: 0.9 }); const lit = P(lt, t0 + 0.3, TOK.fade, LIN); bulb.style.background = lit > 0.5 ? 'var(--lantern)' : '#4a3c78'; bulb.style.boxShadow = `0 0 ${24 * lit}px var(--lantern)`; });
        if (ring) pop(ring, lt, o.ring.at, { dy: 0, s0: 1.35 });
      },
      events: [[0.05, 'swish'], ...o.rows.map((_, i) => [at + i * step + 0.3, 'lantern']), ...(o.ring ? [[o.ring.at, 'sparkle']] : [])],
    };
  });

  // 맵 카드 펼치기: 더미에서 부채꼴로 펼쳐진 뒤 한 장씩 앞으로 나온다
  // o: { maps:[[그림, 이름]], at, focusAt, focusStep, title }
  def('maps', (el, o) => {
    const M = o.maps, n = M.length, cw = 420, gap = n > 4 ? 10 : 34, x0 = (1920 - (cw * n + gap * (n - 1))) / 2;
    const T = o.title ? text(el, o.title, { style: 'marker', y: 110, size: 78, at: 0.05, mark: o.titleMark }) : null;
    const cards = M.map(([src, name], i) => { const c = mk('div', 'mapc', el, null, { left: x0 + i * (cw + gap) + 'px', top: '400px' }); pic(c, src); mk('div', 'lbl', c, name); const dim = mk('div', 'dim', c); return { c, dim }; });
    const at = o.at ?? 0.3, fAt = o.focusAt ?? 1.6, fs = o.focusStep ?? 0.75;
    const mid = (n - 1) / 2;
    return {
      seek(lt) {
        if (T) T.seek(lt);
        const k = lt >= fAt ? Math.min(n - 1, Math.floor((lt - fAt) / fs)) : -1;
        cards.forEach(({ c, dim }, i) => {
          const t0 = at + i * TOK.stag, p = P(lt, t0, TOK.move, F2);
          const fx0 = (mid - i) * (cw + gap), rot = (i - mid) * 5, arcY = Math.abs(i - mid) * 26;
          const tf = fAt + i * fs, on = k === i ? P(lt, tf, TOK.moveFast, F1) : (k > i || k === -1 ? 0 : 0);
          const off = k === i ? 0 : (lt > tf + fs ? 1 - P(lt, tf + fs, TOK.moveFast, OUT) : 0);
          const lift = k === i ? on : 0;
          set(c, { o: P(lt, t0, TOK.fade, LIN), x: lerp(fx0, 0, p), y: lerp(500, arcY, p) - 70 * lift, s: lerp(0.7, 1, p) * (1 + 0.2 * lift), r: lerp(0, rot, p) * (1 - lift) });
          c.style.zIndex = k === i ? 5 : 1;
          dim.style.opacity = k >= 0 && k !== i ? 0.5 * P(lt, fAt, TOK.fade, LIN) : 0;
          void off;
        });
      },
      events: [...(T ? T.events : []), [at, 'deal'], ...M.map((_, i) => [fAt + i * fs, i === 0 ? 'swish' : 'tick'])],
    };
  });

  // 엔드카드: 1.3초 안에 다 정착하고 그 뒤로는 멈춘 화면 (scene 에 still:true 를 주면 배경도 멈춘다)
  // o: { title, sub, urls:[[누구, 주소, 색]], cta, dur, fadeOut }
  def('end', (el, o) => {
    const N = 5, lans = Array.from({ length: N }, (_, i) => lantern(el, 360 + i * 300, 40 + (i % 2) * 40, 0.55, { rope: true, glow: 0.8 }));
    const T = text(el, o.title || [['한밤의', { s: 110 }], ['랜턴', { s: 180, c: 'var(--lantern)' }], ['대작전', { s: 150 }]], { style: 'pop', at: 0.2, y: o.urls && o.urls.length > 1 ? 250 : 300, size: 150 });
    const S = o.sub ? text(el, o.sub, { style: 'mask', at: 0.5, y: o.urls && o.urls.length > 1 ? 470 : 520, size: 50, font: 'body', weight: 800, color: '#e8e0ff' }) : null;
    const rows = (o.urls || []).map(([who, url, c], i) => { const line = mk('div', null, el, null, { position: 'absolute', left: 0, right: 0, top: (o.urls.length > 1 ? 580 : 640) + i * 140 + 'px', display: 'flex', justifyContent: 'center' }); mk('div', 'addr paper', line, `<span class="who jua" style="background:${c || 'var(--lantern)'}">${who}</span><span class="url" style="font-size:${url.length > 24 ? 44 : 56}px">${url}</span>`, { position: 'relative' }); return line; });
    const cta = o.cta ? mk('div', 'jua', el, o.cta, { position: 'absolute', left: 0, right: 0, top: (o.urls && o.urls.length > 1 ? 880 : 820) + 'px', textAlign: 'center', fontSize: '64px', color: 'var(--mint)' }) : null;
    const D = o.dur || 4;
    return {
      seek(lt) {
        lans.forEach((L, i) => L.set(P(lt, 0.15 + i * 0.09, TOK.fade, LIN), 0, `translateY(${lerp(-300, 0, P(lt, i * 0.06, TOK.move, F2))}px)`));
        T.seek(lt); if (S) S.seek(lt);
        rows.forEach((r, i) => pop(r, lt, 0.6 + i * 0.12, { dy: 50, s0: 0.85 }));
        if (cta) pop(cta, lt, 0.9, { dy: 30, s0: 0.8 });
        el.style.opacity = o.fadeOut === false ? 1 : 1 - P(lt, D - 0.3, 0.3, LIN);
      },
      events: [[0.15, 'lantern'], ...T.events, ...(rows.length ? [[0.6, 'pop']] : []), ...(cta ? [[0.9, 'chime']] : [])],
    };
  });

  // ================= 6. 새 부품 =================
  // 1) 랜턴 빛 원 등장: 어둠 속에서 랜턴이 켜지며 빛 원이 번져 그림·글자가 드러남
  // o: { img, lx, ly, at(점등), r(빛 원 반지름), openAt(전체 공개 시각, 없으면 원만), title, sub, ty, from:'left'|'right'|'top' }
  def('lanternReveal', (el, o) => {
    const img = pic(el, o.img, 'full');
    const dark = mk('div', 'shade', el, null, { background: '#050414' });
    const LX = o.lx ?? 960, LY = o.ly ?? 300, AT = o.at ?? 0.6, R = o.r ?? 520;
    const L = lantern(el, LX, LY - 95, 1, { glow: 1.2 });
    seed = 21; const motes = Array.from({ length: 10 }, () => ({ e: mk('div', 'mote', el), a: rnd() * 6.28, rr: 80 + rnd() * (R * 0.8), w: 0.3 + rnd() * 0.6 }));
    const T = o.title ? text(el, o.title, { style: 'glow', at: AT + 0.3, y: o.ty ?? (LY + 140), size: o.size || 110 }) : null;
    const S = o.sub ? text(el, o.sub, { style: 'mask', at: AT + 0.9, y: (o.ty ?? (LY + 140)) + (o.size || 110) + 30, size: 46, font: 'body', weight: 800 }) : null;
    const from = { left: [-700, 0], right: [700, 0], top: [0, -500] }[o.from || 'left'];
    return {
      seek(lt) {
        const p = P(lt, 0, TOK.moveSlow, F2), lit = P(lt, AT, TOK.fadeSlow, LIN);
        L.set(lit, swing(lt, TOK.moveSlow * 0.8, 10, 7, 2.4) + lerp(from[0] ? 16 * Math.sign(from[0]) : 0, 0, p), `translate(${lerp(from[0], 0, p)}px, ${lerp(from[1], 0, p)}px)`);
        let r = lerp(0, R, P(lt, AT, TOK.moveSlow, OUT));
        if (o.openAt != null) r = lerp(r, 2400, P(lt, o.openAt, TOK.moveSlow, INQ));
        dark.style.webkitMaskImage = dark.style.maskImage = `radial-gradient(circle at ${LX}px ${LY}px, transparent ${r * 0.62}px, #000 ${r}px)`;
        dark.style.opacity = 0.97;
        img.style.transform = `scale(${lerp(1.12, 1.03, P(lt, AT, 3, OUT))})`;
        motes.forEach((m, i) => { const a = m.a + lt * m.w, rr = Math.min(m.rr, r * 0.85); m.e.style.opacity = lit * (0.5 + 0.5 * Math.sin(lt * 3 + i)); m.e.style.transform = `translate(${LX + Math.cos(a) * rr}px, ${LY + Math.sin(a) * rr * 0.7 - (lt * 20 % 40)}px)`; });
        if (T) T.seek(lt); if (S) S.seek(lt);
      },
      events: [[0.05, 'swish'], [AT, 'lantern'], ...(T ? T.events : []), ...(S ? S.events : []), ...(o.openAt != null ? [[o.openAt, 'rise']] : [])],
    };
  });

  // 2) 좁아지는 잠 안개: 가장자리 안개가 좁혀 오고 가운데 빛 구역만 남는다
  // o: { img, cx, cy, stages:[{at, r, label}], warn(다음 구역 미리보기 초, 기본 0.6), title }
  def('fogShrink', (el, o) => {
    const img = pic(el, o.img, 'full');
    const CX = o.cx ?? 960, CY = o.cy ?? 520, ST = o.stages || [{ at: 0, r: 900, label: '1단계' }, { at: 1.6, r: 560, label: '2단계' }, { at: 3.2, r: 300, label: '3단계' }];
    const WARN = o.warn ?? 0.6;
    const zone = mk('div', 'zone', el, null, { left: CX - 500 + 'px', top: CY - 500 + 'px', width: '1000px', height: '1000px' });
    const fog = mk('div', 'fogl', el);
    const puffs = Array.from({ length: 14 }, (_, i) => mk('div', 'puff', el));
    const L = lantern(el, CX, CY - 80, 0.7, { glow: 0.9 });
    const box = mk('div', 'stagebox paper jua', el, `<span>안개</span><span class="num">${ST.map(s => `<span>${s.label}</span>`).join('')}</span>`);
    const strip = box.querySelector('.num');
    const T = o.title ? text(el, o.title, { style: 'marker', x: 80, y: 70, size: 66, at: 0.15, markColor: 'var(--lantern)', mark: o.titleMark }) : null;
    const rad = lt => { let r = ST[0].r; for (let i = 1; i < ST.length; i++) r = lerp(r, ST[i].r, P(lt, ST[i].at, TOK.moveSlow, IO)); return r; };
    return {
      seek(lt) {
        img.style.transform = `scale(${lerp(1.05, 1.12, clamp(lt / 6))})`;
        const r = rad(lt) * lerp(1.25, 1, P(lt, 0, TOK.moveSlow, OUT));
        fog.style.webkitMaskImage = fog.style.maskImage = `radial-gradient(circle at ${CX}px ${CY}px, transparent ${r - 60}px, #000 ${r + 90}px)`;
        fog.style.opacity = P(lt, 0, TOK.fadeSlow, LIN);
        puffs.forEach((p, i) => { const a = i / puffs.length * 6.283 + lt * 0.25 * (i % 2 ? 1 : -1), rr = r + 40 + Math.sin(lt * 1.3 + i) * 30; p.style.transform = `translate(${CX + Math.cos(a) * rr}px, ${CY + Math.sin(a) * rr}px) scale(${1 + 0.15 * Math.sin(lt * 1.7 + i * 2)})`; p.style.opacity = P(lt, 0, TOK.fadeSlow, LIN); });
        // 다음 구역 미리보기(노란 점선)
        let nz = -1; for (let i = 1; i < ST.length; i++) if (lt >= ST[i].at - WARN && lt < ST[i].at + TOK.moveSlow) nz = i;
        if (nz > 0) { const s = ST[nz]; zone.style.opacity = Math.min(P(lt, s.at - WARN, TOK.fade, LIN), 1 - P(lt, s.at + TOK.moveSlow - TOK.fade, TOK.fade, LIN)); zone.style.transform = `scale(${s.r / 500 * (1 + 0.03 * Math.sin(lt * 14))})`; } else zone.style.opacity = 0;
        L.set(1, Math.sin(lt * 2) * 3);
        let k = 0; for (let i = 0; i < ST.length; i++) if (lt >= ST[i].at) k = i;
        const slide = k > 0 ? lerp(k - 1, k, P(lt, ST[k].at, TOK.moveFast, F2)) : 0;
        strip.firstElementChild.style.marginTop = (-slide * 1.15) + 'em';
        pop(box, lt, 0.1, { dx: 80, dy: 0, s0: 0.8 });
        if (T) T.seek(lt);
      },
      events: [[0, 'fog'], ...ST.slice(1).flatMap(s => [[s.at - WARN, 'tick'], [s.at, 'fog']]), ...(T ? T.events : [])],
    };
  });

  // 3) 두 모드 나란히 비교 (가운데 VS) + 한쪽 확대
  // o: { left:{icon,title,line,items[],color}, right:{...}, at, itemsAt, itemStep, vsAt, focus:[{at, side:'left'|'right'|null}] }
  def('modeSplit', (el, o) => {
    const SD = { left: o.left || {}, right: o.right || {} };
    const cols = { left: SD.left.color || 'var(--lantern)', right: SD.right.color || 'var(--mint)' };
    const panels = ['left', 'right'].map(side => {
      const s = SD[side];
      const pn = mk('div', 'panel', el, null, { background: side === 'left' ? 'linear-gradient(160deg, #3a1f6b, #17143f 70%)' : 'linear-gradient(200deg, #12345a, #17143f 70%)' });
      const cnt = mk('div', 'cnt', pn, null, { left: side === 'left' ? '0' : '960px' });
      const ic = mk('div', 'ic', cnt, s.icon || (side === 'left' ? '👻' : '🕵️'));
      const tt = mk('div', 'tt jua', cnt, s.title || '', { color: cols[side] });
      const ln = mk('div', 'ln', cnt, s.line || '');
      const its = (s.items || []).map(t => mk('div', 'it', cnt, `<b style="color:${cols[side]}">✦</b>${t}`));
      return { side, pn, cnt, ic, tt, ln, its };
    });
    const seam = mk('div', 'seam', el), vs = mk('div', 'vs', el, 'VS');
    const AT = o.at ?? 0.05, IA = o.itemsAt ?? 1.0, IS = o.itemStep ?? 0.32, VA = o.vsAt ?? 0.6;
    const order = []; const nmax = Math.max(panels[0].its.length, panels[1].its.length);
    for (let i = 0; i < nmax; i++) for (const p of panels) if (p.its[i]) order.push([p, i]);
    const F = o.focus || [];
    const seamX = lt => { let x = 960; for (const f of F) x = lerp(x, f.side === 'left' ? 1360 : f.side === 'right' ? 560 : 960, P(lt, f.at, TOK.moveSlow, IO)); return x; };
    const SK = 70; // 대각선 기울기
    return {
      seek(lt) {
        const X = seamX(lt), pl = P(lt, AT, TOK.moveSlow, F2), pr = P(lt, AT + TOK.stag, TOK.moveSlow, F2);
        panels[0].pn.style.clipPath = `polygon(0 0, ${X + SK}px 0, ${X - SK}px 100%, 0 100%)`;
        panels[1].pn.style.clipPath = `polygon(${X + SK}px 0, 100% 0, 100% 100%, ${X - SK}px 100%)`;
        panels[0].pn.style.transform = `translateX(${lerp(-1100, 0, pl)}px)`; panels[1].pn.style.transform = `translateX(${lerp(1100, 0, pr)}px)`;
        const shift = (X - 960) / 2, lf = clamp((X - 960) / 400), rf = clamp((960 - X) / 400);
        panels[0].cnt.style.transform = `translateX(${shift}px) scale(${1 + 0.08 * lf - 0.1 * rf})`; panels[0].cnt.style.opacity = 1 - 0.6 * rf;
        panels[1].cnt.style.transform = `translateX(${shift}px) scale(${1 + 0.08 * rf - 0.1 * lf})`; panels[1].cnt.style.opacity = 1 - 0.6 * lf;
        panels.forEach((p, j) => { const t0 = AT + 0.25 + j * TOK.stag; pop(p.ic, lt, t0, { dy: 60, s0: 0.3 }); pop(p.tt, lt, t0 + TOK.stag, { dx: j ? 120 : -120, dy: 0, s0: 1.2 }); pop(p.ln, lt, t0 + TOK.stagSlow * 2, { dy: 24, s0: 1 }); });
        order.forEach(([p, i], k) => pop(p.its[i], lt, IA + k * IS, { dx: p.side === 'left' ? -160 : 160, dy: 0, s0: 0.9 }));
        seam.style.transform = `translateX(${X}px) skewX(${-Math.atan2(2 * SK, 1080) * 57.3}deg) scaleY(${P(lt, AT + 0.2, TOK.move, OUT)})`;
        seam.style.left = '0';
        pop(vs, lt, VA, { dy: 0, s0: 0.2, r0: -30 }); vs.style.left = X + 'px';
      },
      events: [[AT, 'swish'], [VA, 'thud'], ...order.map((_, k) => [IA + k * IS, k % 2 ? 'tick' : 'pop']), ...F.map(f => [f.at, 'swish'])],
    };
  });

  // 4) "○○의 재미 → 우리 게임의 무엇" 비교 카드 (글자만)
  // o: { title, pairs:[[재미, 우리 게임, 위 작은 글(선택), 오른쪽 작은 글(선택)]], at, step, fromLabel, toLabel }
  def('likeCard', (el, o) => {
    const PR = o.pairs || [], n = PR.length;
    const T = o.title ? text(el, o.title, { style: 'marker', y: 80, size: 72, at: 0.05, mark: o.titleMark }) : null;
    const rowH = n === 1 ? 0 : n === 2 ? 250 : 210, y0 = n === 1 ? 400 : n === 2 ? 320 : 250;
    const rows = PR.map(([a, b, sa, sb], i) => {
      const y = y0 + i * rowH;
      const L = mk('div', 'like from', el, `<small>${sa || o.fromLabel || '이런 재미'}</small><div class="t jua">${a}</div>`, { left: '150px', top: y + 'px', width: '660px' });
      const svg = mk('div', null, el, `<svg width="260" height="120" style="position:absolute;left:830px;top:${y + 26}px;overflow:visible"><path d="M10 60 C 80 10, 170 110, 230 60" stroke="#ffc247" stroke-width="12" stroke-linecap="round" fill="none" stroke-dasharray="300"/><path d="M200 34 L 244 60 L 200 88" stroke="#ffc247" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`);
      const [ar, head] = svg.querySelectorAll('path');
      const R = mk('div', 'like to', el, `<small>${sb || o.toLabel || '한밤의 랜턴 대작전'}</small><div class="t jua">${b}</div>`, { left: '1110px', top: y + 'px', width: '660px' });
      return { L, ar, head, R };
    });
    const at = o.at ?? 0.4, step = o.step ?? 1.1;
    return {
      seek(lt) {
        if (T) T.seek(lt);
        rows.forEach(({ L, ar, head, R }, i) => {
          const t0 = at + i * step;
          pop(L, lt, t0, { dx: -140, dy: 0, s0: 0.92 });
          ar.style.strokeDashoffset = lerp(300, 0, P(lt, t0 + 0.3, TOK.moveFast, OUT)); head.style.opacity = P(lt, t0 + 0.6, TOK.fadeFast, LIN);
          pop(R, lt, t0 + 0.65, { dy: 0, s0: 0.5, r0: 4 });
          R.style.filter = `brightness(${lerp(1.6, 1, P(lt, t0 + 0.65, TOK.fadeSlow, LIN))})`;
        });
      },
      events: [...(T ? T.events : []), ...rows.flatMap((_, i) => [[at + i * step, 'tick'], [at + i * step + 0.3, 'swish'], [at + i * step + 0.65, 'lantern']])],
    };
  });

  // 5) 연속 그림 재생기: shots/seq/<name>/0001.png… 를 seek(t)에 맞춰 넘긴다
  // o: { name 또는 dir, frames(장 수, 필수), fps(기본 12), speed, loop(기본 true), pingpong, start, ext('png'), pad(4), at,
  //      device: null(전체 화면) | 'laptop' | 'tablet' | 'phone', x, y, w, path(카메라), label, callouts, chips, rings }
  def('flipbook', (el, o) => {
    const seq = { name: o.name, dir: o.dir, frames: o.frames, fps: o.fps, speed: o.speed, loop: o.loop, pingpong: o.pingpong, start: o.start, ext: o.ext, pad: o.pad, at: o.at, first: o.first };
    if (o.device) return Q.device(el, { ...o, badge: null, caps: null, seq: { ...seq, path: o.path } });
    const box = mk('div', 'layer', el, null, { overflow: 'hidden' });
    const f = flip(box, 1920, 1080, { ...seq, path: o.path });
    const lbl = o.label ? mk('div', 'chip', el, o.label, { left: '70px', bottom: '60px', top: 'auto' }) : null;
    return {
      seek(lt) { f(lt); box.style.opacity = P(lt, 0, TOK.fade, LIN); if (lbl) pop(lbl, lt, 0.3, { dx: -60, dy: 0 }); },
      events: lbl ? [[0.3, 'tick']] : [],
    };
  });

  // 6) 퀴즈 창 → 보기 4개 → 정답 선택 → "정답!" 도장 + 랜턴 점등 + 새벽빛 게이지
  // o: { bg(게임 화면, 선택), q, choices:[4], answer(0~3), at, pickAt, x, y, scale, gauge:{from,to,label}|false, stamp:'정답!' }
  def('quizPop', (el, o) => {
    const bg = o.bg ? pic(el, o.bg, 'full') : null;
    if (bg) mk('div', 'shade', el, null, { background: 'rgba(11,10,36,.55)' });
    const QX = o.x ?? 400, QY = o.y ?? 130, SC = o.scale ?? 1;
    const wrap = mk('div', null, el, null, { position: 'absolute', left: QX + 'px', top: QY + 'px', transformOrigin: '0 0', transform: `scale(${SC})` });
    const box = mk('div', 'quiz paper', wrap);
    mk('div', 'qh', box, o.head || '❓ 퀴즈');
    mk('div', 'qq', box, o.q || '달이 지구 둘레를 한 바퀴 도는 데 약 며칠?');
    const grid = mk('div', 'grid', box);
    const NC = ['#9b6bf2', '#5cc8f2', '#ff9ec4', '#ffb547'];
    const chs = (o.choices || ['약 7일', '약 15일', '약 30일', '약 365일']).map((c, i) => { const e = mk('div', 'ch', grid, `<span class="ok"></span><span class="n" style="background:${NC[i]}">${i + 1}</span><span>${c}</span>`); return { e, ok: e.querySelector('.ok') }; });
    const hand = mk('div', null, wrap, '👆', { position: 'absolute', left: 0, top: 0, fontSize: '96px', filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.4))' });
    const ANS0 = o.answer ?? 2;
    // 도장: 정답 칸 오른쪽 끝에 겹쳐 찍힌다
    const stamp = mk('div', 'stamp', wrap, o.stamp || '정답!', { left: (ANS0 % 2) * 512 + 330 + 'px', top: Math.floor(ANS0 / 2) * 130 + 300 + 'px', fontSize: '96px', zIndex: 3 });
    const L = lantern(el, o.lx ?? 1700, o.ly ?? 230, 0.8, { glow: 1 });
    const G = o.gauge === false ? null : (() => {
      const g = o.gauge || {};
      const lb = mk('div', 'jua', el, `${g.icon || '🌅'} ${g.label || '새벽빛'}`, { position: 'absolute', left: '420px', top: '858px', fontSize: '44px' });
      const bar = mk('div', 'gbar', el, null, { left: '660px', top: '856px', width: '900px' });
      const fill = mk('div', 'fill', bar);[25, 50, 75].forEach(v => mk('div', 'tickm', bar, null, { left: v + '%' }));
      const num = mk('div', 'jua', el, '', { position: 'absolute', left: '1590px', top: '846px', fontSize: '60px', color: 'var(--lantern)' });
      return { g, lb, bar, fill, num };
    })();
    const AT = o.at ?? 0.2, PK = o.pickAt ?? 2.0, ANS = o.answer ?? 2;
    return {
      seek(lt) {
        if (bg) bg.style.transform = `scale(${lerp(1.04, 1.1, clamp(lt / 6))})`;
        pop(box, lt, AT, { dy: 140, s0: 0.35 });
        chs.forEach(({ e, ok }, i) => {
          pop(e, lt, AT + 0.4 + i * TOK.stag, { dy: 30, s0: 0.7 });
          const on = i === ANS ? P(lt, PK, TOK.fade, LIN) : 0;
          ok.style.opacity = on; if (i !== ANS) e.style.opacity = +e.style.opacity * (1 - 0.55 * P(lt, PK, TOK.fade, LIN));
          if (i === ANS && lt > PK) e.style.transform += ` scale(${lerp(0.92, 1, P(lt, PK, TOK.moveFast, F1))})`;
        });
        // 손가락: 오른쪽 아래에서 정답 칸으로
        const tx = (ANS % 2) * 512 + 360, ty = Math.floor(ANS / 2) * 124 + 300;
        const hp = P(lt, PK - 0.6, TOK.move, IO);
        hand.style.opacity = P(lt, PK - 0.6, TOK.fade, LIN) * (1 - P(lt, PK + 0.5, TOK.fade, LIN));
        hand.style.transform = `translate(${lerp(1150, tx, hp)}px, ${lerp(640, ty, hp)}px) scale(${lt > PK && lt < PK + 0.12 ? 0.86 : 1})`;
        pop(stamp, lt, PK + 0.25, { s0: 2.4, dy: 0, r0: -22, r: -8, d: TOK.moveFast });
        L.set(P(lt, PK + 0.5, TOK.fadeSlow, LIN), Math.sin(lt * 2) * 3, `translateY(${lerp(-400, 0, P(lt, AT, TOK.moveSlow, F2))}px)`);
        if (G) {
          const gp = P(lt, PK + 0.7, 0.9, OUT), v = lerp(G.g.from ?? 40, G.g.to ?? 65, gp);
          [G.lb, G.bar, G.num].forEach((e, i) => pop(e, lt, AT + 0.5 + i * TOK.stagFast, { dy: 40, s0: 0.9 }));
          G.fill.style.transform = `scaleX(${v / 100})`; G.num.textContent = Math.round(v) + '%';
        }
      },
      events: [[AT, 'pop'], ...chs.map((_, i) => [AT + 0.4 + i * TOK.stag, 'tick']), [PK, 'click'], [PK + 0.25, 'correct'], [PK + 0.5, 'lantern'], ...(G ? [[PK + 0.7, 'rise']] : [])],
    };
  });

  // 7) 새벽빛 게이지(0→100%) / 달 시계 카운트다운
  // o: { type:'dawn'|'moon'|'both', from, to, at, dur, label, clock:{from(초), to(초), at, dur, label}, title }
  def('gauge', (el, o) => {
    const type = o.type || 'both';
    const T = o.title ? text(el, o.title, { style: 'mask', y: 90, size: 74, at: 0.05 }) : null;
    const warm = mk('div', 'shade', el, null, { background: 'radial-gradient(ellipse 1400px 700px at 50% 115%, rgba(255,170,90,.95), rgba(255,120,150,.45) 45%, rgba(255,120,150,0) 75%)' });
    let D = null, C = null;
    const dawnX = type === 'both' ? 820 : 360, dawnW = type === 'both' ? 960 : 1200;
    if (type !== 'moon') {
      const num = mk('div', 'jua', el, '', { position: 'absolute', left: dawnX + 'px', width: dawnW + 'px', top: '300px', textAlign: 'center', fontSize: '230px', lineHeight: '1', color: 'var(--lantern)', textShadow: '0 0 50px rgba(255,194,71,.6), 0 10px 0 rgba(11,10,36,.5)' });
      const lb = mk('div', 'jua', el, `🌅 ${o.label || '새벽빛'}`, { position: 'absolute', left: dawnX + 'px', width: dawnW + 'px', top: '220px', textAlign: 'center', fontSize: '56px' });
      const bar = mk('div', 'gbar', el, null, { left: dawnX + 'px', top: '600px', width: dawnW + 'px', height: '76px' });
      const fill = mk('div', 'fill', bar);[25, 50, 75].forEach(v => mk('div', 'tickm', bar, null, { left: v + '%' }));
      const rider = lantern(el, dawnX, 520, 0.5, { glow: 0.7 });
      D = { num, lb, bar, fill, rider };
    }
    if (type !== 'dawn') {
      const cx = type === 'both' ? 140 : 740;
      const c = mk('div', 'clock', el, null, { left: cx + 'px', top: '230px' });
      const ring = mk('div', 'layer', c, null, { borderRadius: '50%' });
      const face = mk('div', 'face', c, `<div class="tm"></div><div class="lb">${(o.clock && o.clock.label) || '남은 밤 시간'}</div>`);
      const orb = mk('div', 'orb', c, '🌙');
      C = { c, ring, tm: face.querySelector('.tm'), orb };
    }
    const at = o.at ?? 0.4, dur = o.dur ?? 1.6, ck = o.clock || {};
    const ca = ck.at ?? 0.4, cd = ck.dur ?? 2.2, c0 = ck.from ?? 300, c1 = ck.to ?? 0;
    return {
      seek(lt) {
        if (T) T.seek(lt);
        if (D) {
          const v = lerp(o.from ?? 0, o.to ?? 100, P(lt, at, dur, IO));
          D.num.textContent = Math.round(v) + '%';
          D.fill.style.transform = `scaleX(${v / 100})`;
          D.rider.set(v / 100, Math.sin(lt * 3) * 4, `translateX(${dawnW * v / 100}px)`);
          warm.style.opacity = 0.15 + 0.85 * v / 100;
          [D.lb, D.num, D.bar].forEach((e, i) => pop(e, lt, 0.1 + i * TOK.stag, { dy: 50, s0: i === 1 ? 1.5 : 0.85 }));
          if (lt > at + dur) D.num.style.transform += ` scale(${lerp(1.12, 1, P(lt, at + dur, TOK.moveFast, F1))})`;
        } else warm.style.opacity = 0.2;
        if (C) {
          const p = P(lt, ca, cd, LIN), s = Math.max(0, Math.round(lerp(c0, c1, p)));
          C.tm.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          const frac = c0 ? s / c0 : 0, low = frac <= 0.2;
          C.ring.style.background = `conic-gradient(${low ? 'var(--warn)' : 'var(--lantern)'} ${frac * 360}deg, rgba(255,255,255,.12) 0)`;
          C.tm.style.color = low ? 'var(--warn)' : '#fff';
          const a = (frac * 360 - 90) * Math.PI / 180; C.orb.style.transform = `translate(${Math.cos(a) * 203}px, ${Math.sin(a) * 203}px)`;
          pop(C.c, lt, 0.05, { dy: 0, s0: 0.4 });
        }
      },
      events: [...(T ? T.events : []), ...(D ? [[at, 'rise'], [at + dur, 'lantern']] : []), ...(C ? [[0.05, 'pop'], [ca + cd, 'bell']] : [])],
    };
  });

  // 8) ①②③ 단계 카드가 길을 따라 이어진다 (길 위로 작은 랜턴이 이동)
  // o: { title, steps:[[아이콘, 제목, 설명]], at, segDur(한 구간 그리는 시간) }
  def('steps', (el, o) => {
    const S = o.steps || [], n = S.length;
    const T = o.title ? text(el, o.title, { style: o.titleStyle || 'mask', y: 70, size: 76, at: 0.05 }) : null;
    const xs = S.map((_, i) => n === 1 ? 960 : 300 + i * (1320 / (n - 1))), ys = S.map((_, i) => i % 2 ? 330 : 400);
    let d = `M ${xs[0] - 260} ${ys[0] + 60} Q ${xs[0] - 130} ${ys[0] + 60} ${xs[0]} ${ys[0]}`;
    for (let i = 1; i < n; i++) { const mx = (xs[i - 1] + xs[i]) / 2; d += ` C ${mx} ${ys[i - 1] - 160}, ${mx} ${ys[i] + 160}, ${xs[i]} ${ys[i]}`; }
    const mid_ = 'stepmask' + (++UID);
    const svgW = mk('div', 'layer', el, `<svg width="1920" height="1080"><defs><mask id="${mid_}" maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080"><path class="mk" d="${d}" stroke="#fff" stroke-width="60" fill="none" stroke-linecap="round"/></mask></defs><g mask="url(#${mid_})"><path d="${d}" stroke="rgba(255,194,71,.28)" stroke-width="40" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#ffc247" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="14 22"/></g></svg>`);
    const meas = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); meas.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:10px;height:10px'); document.body.appendChild(meas);
    const mp = document.createElementNS('http://www.w3.org/2000/svg', 'path'); mp.setAttribute('d', d); meas.appendChild(mp);
    const total = mp.getTotalLength();
    const nodeLen = xs.map((x, i) => { let best = 0, bd = 1e9; for (let s = 0; s <= 400; s++) { const L = total * s / 400, q = mp.getPointAtLength(L), dd = (q.x - x) ** 2 + (q.y - ys[i]) ** 2; if (dd < bd) { bd = dd; best = L; } } return best; });
    const pts = Array.from({ length: 201 }, (_, s) => { const q = mp.getPointAtLength(total * s / 200); return [q.x, q.y]; });
    const ptAt = L => { const f = clamp(L / total) * 200, i = Math.floor(f), j = Math.min(200, i + 1), u = f - i; return [lerp(pts[i][0], pts[j][0], u), lerp(pts[i][1], pts[j][1], u)]; };
    const mkEl = svgW.querySelector('.mk'); mkEl.setAttribute('stroke-dasharray', `${total + 10} ${total + 10}`);
    const lan = lantern(el, 0, -95, 0.55, { glow: 0.8 });
    const nums = '①②③④⑤';
    const cards = S.map(([ic, t, dd], i) => mk('div', 'stepc', el, `<div class="no">${i + 1}</div><div class="card paper"><div class="ic">${ic}</div><div class="tt jua">${t}</div><div class="dd">${dd}</div></div>`, { left: xs[i] - 200 + 'px', top: ys[i] - 60 + 'px' }));
    void nums;
    const at = o.at ?? 0.4, seg = o.segDur ?? 0.7;
    const nodeT = nodeLen.map((_, i) => at + seg * (i + 0.5));
    const lenAt = lt => { if (lt <= at) return 0; for (let i = 0; i < n; i++) { const t0 = i === 0 ? at : nodeT[i - 1], t1 = nodeT[i], L0 = i === 0 ? 0 : nodeLen[i - 1]; if (lt < t1) return lerp(L0, nodeLen[i], IO(clamp((lt - t0) / (t1 - t0)))); } return nodeLen[n - 1]; };
    return {
      seek(lt) {
        if (T) T.seek(lt);
        const L = lenAt(lt); const [x, y] = ptAt(L);
        mkEl.setAttribute('stroke-dashoffset', total + 10 - L); // 지나간 길만 보이게
        lan.set(1, Math.sin(lt * 5) * 6, `translate(${x}px, ${y - 30}px)`);
        lan.el.style.opacity = P(lt, at - 0.1, TOK.fade, LIN) * (1 - P(lt, nodeT[n - 1] + 0.1, TOK.fade, LIN));
        cards.forEach((c, i) => { const t0 = nodeT[i]; const no = c.firstElementChild, cd = c.lastElementChild; pop(no, lt, t0, { dy: 0, s0: 0.2 }); pop(cd, lt, t0 + TOK.stag, { dy: 80, s0: 0.85 }); });
      },
      events: [...(T ? T.events : []), ...nodeT.map((t, i) => [t, i === n - 1 ? 'lantern' : 'pop'])],
    };
  });

  // 9) 역할 카드: 부채꼴로 펼쳐지고 한 장이 들려 뒤집히며 정체 공개
  // o: { cards:[[아이콘, 이름, 설명]], reveal:{index, icon, name, desc, at, label}, title, at }
  def('roleCards', (el, o) => {
    const C = o.cards || [], n = C.length, RV = o.reveal || {};
    const T = o.title ? text(el, o.title, { style: 'pop', y: 70, size: 74, at: 0.05 }) : null;
    const cards = C.map(([ic, nm, ds], i) => {
      const c = mk('div', 'rcard', el, null, { left: '960px', top: '330px' });
      const f = mk('div', 'face front paper', c, `<div class="ic">${ic}</div><div class="nm">${nm}</div>${ds ? `<div class="ds">${ds}</div>` : ''}`);
      const b = i === RV.index ? mk('div', 'face back', c, `<div class="ic">${RV.icon || '🦹'}</div><div class="nm" style="color:var(--mint)">${RV.name || '꿈도둑'}</div>${RV.desc ? `<div class="ds">${RV.desc}</div>` : ''}`) : null;
      return { c, f, b };
    });
    seed = 33; const sparks = Array.from({ length: 8 }, (_, i) => ({ e: mk('div', 'spark', el, '✦'), a: i / 8 * 6.283 + rnd() * 0.3 }));
    const lbl = mk('div', 'jua', el, RV.label || '정체 공개!', { position: 'absolute', left: 0, right: 0, top: '800px', textAlign: 'center', fontSize: '76px', color: 'var(--mint)', textShadow: '0 0 30px rgba(127,224,196,.7)' });
    const at = o.at ?? 0.35, RA = RV.at ?? 2.0;
    const mid = (n - 1) / 2;
    return {
      seek(lt) {
        if (T) T.seek(lt);
        cards.forEach(({ c }, i) => {
          const p = P(lt, at + i * TOK.stagFast, TOK.moveSlow, F2), ang = (i - mid) * (n > 5 ? 11 : 15);
          const sel = i === RV.index, up = sel ? P(lt, RA, TOK.move, F1) : 0, fl = sel ? P(lt, RA + 0.45, TOK.move, IO) : 0;
          const dimB = !sel && RV.index != null ? 1 - 0.55 * P(lt, RA, TOK.fade, LIN) : 1;
          c.style.opacity = P(lt, at - 0.2, TOK.fade, LIN);
          c.style.filter = dimB < 1 ? `brightness(${dimB})` : '';
          c.style.zIndex = sel && lt > RA ? 10 : i;
          c.style.transform = `perspective(1600px) translateY(${lerp(380, 0, P(lt, 0, TOK.move, F2)) - 50 * up}px) rotate(${lerp(0, ang, p) * (1 - up)}deg) scale(${1 + 0.15 * up}) rotateY(${180 * fl}deg)`;
        });
        const sp = P(lt, RA + 0.75, TOK.moveSlow, OUT);
        sparks.forEach(({ e, a }) => { e.style.opacity = tent(lt, RA + 0.75, 0.8); e.style.transform = `translate(${960 - 26 + Math.cos(a) * 330 * sp}px, ${420 + Math.sin(a) * 260 * sp}px) scale(${lerp(0.3, 1.1, sp)})`; });
        pop(lbl, lt, RA + 0.8, { dy: 40, s0: 0.5 });
      },
      events: [...(T ? T.events : []), [at, 'deal'], [RA, 'swish'], [RA + 0.45, 'flip'], [RA + 0.75, 'sparkle']],
    };
  });

  // 10) 아이템 이름표가 통통 튀며 선반에 쌓인다 (중력 + 튕김, 시간의 순수 함수)
  // o: { items:[[이모지, 이름]], title, at, cols }
  def('itemRain', (el, o) => {
    const I = o.items || [], cols = o.cols || Math.ceil(I.length / Math.ceil(I.length / 4));
    const T = o.title ? text(el, o.title, { style: 'stack', x: 90, y: 70, size: 70, at: 0.05, align: 'left' }) : null;
    const rowsN = Math.ceil(I.length / cols), rowY = r => 860 - (rowsN - 1 - r) * 190;
    const shelves = Array.from({ length: rowsN }, (_, r) => mk('div', 'shelf', el, null, { left: '120px', width: '1680px', top: rowY(r) + 'px' }));
    seed = 77;
    const order = I.map((_, i) => i).sort(() => rnd() - 0.5);
    let tt = o.at ?? 0.3; const starts = []; order.forEach(i => { starts[i] = tt; tt += 0.07 + rnd() * 0.08; });
    const tags = I.map(([em, nm], i) => {
      const r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, I.length - r * cols);
      const cw = 1680 / inRow, x = 120 + cw * c + cw / 2;
      const anchor = mk('div', null, el, null, { position: 'absolute', left: x + 'px', top: rowY(r) - 108 + 'px', width: 0, height: 0 });
      const e = mk('div', 'itag paper', anchor, `<span class="em">${ICON(em, 46)}</span><span class="nm">${nm}</span>`, { left: 0, top: 0 });
      return { e, x, rot: (rnd() - 0.5) * 10 };
    });
    const FALL = 0.45, H = 1100, G = 2 * H / (FALL * FALL), V = G * FALL, E = 0.38;
    // 튕김 높이: 착지 후 n번째 튕김 높이 = H*E^(2n)
    const bounceY = tau => { if (tau < FALL) return H - 0.5 * G * tau * tau; let t = tau - FALL, v = V * E; for (let k = 0; k < 4; k++) { const d = 2 * v / G; if (t < d) return v * t - 0.5 * G * t * t; t -= d; v *= E; } return 0; };
    return {
      seek(lt) {
        if (T) T.seek(lt);
        shelves.forEach((s, i) => pop(s, lt, 0.05 + i * TOK.stag, { dy: 0, s0: 0.2 }));
        tags.forEach(({ e, rot }, i) => {
          const tau = lt - starts[i];
          if (tau < 0) { e.style.opacity = 0; return; }
          const y = bounceY(tau), land = tau - FALL;
          const sq = land > 0 && land < 0.12 ? Math.sin(land / 0.12 * Math.PI) : 0;
          e.style.opacity = 1;
          e.style.transform = `translate(-50%, ${-y}px) rotate(${rot * clamp(1 - land / 0.6)}deg) scale(${1 + 0.14 * sq}, ${1 - 0.16 * sq})`;
        });
      },
      events: [...(T ? T.events : []), ...I.map((_, i) => [starts[i] + FALL, 'boing'])],
    };
  });

  // 11) 빠르게 달려와 "쿵!" 부딪히고 빙글빙글 (킥보드 소개)
  // o: { text, icon, hitAt, spin(초, 기본 2), boom:'쿵!', sub, wall:true }
  def('spinCrash', (el, o) => {
    const HIT = o.hitAt ?? 0.8, SPIN = o.spin ?? 2;
    const world = mk('div', 'layer', el);
    const WX = 1500;
    const wall = o.wall === false ? null : mk('div', 'wall', world, null, { left: WX + 'px', top: '250px', height: '460px' });
    const streaks = Array.from({ length: 7 }, (_, i) => mk('div', 'streak', world, null, { top: 330 + i * 46 + 'px', left: '0', width: 300 + (i * 97) % 300 + 'px' }));
    const blk = mk('div', 'crash', world, `<span class="em">${ICON(o.icon || '🛴', 230)}</span><span class="tt">${o.text || '킥보드'}</span>`, { left: '0', top: '330px' });
    const boom = mk('div', 'boom', world, `<span>${o.boom || '쿵!'}</span>`, { left: WX - 20 + 'px', top: '445px' });
    const dz = Array.from({ length: 3 }, () => mk('div', 'spark', world, '★'));
    const S = o.sub ? text(el, o.sub, { style: 'marker', y: 800, size: 60, font: 'body', weight: 800, at: o.subAt ?? (HIT + SPIN * 0.85), markColor: 'var(--lantern)', mark: o.subMark }) : null;
    return {
      seek(lt) {
        const BW = blk.offsetWidth || 760, restX = WX - BW - 10; // 글꼴이 늦게 와도 맞도록 매번 잰다
        const p = P(lt, HIT - 0.55, 0.55, INQ);
        let x = lerp(-BW - 300, restX, p);
        if (lt > HIT) x = restX - 170 * P(lt, HIT, TOK.moveFast, OUT) + 60 * P(lt, HIT + TOK.moveFast, TOK.move, IO);
        const spinP = P(lt, HIT + 0.05, SPIN, OUT), rot = CALM ? 0 : -720 * spinP;
        blk.style.transform = `translateX(${x}px) rotate(${rot}deg) scale(${lt > HIT && lt < HIT + 0.1 ? 0.9 : 1}, ${lt > HIT && lt < HIT + 0.1 ? 1.1 : 1})`;
        streaks.forEach((s, i) => { s.style.opacity = lt < HIT && lt > HIT - 0.55 ? 0.9 : 0; s.style.transform = `translateX(${x - 380 + (i % 3) * 60}px)`; });
        const [sx, sy] = shake(lt, HIT, 0.45);
        world.style.transform = `translate(${sx}px, ${sy}px)`;
        boom.style.opacity = tent(lt, HIT - 0.05, 0.9) > 0 ? Math.min(1, tent(lt, HIT - 0.05, 0.9) * 3) : 0;
        boom.style.transform = `scale(${lerp(0.2, 1, P(lt, HIT, TOK.moveFast, F1))}) rotate(-8deg)`;
        if (wall) wall.style.transform = `translateX(${lt > HIT ? Math.sin((lt - HIT) * 40) * 10 * clamp(1 - (lt - HIT) / 0.4) : 0}px)`;
        const dzOn = lt > HIT + 0.1 && lt < HIT + SPIN + 0.3;
        dz.forEach((d, i) => { const a = lt * 6 + i * 2.09; d.style.opacity = dzOn ? 1 - P(lt, HIT + SPIN, 0.3, LIN) : 0; d.style.transform = `translate(${x + BW / 2 + Math.cos(a) * 200 - 26}px, ${290 + Math.sin(a) * 50}px)`; });
        if (S) S.seek(lt);
      },
      events: [[HIT - 0.45, 'swish'], [HIT, 'thud'], [HIT + 0.1, 'spin'], ...(S ? S.events : [])],
    };
  });

  // 12) 모닥불 회의: 둥글게 앉은 캐릭터 → 종 → 표가 한 명에게 몰림
  // o: { people:[[이모지, 이름, 색]], target, voters:[번호...](기본: 대상 빼고 모두), bellAt, voteAt, resultAt, result, title }
  def('meeting', (el, o) => {
    const PP = o.people || [], n = PP.length, TG = o.target ?? 0;
    const CX = 960, CY = 520, RX = 650, RY = 250;
    const fire = mk('div', 'fire', el, null, { left: CX + 'px', top: CY + 'px' });
    const fg = mk('div', 'fglow', fire);
    [-18, 18].forEach(r => mk('div', 'log', fire, null, { left: '-110px', top: '40px', transform: `rotate(${r}deg)` }));
    const fls = [['#ff7a3c', 150, 0], ['#ffb547', 110, 1], ['#fff0b0', 64, 2]].map(([c, s, i]) => mk('div', 'fl', fire, null, { width: s + 'px', height: s + 'px', left: -s / 2 + 'px', top: 40 - s * 1.05 + 'px', background: c }));
    const seats = PP.map(([em, nm, c], i) => {
      const a = Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = CX + Math.cos(a) * RX, y = CY + Math.sin(a) * RY;
      const e = mk('div', 'seat', el, `<div class="av" style="background:${c || '#9b6bf2'}">${em}<div class="cnt">0</div></div><div class="nm">${nm}</div>`, { left: x + 'px', top: y - 95 + 'px' });
      return { e, x, y, cnt: e.querySelector('.cnt'), av: e.querySelector('.av') };
    });
    const bell = mk('div', null, el, '🔔', { position: 'absolute', left: '920px', top: '40px', fontSize: '110px', transformOrigin: '50% 10%' });
    const T = text(el, o.title || '회의 시간!', { style: 'pop', x: 1080, y: 70, size: 72, at: (o.bellAt ?? 0.4) + 0.1, align: 'left' });
    const voters = o.voters || PP.map((_, i) => i).filter(i => i !== TG);
    seed = 91; let tv = o.voteAt ?? 1.3; const vt = voters.map(() => { const t = tv; tv += 0.07 + rnd() * 0.08; return t; });
    const ballots = voters.map(() => mk('div', 'ballot', el, '표'));
    const FLY = TOK.move;
    const RS = o.resultAt ?? (vt[vt.length - 1] + FLY + 0.35);
    const res = mk('div', null, el, `<span class="jua" style="display:inline-block;padding:14px 44px 8px;border-radius:26px;background:rgba(11,10,36,.88);border:5px solid var(--lantern);box-shadow:0 0 50px rgba(255,194,71,.55)">${o.result || '꿈도둑으로 지목!'}</span>`, { position: 'absolute', left: 0, right: 0, top: '430px', textAlign: 'center', fontSize: '76px', color: 'var(--lantern)' });
    const BA = o.bellAt ?? 0.4;
    return {
      seek(lt) {
        fls.forEach((f, i) => { const k = 1 + 0.09 * Math.sin(lt * (11 + i * 3) + i) + 0.05 * Math.sin(lt * 23 + i * 2); f.style.transform = `translateX(${Math.sin(lt * 7 + i) * 4}px) scale(${1 / k}, ${k}) rotate(-45deg)`; });
        fg.style.opacity = 0.85 + 0.15 * Math.sin(lt * 9);
        fire.style.transform = `scale(${lerp(0.2, 1, P(lt, 0, TOK.move, F1))})`;
        seats.forEach((s, i) => pop(s.e, lt, 0.15 + i * TOK.stagFast, { dy: 60, s0: 0.5 }));
        bell.style.opacity = P(lt, BA - 0.2, TOK.fade, LIN);
        bell.style.transform = `rotate(${swing(lt, BA, 26, 16, 3)}deg)`;
        T.seek(lt);
        let arrived = 0;
        ballots.forEach((b, k) => {
          const s = seats[voters[k]], d = seats[TG], u = P(lt, vt[k], FLY, IO);
          const x = lerp(s.x, d.x, u), y = lerp(s.y - 60, d.y - 60, u) - Math.sin(u * Math.PI) * 220;
          b.style.opacity = lt >= vt[k] && u < 1 ? 1 : 0;
          b.style.transform = `translate(${x}px, ${y}px) rotate(${u * 360}deg) scale(${lerp(0.6, 1, u)})`;
          if (lt >= vt[k] + FLY) arrived++;
        });
        const d = seats[TG]; d.cnt.textContent = arrived; d.cnt.style.opacity = arrived ? 1 : 0;
        const lastHit = arrived ? vt[arrived - 1] + FLY : -9;
        d.av.style.transform = `scale(${1 + 0.12 * tent(lt, lastHit, 0.2) + 0.15 * P(lt, RS, TOK.move, F1)})`;
        d.av.style.boxShadow = `0 0 ${80 * P(lt, RS, TOK.fadeSlow, LIN)}px rgba(255,194,71,.95)`;
        seats.forEach((s, i) => { if (i !== TG) s.e.style.opacity = +s.e.style.opacity * (1 - 0.5 * P(lt, RS, TOK.fade, LIN)); });
        pop(res, lt, RS + 0.1, { dy: 40, s0: 0.4 });
      },
      events: [[0.15, 'pop'], [BA, 'bell'], ...T.events, ...vt.map(t => [t + FLY, 'vote']), [RS + 0.1, 'stamp']],
    };
  });

  // ================= 7. 전환 7종 =================
  // 각 전환: (p 0~1, 들어오는 장면 el, 나가는 장면 el, 장면 정보) — 효과음은 TRSFX
  let fxEls = null;
  function fxInit() {
    fxEls = {
      ring: mk('div', 'trring', fx), star: mk('div', 'trstar', fx, '★'),
      fogs: Array.from({ length: 6 }, () => mk('div', 'trfog', fx)),
      dl: mk('div', 'door l', fx, null, { left: '0', transformOrigin: '0 50%' }), dr: mk('div', 'door r', fx, null, { left: '960px', transformOrigin: '100% 50%' }),
    };
  }
  function fxReset() { for (const k in fxEls) [].concat(fxEls[k]).forEach(e => { e.style.display = 'none'; }); flash.style.opacity = 0; fx.style.perspective = ''; }
  const show = e => { e.style.display = 'block'; return e; };
  const TRANS = {
    lantern(p, I, O, s) {
      const x = s.tx ?? 960, y = s.ty ?? 540, r = lerp(0, 2300, IO(p));
      I.style.clipPath = `circle(${r}px at ${x}px ${y}px)`;
      const R = show(fxEls.ring); R.style.transform = `translate(${x}px, ${y}px) scale(${r / 470})`; R.style.opacity = 1 - P(p, 0.7, 0.3, LIN);
    },
    fog(p, I, O) {
      fxEls.fogs.forEach((f, i) => { show(f); const x = lerp(2700, -800, IO(p)) + (i % 3) * 420 - 400, y = 180 + (i * 370) % 900; f.style.transform = `translate(${x}px, ${y}px) scale(${1 + (i % 2) * 0.3})`; f.style.opacity = 1; });
      if (p < 0.5) I.style.opacity = 0; else O.style.display = 'none';
    },
    slide(p, I, O) {
      const X = lerp(-500, 2500, IO(p));
      I.style.clipPath = `path('M -10 -10 L ${X} -10 C ${X - 520} 300, ${X + 360} 700, ${X - 340} 1100 L -10 1100 Z')`;
      // 곡선 앞머리를 따라 내려가는 별똥별
      const u = clamp(p * 1.1), b = (a, c, d, e) => (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * c + 3 * (1 - u) * u * u * d + u ** 3 * e;
      const S = show(fxEls.star); S.style.transform = `translate(${b(X, X - 520, X + 360, X - 340)}px, ${b(-10, 300, 700, 1100)}px) rotate(${p * 540}deg)`;
    },
    door(p, I, O) {
      const L = show(fxEls.dl), R = show(fxEls.dr); fx.style.perspective = '2200px';
      if (p < 0.42) { const c = IO(p / 0.42); L.style.transform = `translateX(${lerp(-960, 0, c)}px)`; R.style.transform = `translateX(${lerp(960, 0, c)}px)`; I.style.opacity = 0; }
      else { O.style.display = 'none'; const q = P(p, 0.5, 0.5, IO); L.style.transform = `rotateY(${lerp(0, 105, q)}deg)`; R.style.transform = `rotateY(${lerp(0, -105, q)}deg)`; L.style.opacity = R.style.opacity = 1 - P(p, 0.85, 0.15, LIN); }
    },
    flip(p, I, O) {
      if (p < 0.5) { O.style.transform = `rotateY(${lerp(0, 90, INQ(p * 2))}deg) scale(${lerp(1, 0.9, p * 2)})`; I.style.display = 'none'; }
      else { O.style.display = 'none'; I.style.transform = `rotateY(${lerp(-90, 0, OUT((p - 0.5) * 2))}deg) scale(${lerp(0.9, 1, OUT((p - 0.5) * 2))})`; }
    },
    punch(p, I, O) {
      O.style.transform = `scale(${lerp(1, 1.6, P(p, 0, 0.45, INQ))})`; O.style.opacity = 1 - P(p, 0, 0.45, LIN);
      I.style.transform = `scale(${lerp(0.8, 1, P(p, 0.3, 0.7, F1))})`; I.style.opacity = P(p, 0.3, 0.3, LIN);
      if (!CALM) flash.style.opacity = tent(p, 0.15, 0.5) * 0.45;
    },
    push(p, I, O) {
      const q = IO(p);
      O.style.transform = `translateY(${lerp(0, -1080, q)}px)`; I.style.transform = `translateY(${lerp(1080, 0, q)}px)`;
    },
  };
  const TRSFX = { lantern: 'lantern', fog: 'fog', slide: 'swish', door: 'door', flip: 'flip', punch: 'thud', push: 'swish' };
  MG.TRANS = Object.keys(TRANS);

  // ================= 8. 영상 조립 =================
  // makeVideo({ bpm, mood:'promo'|'teacher'|'student', scenes:[{ name, bars, bg, trans, tx, ty, moon, still, section, build:(el, c)=>Q.x(el,{...}) }] })
  // section: 음악 구간 표시 'build'(드럼 시작) | 'drop'(가장 신남) | 'outro'(끝맺음)
  window.makeVideo = function ({ bpm, mood = 'promo', scenes }) {
    const BAR = 60 / bpm * 4, beat = 60 / bpm;
    fxInit();
    let b = 0;
    const list = scenes.map((s, i) => {
      const el = mk('div', 'scene', scenesEl), inner = mk('div', 'scene-in', el);
      const start = b * BAR; b += s.bars; const end = b * BAR;
      return { ...s, no: i + 1, el, inner, start, end, b0: +(start / BAR).toFixed(4), inst: null, td: s.trans && i > 0 ? (s.td ?? TRD[s.trans] ?? 0.6) : 0 };
    });
    list.forEach(s => { s.el.style.display = 'block'; s.inst = s.build(s.inner, { dur: s.end - s.start, beat, bar: BAR, start: s.start }); s.el.style.display = 'none'; });
    const TOTAL = b * BAR;
    window.TOTAL = TOTAL; window.BPM = bpm; window.BAR = BAR; window.MOOD = mood;
    window.SB = list.map(s => ({ no: s.no, name: s.name, start: s.start, end: s.end, bars: s.bars, b0: s.b0, trans: s.trans || 'cut', thumbs: s.thumbs }));
    const ev = list.flatMap(s => [...s.inst.events.map(([t, k]) => [+(s.start + t).toFixed(3), k]), ...(s.td ? [[+s.start.toFixed(3), TRSFX[s.trans]]] : [])]);
    window.EVENTS = ev.filter(e => e[0] >= 0 && e[0] < TOTAL && e[1]).sort((a, c) => a[0] - c[0]);
    window.SECTIONS = Object.fromEntries(list.filter(s => s.section).map(s => [s.section, s.b0]));
    window.SECTIONS.total = b;
    window.seek = function (t) {
      t = clamp(t, 0, TOTAL - 1e-4);
      let ci = list.findIndex(s => t >= s.start && t < s.end); if (ci < 0) ci = list.length - 1;
      const cur = list[ci], prev = ci > 0 ? list[ci - 1] : null;
      const p = cur.td ? (t - cur.start) / cur.td : 1, inTr = prev && cur.td && p < 1;
      fxReset();
      for (const s of list) { const on = s === cur || (inTr && s === prev); s.el.style.display = on ? 'block' : 'none'; s.el.style.clipPath = ''; s.el.style.transform = ''; s.el.style.opacity = 1; s.el.style.zIndex = s === cur ? 2 : 1; }
      if (inTr) prev.inst.seek(t - prev.start);
      cur.inst.seek(t - cur.start);
      if (inTr) TRANS[cur.trans](clamp(p), cur.el, prev.el, cur);
      // 배경: 종류가 바뀌면 전환 동안 섞는다. still 장면은 1.3초 뒤 배경도 멈춤
      const bt = cur.still ? Math.min(t, cur.start + 1.3) : t;
      const kPrev = prev ? (prev.bg || 'night') : (cur.bg || 'night'), kCur = cur.bg || 'night';
      if (bgA.dataset.k !== kPrev) { bgA.style.background = bgCss(kPrev); bgA.dataset.k = kPrev; }
      if (bgB.dataset.k !== kCur) { bgB.style.background = bgCss(kCur); bgB.dataset.k = kCur; }
      bgB.style.opacity = inTr ? P(t, cur.start, Math.max(TOK.fadeSlow, cur.td), LIN) : 1;
      STARS.forEach(({ e, w, ph }) => { e.style.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(bt * w + ph)); });
      sky.style.opacity = cur.stars === false ? 0 : 1;
      moonEl.style.display = cur.moon ? 'block' : 'none';
      bfog.forEach((f, i) => { f.style.transform = `translateX(${Math.sin(bt * 0.25 + i * 2) * 80}px)`; });
      caption(t - cur.start, cur.inst.caps);
    };
    // 그림·글꼴 로딩 대기 (최대 20초)
    window.ready = Promise.race([document.fonts.ready.then(() => Promise.all(PENDING)), new Promise(r => setTimeout(r, 20000))]);
    // ?ui=1 이면 미리보기용 손잡이(렌더와 무관): 끌어서 시간 이동
    if (/[?&]ui=1/.test(location.search)) {
      const bar = mk('input', null, document.body, null, { position: 'fixed', left: '20px', right: '20px', bottom: '8px', width: '1880px', zIndex: 99 });
      bar.type = 'range'; bar.min = 0; bar.max = TOTAL; bar.step = 1 / 30; bar.value = 0; bar.oninput = () => window.seek(+bar.value);
    }
    window.seek(0);
  };
})();
