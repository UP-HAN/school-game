// 한 번에 렌더: 사건 뽑기 → 음악·효과음 합성 → 프레임 캡처(ffmpeg 로 바로 인코딩) → mp4 (H.264 + AAC, 1920x1080, 30fps)
// 사용: node render.mjs demo --q "cut=reel" --out output/demo.mp4 [--fps 30] [--from 초 --to 초] [--noaudio]
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { args, open, info, WORK, HERE } from './_common.mjs';
import { makeAudio } from './audio.mjs';
const A = args();
const FPS = +(A.fps || 30);
const out = path.resolve(HERE, A.out || `output/${A.tag}.mp4`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const { browser, page } = await open(A.name, A.q);
const d = await info(page);
fs.writeFileSync(path.join(WORK, `events_${A.tag}.json`), JSON.stringify(d, null, 1));
const mix = A.noaudio ? null : makeAudio(A.tag);
const t0 = +(A.from || 0), t1 = Math.min(d.total, +(A.to || d.total));
const n = Math.round((t1 - t0) * FPS);
const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
if (mix) ffArgs.push('-ss', String(t0), '-t', String(t1 - t0), '-i', mix);
ffArgs.push('-map', '0:v', ...(mix ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k'] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', '-shortest', out);
const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
const started = Date.now();
for (let f = 0; f < n; f++) {
  await page.evaluate(t => seek(t), t0 + f / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 150 === 0) console.log(`frame ${f}/${n}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
const code = await new Promise(r => ff.on('close', r));
await browser.close();
console.log(code === 0 ? `done ${out}  (${(t1 - t0).toFixed(2)}s, ${n} frames, ${((Date.now() - started) / 1000).toFixed(0)}s 걸림)` : `ffmpeg 실패 code=${code}`);
