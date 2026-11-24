// 소개 영상용 캡처 공용 도구.
// - 게임 코드(outputs/code)는 읽기만 한다. 서버는 testkit.startServer 로 띄운다 (포트 3700~3760).
// - 봇(다른 참가자)은 웹소켓으로 움직이고, 브라우저(playwright-core) 한 개 또는 여러 개가 실제 화면을 보여 준다.
// - 브라우저 쪽 "나"는 화면 안에서 키보드 이벤트로 걷는다 (window.__walk). 위치는 보낸 pos·state 로 안다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// 컴퓨터마다 설치 위치가 달라서, 있는 것을 골라 쓴다 (새로 설치하지 않는다). 환경변수 PW_CORE · CHROME 으로 직접 정할 수도 있다.
const firstExisting = (list, what) => {
  const hit = list.filter(Boolean).find((p) => fs.existsSync(p));
  if (!hit) throw new Error(what + ' 을(를) 찾지 못했습니다: ' + list.filter(Boolean).join(', '));
  return hit;
};
const slash = (p) => p.split(path.sep).join('/');
const HOME = slash(process.env.USERPROFILE || '');
const { chromium } = require(firstExisting([
  process.env.PW_CORE,
  'C:/Users/hanui/OneDrive/Desktop/Workspace_backup/Car_Racing/promo_video/node_modules/playwright-core',
  HOME + '/Desktop/Workspace/phone_free/outputs/video/node_modules/playwright-core',
  HOME + '/Desktop/Workspace/voyage-trade-king/node_modules/playwright-core',
], 'playwright-core'));
export const CHROME = firstExisting([
  process.env.CHROME,
  HOME + '/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',
  HOME + '/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
], '크로미움');
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CODE = slash(path.resolve(HERE, '../../../code')) + '/';
// 캡처 저장 폴더. 환경변수 SHOTS 로 다른 폴더에 찍을 수 있다 (끝에 / 를 붙인다).
export const SHOTS = process.env.SHOTS || slash(path.resolve(HERE, '../shots')) + '/';
const ROOT = pathToFileURL(CODE).href;
export const kit = await import(ROOT + 'server/testkit.js');
export const { GAME, CHASE } = await import(ROOT + 'shared/config.js');
const MG = await import(ROOT + 'shared/mapgrid.js');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 화면에 보일 이름: 실제 아이 이름처럼 보이지 않는 낱말
export const NAMES = ['하늘', '별이', '구름', '바다', '햇살', '무지개', '솜사탕', '도토리', '바람', '새싹'];
export const CHARS = ['cat', 'rabbit', 'dino', 'kid', 'slime', 'alien', 'kid2', 'cyclops'];

// 문제 세트 (영상용: 초등 수준 일반 상식). 정답은 ANSWER 로 찾는다.
export const QSET = {
  title: '3학년 2학기 복습',
  questions: [
    { q: '우리나라의 수도는 어디일까요?', a: '서울', wrong: ['부산', '대구', '광주'] },
    { q: '7 × 8 은 얼마일까요?', a: '56' },
    { q: '물이 얼음이 되는 온도는 몇 도일까요?', a: '0도', wrong: ['10도', '50도', '100도'] },
    { q: '한글을 만든 임금은 누구일까요?', a: '세종대왕' },
    { q: '곤충의 다리는 모두 몇 개일까요?', a: '6개', wrong: ['4개', '8개', '10개'] },
    { q: '해가 뜨는 방향은 어느 쪽일까요?', a: '동쪽' },
    { q: '1분은 몇 초일까요?', a: '60초', wrong: ['30초', '100초', '120초'] },
    { q: '식물이 햇빛으로 양분을 만드는 일을 무엇이라 할까요?', a: '광합성' },
    { q: '삼각형의 꼭짓점은 몇 개일까요?', a: '3개', wrong: ['2개', '4개', '5개'] },
    { q: '96 ÷ 8 은 얼마일까요?', a: '12' },
    { q: '우리나라 국기의 이름은 무엇일까요?', a: '태극기', wrong: ['무궁화', '애국가', '훈민정음'] },
    { q: '지구가 스스로 한 바퀴 도는 데 걸리는 시간은?', a: '하루', wrong: ['한 시간', '일주일', '한 달'] },
  ],
};
export const answerOf = (text) => (QSET.questions.find((q) => q.q === text) || {}).a;
// 봇이 받은 question 메시지에 맞는 답
export const botAnswer = (q) => {
  const a = answerOf(q.text);
  return q.kind === 'short' ? a : q.choices.indexOf(a);
};

