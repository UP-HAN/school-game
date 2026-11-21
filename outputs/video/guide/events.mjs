// 구성 파일에서 사건(효과음) 시각·길이·BPM·분위기를 뽑아 work/events_<tag>.json 으로 저장
// 사용: node events.mjs demo [--q "cut=reel"] [--tag 이름]
import fs from 'fs';
import path from 'path';
import { args, open, info, WORK } from './_common.mjs';
const A = args();
const { browser, page } = await open(A.name, A.q);
const d = await info(page);
const out = path.join(WORK, `events_${A.tag}.json`);
fs.writeFileSync(out, JSON.stringify(d, null, 1));
console.log(`${out}\n  ${d.events.length} events, ${d.total.toFixed(2)}s, ${d.bpm} BPM, mood=${d.mood}, scenes=${d.scenes.length}`);
await browser.close();
