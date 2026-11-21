// 맵 충돌 점검 도구.
//   node tools/map-check.mjs                    → 글로 된 점검 결과 (가구별 그림·막힘 영역, 좁은 틈, 도달 가능성)
//   node tools/map-check.mjs --png 파일.png      → 점검 그림도 찍는다 (설치된 크롬/엣지를 화면 없이 띄워서)
//   --before 폴더                                 → 그 폴더의 mapgrid.js·config.js·maprender.js·<맵>.json 사본으로 점검 (고치기 전 비교용)
//   --map monster-gym                             → 맵 id (기본 monster-gym)
//   --overview                                    → (--png 와 같이) 점검 그림 대신 층 한눈에 보기 미리보기 그림 (1600×1000)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const mapId = opt('--map') || 'monster-gym';
const beforeDir = opt('--before') ? path.resolve(opt('--before')) : null;
const pngOut = opt('--png') ? path.resolve(opt('--png')) : null;

const gridFile = beforeDir ? path.join(beforeDir, 'mapgrid.js') : path.join(ROOT, 'shared', 'mapgrid.js');
const cfgFile = beforeDir ? path.join(beforeDir, 'config.js') : path.join(ROOT, 'shared', 'config.js');
const mapFile = beforeDir ? path.join(beforeDir, mapId + '.json') : path.join(ROOT, 'maps', mapId + '.json');
const G = await import(pathToFileURL(gridFile).href);
const { GAME } = await import(pathToFileURL(cfgFile).href);
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const g = G.buildGrid(map);
const r = GAME.radius;

// ── 1. 가구별: 그림 영역 대비 막힌 영역, 사방의 보이지 않는 여유 ──
const foot = (f) => (g.foots ? g.foots[map.furniture.indexOf(f)] : f.rect);
console.log(`[${beforeDir ? '고치기 전' : '현재'}] ${map.name} — 캐릭터 발 반지름 ${r}px, 가구 ${map.furniture.length}개`);
console.log('가구 이름 | 그림 [x,y,w,h] | 막힘 [x,y,w,h] | 막힘/그림 넓이 | 발이 멈추는 곳(그림 바깥으로 위·아래·왼쪽·오른쪽 px)');
for (const f of map.furniture) {
  const [x, y, w, h] = f.rect;
  const b = foot(f);
  const ratio = (b[2] * b[3]) / (w * h);
  // 발 중심이 멈추는 선이 그림 가장자리에서 얼마나 바깥인가 (+ 면 그림 밖에서 멈춤 = 보이지 않는 벽)
  const ry = G.footHalfHeight ? G.footHalfHeight(r) : r;
  const top = y - (b[1] - ry);
  const bottom = b[1] + b[3] + ry - (y + h);
  const left = x - (b[0] - r);
  const right = b[0] + b[2] + r - (x + w);
  console.log(`${f.name.padEnd(8)} | ${JSON.stringify(f.rect)} | ${JSON.stringify(b)} | ${(ratio * 100).toFixed(0)}% | ${top}·${bottom}·${left}·${right}`);
}

// ── 2. 점검 (새 mapgrid 의 inspectMap / validateMap) ──
if (G.inspectMap) {
  const found = G.inspectMap(map, g, r);
  console.log(`\n좁은 틈·보이지 않는 벽 점검: ${found.length ? found.length + '곳' : '문제 없음'}`);
  for (const p of found) console.log(' - ' + p.text);
}
const problems = G.validateMap(map, g, r);
console.log(`\n맵 검사(도달 가능성 포함): ${problems.length ? problems.length + '건' : '문제 없음'}`);
for (const p of problems) console.log(' - ' + p);

// ── 3. 점검 그림 ──
if (pngOut) await shoot();

async function shoot() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  const mounts = [
    ['/before/', beforeDir],
    ['/shared/', path.join(ROOT, 'shared')],
    ['/maps/', path.join(ROOT, 'maps')],
    ['/tools/', path.join(ROOT, 'tools')],
    ['/', path.join(ROOT, 'client')],
  ].filter((m) => m[1]);
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const m = mounts.find(([pre]) => p.startsWith(pre));
    const file = path.resolve(m[1], '.' + p.slice(m[0].length - 1));
    fs.readFile(file, (err, data) => {
      if (err || !file.startsWith(m[1])) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  // --overview: 점검 그림 대신 여러 층 한눈에 보기(선생님 맵 고르기 미리보기와 같은 그림)를 1600×1000 으로 찍는다
  const overview = args.includes('--overview');
  const [shotW, shotH] = overview ? [1600, 1000] : map.size;
  const url = `http://127.0.0.1:${srv.address().port}/tools/map-check.html?map=${mapId}${beforeDir ? '&src=before' : ''}${overview ? `&view=overview&w=${shotW}&h=${shotH}` : ''}`;
  const browsers = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const exe = browsers.find((b) => fs.existsSync(b));
  if (!exe) {
    console.log('크롬/엣지를 찾지 못해 그림은 못 찍었어요. 직접 열어 보기: ' + url);
    srv.close();
    return;
  }
  fs.mkdirSync(path.dirname(pngOut), { recursive: true });
  const profile = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'mapcheck-'));
  await new Promise((ok) => {
    const p = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, `--window-size=${shotW},${shotH}`, '--virtual-time-budget=8000', `--screenshot=${pngOut}`, url], { stdio: 'ignore' });
    p.on('exit', ok);
  });
  srv.close();
  console.log(fs.existsSync(pngOut) ? `\n점검 그림: ${pngOut}` : '\n점검 그림을 찍지 못했어요: ' + url);
}
