// 선생님 화면 캡처 (브라우저 = 선생님, 학생 8명은 봇). 한밤의 놀이공원 · 잠귀신 술래잡기.
// 사용: node teacher.mjs
import * as L from './lib.mjs';
const { sleep, log, shot } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3706);
const srv = await L.server(PORT, { fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] }, fogCenter: 0 });
await L.launch();
const page = await L.newPage();
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
  const URL = `http://127.0.0.1:${PORT}/teacher/`;
  await page.goto(URL);
  await sleep(1500);
  await shot(page, 't_home');

  // 문제 넣기: 영상용 문제 세트를 초안으로 넣어 둔다 (엑셀을 올린 것과 같은 모습)
  await step('questions', async () => {
    await page.evaluate((qs) => {
      const rows = qs.questions.map((q) => ({ q: q.q, a: q.a, wrong: [0, 1, 2].map((k) => (q.wrong || [])[k] || ''), alts: '' }));
      localStorage.setItem('sg-qdraft', JSON.stringify({ title: qs.title, rows }));
    }, L.QSET);
    await page.reload();
    await sleep(1500);
    await shot(page, 't_questions');
    // AI 요청문 팝업도 한 장
    await page.click('#ts-prompt');
    await sleep(800);
    await shot(page, 't_ai_prompt');
    await page.keyboard.press('Escape');
    await sleep(500);
  });

  await step('settings', async () => {
    // 놀이 방법 + 맵 + 자세히 설정
    await page.click(`#ts-maps [data-id="${MAP}"], #ts-maps [data-map="${MAP}"]`).catch(async () => {
      const cards = await page.$$('#ts-maps > *');
      for (const c of cards) if ((await c.textContent()).includes('놀이공원')) await c.click();
    });
    await page.evaluate(() => (document.getElementById('ts-more').open = true));
    await sleep(500);
    await page.evaluate(() => document.getElementById('ts-h-mode').scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -20));
    await sleep(600);
    await shot(page, 't_setup_modes'); // 첫 화면 ② 놀이 방법 + ③ 맵 위쪽
    await page.evaluate(() => document.getElementById('ts-more').scrollIntoView({ block: 'end' }));
    await page.evaluate(() => window.scrollBy(0, 20));
    await sleep(600);
    await shot(page, 't_setup_more'); // 첫 화면 ④ 자세히 설정 (잠귀신 수·속도·랜턴 수·시간 등)
    await page.evaluate(() => document.getElementById('ts-h-map').scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -20));
    await sleep(800);
    await shot(page, 't_maps');
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
  });

  // 방 만들기 → 대기방
  let code;
  await step('lobby', async () => {
    await page.click('#ts-create');
    await page.waitForSelector('#view-teacher:not([hidden])', { timeout: 8000 });
    code = await page.evaluate(() => document.getElementById('t-code').textContent.trim());
    log('room', code);
    bots = await L.addBots(PORT, code, L.NAMES.slice(0, 8), MAP, ['cat', ...L.CHARS.slice(1, 8)]);
    await sleep(1800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 't_lobby');
    await shot(page, 't_lobby_full', { fullPage: true });
    // 대기방의 '설정 바꾸기'를 펼치면 모드·맵·잠귀신 수·시간이 한 곳에
    await page.evaluate(() => (document.querySelector('#view-teacher details.t-more').open = true));
    await sleep(600);
    await shot(page, 't_settings');
    await page.evaluate(() => (document.querySelector('#view-teacher details.t-more').open = false));
    await sleep(300);
  });

  // 게임 시작 → 진행 화면
  await step('live', async () => {
    await page.click('#t-start');
    await page.waitForSelector('#view-game:not([hidden])', { timeout: 8000 });
    await sleep(800);
    await shot(page, 't_loading');
    await sleep(3500);
    for (const b of bots) b.syncPos();
    const terms = L.nav(MAP).MAP.terminals;
    const room = () => bots[0].room;
    const roleOf = (b) => room().players.find((p) => p.id === b.id).role;
    // 학생 봇은 랜턴을 켜러 흩어지고(가끔 틀린다), 잠귀신 봇은 광장을 돈다
    let stop = false;
    for (const [i, b] of bots.entries()) {
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
          if (Math.random() < 0.45) {
            // 틀린 답 한 번 (리포트에 정답률이 보이게)
            const wrong = q.kind === 'short' ? '모름' : q.choices.findIndex((c) => c !== L.answerOf(q.text));
            bb.send({ t: 'answer', value: wrong });
            const r = await bb.next((m) => m.t === 'result', 4000).catch(() => null);
            await sleep((r && r.lockMs ? r.lockMs : 5000) + 300);
          }
          bb.send({ t: 'answer', value: L.botAnswer(q) });
          await bb.next((m) => m.t === 'result', 4000).catch(() => null);
          await sleep(400);
        }
        bb.anchor = [1600, 1250, 400];
      });
    }
    await sleep(14000);
    await page.click('#g-tmenu-btn');
    await sleep(400);
    await page.click('#g-reveal');
    await sleep(600);
    await shot(page, 't_live_menu');
    await page.click('#g-tmenu-btn');
    await sleep(1500);
    await shot(page, 't_live');
    await sleep(20000);
    await shot(page, 't_live_2');
    // 퀴즈 리포트
    await page.click('#g-tmenu-btn');
    await sleep(300);
    await page.click('#g-report');
    await page.waitForSelector('#dlg-report[open]', { timeout: 5000 });
    await sleep(1200);
    await shot(page, 't_report');
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
