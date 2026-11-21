// 아이템 몽타주 (홍보용·학생용 공용). lib.js 는 고치지 않고 Q.itemMontage 를 더한다.
// 실제 게임 연속 장면(shots/seq/item_*, crate_open)을 박자에 맞춰 빠르게 끊어 보여 준다.
// 규칙: 모든 움직임은 seek(lt) 의 순수 함수.
(function () {
  const { TOK, P, mk, pic, text, lerp, clamp, tent, F1, F2, OUT, INQ, IO, LIN, CALM } = MG;
  const W = 1920, H = 1080;
  // 조절값
  const IT = {
    enterDur: 0.28,   // 컷 들어올 때 카메라 움직임 시간
    tagDur: 0.36,     // 이름표 등장 시간
    flash: 0.4,       // 컷마다 번쩍 세기 (모션 축소면 0)
    push: 0.08,       // 컷 안에서 천천히 다가가는 정도(배율 증가)
  };
  const seqSrc = (name, i) => `@seq/${name}/${String(i).padStart(4, '0')}.png`;
  // 카메라 (lib.js 의 cam 과 같은 식) → 화면 좌표 변환도 같이
  const camT = (z, cx, cy) => ({ z, tx: clamp(W / 2 - cx * W * z, W - W * z, 0), ty: clamp(H / 2 - cy * H * z, H - H * z, 0) });
  const toScr = (c, u, v) => [c.tx + u * W * c.z, c.ty + v * H * c.z];
  // 프레임 번호로 위치 보간: pts = [[프레임, u, v], ...]
  const ptAt = (pts, f) => { if (f <= pts[0][0]) return pts[0].slice(1); for (let i = 1; i < pts.length; i++) if (f <= pts[i][0]) { const a = pts[i - 1], b = pts[i], k = (f - a[0]) / (b[0] - a[0]); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; } return pts[pts.length - 1].slice(1); };
  // 컷 들어오는 방식 (카메라 층)
  const ENTER = {
    punch: p => `scale(${lerp(1.2, 1, p)})`,
    whipL: p => `translateX(${lerp(-260, 0, p)}px) scale(${lerp(1.08, 1, p)})`,
    whipR: p => `translateX(${lerp(260, 0, p)}px) scale(${lerp(1.08, 1, p)})`,
    drop: p => `translateY(${lerp(-180, 0, p)}px)`,
    tilt: p => `rotate(${lerp(-4, 0, p)}deg) scale(${lerp(1.12, 1, p)})`,
    pull: p => `scale(${lerp(0.86, 1, p)})`,
  };
  // 이름표 등장 방식
  const TAGIN = {
    slam: (p, q) => ({ o: q, t: `scale(${lerp(1.9, 1, p)}) rotate(${lerp(-8, -2, p)}deg)` }),
    slideL: (p, q) => ({ o: q, t: `translateX(${lerp(-520, 0, p)}px) rotate(-2deg)` }),
    slideR: (p, q) => ({ o: q, t: `translateX(${lerp(520, 0, p)}px) rotate(2deg)` }),
    drop: (p, q) => ({ o: q, t: `translateY(${lerp(-220, 0, p)}px)` }),
    pop: (p, q) => ({ o: q, t: `scale(${lerp(0.3, 1, p)})` }),
    rise: (p, q) => ({ o: q, t: `translateY(${lerp(160, 0, p)}px) rotate(1.5deg)` }),
  };

  // o: { cuts:[ { name, frames, start, fps, speed, beats | dur, zoom:[z0,cx,cy, z1?], enter, tag:{name, fx, pos:'L'|'R'|'C', y, style, note}, group:'student'|'chaser',
  //               marks:[{ type:'ring', pts:[[프레임,u,v],...], r, from, to(초), label }] }
  //             | { card:{ icon, lines:[...], sub }, beats } ],
  //      beat, groups:{student:{label,total,color}, chaser:{...}}, caps }
  Q.itemMontage = (el, o) => {
    const B = o.beat || 0.5;
    let t = 0;
    const counts = {};
    const C = o.cuts.map((c, i) => {
      const dur = c.dur ?? c.beats * B;
      const box = mk('div', 'layer', el, null, { overflow: 'hidden', display: 'none' });
      const r = { ...c, i, dur, t0: t, box };
      t += dur;
      if (c.card) {
        mk('div', 'layer', box, null, { background: c.card.bg || 'radial-gradient(ellipse at 50% 60%, #5a2a4a, #1a1030 75%)' });
        r.cardIc = mk('div', null, box, c.card.icon || '👻', { position: 'absolute', left: 0, right: 0, top: '200px', textAlign: 'center', fontSize: '170px', lineHeight: 1 });
        r.cardLines = (c.card.lines || []).map((ln, k) => mk('div', 'jua', box, ln, { position: 'absolute', left: 0, right: 0, top: 420 + k * 150 + 'px', textAlign: 'center', fontSize: (k ? 130 : 96) + 'px', color: k ? 'var(--lantern)' : '#fff', textShadow: '0 8px 0 rgba(11,10,36,.55), 0 0 40px rgba(255,194,71,.35)' }));
        return r;
      }
      r.inner = mk('div', 'layer', box, null, { transformOrigin: '50% 50%' });
      r.cam = mk('div', 'layer', r.inner);
      r.imgs = Array.from({ length: c.frames }, (_, k) => pic(r.cam, seqSrc(c.name, k + 1), '', { display: 'none' }));
      r.last = -1;
      mk('div', 'shade', r.inner, null, { background: 'radial-gradient(ellipse 75% 75% at 50% 50%, rgba(5,4,20,0) 55%, rgba(5,4,20,.55))' });
      r.marks = (c.marks || []).map(m => {
        const e = mk('div', 'ring', r.inner, null, { left: 0, top: 0, width: 2 * (m.r || 80) + 'px', height: 2 * (m.r || 80) + 'px', borderRadius: '50%', transformOrigin: '50% 50%' });
        const lb = m.label ? mk('div', 'callout jua', r.inner, m.label, { left: 0, top: 0, '--tx': '40px', fontSize: '40px' }) : null;
        return { ...m, e, lb };
      });
      // 이름표
      const tg = c.tag || {};
      const grp = (o.groups || {})[c.group];
      if (c.group && !c.cont) counts[c.group] = (counts[c.group] || 0) + 1; // cont: 앞 컷과 같은 아이템(다른 화면)
      const pos = tg.pos || ['L', 'R', 'C'][i % 3];
      const style = pos === 'C' ? { left: 0, right: 0, textAlign: 'center' } : pos === 'L' ? { left: '70px' } : { right: '70px', textAlign: 'right' };
      const wrap = mk('div', null, box, null, { position: 'absolute', top: (tg.y ?? 120) + 'px', ...style });
      const col = grp ? grp.color : 'var(--lantern)';
      r.tag = mk('div', 'paper', wrap, `<div class="jua" style="font-size:${tg.size || 76}px;line-height:1.05;color:var(--ink)">${tg.name}</div>`
        + (tg.fx ? `<div style="font-size:42px;font-weight:900;margin-top:6px;color:#4b2f8f">${tg.fx}</div>` : '')
        + (tg.note ? `<div class="jua" style="display:inline-block;margin-top:8px;padding:4px 16px 0;border-radius:12px;background:${col};color:var(--ink);font-size:30px">${tg.note}</div>` : ''),
        { display: 'inline-block', padding: '18px 40px 20px', borderRadius: '30px', textAlign: 'left', borderColor: 'var(--ink)', boxShadow: `8px 8px 0 var(--ink), 0 0 0 6px ${col}`, transformOrigin: pos === 'L' ? '0 50%' : pos === 'R' ? '100% 50%' : '50% 50%' });
      r.tagStyle = tg.style || ['slam', 'slideL', 'drop', 'slideR', 'pop', 'rise'][i % 6];
      // 무리 표시 칩 (학생 아이템 n/6 · 잠귀신 아이템 n/3)
      r.chip = grp ? mk('div', 'chip jua', box, `${grp.label} <span style="color:${grp.dark || '#4b2f8f'}">${counts[c.group]}/${grp.total}</span>`, { left: '50%', top: '30px', transform: 'translateX(-50%)', background: col, fontSize: '38px', fontWeight: 400 }) : null;
      return r;
    });
    const fl = mk('div', 'shade', el, null, { background: '#fff1c9', opacity: 0 });
    const TOTAL = t;
    return {
      seek(lt) {
        let k = 0; C.forEach((c, i) => { if (lt >= c.t0) k = i; });
        C.forEach((c, i) => {
          c.box.style.display = i === k ? 'block' : 'none';
          if (i !== k) return;
          const u = lt - c.t0;
          if (c.card) {
            const p = P(u, 0, IT.tagDur, F1);
            c.cardIc.style.transform = `translateY(${lerp(-160, 0, P(u, 0, TOK.move, F2))}px) rotate(${Math.sin(u * 9) * 8 * (CALM ? 0 : 1)}deg)`;
            c.cardLines.forEach((e, j) => { const q = P(u, 0.08 + j * TOK.stag, IT.tagDur, F1); e.style.opacity = P(u, 0.08 + j * TOK.stag, TOK.fadeFast, LIN); e.style.transform = `scale(${lerp(j ? 1.8 : 0.4, 1, q)})`; });
            void p; return;
          }
          const fps = (c.fps || 12) * (c.speed || 1);
          const f = clamp(Math.floor(u * fps) + (c.start || 1) - 1, 0, c.frames - 1);
          if (f !== c.last) { c.imgs.forEach((e, j) => { e.style.display = j === f ? 'block' : 'none'; }); c.last = f; }
          const [z0, cx, cy, z1] = c.zoom || [1.1, 0.5, 0.5];
          const z = lerp(z0, z1 ?? z0 + IT.push, clamp(u / c.dur));
          const cm = camT(z, cx, cy);
          c.cam.style.transformOrigin = '0 0';
          c.cam.style.transform = `translate(${cm.tx}px, ${cm.ty}px) scale(${z})`;
          c.inner.style.transform = (ENTER[c.enter || 'punch'])(P(u, 0, IT.enterDur, OUT));
          c.marks.forEach(m => {
            const on = u >= (m.from || 0) && u < (m.to ?? 99);
            m.e.style.opacity = on ? Math.min(P(u, m.from || 0, TOK.fadeFast, LIN), 1 - P(u, (m.to ?? 99) - TOK.fadeFast, TOK.fadeFast, LIN)) : 0;
            const [mu, mv] = ptAt(m.pts, f + 1);
            const [x, y] = toScr(cm, mu, mv), R = m.r || 80;
            m.e.style.transform = `translate(${x - R}px, ${y - R}px) scale(${lerp(1.5, 1, P(u, m.from || 0, TOK.moveFast, F1)) * (1 + 0.04 * Math.sin(u * 10))})`;
            if (m.lb) { m.lb.style.opacity = m.e.style.opacity; m.lb.style.transform = `translate(${x - 40 + (m.lx || 0)}px, ${y - R - 120 + (m.ly || 0)}px)`; }
          });
          const tp = P(u, 0.06, IT.tagDur, F1), tq = P(u, 0.06, TOK.fadeFast, LIN);
          const s = TAGIN[c.tagStyle](tp, tq);
          c.tag.style.opacity = s.o; c.tag.style.transform = s.t;
          if (c.chip) c.chip.style.opacity = 1;
        });
        const cuts = C.map(c => c.t0).slice(1);
        fl.style.opacity = CALM ? 0 : Math.max(0, ...cuts.map(ct => tent(lt, ct - 0.02, 0.18))) * IT.flash;
      },
      events: C.flatMap((c, i) => [...(i ? [[c.t0, c.card ? 'thud' : (i % 2 ? 'whoosh' : 'swish')]] : []), [c.t0 + 0.1, c.card ? 'stamp' : 'pop2'], ...(c.sfx || []).map(([tt, nm]) => [c.t0 + tt, nm])]).filter(e => e[0] < TOTAL),
      caps: o.caps || [],
      total: TOTAL,
    };
  };

  // 두 편이 같이 쓰는 컷 목록 (효과 문구는 shared/config.js ITEMS · ITEM_POOLS · server/index.js useItem 으로 확인)
  //   학생 아이템 7 (운동화·우산·손전등·찬스 카드·기상 나팔·투명 망토·킥보드), 잠귀신 아이템 2 (안개 망토·긴 베개) — 찬스 카드는 잠귀신도 받음
  //   박자 합 36 = 9마디
  window.ITEM_CUTS = (v = {}) => [
    { name: 'crate_open', frames: 35, start: 4, speed: 1.5, beats: 4, zoom: [1.0, 0.5, 0.5, 1.12], enter: 'pull',
      tag: { name: '보급 상자', fx: v.crateFx || '꾹~ 누르면 열려요', pos: 'R', y: 330, style: 'slam' },
      marks: [{ pts: [[1, 0.535, 0.565]], r: 120, from: 0.1, to: 1.2, label: '꾹~' },
        { pts: [[1, 0.955, 0.9]], r: 95, from: 0.1, to: 1.2 },
        { pts: [[1, 0.15, 0.042]], r: 130, from: 1.25, label: '가방에 쏙!', ly: 330 }] },
    { name: 'item_shoes', frames: 34, start: 8, speed: 1.1, beats: 3, zoom: [1.45, 0.5, 0.47], enter: 'whipR', group: 'student',
      tag: { name: '반짝 운동화', fx: '6초 동안 쌩!', pos: 'L' } },
    { name: 'item_umbrella', frames: 35, start: 10, speed: 1.15, beats: 3, zoom: [1.35, 0.5, 0.4], enter: 'drop', group: 'student', sfx: [[1.1, 'pop']],
      tag: { name: '꿈막이 우산', fx: '꿈 걸기를 한 번 막아 줘요', pos: 'R' } },
    { name: 'item_flashlight', frames: 31, start: 4, speed: 1.15, beats: 3, zoom: [1.0, 0.5, 0.5, 1.06], enter: 'pull', group: 'student',
      tag: { name: '손전등', fx: '10초 동안 더 넓게 보여요', pos: 'C', y: 120 } },
    { name: 'item_chance', frames: 31, start: 2, speed: 1, beats: 3, zoom: [1.25, 0.5, 0.47], enter: 'tilt', group: 'student',
      tag: { name: '찬스 카드', fx: '틀린 보기 2개가 사라져요', note: '잠귀신도 받아요', pos: 'R', y: 90 } },
    { name: 'item_bugle', frames: 31, start: 5, speed: 1.25, beats: 3, zoom: [1.45, 0.5, 0.42], enter: 'whipL', group: 'student',
      tag: { name: '기상 나팔', fx: '둘레 친구를 한꺼번에 깨워요', note: '잠귀신 술래잡기', pos: 'L' } },
    { name: 'item_invis', frames: 35, start: 7, speed: 1.2, beats: 3, zoom: [1.4, 0.5, 0.42], enter: 'punch', group: 'student',
      tag: { name: '투명 망토', fx: '4초 동안 잠귀신 눈에 안 보여요', note: '잠귀신 술래잡기', pos: 'R' },
      marks: [{ pts: [[1, 0.5, 0.47]], r: 85, from: 0.3, label: '내 화면' }] },
    { name: 'item_invis_chaser', frames: 36, start: 1, speed: 1.15, beats: 3, zoom: [1.35, 0.55, 0.42], enter: 'whipR', group: 'student', cont: true,
      tag: { name: '잠귀신 화면에서는?', fx: '방금 그 친구가 사라졌어요!', pos: 'L', style: 'drop' },
      marks: [{ pts: [[1, 0.62, 0.45]], r: 90, from: 0.15, label: '어디 갔지?' }] },
    { name: 'item_kickboard', frames: 31, start: 8, speed: 1.1, beats: 3, zoom: [1.4, 0.5, 0.47], enter: 'whipR', group: 'student',
      tag: { name: '킥보드', fx: '8초 동안 쌩쌩!', note: '놀이공원에서만', pos: 'R' } },
    { card: { icon: '👻', lines: ['잠귀신도', '아이템을 써요!'] }, beats: 3 },
    { name: 'item_fogcape', frames: 34, start: 7, speed: 1.15, beats: 2, zoom: [1.35, 0.6, 0.42], enter: 'punch', group: 'chaser',
      tag: { name: '안개 망토', fx: '8초 동안 흐릿하게 숨어요', pos: 'L' },
      marks: [{ pts: [[5, 0.68, 0.4], [13, 0.67, 0.4], [17, 0.64, 0.4], [22, 0.6, 0.42]], r: 100, from: 0.1, label: '흐릿~' }] },
    { name: 'item_pillow', frames: 34, start: 6, speed: 1.05, beats: 3, zoom: [1.6, 0.55, 0.47], enter: 'tilt', group: 'chaser',
      tag: { name: '긴 베개', fx: '멀리서도 꿈에 빠뜨려요', pos: 'R' },
      marks: [{ pts: [[1, 0.59, 0.48]], r: 95, from: 0.1, to: 0.85 }, { pts: [[1, 0.5, 0.47]], r: 95, from: 0.85, label: 'Zzz…' }] },
  ];
  window.ITEM_GROUPS = { student: { label: '🎒 학생 아이템', total: 7, color: 'var(--mint)' }, chaser: { label: '👻 잠귀신 아이템', total: 2, color: 'var(--lantern)' } };

  // ── 단계 진행 표시 (꿈도둑을 찾아라 ①~⑦) ──
  // Q.stepped(el, { steps:[[시각, 번호(1부터)], ...], labels:[...], title:{t, at, style, y, size} }, el => Q.x(el, …))
  const NUM = '①②③④⑤⑥⑦⑧⑨';
  Q.stepped = (el, o, build) => {
    const r = build(el);
    const L = o.labels || [];
    const row = mk('div', null, el, null, { position: 'absolute', left: '50px', top: '34px', display: 'flex', gap: '10px', alignItems: 'center', zIndex: 5 });
    const pills = L.map((lb, i) => mk('div', 'jua', row, `<span class="n">${NUM[i]}</span><span class="l" style="display:none"> ${lb}</span>`,
      { padding: '6px 16px 2px', borderRadius: '999px', fontSize: '38px', border: '4px solid var(--ink)', boxShadow: '4px 4px 0 var(--ink)', whiteSpace: 'nowrap', transformOrigin: '0 50%' }));
    const T = o.title ? text(el, o.title.t, { style: o.title.style || 'mask', y: o.title.y ?? 130, size: o.title.size || 72, at: o.title.at ?? 0.15, mark: o.title.mark }) : null;
    const S = o.steps || [[0, 1]];
    return {
      seek(lt) {
        r.seek(lt);
        let cur = S[0][1], t0 = S[0][0]; for (const [t, n] of S) if (lt >= t) { cur = n; t0 = t; }
        pills.forEach((p, i) => {
          const n = i + 1, on = n === cur, done = n < cur;
          p.style.background = on ? 'var(--lantern)' : done ? 'var(--mint)' : 'rgba(255,246,229,.35)';
          p.style.color = 'var(--ink)';
          p.lastChild.style.display = on ? 'inline' : 'none';
          p.style.opacity = P(lt, 0.05 + i * TOK.stagFast, TOK.fade, LIN) * (on || done ? 1 : 0.8);
          p.style.transform = on ? `scale(${lerp(1.25, 1, P(lt, t0, TOK.move, F1))})` : 'scale(.92)';
        });
        if (T) { T.seek(lt); if (o.title.out != null) T.el.style.opacity = 1 - P(lt, o.title.out, TOK.fadeSlow, LIN); }
      },
      events: [...(r.events || []), ...S.map(([t]) => [t + 0.02, 'tick']), ...(T ? T.events : [])],
      caps: o.caps || r.caps || [],
    };
  };
})();
