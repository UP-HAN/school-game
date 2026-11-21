// 꿈도둑을 찾아라 (mafia) 캡처. 한밤의 놀이공원, 8명 판 (브라우저 "하늘" + 봇 7), 선생님이 꿈도둑을 1명만 몰래 정한다.
// 판 A: 내가 꿈도둑 (역할 안내 · 작전 메뉴 · 꿈에 빠뜨리기)
// 판 C: 내가 학생, 봇 꿈도둑이 나를 꿈에 빠뜨린다 (학생 역할 안내 · 꿈에 빠진 모습)
// 판 B: 내가 학생, 회의 종 → 모닥불 회의 → 지목 → 추방 → 학생 승리
// 사용: node mafia.mjs [A] [C] [B]
import * as L from './lib.mjs';
const { sleep, log, shot } = L;
const MAP = 'night-park';
const PORT = Number(process.env.PORT || 3705);
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const srv = await L.server(PORT, {
  // 기다리는 시간만 줄인다 (규칙은 그대로)
  mafia: { freezeGraceMs: 7000, sabotageGraceMs: 7000, buttonGraceMs: 7000, discussMs: 9000, voteMs: 20000, resultMs: 4500 },
  loot: { dropsAt: [0.9] },
  fog: { stages: [{ at: 0.85, shrinkMs: 40000 }, { at: 0.92, shrinkMs: 30000 }, { at: 0.97, shrinkMs: 10000 }] },
  fogCenter: 0,
});
await L.launch();
const fails = [];
const SETTINGS = { mode: 'mafia', minutes: 10, meetings: 3, reveal: true, missions: 5 };
const BELL = [1900, 1120];
let page;
async function game(pick, fn, name) {
  page = await L.newPage();
  let bots = [];
  try {
    const g = await L.studentGame({
      port: PORT,
      page,
      map: MAP,
      settings: SETTINGS,
      wantRole: null,
      pick,
      onLoading: async () => {
        await sleep(1200);
      },
    });
    bots = g.bots;
    await fn(g);
  } catch (e) {
    log('✖', name, e.stack || e.message);
    fails.push(name + ': ' + e.message);
    await shot(page, '_fatal_mafia_' + name).catch(() => {});
  } finally {
    for (const b of bots) {
      b.dead = true;
      b.ws.close();
    }
    await page.context().close();
  }
}

// ── 판 A: 내가 꿈도둑 ──
if (want('A'))
  await game(['me'], async ({ T, bots, myId }) => {
    // 로딩 3.5초 뒤 역할 안내가 5초 뜬다
    await page.waitForSelector('#g-intro:not([hidden])', { timeout: 9000 });
    await sleep(900);
    await shot(page, 'm_role_thief');
    const [mx, my] = await L.myPos(page);
    bots.forEach((b, i) => (b.anchor = [mx - 100 + (i % 3) * 90, my - 40 + Math.floor(i / 3) * 60, 160]));
    await page.waitForSelector('#g-intro', { state: 'hidden', timeout: 9000 }).catch(() => {});
    // 작전이 준비될 때까지 (7초)
    for (let k = 0; k < 40; k++) {
      const ready = await page.evaluate(() => !document.getElementById('g-sabo-blackout').disabled && !document.getElementById('g-sabo-menu').hidden);
      if (ready) break;
      await sleep(250);
    }
    await sleep(500);
    await L.waitClear(page, 5000);
    await shot(page, 'm_sabo');
    // 학생 한 명 옆으로 가서 (그 학생은 멈춰 서 있다)
    const V = bots[2];
    await V.task(async (b) => b.goTo(mx + 260, my + 40, 10));
    V.anchor = null;
    await L.walkPage(page, MAP, mx + 200, my + 40, 10);
    await sleep(900);
    await L.waitClear(page, 4000);
    await shot(page, 'm_freeze');
    await L.press(page, 'Space');
    await sleep(1000);
    await shot(page, 'm_freeze_after');
    await sleep(1600);
    await shot(page, 'm_freeze_after2');
    // 안개 뿌리기도 한 장 (꿈도둑 화면)
    await L.press(page, 'Digit1');
    await sleep(1200);
    await shot(page, 'm_sabo_fog');
    T.send({ t: 'end' });
    await sleep(500);
  }, 'A');