// ───────── 서버 ─────────
export async function server(port, ovr = {}) {
  // 선생님 비밀번호는 비워 둔다 (실제 운영과 같음). 비밀번호를 쓰거나 적지 않는다.
  const s = await kit.startServer(port, { createGapMs: 0, ...ovr }, { TEACHER_PASSWORD: '' });
  log('server on', port);
  return s;
}

// ───────── 길 찾기 (맵마다) ─────────
const navCache = new Map();
export function nav(mapId) {
  if (navCache.has(mapId)) return navCache.get(mapId);
  const MAP = JSON.parse(fs.readFileSync(CODE + 'maps/' + mapId + '.json', 'utf8'));
  const G = MG.buildGrid(MAP);
  const { step, W, H, ok: ok0 } = MG.walkMap(MAP, G, GAME.radius);
  // 길은 벽·가구에서 조금 떨어지게 (여유 반지름). 여유 칸이 없으면 기본 칸을 쓴다.
  const wide = MG.walkMap(MAP, G, GAME.radius + 9).ok;
  let ok = ok0;
  const nearestOk = (x, y) => {
    let best = -1;
    let bd = Infinity;
    const i0 = Math.round(x / step);
    const j0 = Math.round(y / step);
    for (let j = j0 - 6; j <= j0 + 6; j++)
      for (let i = i0 - 6; i <= i0 + 6; i++) {
        if (i < 0 || j < 0 || i >= W || j >= H || !ok[j * W + i]) continue;
        const d = Math.hypot(i * step - x, j * step - y);
        if (d < bd) (bd = d), (best = j * W + i);
      }
    return best;
  };
  // 8방향 BFS (대각선은 양옆이 모두 비었을 때만). within: 목표에서 이 거리 안이면 도착
  function path(sx, sy, tx, ty, within = 20) {
    ok = wide;
    const p = path0(sx, sy, tx, ty, within);
    ok = ok0;
    return p || path0(sx, sy, tx, ty, within);
  }
  function path0(sx, sy, tx, ty, within) {
    const s = nearestOk(sx, sy);
    if (s < 0) return null;
    const prev = new Int32Array(W * H).fill(-2);
    prev[s] = -1;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      const i = k % W;
      const j = (k - i) / W;
      if (Math.hypot(i * step - tx, j * step - ty) <= within) {
        const out = [];
        for (let n = k; n >= 0; n = prev[n]) out.push([(n % W) * step, Math.floor(n / W) * step]);
        return out.reverse();
      }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (!ok[n] || prev[n] !== -2) continue;
        if (di && dj && !(ok[j * W + ni] && ok[nj * W + i])) continue;
        prev[n] = k;
        q.push(n);
      }
    }
    return null;
  }
  const canStand = (x, y) => MG.canStand(G, x, y, GAME.radius);
  const o = { MAP, G, path, canStand, step };
  navCache.set(mapId, o);
  return o;
}

