// 홍보글(게시판)에 붙일 그림 찍기. 1920×1080.
// 선생님 화면(브라우저) + 학생 화면(브라우저 "하늘") + 학생 봇 8명. 한밤의 놀이공원 · 잠귀신 술래잡기 · 예시 문제 30개.
// 사용(이 폴더에서):  SHOTS=<저장 폴더>/ node post.mjs      (SHOTS 를 비우면 ../shots/ 에 저장)
import * as L from './lib.mjs';
const { sleep, log, shot } = L;
const { EXAMPLES } = await import('file:///' + L.CODE + 'client/examples.js');
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3712);
const answerOf = (text) => (EXAMPLES.find((q) => q.q === text) || {}).a;
const srv = await L.server(PORT, { fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] }, fogCenter: 0 });
await L.launch();
const page = await L.newPage({ w: 1920, h: 1080 });
const stu = await L.newPage({ w: 1920, h: 1080 });
for (const p of [page, stu]) p.on('dialog', (d) => d.accept().catch(() => {}));
const fails = [];
let bots = [];
const step = async (name, fn) => {
  try {
    log('▶', name);
    await fn();
  } catch (e) {
    log('✖', name, e.stack || e.message);
    fails.push(name + ': ' + e.message);
  }
};
try {
  await page.goto(`http://127.0.0.1:${PORT}/teacher/`);
  await sleep(1500);
  await step('questions', async () => {
    await page.click('#ts-example');
    await sleep(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);
    await shot(page, '2_선생님_문제넣기');
    await page.click(`#ts-maps [data-id="${MAP}"], #ts-maps [data-map="${MAP}"]`).catch(async () => {
      for (const c of await page.$$('#ts-maps > *')) if ((await c.textContent()).includes('놀이공원')) await c.click();
    });
    await page.evaluate(() => document.getElementById('ts-h-mode').scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -20));
    await sleep(700);
    await shot(page, '2b_선생님_놀이방법_맵');
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  let code;
  await step('lobby', async () => {
    await page.click('#ts-create');
    await page.waitForSelector('#view-teacher:not([hidden])', { timeout: 8000 });
    code = await page.evaluate(() => document.getElementById('t-code').textContent.trim());
    log('room', code);
    // 학생 화면: 방 번호와 이름 쓰기
    await stu.goto(`http://127.0.0.1:${PORT}/`);
    await sleep(1500);
    await stu.fill('#join-code', code);
    await stu.fill('#join-name', '하늘');
    await sleep(500);
    await shot(stu, '3_학생_입장');
    await stu.click('#join-form button[type=submit]');
    bots = await L.addBots(PORT, code, L.NAMES.slice(1, 9), MAP, L.CHARS);
    await sleep(2000);
    await shot(stu, '3b_학생_대기방');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '3c_선생님_대기방');
  });

  await step('live', async () => {
    await page.click('#t-start');
    await page.waitForSelector('#view-game:not([hidden])', { timeout: 8000 });
    await sleep(4500);
    for (const b of bots) b.syncPos();
    const terms = L.nav(MAP).MAP.terminals;
    const room = () => bots[0].room;
    const roleOf = (b) => room().players.find((p) => p.id === b.id).role;
    let stop = false;
    for (const b of bots) {
      if (roleOf(b) === 'chaser') {
        b.anchor = [1600, 1250, 500];
        continue;
      }
      b.task(async (bb) => {
        const order = [...terms].sort(() => Math.random() - 0.5);
        for (const t of order) {
          if (stop) break;
          if (!(await bb.goTo(t.pos[0], t.pos[1], 60))) continue;
          bb.send({ t: 'open', terminal: t.id });
          const q = await bb.next((m) => m.t === 'question' || m.t === 'error', 4000).catch(() => null);
          if (!q || q.t === 'error') continue;
          await sleep(700);
          const a = answerOf(q.text);
          if (Math.random() < 0.45) {
            const wrong = q.kind === 'short' ? '모름' : q.choices.findIndex((c) => c !== a);
            bb.send({ t: 'answer', value: wrong });
            const r = await bb.next((m) => m.t === 'result', 4000).catch(() => null);
            await sleep((r && r.lockMs ? r.lockMs : 5000) + 300);
          }
          bb.send({ t: 'answer', value: q.kind === 'short' ? a : q.choices.indexOf(a) });
          await bb.next((m) => m.t === 'result', 4000).catch(() => null);
          await sleep(400);
        }
        bb.anchor = [1600, 1250, 400];
      });
    }
    await sleep(3000);
    await shot(stu, '6_학생_게임화면');
    await sleep(11000);
    await page.click('#g-tmenu-btn');
    await sleep(400);
    await page.click('#g-reveal');
    await sleep(600);
    await page.click('#g-tmenu-btn');
    await sleep(1500);
    await shot(page, '4_선생님_실시간중계');
    await shot(stu, '6b_학생_게임화면');
    await sleep(25000);
    await shot(page, '4b_선생님_실시간중계');
    await shot(stu, '6c_학생_게임화면');
    await sleep(25000);
    await page.click('#g-tmenu-btn');
    await sleep(300);
    await page.click('#g-report');
    await page.waitForSelector('#dlg-report[open]', { timeout: 5000 });
    await sleep(1200);
    await shot(page, '5_결과_문제별정답률');
    stop = true;
  });
} catch (e) {
  log('FATAL', e.stack || e.message);
  fails.push('fatal: ' + e.message);
} finally {
  log('FAILS', JSON.stringify(fails));
  for (const b of bots) b.dead = true;
  await L.closeBrowser();
  await srv.stop();
  process.exit(0);
}
