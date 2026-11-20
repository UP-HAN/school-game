// 보급 상자·아이템 자동 시험 (06 명세 15절 15~21번). 실행: npm test
// 시험용 짧은 판: 게임 "1분" = 6초 → 5분 판 = 30초. 안개는 시험 시간 안에 오지 않게 미룬다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_POOLS, LOOT, GAME, lootCount } from '../shared/config.js';
import { distToRect } from '../shared/mapgrid.js';
import { makeChecker, startServer, setup, startGame, endGame, split, walk, route, sleep, SPAWN, runAll } from './testkit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(fs.readFileSync(path.join(here, '..', 'maps', 'monster-gym.json'), 'utf8'));
const ROOM_IDS = new Set(MAP.rooms.map((r) => r.id));
const T = makeChecker('보급 상자');
const { check } = T;
const NO_FOG = { stages: [{ at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }, { at: 5, shrinkMs: 1000 }] };
const until = (v, ms) => sleep(Math.max(0, v.startedAt + ms - Date.now()));
// 큰 체육관 고깔 두 개 (가구 번호 9·12) 옆에 설 자리
const CONES = { 9: { center: [1200, 640], stand: [1260, 660], path: [[1260, 780], [1260, 660]] }, 12: { center: [1600, 1200], stand: [1540, 1160], path: [[1540, 1060], [1540, 1160]] } };
const coneOf = (crate) => (crate.x === 1200 ? CONES[9] : CONES[12]);