// ───────── 봇 ─────────
// kit.client 위에 걷기·배회를 얹는다. bot.task(fn) 으로 할 일을 주면 배회를 멈추고 그 일을 한다.
export function makeBot(c, mapId) {
  const N = nav(mapId);
  const b = c;
  b.mapId = mapId;
  b.busy = false;
  b.stopWalk = false;
  b.anchor = null; // [x, y, r] 배회 중심
  b.speed = 1; // 1 = 보통 속도(270px/s 쯤)
  b.me = () => b.room && b.room.players.find((p) => p.id === b.id);
  b.pos = () => {
    const p = b.me();
    return p ? [p.x, p.y] : [b.x, b.y];
  };
  b.syncPos = () => {
    const p = b.me();
    if (p) (b.x = p.x), (b.y = p.y);
  };
  // 경로를 따라 걷기. 서버가 되돌리면(fix) 그 자리에서 다시 길을 찾는다.
  b.goTo = async (tx, ty, within = 20) => {
    for (let tries = 0; tries < 3; tries++) {
      const p = N.path(b.x, b.y, tx, ty, within);
      if (!p) return false;
      const f0 = b.fixes;
      const stride = 2; // 10px 격자 2칸 = 20px
      let fixed = false;
      for (let k = stride; k < p.length + stride - 1 && !b.stopWalk; k += stride) {
        const [nx, ny] = p[Math.min(k, p.length - 1)];
        const f = nx < b.x ? -1 : nx > b.x ? 1 : b.f || 1;
        b.f = f;
        b.x = nx;
        b.y = ny;
        b.send({ t: 'pos', x: b.x, y: b.y, f, m: 1 });
        await sleep(76 / b.speed);
        if (b.fixes !== f0) {
          fixed = true;
          break;
        }
      }
      b.send({ t: 'pos', x: b.x, y: b.y, f: b.f || 1, m: 0 });
      if (!fixed) return !b.stopWalk;
      await sleep(300);
    }
    return false;
  };
  b.faceTo = (x) => {
    b.f = x < b.x ? -1 : 1;
    b.send({ t: 'pos', x: b.x, y: b.y, f: b.f, m: 0 });
  };
  b.task = async (fn) => {
    b.stopWalk = true;
    while (b.wandering) await sleep(20);
    b.stopWalk = false;
    b.busy = true;
    try {
      return await fn(b);
    } finally {
      b.busy = false;
    }
  };
  // 배회: anchor 주변을 천천히 걸어 다닌다 (busy 가 아닐 때)
  b.loop = async () => {
    while (!b.dead) {
      if (b.busy || !b.anchor || !b.room || b.room.phase !== 'game' || (b.me() && b.me().frozen)) {
        await sleep(150);
        continue;
      }
      b.wandering = true;
      const [ax, ay, r] = b.anchor;
      let tx;
      let ty;
      for (let k = 0; k < 20; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r;
        tx = ax + Math.cos(a) * d;
        ty = ay + Math.sin(a) * d;
        if (N.canStand(tx, ty)) break;
      }
      const sp = b.speed;
      b.speed = 0.55 + Math.random() * 0.3;
      await b.goTo(tx, ty, 15);
      b.speed = sp;
      b.wandering = false;
      if (b.stopWalk) {
        await sleep(30);
        continue;
      }
      // 잠깐 멈춤
      const until = Date.now() + 400 + Math.random() * 1600;
      while (Date.now() < until && !b.stopWalk) await sleep(50);
    }
  };
  b.loop();
  return b;
}

export async function addBots(port, code, names, mapId, chars = []) {
  const bots = [];
  for (let i = 0; i < names.length; i++) {
    const c = await kit.joinAs(port, code, names[i]);
    if (chars[i]) c.send({ t: 'character', character: chars[i] });
    bots.push(makeBot(c, mapId));
    await sleep(120);
  }
  return bots;
}

// 봇의 퀴즈 풀기 (랜턴 앞에서)
export async function botSolve(b, terminal) {
  b.send({ t: 'open', terminal });
  const q = await b.next((m) => m.t === 'question' || m.t === 'error', 4000).catch(() => null);
  if (!q || q.t === 'error') return q ? q.code : 'timeout';
  await sleep(500 + Math.random() * 800);
  b.send({ t: 'answer', value: botAnswer(q) });
  const r = await b.next((m) => m.t === 'result', 4000).catch(() => null);
  return r && r.ok ? 'ok' : 'wrong';
}

// ───────── 브라우저 ─────────
let browser = null;
export async function launch(args = process.env.CAP_ARGS ? process.env.CAP_ARGS.split(' ') : ['--enable-unsafe-swiftshader']) {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...args, '--autoplay-policy=no-user-gesture-required'] });
  return browser;
}
export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
  convPage = null;
}

