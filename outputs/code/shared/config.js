// 서버와 화면이 같이 쓰는 값. 규칙 숫자는 여기 한 곳에서만 고친다.
// 숫자의 근거는 outputs/06-spec-revamp.md 6·7·8·10절.

// 게임 중에는 "맛 + 캐릭터" 로 부른다 (딸기 고양이). 저장 값은 번호(0~9)라 바꿔도 기록에 영향이 없다.
export const COLORS = [
  { id: 'red', name: '딸기', adj: '딸기', hex: '#f25c6e' },
  { id: 'orange', name: '귤', adj: '귤', hex: '#ff9a3c' },
  { id: 'yellow', name: '바나나', adj: '바나나', hex: '#ffd84d' },
  { id: 'lime', name: '멜론', adj: '멜론', hex: '#a8e05f' },
  { id: 'green', name: '민트', adj: '민트', hex: '#3fc9a0' },
  { id: 'sky', name: '소다', adj: '소다', hex: '#5cc8f2' },
  { id: 'blue', name: '블루베리', adj: '블루베리', hex: '#5a6ff0' },
  { id: 'purple', name: '포도', adj: '포도', hex: '#9b6bf2' },
  { id: 'pink', name: '복숭아', adj: '복숭아', hex: '#ff9ec4' },
  { id: 'brown', name: '초코', adj: '초코', hex: '#a8714a' },
];

export const CHARACTERS = [
  { id: 'kid', name: '학생', group: '사람' },
  { id: 'kid2', name: '운동부', group: '사람' },
  { id: 'cat', name: '고양이', group: '동물' },
  { id: 'rabbit', name: '토끼', group: '동물' },
  { id: 'dino', name: '공룡', group: '동물' },
  { id: 'cyclops', name: '외눈이', group: '몬스터' },
  { id: 'slime', name: '슬라임', group: '몬스터' },
  { id: 'alien', name: '외계인', group: '몬스터' },
];

// 모드 id 는 코드 안 이름(화면에 안 보임). name·chaser·student 가 화면에 보이는 이름.
export const MODES = [
  { id: 'sleep-tag', name: '잠귀신 술래잡기', chaser: '잠귀신', student: '학생' },
  { id: 'mafia', name: '꿈도둑을 찾아라', chaser: '꿈도둑', student: '학생' },
];
export const modeOf = (id) => MODES.find((m) => m.id === id) || MODES[0];

// 인원에 맞는 잠귀신(꿈도둑) 수 추천. 선생님이 '자동'으로 두면 이 값을 쓴다.
// 잠귀신 술래잡기: 6명까지 1명, 7명부터 2명 / 꿈도둑을 찾아라: 7명까지 1명, 8명부터 2명
export function recommendChasers(mode, playerCount) {
  const two = mode === 'mafia' ? 8 : 7;
  return playerCount >= two ? 2 : 1;
}
// 잠귀신(꿈도둑)이 될 수 있는 최대 수. 학생이 1명은 남아야 하고,
// 꿈도둑을 찾아라는 시작하자마자 꿈도둑 승리(학생 수 ≤ 꿈도둑 수)가 되지 않도록 (인원 − 1) ÷ 2 (내림)까지.
export function maxChasers(mode, playerCount) {
  const cap = mode === 'mafia' ? Math.floor((playerCount - 1) / 2) : playerCount - 1;
  return Math.max(1, cap);
}
// 실제로 쓸 수: 선생님이 고른 값이 있으면 그 값(위 최대 수까지), 없으면 추천값
export function chaserCount(settings, playerCount) {
  const want = settings.chasers === 'auto' || !settings.chasers ? recommendChasers(settings.mode, playerCount) : settings.chasers;
  return Math.max(1, Math.min(want, maxChasers(settings.mode, playerCount)));
}

export const MAPS = [{ id: 'monster-gym', name: '몬스터 체육관' }];

export const LIMITS = {
  maxPlayers: 10,
  minPlayers: 4,
  nameMax: 8,
  maxRooms: 20,
  rejoinSeconds: 60, // 연결이 끊긴 뒤 이 시간 안에 돌아오면 이어서 한다
};

