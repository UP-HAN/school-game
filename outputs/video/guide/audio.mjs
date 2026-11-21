// 음악(코드 합성)과 효과음(화면 사건 시각에 맞춰) 만들기
// 사용: node audio.mjs <tag>   → work/events_<tag>.json 을 읽어 work/music_<tag>.wav, sfx_<tag>.wav, mix_<tag>.wav
// 분위기(mood)는 구성 파일 makeVideo({ mood }) 에서 정한다:
//   promo   — 홍보용: 신나고 빠름 (126~132 BPM), A단조 모험, 종소리 리드
//   teacher — 선생님용: 밝고 차분 (108~116 BPM), F장조, 마림바·첼레스타
//   student — 학생용: 가장 빠르고 장난스러움 (132~140 BPM), D도리안, 실로폰·피치카토
// 구간(마디): sections.build(드럼 시작) / drop(가장 신남) / outro(끝맺음). 없으면 자동.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const SR = 44100;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// 분위기별 설정 — 예전 퀴즈 카트 곡(C-G-Am-F)과 다른 진행·멜로디
const MOODS = {
  promo: {
    prog: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59, 64]],        // Am - F - G - E (마이너 모험)
    root: [45, 41, 43, 40],
    lead: [[76, 0, 72, 76, 79, 0, 76, 74], [77, 0, 72, 69, 72, 0, 77, 76], [74, 0, 71, 67, 71, 74, 76, 0], [76, 0, 80, 76, 71, 0, 68, 71]],
    leadInst: 'bell', arpInst: 'xylo', drums: 'four', swing: 0, bassType: 'saw', padAmp: 0.026,
  },
  teacher: {
    prog: [[53, 57, 60, 64], [50, 53, 57, 60], [46, 50, 53, 57], [48, 53, 55, 60]], // Fmaj7 - Dm7 - Bbmaj7 - Csus4
    root: [41, 38, 34, 36],
    lead: [[72, 0, 69, 72, 77, 0, 76, 72], [74, 0, 69, 72, 74, 77, 0, 74], [70, 0, 74, 77, 74, 0, 72, 70], [72, 0, 67, 72, 77, 0, 79, 0]],
    leadInst: 'marimba', arpInst: 'celesta', drums: 'soft', swing: 0.04, bassType: 'sine', padAmp: 0.03,
  },
  student: {
    prog: [[50, 53, 57, 60], [55, 59, 62, 65], [50, 53, 57, 62], [48, 52, 55, 60]], // Dm7 - G7 - Dm - C (도리안, 장난스러움)
    root: [38, 43, 38, 36],
    lead: [[74, 77, 0, 74, 81, 0, 79, 77], [79, 0, 74, 71, 74, 76, 0, 79], [77, 0, 81, 77, 74, 0, 72, 74], [76, 72, 0, 76, 79, 0, 76, 72]],
    leadInst: 'xylo', arpInst: 'pizz', drums: 'bouncy', swing: 0, bassType: 'pizz', padAmp: 0.02,
  },
};