// 화면 안 도우미: 웹소켓 엿보기 + 내 위치 + 키보드 자동 걷기
const HOOK = () => {
  const W = window.WebSocket;
  window.__me = { x: 0, y: 0, at: 0, sentAt: 0 };
  window.__id = null;
  window.__events = [];
  window.__crates = [];
  window.__q = null;
  window.__info = null;
  class H extends W {
    constructor(...a) {
      super(...a);
      window.__ws = this;
      this.addEventListener('message', (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        const now = performance.now();
        if (m.t === 'joined' || (m.t === 'resumed' && m.id)) window.__id = m.id;
        if (m.t === 'state') {
          const r = m.p.find((x) => x[0] === window.__id);
          if (r && now - window.__me.sentAt > 400) Object.assign(window.__me, { x: r[1], y: r[2], at: now });
          return;
        }
        if (m.t === 'fix') Object.assign(window.__me, { x: m.x, y: m.y, at: now, sentAt: 0 });
        if (m.t === 'room') {
          window.__room = m;
          const p = m.players && m.players.find((x) => x.id === window.__id);
          if (p && now - window.__me.sentAt > 400) Object.assign(window.__me, { x: p.x, y: p.y, at: now });
        }
        if (m.t === 'me') window.__info = m;
        if (m.t === 'crates') window.__crates = m.crates || [];
        if (m.t === 'question') window.__q = m;
        if (m.t === 'event') {
          window.__events.push({ ...m, _at: now });
          if (m.kind === 'ride' && m.id === window.__id) Object.assign(window.__me, { x: m.to[0], y: m.to[1], at: now + m.ms, sentAt: 0 });
        }
        if (m.t === 'error') window.__events.push({ ...m, _at: now });
      });
    }
    send(d) {
      try {
        const m = JSON.parse(d);
        if (m.t === 'pos') Object.assign(window.__me, { x: m.x, y: m.y, at: performance.now(), sentAt: performance.now() });
      } catch {}
      super.send(d);
    }
  }
  window.WebSocket = H;
  const held = new Set();
  const key = (code, on) => {
    if (on === held.has(code)) return;
    if (on) held.add(code);
    else held.delete(code);
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  };
  window.__key = key;
  window.__release = () => {
    for (const c of [...held]) key(c, false);
  };
  // 터치 조이스틱 (태블릿 화면): 캔버스에 손가락(pointerType touch)을 대고 끈다
  const stick = { on: false, ox: 0, oy: 0 };
  const pe = (type, x, y) =>
    document.getElementById('game-canvas').dispatchEvent(
      new PointerEvent(type, { pointerId: 77, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: 1 }),
    );
  window.__stickDown = (x, y) => {
    stick.on = true;
    stick.ox = x;
    stick.oy = y;
    pe('pointerdown', x, y);
  };
  window.__stickMove = (dx, dy) => pe('pointermove', stick.ox + dx, stick.oy + dy);
  window.__stickUp = () => {
    if (stick.on) pe('pointerup', stick.ox, stick.oy);
    stick.on = false;
  };
  window.__walkStick = async (pts, opt = {}) => {
    const tol = opt.tol || 20;
    const t0 = performance.now();
    const R = opt.r || 70;
    const [sx, sy] = opt.at || [innerWidth * 0.3, innerHeight * 0.7];
    window.__stickDown(sx, sy);
    let i = 0;
    while (i < pts.length && performance.now() - t0 < (opt.timeout || 20000)) {
      const me = window.__me;
      let k = i;
      while (k < pts.length - 1 && Math.hypot(pts[k][0] - me.x, pts[k][1] - me.y) < 30) k++;
      i = k;
      const dx = pts[k][0] - me.x;
      const dy = pts[k][1] - me.y;
      const d = Math.hypot(dx, dy);
      if (k === pts.length - 1 && d < tol) break;
      const s = Math.min(1, Math.max(0.35, d / 60));
      window.__stickMove((dx / (d || 1)) * R * s, (dy / (d || 1)) * R * s);
      await new Promise((r) => setTimeout(r, 30));
    }
    if (!opt.keep) window.__stickUp();
    return [window.__me.x, window.__me.y];
  };
  // 경로(점 목록)를 따라 걷기. 위치는 마지막으로 보낸 pos 를 기준으로 (1초에 10번)
  window.__walk = async (pts, opt = {}) => {
    const tol = opt.tol || 22;
    const t0 = performance.now();
    let i = 0;
    let lastX = NaN;
    let lastY = NaN;
    let stillSince = performance.now();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    while (i < pts.length) {
      if (performance.now() - t0 > (opt.timeout || 20000)) break;
      const me = window.__me;
      // 가까운 점은 지나간 것으로 본다
      let k = i;
      while (k < pts.length - 1 && Math.hypot(pts[k][0] - me.x, pts[k][1] - me.y) < 28) k++;
      const [tx, ty] = pts[k];
      const dx = tx - me.x;
      const dy = ty - me.y;
      if (k === pts.length - 1 && Math.hypot(dx, dy) < tol) break;
      i = k;
      const th = 7;
      key('ArrowRight', dx > th);
      key('ArrowLeft', dx < -th);
      key('ArrowDown', dy > th);
      key('ArrowUp', dy < -th);
      await wait(25);
      // 막혔으면 옆으로 살짝 비켜 본다
      if (me.x !== lastX || me.y !== lastY) (lastX = me.x), (lastY = me.y), (stillSince = performance.now());
      else if (performance.now() - stillSince > 450) {
        window.__release();
        const side = Math.abs(dx) > Math.abs(dy) ? (Math.random() < 0.5 ? 'ArrowUp' : 'ArrowDown') : Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
        key(side, true);
        await wait(140);
        key(side, false);
        stillSince = performance.now();
      }
    }
    window.__release();
    return [window.__me.x, window.__me.y];
  };
};