// ════ L1: 떨어지는 때·개수·자리, 상자 자리 숨기기 ════
async function runL1() {
  const srv = await startServer(3982, { minuteMs: 6000, fog: NO_FOG });
  try {
    const { teacher, P } = await setup(srv.port, ['가', '나', '다', '라', '마', '바'], { minutes: 5 });
    const v = await startGame(teacher, P);
    const drops = [];
    const lists = [];
    for (let k = 0; k < 4; k++) {
      const ev = await teacher.event('drop', 9000);
      drops.push({ at: ev._at - v.startedAt, count: ev.count });
      const list = await teacher.next((m) => m.t === 'crates' && m.crates.length === 2 * (k + 1), 2000);
      lists.push(list.crates);
    }
    const timesOk = drops.every((d, k) => Math.abs(d.at - [0.15, 0.35, 0.55, 0.75][k] * 30000) < 500);
    check('15. 15%·35%·55%·75% 에 상자가 떨어진다 (drop 알림)', timesOk, JSON.stringify(drops));
    check('15. 6명이면 한 번에 2개 (인원별 개수)', drops.every((d) => d.count === 2) && lootCount(5) === 1 && lootCount(8) === 2 && lootCount(10) === 3);
    let distinct = true;
    let inRooms = true;
    lists.forEach((list, k) => {
      const fresh = list.slice(2 * k);
      if (fresh.length !== 2 || fresh[0].room === fresh[1].room) distinct = false;
      for (const c of fresh) {
        if (!ROOM_IDS.has(c.room)) inRooms = false;
        const f = MAP.furniture.find((g) => g.rect.join() === c.rect.join());
        const r = MAP.rooms.find((x) => x.id === c.room);
        if (!f || !(c.rect[0] >= r.rect[0] && c.rect[1] >= r.rect[1] && c.rect[0] + c.rect[2] <= r.rect[0] + r.rect[2] && c.rect[1] + c.rect[3] <= r.rect[1] + r.rect[3])) inRooms = false;
      }
    });
    check('15. 같은 때 떨어진 상자는 서로 다른 방, 모두 방 안 가구 (복도 가구 아님)', distinct && inRooms, JSON.stringify(lists[3]));
    await sleep(300);
    // 16. 학생이 받는 room·state 에는 상자 자리가 없고, crates 는 시야+100 안의 것만
    const all = lists[3];
    let leak = false;
    let tooFar = false;
    for (const c of P) {
      const me = teacher.see(c);
      for (const text of c.raw) {
        const m = JSON.parse(text);
        if (m.t === 'room' && ('crates' in m || text.includes('"rect"'))) leak = true;
        if (m.t === 'crates') for (const k of m.crates) if (distToRect(me.x, me.y, k.rect) > GAME.vision + LOOT.seeExtra + 1) tooFar = true;
      }
    }
    const expectSeen = P.map((c) => all.filter((k) => distToRect(teacher.see(c).x, teacher.see(c).y, k.rect) <= GAME.vision + LOOT.seeExtra).length);
    const gotSeen = P.map((c) => (c.crates ? c.crates.length : 0));
    check('16. 학생이 받는 room·state 어디에도 상자 자리가 없다 (cratesLeft 만)', !leak && P.every((c) => c.room.cratesLeft === 8), JSON.stringify({ leak, left: P.map((c) => c.room.cratesLeft) }));
    check('16. 학생은 시야+100 안의 상자만 crates 로 받는다 (선생님은 모두)', !tooFar && expectSeen.join() === gotSeen.join() && all.length === 8, JSON.stringify({ expectSeen, gotSeen }));
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

// ════ L2: 열기·가방·동시 열기·사라짐·아이템 효과 (상자는 큰 체육관 고깔 두 개에만) ════
async function runL2() {
  const srv = await startServer(3983, {
    minuteMs: 6000,
    fog: NO_FOG,
    loot: { dropsAt: [0.05, 0.3], lifeMs: 8000 },
    lootFurniture: [9, 12],
    itemSeq: ['flashlight'],
    testGive: true,
    chase: { graceMs: 500, cooldownMs: 300 },
  });
  try {
    const { teacher, P } = await setup(srv.port, ['일', '이', '삼', '사'], { minutes: 5 });
    const v = await startGame(teacher, P);
    const { C: [C], S: [S1, S2, S3] } = split(v, P);
    await Promise.all([route(S1, [SPAWN, ...CONES[9].path]), route(S2, [SPAWN, ...CONES[12].path]), route(S3, [SPAWN, [920, 920], [780, 920]]), walk(C, ...SPAWN)]);
    await teacher.event('drop', 4000);
    const crate = (await teacher.next((m) => m.t === 'crates' && m.crates.length === 1)).crates[0];
    const near = crate.x === 1200 ? S1 : S2;
    await sleep(250);
    check('16. 가까운 학생은 crates 로 받고, 먼 학생(시야+100 밖)의 목록에는 없다', near.crates && near.crates.some((k) => k.id === crate.id) && (!S3.crates || S3.crates.length === 0), JSON.stringify({ crate, near: near.crates, far: S3.crates, nearPos: [near.x, near.y] }));
    // 17. 꾹 누르기
    for (const c of P) c.clear();
    near.send({ t: 'lootStart', crate: crate.id });
    near.send({ t: 'lootEnd' });
    check('17. 1.5초 전에 lootEnd → 실패', (await near.error()) === 'too_soon');
    near.send({ t: 'testGive', item: 'shoes' });
    await near.next((m) => m.t === 'me' && m.item === 'shoes');
    near.send({ t: 'lootStart', crate: crate.id });
    check('17. 가방이 차 있으면 거부 (bag_full)', (await near.error()) === 'bag_full');
    // 20. 운동화: 쓰기 전에는 100ms 에 68px 이 거부, 쓰고 나면 받아들인다
    const [sx, sy] = CONES[crate.x === 1200 ? 9 : 12].stand;
    near.x = sx;
    near.y = sy;
    await sleep(300);
    let f0 = near.fixes;
    near.send({ t: 'pos', x: sx, y: sy, f: 1, m: 1 }); // 제자리 (움직인 때를 지금으로)
    await sleep(100);
    near.send({ t: 'pos', x: sx + 68, y: sy, f: 1, m: 1 });
    await sleep(150);
    const rejected = near.fixes > f0;
    near.x = sx;
    near.y = sy;
    near.send({ t: 'useItem' });
    const itemEv = await S3.event('item', 2000);
    await sleep(100);
    const shoeMe = near.meMsg;
    f0 = near.fixes;
    near.send({ t: 'pos', x: sx, y: sy, f: 1, m: 1 });
    await sleep(100);
    near.send({ t: 'pos', x: sx + 68, y: sy, f: 1, m: 1 });
    await sleep(100);
    near.send({ t: 'pos', x: sx, y: sy, f: 1, m: 1 });
    await sleep(150);
    check('20. 운동화를 쓰면 빠른 위치를 받아들인다 (쓰기 전에는 되돌림)', rejected && near.fixes === f0 && shoeMe.item === null && shoeMe.effects.shoes > 5000 && itemEv.id === near.id && itemEv.item === 'shoes', JSON.stringify({ rejected, fx: shoeMe.effects }));
    // 17. 움직이면 취소
    near.send({ t: 'lootStart', crate: crate.id });
    await sleep(200);
    near.send({ t: 'pos', x: sx, y: sy + 30, f: 1, m: 1 });
    await sleep(1500);
    near.send({ t: 'lootEnd' });
    check('17. 여는 동안 움직이면 취소된다', (await near.error()) === 'loot_cancelled');
    near.send({ t: 'pos', x: sx, y: sy, f: 1, m: 1 });
    near.x = sx;
    near.y = sy;
    // 18. 동시에 두 사람 (잠귀신 C 도 열 수 있다)
    await route(C, coneOf(crate).path.map(([x, y]) => [x + (crate.x === 1200 ? 30 : -30), y]));
    for (const c of [teacher, ...P]) c.clear();
    C.send({ t: 'lootStart', crate: crate.id });
    near.send({ t: 'lootStart', crate: crate.id });
    await sleep(1550);
    near.send({ t: 'lootEnd' });
    await sleep(200);
    C.send({ t: 'lootEnd' });
    const cErr = await C.error();
    const opened = await S3.event('crateOpened', 2000);
    await sleep(150);
    check('18. 동시에 열면 먼저 채운 사람만 (나중 사람은 crate_gone)', near.meMsg.item === 'flashlight' && cErr === 'crate_gone' && C.meMsg.item === null, JSON.stringify({ n: near.meMsg.item, cErr, c: C.meMsg.item, nerr: near.inbox.filter((m) => m.t === 'error') }));
    check('21. crateOpened 에는 여는 사람 정보가 없다, 열린 상자는 목록에서 빠진다', Object.keys(opened).filter((k) => k !== 't' && k !== 'kind').length === 0 && !teacher.crates.some((k) => k.id === crate.id), JSON.stringify({ opened, left: teacher.room.cratesLeft }));
    // 19. 두 번째 상자는 아무도 안 열면 사라진다 (시험값 8초)
    await teacher.event('drop', 6000);
    const second = (await teacher.next((m) => m.t === 'crates' && m.crates.length === 1)).crates[0];
    const dropAt = Date.now();
    check('7-1. 바로 전 차례와 같은 가구는 피한다', second.x !== crate.x);

    // 20. 아이템 효과 (시험용 testGive 로 바로 준다). 모두 가운데로
    await Promise.all([route(S1, [[1400, 920]]), route(S2, [[1440, 920]]), route(S3, [[920, 920], [1400, 1150]]), route(C, [[1420, 1000]])]);
    // 우산: S1 이 쓰고, C 가 꿈을 건다 → 막힘, 구슬은 그대로
    S1.send({ t: 'testGive', item: 'umbrella' });
    await S1.next((m) => m.t === 'me' && m.item === 'umbrella');
    S1.send({ t: 'useItem' });
    await S1.next((m) => m.t === 'me' && m.effects && m.effects.umbrella > 0);
    await route(C, [[1400, 960]]); // S1 이 가장 가깝다
    const e0 = C.meMsg.energy;
    for (const c of [teacher, ...P]) c.clear();
    C.send({ t: 'tag' });
    const pop = await teacher.event('shieldPop', 2000);
    await sleep(150);
    check('20. 꿈막이 우산이 꿈 걸기 1번을 막고, 꿈 구슬은 안 줄어든다 (쿨타임은 쓴다)', pop.id === S1.id && !teacher.see(S1).frozen && C.meMsg.energy === e0 && e0 === 3 && C.meMsg.tagMs > 0 && !S1.meMsg.effects.umbrella);
    // 기상 나팔: C 가 S1·S2 를 꿈에 빠뜨리고, S3(250 안)이 나팔을 분다
    await sleep(400);
    C.send({ t: 'tag' });
    await teacher.event('tag', 2000);
    await sleep(400);
    C.send({ t: 'tag' });
    await teacher.event('tag', 2000);
    await sleep(150);
    const bothAsleep = teacher.see(S1).frozen && teacher.see(S2).frozen;
    S3.send({ t: 'testGive', item: 'bugle' });
    await S3.next((m) => m.t === 'me' && m.item === 'bugle');
    S3.send({ t: 'useItem' });
    const w1 = await teacher.event('thaw', 2000);
    const w2 = await teacher.event('thaw', 2000);
    await sleep(150);
    check('20. 기상 나팔이 둘레 250 안의 꿈에 빠진 친구를 모두 깨운다', bothAsleep && [w1.id, w2.id].sort().join() === [S1.id, S2.id].sort().join() && w1.by === S3.id && !teacher.see(S1).frozen && !teacher.see(S2).frozen);
    // 긴 베개: 거리 100 은 보통은 헛손질, 베개를 쓰면 닿는다 (S3 은 1400,1150 · C 는 1400,1050)
    await route(C, [[1400, 1050]]);
    await sleep(300);
    C.clear();
    C.send({ t: 'tag' });
    const miss = await C.next((m) => m.t === 'me', 2000);
    const missed = !teacher.see(S3).frozen && miss.tagMs <= 800;
    C.send({ t: 'testGive', item: 'pillow' });
    await C.next((m) => m.t === 'me' && m.item === 'pillow');
    C.send({ t: 'useItem' });
    await C.next((m) => m.t === 'me' && m.effects && m.effects.pillow > 0);
    await sleep(850);
    C.send({ t: 'tag' });
    const tagS3 = await teacher.event('tag', 2000).catch(() => null);
    check('20. 긴 베개를 쓰면 꿈 걸기 거리가 115 로 늘어난다', missed && !!tagS3 && tagS3.id === S3.id);
    // 잠귀신은 기상 나팔·운동화를 받을 수 없다 (목록)
    check('7-4. 아이템 목록: 학생 5종 · 잠귀신 4종 (찬스 카드는 둘 다)', ITEM_POOLS['sleep-tag'].student.join() === 'shoes,umbrella,flashlight,chance,bugle' && ITEM_POOLS['sleep-tag'].chaser.join() === 'chance,windcape,fogcape,pillow');
    // 19. 사라짐
    const gone = await teacher.event('crateGone', Math.max(1000, dropAt + 8800 - Date.now()));
    await sleep(150);
    check('19. 아무도 안 열면 시간(시험값 8초) 뒤 사라지고 crateGone', !!gone && Date.now() - dropAt > 7500 && teacher.room.cratesLeft === 0 && (await teacher.next((m) => m.t === 'crates' && m.crates.length === 0, 1000).then(() => true, () => teacher.raw.some((t) => t.includes('"crates":[]')))));
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

// ════ L3: 꿈도둑을 찾아라 — 꿈도둑도 학생과 같은 아이템 목록 ════
async function runL3() {
  const srv = await startServer(3984, { minuteMs: 6000, fog: NO_FOG, loot: { dropsAt: [0.05] }, lootFurniture: [9, 12] });
  try {
    const { teacher, P } = await setup(srv.port, ['하나', '두리', '세찬', '네오'], { mode: 'mafia', minutes: 5 });
    teacher.send({ t: 'pickChasers', ids: [P[0].id] });
    await teacher.type('picked');
    const v = await startGame(teacher, P);
    const [M, S1] = P;
    await walk(M, ...SPAWN);
    await teacher.event('drop', 4000);
    const crate = (await teacher.next((m) => m.t === 'crates' && m.crates.length === 1)).crates[0];
    await route(M, coneOf(crate).path);
    M.send({ t: 'lootStart', crate: crate.id });
    await sleep(1550);
    M.send({ t: 'lootEnd' });
    const opened = await S1.event('crateOpened', 2000);
    await sleep(150);
    check('21. 꿈도둑이 받는 아이템이 학생 목록 안에 있다', ITEM_POOLS.mafia.student.includes(M.meMsg.item) && ITEM_POOLS.mafia.chaser.join() === ITEM_POOLS.mafia.student.join(), M.meMsg.item);
    check('21. crateOpened 에 여는 사람 id 가 없다 (꿈도둑을 찾아라)', !JSON.stringify(opened).includes(M.id) && !S1.raw.some((t) => t.includes('crateOpened') && t.includes(M.id)));
    await endGame(teacher, P);
  } finally {
    await srv.stop();
  }
}

runAll(T, [runL1, runL2, runL3], 150_000);