export function makeAudio(tag) {
  const J = JSON.parse(fs.readFileSync(path.join(HERE, 'work', `events_${tag}.json`), 'utf8'));
  const { events, total, bpm } = J, sections = J.sections || {};
  const M0 = MOODS[J.mood] || MOODS.promo;
  const DUR = total + 0.6, N = Math.ceil(DUR * SR);
  const BEAT = 60 / bpm, BAR = BEAT * 4, BARS = Math.ceil(total / BAR);
  const r2 = x => Math.round(x * 2) / 2; // 반 마디 단위로 정리 (소수 오차 제거)
  const IB = Math.round(sections.build ?? Math.min(2, BARS)), O = r2(sections.outro ?? Math.max(IB + 1, BARS - 2)), D = Math.round(sections.drop ?? Math.max(IB, Math.round((IB + O) / 2) - 2));
  const T_END = O * BAR; // 끝맺음(엔드카드) 시작: 여기서 마지막 화음, 그 뒤 박자는 멈춘다
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 * 2 - 1;
  const buf = () => [new Float32Array(N), new Float32Array(N)];

  // ---- 기본 소리 ----
  function tone(B, t0, dur, f, { type = 'sine', amp = 0.2, a = 0.005, r = 0.08, pan = 0, slide = 0, lp = 0, vib = 0, decay = 0 } = {}) {
    const i0 = Math.floor(t0 * SR), n = Math.floor((dur + r) * SR);
    let ph = 0, y = 0;
    const L = Math.cos((pan + 1) * Math.PI / 4), R = Math.sin((pan + 1) * Math.PI / 4);
    for (let k = 0; k < n && i0 + k < N; k++) {
      if (i0 + k < 0) continue;
      const t = k / SR;
      const ff = f * Math.pow(2, slide * Math.min(t, dur) / Math.max(dur, 0.01) / 12) * (1 + vib * Math.sin(t * 2 * Math.PI * 5.5));
      ph += ff / SR; const x = ph % 1;
      let s = type === 'sine' ? Math.sin(2 * Math.PI * x) : type === 'square' ? (x < 0.5 ? 1 : -1) : type === 'saw' ? 2 * x - 1 : 1 - 4 * Math.abs(x - 0.5);
      if (lp) { y += (s - y) * lp; s = y; }
      let env = t < a ? t / a : t < dur ? 1 : Math.max(0, 1 - (t - dur) / r);
      if (decay) env *= Math.exp(-t / decay);
      B[0][i0 + k] += s * env * amp * L; B[1][i0 + k] += s * env * amp * R;
    }
  }
  function noise(B, t0, dur, { amp = 0.2, hp = 0, lp = 1, a = 0.002, decay = 0, sweep = 0, pan = 0, fadeOut = 0 } = {}) {
    const i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR); let y = 0, yh = 0, prev = 0;
    for (let k = 0; k < n && i0 + k < N; k++) {
      if (i0 + k < 0) continue;
      const t = k / SR, p = t / dur;
      let s = rnd();
      const lpc = sweep ? lp * (sweep > 0 ? p : 1 - p) + 0.02 : lp;
      y += (s - y) * Math.min(1, lpc); s = y;
      if (hp) { yh = hp * (yh + s - prev); prev = s; s = yh; }
      let env = (t < a ? t / a : 1) * (decay ? Math.exp(-t / decay) : 1);
      if (fadeOut) env *= Math.min(1, (dur - t) / fadeOut);
      B[0][i0 + k] += s * env * amp * (1 - pan * 0.5); B[1][i0 + k] += s * env * amp * (1 + pan * 0.5);
    }
  }
  // 악기: 종(배음이 어긋난 맑은 소리), 실로폰, 마림바, 첼레스타, 피치카토
  const INST = {
    bell: (B, t, n, amp = 0.09, pan = 0) => { const f = mtof(n); tone(B, t, 0.02, f, { amp, r: 0.01, decay: 0.9, pan }); tone(B, t, 0.9, f, { amp, decay: 0.7, r: 0.3, pan }); tone(B, t, 0.5, f * 2.76, { amp: amp * 0.35, decay: 0.25, pan }); tone(B, t, 0.3, f * 5.4, { amp: amp * 0.12, decay: 0.12, pan }); },
    xylo: (B, t, n, amp = 0.1, pan = 0) => { const f = mtof(n); tone(B, t, 0.25, f, { amp, decay: 0.16, r: 0.05, pan }); tone(B, t, 0.1, f * 3.99, { amp: amp * 0.3, decay: 0.05, pan }); },
    marimba: (B, t, n, amp = 0.12, pan = 0) => { const f = mtof(n); tone(B, t, 0.4, f, { amp, decay: 0.28, r: 0.08, a: 0.004, pan }); tone(B, t, 0.15, f * 4, { amp: amp * 0.18, decay: 0.05, pan }); tone(B, t, 0.3, f / 2, { amp: amp * 0.25, decay: 0.2, pan }); },
    celesta: (B, t, n, amp = 0.06, pan = 0) => { const f = mtof(n); tone(B, t, 0.6, f, { amp, decay: 0.45, r: 0.2, pan }); tone(B, t, 0.4, f * 2, { amp: amp * 0.3, decay: 0.2, pan }); },
    pizz: (B, t, n, amp = 0.1, pan = 0) => tone(B, t, 0.12, mtof(n), { type: 'saw', amp, lp: 0.18, decay: 0.08, r: 0.04, pan }),
  };
  const kick = (B, t, amp = 0.9) => { tone(B, t, 0.18, 55, { amp, slide: -14, a: 0.001, r: 0.05 }); tone(B, t, 0.02, 2000, { amp: amp * 0.1, a: 0.0005, r: 0.01, type: 'tri' }); };
  const snare = (B, t, amp = 0.3) => { noise(B, t, 0.18, { amp, hp: 0.85, decay: 0.05 }); tone(B, t, 0.06, 190, { amp: amp * 0.5, decay: 0.04 }); };
  const rim = (B, t, amp = 0.18) => { tone(B, t, 0.03, 900, { type: 'tri', amp, decay: 0.012 }); noise(B, t, 0.03, { amp: amp * 0.4, hp: 0.8, decay: 0.008 }); };
  const hat = (B, t, amp = 0.1, pan = 0.3) => noise(B, t, 0.05, { amp, hp: 0.97, decay: 0.014, pan });
  const shaker = (B, t, amp = 0.05, pan = -0.3) => noise(B, t, 0.06, { amp, hp: 0.95, a: 0.01, decay: 0.02, pan });

  // ---------- 음악 ----------
  const M = buf();
  const md = M0;
  for (let b = 0; b <= BARS; b++) {
    const t = b * BAR, i = b % 4, ch = md.prog[i], root = md.root[i];
    const intro = b < IB, drop = b >= D && b < O, preDrop = b === D - 1;
    if (t >= T_END - 1e-6) continue;
    // 밤 하늘 패드 (낮게 깔리는 화음)
    for (const n of ch) tone(M, t, Math.min(BAR * 0.98, T_END - t), mtof(n), { type: 'saw', amp: md.padAmp, lp: 0.045, a: 0.25, r: 0.3, pan: (n % 3 - 1) * 0.45, vib: 0.002 });
    // 아르페지오 (반짝이는 별)
    const arpN = drop ? 8 : 4;
    for (let s = 0; s < arpN; s++) {
      const st = t + s * BAR / arpN + (s % 2 ? md.swing * BEAT : 0);
      if (st >= T_END) break;
      INST[md.arpInst](M, st, ch[(s * 2 + (b % 2)) % ch.length] + 12 + (s >= 4 ? 12 : 0), intro ? 0.06 : 0.045, s % 2 ? 0.45 : -0.45);
    }
    if (intro) { // 인트로: 패드·아르페지오 + 멜로디 절반 + 낮은 맥박
      md.lead[i].forEach((n, s) => { const st = t + s * BEAT / 2; if (n && s % 2 === 0 && st < T_END) INST[md.leadInst](M, st, n, 0.075, -0.1); });
      for (let q = 0; q < 4; q += 2) if (t + q * BEAT < T_END) { kick(M, t + q * BEAT, 0.45); tone(M, t + q * BEAT, BEAT * 1.5, mtof(root), { amp: 0.12, a: 0.02, r: 0.2 }); }
      if (b === IB - 1) noise(M, t, BAR, { amp: 0.1, lp: 0.5, sweep: 1 });
      continue;
    }
    // 드럼
    for (let q = 0; q < 4; q++) {
      const tb = t + q * BEAT;
      if (tb >= T_END) break;
      if (preDrop && q >= 2) { for (let r = 0; r < 4; r++) snare(M, tb + r * BEAT / 4, 0.08 + r * 0.035 + (q - 2) * 0.06); continue; }
      if (md.drums === 'four') { kick(M, tb, drop ? 0.95 : 0.8); if (q % 2) snare(M, tb, drop ? 0.32 : 0.24); hat(M, tb + BEAT / 2, drop ? 0.12 : 0.08, q % 2 ? 0.3 : -0.3); if (drop) shaker(M, tb + BEAT / 4), shaker(M, tb + BEAT * 3 / 4, 0.04, 0.3); }
      else if (md.drums === 'soft') { if (q % 2 === 0) kick(M, tb, 0.6); else rim(M, tb, 0.16); hat(M, tb + BEAT / 2 + md.swing * BEAT, 0.06, q % 2 ? 0.3 : -0.3); if (drop) shaker(M, tb + BEAT / 4, 0.035); }
      else { kick(M, tb, q === 2 ? 0.6 : 0.9); if (q % 2) snare(M, tb, 0.28); hat(M, tb + BEAT / 2, 0.1, 0.3); if (drop || q === 3) rim(M, tb + BEAT * 3 / 4, 0.12); }
    }
    // 베이스
    for (let q = 0; q < 4; q++) {
      const tb = t + q * BEAT;
      if (tb >= T_END) break;
      if (md.bassType === 'saw') { tone(M, tb, BEAT * 0.3, mtof(root), { amp: 0.16, r: 0.03 }); tone(M, tb + BEAT / 2, BEAT * 0.4, mtof(root + 12), { type: 'saw', amp: 0.13, lp: 0.1, r: 0.03 }); }
      else if (md.bassType === 'sine') { if (q % 2 === 0) tone(M, tb, BEAT * 1.6, mtof(root + (q === 2 ? 7 : 0)), { amp: 0.17, a: 0.01, r: 0.1 }); }
      else { const nn = [0, 12, 7, 12][q]; INST.pizz(M, tb, root + nn, 0.16); if (q === 3) INST.pizz(M, tb + BEAT / 2, root + 10, 0.1); }
    }
    if (preDrop) noise(M, t, BAR, { amp: 0.1, lp: 0.8, sweep: 1 });
    // 리드 멜로디 (드롭 구간) / 그 전에는 절반만
    const mel = md.lead[i];
    mel.forEach((n, s) => { const st = t + s * BEAT / 2 + (s % 2 ? md.swing * BEAT : 0); if (!n || st >= T_END) return; if (!drop && s % 2) return; INST[md.leadInst](M, st, n, drop ? undefined : 0.06, 0.1); });
  }
  // 끝맺음: 엔드카드 시작 순간 마지막 화음 + 종
  if (T_END < DUR) {
    const ch = md.prog[0];
    for (const n of ch.concat([ch[0] + 12])) tone(M, T_END, Math.max(0.5, Math.min(BAR * 2, DUR - T_END - 1.2)), mtof(n), { type: 'saw', amp: 0.035, lp: 0.05, a: 0.05, r: 1.6 });
    INST.bell(M, T_END, ch[0] + 24, 0.14); INST.bell(M, T_END + 0.02, ch[2] + 24, 0.08, 0.3);
    kick(M, T_END, 0.9); noise(M, T_END, 2.2, { amp: 0.12, lp: 0.3, decay: 0.7 });
  }

  // ---------- 효과음 (화면 사건에만) ----------
  const X = buf();
  const SFX = {
    pop: t => tone(X, t, 0.07, 520, { amp: 0.32, slide: 14, r: 0.06 }),
    pop2: t => [0, 0.06, 0.12].forEach((d, i) => tone(X, t + d, 0.05, 620 + i * 160, { amp: 0.2, slide: 10, r: 0.05 })),
    tick: t => tone(X, t, 0.025, 1500, { type: 'tri', amp: 0.2, r: 0.02 }),
    swish: t => noise(X, t - 0.12, 0.38, { amp: 0.28, lp: 0.9, sweep: -1, a: 0.12 }),           // 휙 (전환·이동)
    whoosh: t => noise(X, t - 0.15, 0.45, { amp: 0.33, lp: 0.9, sweep: -1, a: 0.15 }),
    type: t => { for (let k = 0; k < 14; k++) noise(X, t + k * 0.062 + (k % 3) * 0.008, 0.02, { amp: 0.1, hp: 0.8, decay: 0.006 }); },
    marker: t => noise(X, t + 0.3, 0.35, { amp: 0.12, hp: 0.6, lp: 0.5, a: 0.05, fadeOut: 0.1 }),
    lantern: t => { INST.bell(X, t, 88, 0.18); INST.bell(X, t + 0.05, 95, 0.07, 0.3); noise(X, t, 0.5, { amp: 0.03, hp: 0.95, decay: 0.2 }); }, // 랜턴 점등 (딩)
    correct: t => { [84, 88, 91, 96].forEach((n, i) => INST.xylo(X, t + i * 0.07, n, 0.18)); INST.bell(X, t + 0.28, 96, 0.12); }, // 정답
    thud: t => { tone(X, t, 0.32, 75, { amp: 0.6, slide: -12, r: 0.25 }); noise(X, t, 0.4, { amp: 0.3, lp: 0.25, decay: 0.12 }); },    // 쿵
    bell: t => { for (const [d, f0] of [[0, 660], [0.42, 660]]) [1, 2.0, 2.4, 3.0, 4.2].forEach((h, i) => tone(X, t + d, 1.2, f0 * h, { amp: [0.16, 0.08, 0.06, 0.04, 0.025][i], decay: 0.6 / (1 + i * 0.4), r: 0.4 })); }, // 회의 종
    fog: t => { noise(X, t - 0.1, 1.3, { amp: 0.2, lp: 0.25, sweep: 1, a: 0.3, fadeOut: 0.5 }); tone(X, t - 0.1, 1.1, 98, { amp: 0.1, slide: -5, a: 0.2, r: 0.4, type: 'tri' }); }, // 안개 (낮은 스윕)
    flip: t => { noise(X, t, 0.1, { amp: 0.22, lp: 0.55, decay: 0.035 }); noise(X, t + 0.08, 0.08, { amp: 0.14, lp: 0.5, decay: 0.03 }); },
    deal: t => [0, 0.07, 0.13, 0.2, 0.26].forEach((d, i) => noise(X, t + d, 0.06, { amp: 0.13 + i * 0.01, lp: 0.6, decay: 0.02, pan: i % 2 ? 0.3 : -0.3 })),
    sparkle: t => [0, 0.05, 0.11, 0.18].forEach((d, i) => tone(X, t + d, 0.08, 1900 + i * 340, { amp: 0.1, r: 0.14 })),
    click: t => { noise(X, t, 0.03, { amp: 0.28, hp: 0.6, decay: 0.008 }); tone(X, t, 0.02, 320, { amp: 0.18, r: 0.02 }); },
    stamp: t => { tone(X, t, 0.14, 110, { amp: 0.45, slide: -6, r: 0.1 }); noise(X, t, 0.12, { amp: 0.3, lp: 0.4, decay: 0.04 }); },
    rise: t => { noise(X, t, 0.9, { amp: 0.12, lp: 0.8, sweep: 1, fadeOut: 0.15 }); tone(X, t, 0.9, 440, { amp: 0.06, slide: 12, type: 'tri', r: 0.1 }); },
    boing: t => { const f = 300 + (Math.abs(rnd()) * 180 | 0); tone(X, t, 0.16, f, { amp: 0.16, slide: 9, vib: 0.05, r: 0.06 }); },
    spin: t => { for (let k = 0; k < 6; k++) tone(X, t + k * 0.22, 0.2, 700 + Math.sin(k) * 120, { amp: 0.07 * (1 - k / 7), slide: k % 2 ? -7 : 7, type: 'tri', r: 0.04 }); },
    vote: t => tone(X, t, 0.03, 980 + (Math.abs(rnd()) * 200 | 0), { type: 'tri', amp: 0.18, decay: 0.03 }),
    door: t => { tone(X, t, 0.35, 180, { type: 'saw', amp: 0.05, lp: 0.08, vib: 0.08, slide: 4 }); tone(X, t + 0.36, 0.12, 90, { amp: 0.35, slide: -6, r: 0.1 }); noise(X, t + 0.45, 0.4, { amp: 0.18, lp: 0.9, sweep: -1, a: 0.1 }); },
    chime: t => [88, 92, 95, 100].forEach((n, i) => INST.bell(X, t + i * 0.08, n, 0.08)),
  };
  for (const [t, k] of events) (SFX[k] || SFX.pop)(t);

  // ---------- 저장 ----------
  const peak = B => { let m = 0; for (const c of B) for (const v of c) m = Math.max(m, Math.abs(v)); return m || 1; };
  const scale = (B, g) => { for (const c of B) for (let i = 0; i < c.length; i++) c[i] *= g; };
  scale(M, 0.8 / peak(M)); scale(X, 0.75 / peak(X));
  const MX = buf();
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < N; i++) MX[ch][i] = Math.tanh((M[ch][i] * 0.72 + X[ch][i] * 0.62) * 1.25) / Math.tanh(1.25);
  function wav(file, B) {
    const d = Buffer.alloc(44 + N * 4);
    d.write('RIFF', 0); d.writeUInt32LE(36 + N * 4, 4); d.write('WAVE', 8); d.write('fmt ', 12); d.writeUInt32LE(16, 16); d.writeUInt16LE(1, 20); d.writeUInt16LE(2, 22);
    d.writeUInt32LE(SR, 24); d.writeUInt32LE(SR * 4, 28); d.writeUInt16LE(4, 32); d.writeUInt16LE(16, 34); d.write('data', 36); d.writeUInt32LE(N * 4, 40);
    for (let i = 0; i < N; i++) { const fo = Math.min(1, (DUR - i / SR) / 0.6); d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, B[0][i] * fo)) * 32767), 44 + i * 4); d.writeInt16LE(Math.round(Math.max(-1, Math.min(1, B[1][i] * fo)) * 32767), 46 + i * 4); }
    fs.writeFileSync(file, d);
  }
  const W = n => path.join(HERE, 'work', `${n}_${tag}.wav`);
  wav(W('music'), M); wav(W('sfx'), X); wav(W('mix'), MX);
  const unknown = [...new Set(events.map(e => e[1]).filter(k => !SFX[k]))];
  console.log(`audio ${tag}: mood=${J.mood} ${bpm}BPM ${DUR.toFixed(2)}s, ${events.length} events, 구간 build=${IB} drop=${D} outro=${O}${unknown.length ? ' (모르는 효과음→pop: ' + unknown.join(',') + ')' : ''}`);
  return W('mix');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) makeAudio(process.argv[2] || 'demo');