export async function newPage({ w = 1600, h = 900, touch = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    hasTouch: touch,
    isMobile: touch,
    locale: 'ko-KR',
  });
  await ctx.addInitScript(HOOK);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGE ERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') log('console.error', m.text().slice(0, 200));
  });
  return page;
}

export async function shot(page, name, opt = {}) {
  const file = SHOTS + name + '.png';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!opt.clip && !opt.fullPage) {
    const [iw, ih] = await page.evaluate(() => [innerWidth, innerHeight]);
    const want = page.__view || page.viewportSize() && [page.viewportSize().width, page.viewportSize().height];
    if (want && (iw !== want[0] || ih !== want[1])) log('WARN shot size', name, iw, ih, 'wanted', want.join('x'));
  }
  await page.screenshot({ path: file, ...opt });
  log('SHOT', name);
  return file;
}

// 화면 크기 바꾸기. (이 크로미움에서는 playwright 의 setViewportSize 가 가끔 1264×625 처럼 틀린 크기가 되어 CDP 로 직접 정한다)
const cdpOf = new WeakMap();
async function cdpFor(page) {
  if (!cdpOf.has(page)) cdpOf.set(page, await page.context().newCDPSession(page));
  return cdpOf.get(page);
}
export async function setView(page, w, h, mobile = false) {
  const cdp = await cdpFor(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile, screenWidth: w, screenHeight: h });
  await sleep(400);
  const [iw, ih] = await page.evaluate(() => [innerWidth, innerHeight]);
  if (iw !== w || ih !== h) log('WARN view', iw, ih, 'wanted', w, h);
  page.__view = [w, h];
}
let convPage = null;
async function toPng(list, nameOf, out = null) {
  if (!convPage) {
    const ctx = await browser.newContext({ viewport: { width: 200, height: 200 } });
    convPage = await ctx.newPage();
  }
  for (let i = 0; i < list.length; i++) {
    const png = await convPage.evaluate(async ([b64, out]) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = out ? out[0] : img.naturalWidth;
      c.height = out ? out[1] : img.naturalHeight;
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    }, [list[i], out]);
    fs.writeFileSync(nameOf(i), Buffer.from(png, 'base64'));
  }
}
// 연속 장면 + 대표 정지 화면을 한 번에: 화면(1600×900 등)을 그대로 녹화해서
// 프레임은 out 크기(1280×720)로 줄여 저장하고, stillAt 초 프레임은 원래 크기 PNG(stillName)로 저장한다.
export async function seqStill(page, name, secs, during, { stillName = null, stillAt = 1, out = [1280, 720], fps = 12 } = {}) {
  const dir = SHOTS + 'seq/' + name + '/';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await cdpFor(page);
  const [vw, vh] = await page.evaluate(() => [innerWidth, innerHeight]);
  const frames = [];
  const onFrame = (f) => {
    frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: vw, maxHeight: vh, everyNthFrame: 1 });
  await sleep(300);
  const t0 = Date.now();
  const job = during ? during(t0) : null;
  await sleep(secs * 1000 + 120);
  await cdp.send('Page.stopScreencast');
  cdp.off('Page.screencastFrame', onFrame);
  if (job) await job;
  const near = (t) => frames.reduce((b, f) => (!b || Math.abs(f.ts - t) < Math.abs(b.ts - t) ? f : b), null);
  const n = Math.round(secs * fps);
  const picked = [];
  for (let i = 0; i < n; i++) picked.push(near(t0 + (i * 1000) / fps).data);
  await toPng(picked, (i) => dir + String(i + 1).padStart(4, '0') + '.png', out);
  if (stillName) await toPng([near(t0 + stillAt * 1000).data], () => SHOTS + stillName + '.png');
  const distinct = new Set(picked).size;
  log(`SEQ ${name}: ${n} frames ${out.join('x')} from ${vw}x${vh} (distinct ${distinct})${stillName ? ' + ' + stillName : ''}`);
  return { n, distinct };
}
// 연속 장면: fps 간격으로 찍는다 (CDP 빠른 캡처). 끝나면 실제 간격을 알려 준다.
export async function seq(page, name, secs, fps = 12, during = null) {
  const dir = SHOTS + 'seq/' + name + '/';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await cdpFor(page);
  const [vw, vh] = await page.evaluate(() => [innerWidth, innerHeight]);
  const clip = { x: 0, y: 0, width: vw, height: vh, scale: 1 };
  const n = Math.round(secs * fps);
  const gap = 1000 / fps;
  if (process.env.SEQ_MODE !== 'shot') {
    // 화면 녹화(screencast)로 프레임을 모두 받은 뒤, 1/fps 초 간격 시각에 가장 가까운 프레임을 고른다 (간격이 고르다)
    const frames = [];
    const onFrame = (f) => {
      frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: vw, maxHeight: vh, everyNthFrame: 1 });
    await sleep(300); // 녹화가 자리 잡을 때까지
    const t0 = Date.now();
    const job = during ? during() : null;
    await sleep(secs * 1000 + 120);
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', onFrame);
    if (job) await job;
    const picked = [];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const target = t0 + i * gap;
      let best = null;
      for (const f of frames) if (!best || Math.abs(f.ts - target) < Math.abs(best.ts - target)) best = f;
      picked.push(best.data);
      used.add(best);
    }
    const inWin = frames.filter((f) => f.ts >= t0 && f.ts <= t0 + secs * 1000);
    await toPng(picked, (i) => dir + String(i + 1).padStart(4, '0') + '.png');
    log(`SEQ ${name}: ${n} frames ${vw}x${vh} (screencast ${(inWin.length / secs).toFixed(1)} fps, distinct ${used.size})`);
    return { n, srcFps: inWin.length / secs, distinct: used.size };
  }
  const t0 = Date.now();
  const times = [];
  const writes = [];
  const job = during ? during() : null;
  for (let i = 0; i < n; i++) {
    const due = t0 + i * gap;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    times.push(Date.now() - t0);
    // 빠르게 찍으려고 JPEG(품질 95)로 받고, 다 찍은 뒤 PNG 로 바꾼다
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true, clip });
    writes.push(r.data);
  }
  if (job) await job;
  await toPng(writes, (i) => dir + String(i + 1).padStart(4, '0') + '.png');
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const avg = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  log(`SEQ ${name}: ${n} frames ${vw}x${vh}, avg gap ${avg.toFixed(1)}ms, max ${Math.max(...gaps)}ms`);
  return { n, avg, max: Math.max(...gaps) };
}

