// 장면표(콘택트 시트): 장면마다 1장씩 480x270 으로 붙여 work/sheet_<tag>.jpg
// 사용: node preview.mjs demo [--q "cut=reel"]
// sharp 는 새로 설치하지 않고, 이미 있는 다른 작업 폴더의 것을 경로로 불러 쓴다. 없으면 ffmpeg tile 로 대신한다.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { args, open, info, WORK } from './_common.mjs';
const require = createRequire(import.meta.url);
const A = args();
const SHARP = 'C:/Users/hanui/OneDrive/Desktop/Workspace_backup/Car_Racing/art/tools/node_modules/sharp';
const { browser, page } = await open(A.name, A.q);
const d = await info(page);
const tmp = path.join(WORK, `_sheet_${A.tag}`); fs.mkdirSync(tmp, { recursive: true });
const files = [];
for (const s of d.scenes) {
  const len = s.end - s.start;
  await page.evaluate(t => seek(t), s.start + (s.thumbs ? s.thumbs[0] : Math.min(len - 0.3, len * 0.7)));
  const f = path.join(tmp, `${String(s.no).padStart(2, '0')}.jpg`); files.push([f, s]);
  await page.screenshot({ path: f, type: 'jpeg', quality: 80 });
}
await browser.close();
const out = path.join(WORK, `sheet_${A.tag}.jpg`);
const cols = 4, rows = Math.ceil(files.length / cols);
if (fs.existsSync(SHARP)) {
  const sharp = require(SHARP);
  const tiles = await Promise.all(files.map(async ([f, s]) => sharp(f).resize(480, 270).composite([{ input: Buffer.from(`<svg width="480" height="40"><rect width="480" height="40" fill="rgba(0,0,0,.65)"/><text x="10" y="28" font-size="22" font-family="Malgun Gothic" fill="#ffc247">${s.no}. ${s.name.replace(/[<&]/g, '')} (${s.bars}마디, ${s.trans})</text></svg>`), top: 230, left: 0 }]).toBuffer()));
  await sharp({ create: { width: 480 * cols, height: 270 * rows, channels: 3, background: '#111' } }).composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 480, top: Math.floor(i / cols) * 270 }))).jpeg({ quality: 84 }).toFile(out);
} else {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(tmp, '%02d.jpg'), '-vf', `scale=480:270,tile=${cols}x${rows}`, '-frames:v', '1', out]);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out, `total ${d.total.toFixed(1)}s, ${d.scenes.length} scenes, ${d.events.length} events`, JSON.stringify(d.sections));