// ── 판 C: 내가 학생, 꿈도둑 봇이 나를 꿈에 빠뜨린다 ──
if (want('C'))
  await game([0], async ({ T, bots, myId }) => {
    await page.waitForSelector('#g-intro:not([hidden])', { timeout: 9000 });
    await sleep(900);
    await shot(page, 'm_role_student');
    const thief = bots[0];
    const [mx, my] = await L.myPos(page);
    bots.forEach((b, i) => b !== thief && (b.anchor = [mx - 60 + (i % 3) * 80, my - 60 + Math.floor(i / 3) * 70, 150]));
    thief.anchor = [mx + 250, my, 60];
    await page.waitForSelector('#g-intro', { state: 'hidden', timeout: 9000 }).catch(() => {});
    await sleep(1500);
    // 가까운 학생이 나 혼자이도록 조금 떨어진 곳으로
    await L.walkPage(page, MAP, mx + 330, my - 120, 10);
    await sleep(400);
    const [px, py] = await L.myPos(page);
    await thief.task(async (b) => {
      await b.goTo(px + 55, py + 10, 8);
      await sleep(200);
      b.send({ t: 'tag' });
      await sleep(600);
      await b.goTo(px + 300, py + 150, 20);
    });
    thief.anchor = [px + 300, py + 150, 80];
    await sleep(900);
    await shot(page, 'm_dream');
    // 꿈에 빠진 채 조금 걸어 다니기 (고리)
    await L.walkPage(page, MAP, px - 120, py + 60, 12);
    await L.waitClear(page, 5000);
    await shot(page, 'm_dream_2');
    T.send({ t: 'end' });
    await sleep(500);
  }, 'C');

// ── 판 B: 회의 종 → 회의 → 지목 → 추방 → 승리 ──
if (want('B'))
  await game([0], async ({ T, bots, myId }) => {
    const thief = bots[0];
    await L.waitIntroGone(page);
    bots.forEach((b, i) => (b.anchor = [BELL[0] - 160 + (i % 4) * 90, BELL[1] + 90 + Math.floor(i / 4) * 80, 90]));
    await L.walkPage(page, MAP, BELL[0] - 55, BELL[1] + 30, 10);
    // 종이 준비될 때까지
    for (let k = 0; k < 60; k++) {
      const ok = await page.evaluate(() => !document.getElementById('g-action').hidden && !document.getElementById('g-action').disabled);
      if (ok) break;
      await sleep(250);
    }
    await sleep(600);
    await L.waitClear(page, 5000);
    await shot(page, 'm_bell');
    await L.press(page, 'Space');
    await page.waitForSelector('#meeting:not([hidden])', { timeout: 5000 });
    await sleep(700);
    await shot(page, 'm_meeting_intro');
    // 토론 단계
    await page.waitForFunction(() => document.getElementById('meeting').dataset.stage === 'discuss', null, { timeout: 8000 });
    await sleep(1500);
    await shot(page, 'm_meeting');
    // 투표 단계
    await page.waitForFunction(() => document.getElementById('meeting').dataset.stage === 'vote', null, { timeout: 15000 });
    await sleep(800);
    await shot(page, 'm_vote_open');
    // 봇들이 하나둘 투표 (꿈도둑은 나를 찍는다)
    const voters = bots.filter((b) => b !== thief);
    for (const b of voters.slice(0, 3)) {
      b.send({ t: 'vote', target: thief.id });
      await sleep(500);
    }
    await page.click(`#mt-cards .mt-card[data-id="${thief.id}"]`);
    await sleep(600);
    await shot(page, 'm_vote');
    await page.click('#mt-yes');
    await sleep(700);
    await shot(page, 'm_vote_done');
    for (const b of voters.slice(3)) {
      b.send({ t: 'vote', target: thief.id });
      await sleep(300);
    }
    thief.send({ t: 'vote', target: myId });
    await page.waitForFunction(() => document.getElementById('meeting').dataset.stage === 'result', null, { timeout: 15000 });
    await sleep(900);
    await shot(page, 'm_result_fly'); // 추방된 카드가 날아가는 중
    await sleep(1700);
    await shot(page, 'm_result');
    await page.waitForSelector('#g-ending:not([hidden])', { timeout: 15000 });
    await sleep(1300);
    await shot(page, 'm_win');
    await page.waitForSelector('#g-over:not([hidden])', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    await shot(page, 'm_win_over');
  }, 'B');

log('FAILS', JSON.stringify(fails));
await L.closeBrowser();
await srv.stop();
process.exit(0);
