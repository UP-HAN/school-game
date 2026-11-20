// 시작 로딩 화면에 2초마다 바뀌는 TIP (쉬운 말). 모드별로 고른다. 키 이름은 keys.js 에서 읽는다.
import { KEYS } from './keys.js';

const COMMON = [
  `${KEYS.act.label} 키 하나로 지금 할 수 있는 행동을 해요. 태블릿은 오른쪽 아래 큰 동그라미 버튼!`,
  '움직이기는 W A S D 또는 방향키! 두 개를 같이 누르면 대각선으로 가요.',
  '잠 안개 밖에서는 느려지고 앞이 잘 안 보여요. 빛 구역 안으로 들어가요.',
  '보급 상자는 방 안 가구 속에 숨어 있어요. 반짝이는 별가루를 찾아보세요.',
  '퀴즈를 연속으로 맞히면 보급 상자가 있는 곳 힌트가 나와요.',
  '개구멍 앞 나무 팻말을 보면 누가 탈 수 있는지 알 수 있어요.',
  `퀴즈 수첩(${KEYS.notebook.label} 키)은 어디서나 열 수 있어요. 대신 여는 동안은 움직일 수 없어요.`,
  `가방(${KEYS.bag.label} 키)에 든 아이템은 한 개만 가질 수 있어요. 아끼지 말고 써요!`,
  `${KEYS.map.label} 키를 누르면 작은 지도가 열려요. 빛 구역도 볼 수 있어요. 닫을 때는 ${KEYS.esc.label}!`,
];
const SLEEP = [
  '꿈에 빠진 친구는 옆에서 깨우기 버튼을 꾹 눌러 깨워 줘요.',
  '잠귀신은 개구멍과 미끄럼틀을 탈 수 없어요. 도망칠 때 써 보세요!',
  '잠귀신도 퀴즈를 맞혀야 꿈 구슬이 생겨요. 구슬이 없으면 꿈에 빠뜨릴 수 없어요.',
  '안개 속에 오래 있으면 졸음 막대가 차서 스르륵 잠들어요.',
  '모든 랜턴을 켜서 새벽빛이 100%가 되면 아침이 와요!',
];
const MAFIA = [
  '꿈도둑은 학생인 척 숨어 있어요. 모닥불 회의에서 가려내요.',
  '꿈에 빠진 친구를 보면 호루라기를 불어 회의를 열어요.',
  '회의 종은 한 사람이 한 번만 울릴 수 있어요.',
  '꿈에 빠진 학생도 랜턴을 켜서 친구들을 도울 수 있어요.',
  '누가 꿈도둑인지 모르겠으면 기권해도 괜찮아요.',
  `꿈도둑의 작전은 숫자 ${KEYS.sabo1.label}·${KEYS.sabo2.label}·${KEYS.sabo3.label} 키로 바로 써요.`,
  `회의 투표는 방향키로 친구 카드를 고르고 ${KEYS.act.label}!`,
];

// 선생님이 고른 잠귀신 속도 안내 (same 이면 없음)
const CHASER_SPEED_TIP = { fast: '이번 판은 잠귀신이 조금 빨라요!', very: '이번 판은 잠귀신이 매우 빨라요! 조심해요!' };

// chaserSpeed: room.settings.chaserSpeed ('same'|'fast'|'very'). 잠귀신 술래잡기에서 빠르게 골랐으면 첫 TIP 으로 보여 준다.
export function tipsFor(mode, chaserSpeed) {
  const list = [...(mode === 'mafia' ? MAFIA : SLEEP), ...COMMON];
  // 무작위 순서
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (mode !== 'mafia' && CHASER_SPEED_TIP[chaserSpeed]) list.unshift(CHASER_SPEED_TIP[chaserSpeed]);
  return list;
}