// 브라우저 "나"를 (tx,ty) 근처로 걷게 한다
export async function walkPage(page, mapId, tx, ty, within = 20, opt = {}) {
  const N = nav(mapId);
  const me = await page.evaluate(() => window.__me);
  const p = N.path(me.x, me.y, tx, ty, within);
  if (!p) {
    log('no path', me.x, me.y, '→', tx, ty);
    return null;
  }
  const pts = p.filter((_, i) => i % 3 === 0 || i === p.length - 1);
  if (opt.stick) return page.evaluate(([pts, opt]) => window.__walkStick(pts, opt), [pts, opt]);
  return page.evaluate(([pts, opt]) => window.__walk(pts, opt), [pts, opt]);
}
export const myPos = (page) => page.evaluate(() => [window.__me.x, window.__me.y]);
export const press = async (page, code, ms = 60) => {
  await page.evaluate((c) => window.__key(c, true), code);
  await sleep(ms);
  await page.evaluate((c) => window.__key(c, false), code);
};
// 봇 선생님 + 봇 7 + 브라우저 학생("하늘") 판 준비 → 시작. wantRole: 브라우저가 맡을 역할 (맞을 때까지 다시 시작)
// pick: (꿈도둑을 찾아라) 선생님이 몰래 정할 꿈도둑 — 'me' 또는 봇 번호 목록
export async function studentGame({ port, page, map, settings, wantRole = 'student', pick = null, myChar = 'cat', botN = 7, onLoading = null }) {
  const T = await kit.teacherOf(port);
  T.send({ t: 'questions', set: QSET });
  await T.next((m) => m.t === 'room' && m.qset);
  T.send({ t: 'settings', map, ...settings });
  await T.next((m) => m.t === 'room' && m.settings.map === map);
  const bots = await addBots(port, T.code, NAMES.slice(1, 1 + botN), map, CHARS.slice(1, 1 + botN));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.fill('#join-code', T.code);
  await page.fill('#join-name', NAMES[0]);
  await page.click('#join-form button[type=submit]');
  await page.waitForSelector('#view-student:not([hidden])');
  const myId = await page.evaluate(() => window.__id);
  await page.click(`#s-picker [data-kind="${myChar}"]`);
  await sleep(600);
  if (pick) {
    const ids = pick.map((k) => (k === 'me' ? myId : bots[k].id));
    T.send({ t: 'pickChasers', ids });
    await T.next((m) => m.t === 'picked');
  }
  const roleOf = (id) => T.room.players.find((p) => p.id === id).role;
  for (let tries = 0; tries < 12; tries++) {
    T.clear();
    T.send({ t: 'start' });
    await T.next((m) => m.t === 'room' && m.phase === 'game');
    await page.waitForSelector('#g-loading:not([hidden])', { timeout: 5000 }).catch(() => {});
    if (onLoading) await onLoading(tries);
    if (!wantRole || roleOf(myId) === wantRole) break;
    log('role', roleOf(myId), '→ restart');
    T.send({ t: 'end' });
    await T.next((m) => m.t === 'room' && m.phase === 'lobby');
    await sleep(800);
  }
  await sleep(300);
  for (const b of bots) b.syncPos();
  const chasers = bots.filter((b) => roleOf(b.id) === 'chaser');
  const students = bots.filter((b) => roleOf(b.id) !== 'chaser');
  return { T, bots, myId, chasers, students, roleOf };
}
export async function waitIntroGone(page) {
  await page.waitForSelector('#g-intro:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('#g-intro', { state: 'hidden', timeout: 9000 }).catch(() => {});
}

// 토스트·큰 글씨·소식 띠가 모두 사라질 때까지 기다린다
export async function waitClear(page, max = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const busy = await page.evaluate(
      () => document.getElementById('toast').classList.contains('show') || !document.getElementById('g-big').hidden || !document.getElementById('g-alert').hidden,
    );
    if (!busy) return true;
    await sleep(150);
  }
  return false;
}
// 토스트(안내 띠)가 사라질 때까지 기다린다
export async function waitNoToast(page, max = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const on = await page.evaluate(() => document.getElementById('toast').classList.contains('show'));
    if (!on) return true;
    await sleep(100);
  }
  return false;
}