export const GAME = {
  speed: 270, // 1초에 움직이는 거리(px)
  radius: 14, // 캐릭터 발밑 충돌 반지름
  charSize: 80, // 맵 위 캐릭터 키(px)
  sendHz: 10, // 위치를 1초에 몇 번 주고받는가
  vision: 340, // 학생·잠귀신이 볼 수 있는 거리 (선생님은 전체를 본다)
};

// 잠귀신 술래잡기 규칙 숫자 (06 명세 10-1절). 안개 단계에 따라 바뀌는 값은 FOG 표의 0단계가 이 값이다.
export const CHASE = {
  reach: 75, // 꿈 걸기·깨우기가 닿는 거리
  cooldownMs: 6000, // 꿈을 건 뒤 다시 걸 수 있을 때까지
  graceMs: 10000, // 게임 시작 뒤 이 시간 동안은 꿈을 걸 수 없다
  thawHoldMs: 1200, // 깨우기 버튼을 누르고 있어야 하는 시간
  thawProtectMs: 4000, // 깨어난 뒤 보호 시간
  joinProtectMs: 3000, // 도중에 들어온 학생 보호 시간
  deviceReach: 80, // 미끄럼틀·개구멍 입구에서 이만큼 안에 있어야 탈 수 있다
};
export const MINUTES = [5, 8, 10, 12, 15];

// 꿈도둑을 찾아라 규칙 숫자 (06 명세 10-2절, 05 명세 6절). kind 이름(blackout·lock·disguise)은 코드 안 이름.
export const MAFIA = {
  freezeReach: 90, // 꿈 걸기 거리
  freezeGraceMs: 20000, // 시작 뒤 첫 꿈 걸기까지
  freezeCooldownMs: 30000, // 꿈 걸기 쿨타임 (안개 단계에 따라 FOG.mafiaCooldownMs)
  freezeAfterMeetingMs: 15000, // 회의가 끝난 뒤 다시 걸 수 있을 때까지
  sabotageGraceMs: 20000, // 시작 뒤 첫 작전까지
  blackoutMs: 10000, // 안개 뿌리기 지속
  blackoutVision: 0.4, // 안개 뿌리기 때 깨어 있는 학생 시야 배율
  blackoutCooldownMs: 45000, // 안개 뿌리기 쿨타임 (꿈도둑 팀 공용)
  lockMs: 8000, // 문 막기 지속
  lockCooldownMs: 50000, // 문 막기 쿨타임 (꿈도둑 팀 공용)
  lockReach: 300, // 이 거리 안의 막을 수 있는 문만 막는다
  disguiseMs: 12000, // 변신 지속
  disguisePerGame: 2, // 변신 횟수 (사람마다)
  reportReach: 120, // 호루라기 (꿈에 빠진 자리) 거리
  buttonReach: 90, // 회의 종 거리
  buttonGraceMs: 20000, // 시작·회의 뒤 종 대기
  meetingsDefault: 3, // 회의 종 총 횟수 기본
  meetingIntroMs: 2500, // 회의 시작 알림
  discussMs: 30000, // 토론
  voteMs: 20000, // 투표
  resultMs: 4000, // 결과
  extendMs: 15000, // 선생님 토론 연장
  extendMax: 2, // 회의당 연장 횟수
};
export const MEETINGS = [0, 1, 2, 3, 4, 5]; // 선생님 설정 선택지 (회의 종 총 횟수)

// 잠 안개 (06 명세 6절). 시각은 게임 시간 비율. 배열 4칸 = 안개 단계 0·1·2·3.
export const FOG = {
  warnMs: 20000, // 단계 시작 전 예고
  stages: [
    { at: 0.3, shrinkMs: 40000 },
    { at: 0.55, shrinkMs: 40000 },
    { at: 0.8, shrinkMs: 30000 },
  ],
  radii: [1250, 850, 550], // 각 단계가 끝났을 때 빛 구역 반지름 (맵에 fog.radii 가 있으면 그 값)
  slow: 0.75, // 안개 속 속도 배율 (화면이 적용)
  vision: 0.6, // 안개 속 시야 배율 (화면이 적용)
  wrongLockMs: 8000, // 안개 속에서 연 퀴즈의 오답 잠금
  drowsyMs: 12000, // 안개 속에 이만큼 있으면 꿈에 빠진다 (잠귀신 술래잡기 학생만)
  drowsyRecover: 2, // 빛 구역 안에서 졸음이 줄어드는 빠르기 (배)
  chaseCooldownMs: [6000, 8000, 10000, 12000],
  wakeHoldMs: [1200, 1200, 1000, 800],
  wakeProtectMs: [4000, 4000, 5000, 5000],
  innerWrongLockMs: [5000, 5000, 4000, 3000],
  helpAfter: [2, 2, 1, 1], // 오답 도움이 나오는 오답 횟수
  mafiaCooldownMs: [30000, 35000, 40000, 45000],
  lastNightChaserSpeed: 1.1, // 마지막 밤(3단계) 잠귀신 속도 배율
  bonusCount: 2, // 마지막 밤 임시 랜턴 수
};
// 안개 단계 값 (0~3). 0단계는 base(CHASE·MAFIA 값)를 쓴다.
export function stageValue(key, stage, base) {
  if (!stage && base !== undefined) return base;
  const list = FOG[key];
  return list[Math.max(0, Math.min(list.length - 1, stage || 0))];
}

