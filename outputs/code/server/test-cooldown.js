// "잠귀신이 다시 재우기까지 쉬는 시간" 설정 자동 시험. 실행: npm test
// 선생님이 고른 초(1·3·5·7·9)가 판 내내 그대로 쓰이는지, 0(기본)이면 원래 값(6초)인지 본다.
import { TAG_COOLDOWNS, tagCooldownMs } from '../shared/config.js';
import { makeChecker, startServer, setup, startGame, split, route, sleep, SPAWN, runAll } from './testkit.js';

const T = makeChecker('다시 재우기까지 쉬는 시간');
const { check } = T;

// 잠귀신 옆에 학생 한 명을 세우고 재운 뒤, 서버가 알려 주는 남은 쉬는 시간(ms)을 돌려준다
async function tagOnce(port, settings) {
  const { teacher, P } = await setup(port, ['가람', '나래', '다온', '라온', '마루'], { minutes: 5, ...settings });
  const v = await startGame(teacher, P);
  const { C: [C], S: [S1] } = split(v, P);
  await Promise.all([route(S1, [[1400, 920]]), route(C, [SPAWN, [1400, 960]])]);
  await sleep(Math.max(0, v.startedAt + 800 - Date.now()));
  for (const c of [teacher, ...P]) c.clear();
  C.send({ t: 'tag' });
  await teacher.event('tag', 2000);
  const me = await C.next((m) => m.t === 'me' && m.tagMs > 900, 2000);
  for (const c of [teacher, ...P]) c.ws.close();
  return me.tagMs;
}

async function run(port) {
  check('고를 수 있는 값은 0(기본)·1·3·5·7·9', JSON.stringify(TAG_COOLDOWNS) === '[0,1,3,5,7,9]');
  check('0(기본)이면 원래 값을 그대로 쓴다', tagCooldownMs({ mode: 'sleep-tag', tagCooldown: 0 }, 6000) === 6000);
  check('고른 초가 있으면 안개 단계와 상관없이 그 초', tagCooldownMs({ mode: 'sleep-tag', tagCooldown: 3 }, 12000) === 3000);
  check('꿈도둑을 찾아라에서는 무시한다', tagCooldownMs({ mode: 'mafia', tagCooldown: 3 }, 30000) === 30000);
  check('목록에 없는 값은 무시한다', tagCooldownMs({ mode: 'sleep-tag', tagCooldown: 2 }, 6000) === 6000);

  const base = await tagOnce(port, null);
  check(`기본: 재운 뒤 6초 쉰다 (${base}ms)`, base > 5000 && base <= 6000);
  const three = await tagOnce(port, { tagCooldown: 3 });
  check(`3초로 고르면 3초 쉰다 (${three}ms)`, three > 2000 && three <= 3000);
  const nine = await tagOnce(port, { tagCooldown: 9 });
  check(`9초로 고르면 9초 쉰다 (${nine}ms)`, nine > 8000 && nine <= 9000);

  // 목록에 없는 값(2초)을 보내면 서버가 받지 않는다
  const { teacher, P } = await setup(port, ['가람', '나래', '다온', '라온', '마루'], { tagCooldown: 5 });
  teacher.clear();
  teacher.send({ t: 'settings', tagCooldown: 2 });
  const room = await teacher.next((m) => m.t === 'room', 2000);
  check('목록에 없는 값(2초)은 서버가 받지 않는다', room.settings.tagCooldown === 5);
  for (const c of [teacher, ...P]) c.ws.close();
}

runAll(T, [
  async () => {
    const srv = await startServer(3993, { chase: { graceMs: 500 } });
    try {
      try {
        await run(srv.port);
      } catch (e) {
        T.failed++;
        console.log('실패  시험 도중 오류 →', e.stack || e.message);
      }
    } finally {
      await srv.stop();
    }
  },
], 90_000);
