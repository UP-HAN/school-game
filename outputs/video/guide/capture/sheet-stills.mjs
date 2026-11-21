// 확인용: 정지 화면 여러 장을 한 장에 4칸씩 붙인다 (결과는 임시 폴더). 사용: node sheet-stills.mjs 출력.png 이름 [이름...]
import fs from 'node:fs';
import * as L from './lib.mjs';
const [out, ...names] = process.argv.slice(2);
await L.launch();
const page = await L.newPage({ w: 400, h: 300 });
const items = names.map((n) => ({ n, src: 'data:image/png;base64,' + fs.readFileSync(L.SHOTS + n + '.png').toString('base64') }));
const png = await page.evaluate(async (items) => {
  const W = 480;
  const H = 270;
  const cols = 4;
  const rows = Math.ceil(items.length / cols);
  const c = document.createElement('canvas');
  c.width = W * cols;
  c.height = (H + 20) * rows;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  for (const [i, it] of items.entries()) {
    const im = new Image();
    im.src = it.src;
    await im.decode();
    const k = Math.min((W - 4) / im.naturalWidth, H / im.naturalHeight);
    const cx = (i % cols) * W;
    const cy = Math.floor(i / cols) * (H + 20) + 20;
    x.drawImage(im, cx, cy, im.naturalWidth * k, im.naturalHeight * k);
    x.fillStyle = '#fff';
    x.font = '15px sans-serif';
    x.fillText(it.n, cx + 4, cy - 5);
  }
  return c.toDataURL('image/png').split(',')[1];
}, items);
fs.writeFileSync(out, Buffer.from(png, 'base64'));
await L.closeBrowser();
process.exit(0);
