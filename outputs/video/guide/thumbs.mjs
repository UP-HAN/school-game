// 장면마다 1~2장 썸네일 → work/<tag>_thumbs/NN_a.jpg, NN_b.jpg
// 사용: node thumbs.mjs demo [--q "cut=reel"] [--out work/demo_thumbs] [--at 12.5,30]  (--at 이면 그 시각만)
// 기본 시각: 장면 길이의 45% 와 85% (scene 에 thumbs:[장면 안 초,...] 를 주면 그 시각)
import fs from 'fs';
import path from 'path';
import { args, open, info, WORK, HERE } from './_common.mjs';
const A = args();
const dir = A.out ? path.resolve(HERE, A.out) : path.join(WORK, `${A.tag}_thumbs`);
fs.mkdirSync(dir, { recursive: true });
const { browser, page } = await open(A.name, A.q);
const d = await info(page);
const shots = [];
if (A.at) String(A.at).split(',').forEach((t, i) => shots.push([`t_${(+t).toFixed(2)}`, +t]));
else for (const s of d.scenes) {
  const len = s.end - s.start, ts = s.thumbs || [len * 0.45, len * 0.85];
  ts.forEach((lt, k) => shots.push([`${String(s.no).padStart(2, '0')}_${'abc'[k]}`, s.start + Math.min(lt, len - 0.05)]));
}
for (const [nm, t] of shots) {
  await page.evaluate(t => seek(t), t);
  await page.screenshot({ path: path.join(dir, nm + '.jpg'), type: 'jpeg', quality: 82 });
}
fs.writeFileSync(path.join(dir, 'index.txt'), d.scenes.map(s => `${String(s.no).padStart(2, '0')}  ${s.start.toFixed(2)}-${s.end.toFixed(2)}s  ${s.bars}마디  전환:${s.trans}  ${s.name}`).join('\n'));
console.log(`${shots.length} thumbs → ${dir}  (total ${d.total.toFixed(1)}s, ${d.scenes.length} scenes, ${d.events.length} events)`);
await browser.close();
