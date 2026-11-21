// 확인용 모아 보기: 연속 장면마다 몇 장을 골라 한 장으로 붙인다 (결과는 임시 폴더). 사용: node sheet.mjs 출력.png 이름 [이름...]
import fs from 'node:fs';
import * as L from './lib.mjs';
const [out, ...names] = process.argv.slice(2);
await L.launch();
const page = await L.newPage({ w: 400, h: 300 });
const rows = [];
for (const n of names) {
  const dir = L.SHOTS + 'seq/' + n + '/';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const pick = [0, 0.25, 0.5, 0.75, 1].map((k) => files[Math.round(k * (files.length - 1))]);
  rows.push({ n, imgs: pick.map((f) => 'data:image/png;base64,' + fs.readFileSync(dir + f).toString('base64')), labels: pick });
}
const png = await page.evaluate(async (rows) => {
  const W = 384;
  const H = 216;
  const c = document.createElement('canvas');
  c.width = W * 5;
  c.height = (H + 20) * rows.length;
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  for (const [r, row] of rows.entries())
    for (const [i, src] of row.imgs.entries()) {
      const im = new Image();
      im.src = src;
      await im.decode();
      x.drawImage(im, i * W, r * (H + 20) + 20, W - 4, H);
      x.fillStyle = '#fff';
      x.font = '14px sans-serif';
      x.fillText(row.n + ' ' + row.labels[i], i * W + 4, r * (H + 20) + 15);
    }
  return c.toDataURL('image/png').split(',')[1];
}, rows);
fs.writeFileSync(out, Buffer.from(png, 'base64'));
await L.closeBrowser();
process.exit(0);
