// 안내 페이지(guide.html)와 안내 영상(.mp4) 내려 주기 시험. 실행: node server/test-guide.js
// 영상은 'Range'(일부만 달라는 요청)를 받아야 아이패드·사파리에서 재생된다.
import { makeChecker, startServer, runAll } from './testkit.js';

const T = makeChecker('안내 페이지·영상');
const { check } = T;

async function run(port, base) {
  const srv = await startServer(port, {}, base ? { BASE_PATH: base } : {});
  const url = (p) => `http://127.0.0.1:${port}${base}${p}`;
  const tag = base ? `[${base}] ` : '';
  try {
    const page = await fetch(url('/guide.html'));
    const html = await page.text();
    check(`${tag}guide.html 이 열리고 영상 3개를 가리킨다`, page.status === 200 && ['promo', 'teacher', 'student'].every((n) => html.includes(`./guide/${n}.mp4`)));
    for (const n of ['promo', 'teacher', 'student']) {
      const head = await fetch(url(`/guide/${n}.mp4`), { method: 'HEAD' });
      const size = Number(head.headers.get('content-length'));
      check(`${tag}${n}.mp4: video/mp4, 크기를 알려 주고 Range 를 받는다고 알린다`, head.status === 200 && head.headers.get('content-type') === 'video/mp4' && size > 100000 && head.headers.get('accept-ranges') === 'bytes', `${head.status} ${size}`);
      const part = await fetch(url(`/guide/${n}.mp4`), { headers: { Range: 'bytes=1000-1999' } });
      const body = await part.arrayBuffer();
      check(`${tag}${n}.mp4: 일부 요청 → 206, 딱 그만큼만`, part.status === 206 && body.byteLength === 1000 && part.headers.get('content-range') === `bytes 1000-1999/${size}`, `${part.status} ${body.byteLength} ${part.headers.get('content-range')}`);
      const tail = await fetch(url(`/guide/${n}.mp4`), { headers: { Range: 'bytes=-500' } });
      check(`${tag}${n}.mp4: 끝에서 500바이트 요청`, tail.status === 206 && (await tail.arrayBuffer()).byteLength === 500 && tail.headers.get('content-range') === `bytes ${size - 500}-${size - 1}/${size}`);
      const over = await fetch(url(`/guide/${n}.mp4`), { headers: { Range: `bytes=${size + 10}-` } });
      check(`${tag}${n}.mp4: 파일보다 뒤를 달라고 하면 416`, over.status === 416);
    }
    const none = await fetch(url('/guide/none.mp4'));
    check(`${tag}없는 영상은 404`, none.status === 404);
    const up = await fetch(url('/guide/..%2F..%2Fserver%2Findex.mp4'));
    check(`${tag}폴더 밖은 내려 주지 않는다`, up.status === 404);
  } finally {
    await srv.stop();
  }
}

runAll(T, [() => run(3297, ''), () => run(3298, '/lantern')], 60000);