// 부엉이 택배 보급 상자 (06 명세 7절)
export const LOOT = {
  dropsAt: [0.15, 0.35, 0.55, 0.75],
  countByPlayers: [
    { upTo: 5, count: 1 },
    { upTo: 8, count: 2 },
    { upTo: 99, count: 3 },
  ],
  lifeMs: 90000, // 아무도 안 열면 사라질 때까지
  openHoldMs: 1500, // 꾹 눌러 여는 시간
  openReach: 90, // 가구 둘레 이 거리 안에서 연다
  moveCancel: 20, // 여는 동안 이만큼 넘게 움직이면 취소
  seeExtra: 100, // 시야 + 이만큼 안의 상자 자리를 알려 준다
};
export const lootCount = (players) => (LOOT.countByPlayers.find((c) => players <= c.upTo) || { count: 1 }).count;

// 아이템 (06 명세 7-4절). id 는 코드 안 이름.
export const ITEMS = {
  shoes: { name: '반짝 운동화', ms: 6000, speed: 1.4 },
  umbrella: { name: '꿈막이 우산', ms: 20000 },
  flashlight: { name: '손전등', ms: 10000, vision: 1.5 },
  chance: { name: '찬스 카드' },
  bugle: { name: '기상 나팔', reach: 250 },
  windcape: { name: '바람 망토', ms: 6000, speed: 1.3 },
  fogcape: { name: '안개 망토', ms: 8000, alpha: 0.3 },
  pillow: { name: '긴 베개', ms: 15000, reach: 115 },
};
// 누가 어떤 아이템을 받을 수 있나. 꿈도둑을 찾아라는 꿈도둑도 학생과 같은 목록 (정체가 드러나지 않게).
export const ITEM_POOLS = {
  'sleep-tag': { student: ['shoes', 'umbrella', 'flashlight', 'chance', 'bugle'], chaser: ['chance', 'windcape', 'fogcape', 'pillow'] },
  mafia: { student: ['shoes', 'umbrella', 'flashlight', 'chance'], chaser: ['shoes', 'umbrella', 'flashlight', 'chance'] },
};

// 꿈 구슬: 잠귀신·꿈도둑이 꿈을 걸 때마다 1개 쓴다. 퀴즈를 맞혀야 생긴다 (06 명세 8-1절).
export const ENERGY = {
  'sleep-tag': { start: 3, max: 5, lantern: 2, notebook: 1 },
  mafia: { start: 1, max: 2, lantern: 1, notebook: 1 },
  chaserLanternCooldownMs: 30000, // 잠귀신이 같은 랜턴을 다시 켤 수 있을 때까지
};

// 퀴즈 수첩·연속 정답 (06 명세 8-2·8-3절)
export const STREAK = {
  roomHintAt: 3, // 이 개수째 연속 정답 → 가장 가까운 상자의 방 이름
  exactHintAt: 5, // 이 개수째 → 가구 자리
  repeatEvery: 5, // 그 뒤 5개마다 가구 자리 다시
  roomHintMs: 10000,
  exactHintMs: 20000,
  notebookWrongLockMs: 3000,
  bankMax: 1, // 상자가 없을 때 모아 두는 힌트 수
};

export function playerLabel(colorIndex, characterId) {
  const c = COLORS[colorIndex];
  const ch = CHARACTERS.find((x) => x.id === characterId);
  return `${c ? c.adj : ''} ${ch ? ch.name : ''}`.trim();
}
