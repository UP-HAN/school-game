// 서버와 화면이 같이 쓰는 값. 규칙 숫자는 여기 한 곳에서만 고친다.

export const COLORS = [
  { id: 'red', name: '빨강', adj: '빨간', hex: '#f25c54' },
  { id: 'orange', name: '주황', adj: '주황', hex: '#f8961e' },
  { id: 'yellow', name: '노랑', adj: '노란', hex: '#f9d23c' },
  { id: 'lime', name: '연두', adj: '연두', hex: '#a7d948' },
  { id: 'green', name: '초록', adj: '초록', hex: '#3fae6a' },
  { id: 'sky', name: '하늘', adj: '하늘', hex: '#5cc8f2' },
  { id: 'blue', name: '파랑', adj: '파란', hex: '#4a7bf0' },
  { id: 'purple', name: '보라', adj: '보라', hex: '#9b6bf2' },
  { id: 'pink', name: '분홍', adj: '분홍', hex: '#f582b8' },
  { id: 'brown', name: '갈색', adj: '갈색', hex: '#b07a4f' },
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

export const MODES = [
  { id: 'freeze-tag', name: '얼음땡', chaser: '술래' },
  { id: 'impostor', name: '방해꾼 찾기', chaser: '방해꾼' },
];

// 인원에 맞는 술래(방해꾼) 수 추천. 선생님이 '자동'으로 두면 이 값을 쓴다.
// 얼음땡: 6명까지 1명, 7명부터 2명 / 방해꾼 찾기: 7명까지 1명, 8명부터 2명
export function recommendChasers(mode, playerCount) {
  const two = mode === 'impostor' ? 8 : 7;
  return playerCount >= two ? 2 : 1;
}
// 술래(방해꾼)가 될 수 있는 최대 수. 학생이 1명은 남아야 하고,
// 방해꾼 찾기는 시작하자마자 방해꾼 승리(학생 수 ≤ 방해꾼 수)가 되지 않도록 (인원 − 1) ÷ 2 (내림)까지.
export function maxChasers(mode, playerCount) {
  const cap = mode === 'impostor' ? Math.floor((playerCount - 1) / 2) : playerCount - 1;
  return Math.max(1, cap);
}
// 실제로 쓸 술래 수: 선생님이 고른 값이 있으면 그 값(위 최대 수까지), 없으면 추천값
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
  vision: 340, // 학생·술래가 볼 수 있는 거리 (선생님은 전체를 본다)
};

// 얼음땡 규칙 숫자 (참고작과 같은 값에서 시작)
export const TAG = {
  reach: 70, // 잡기·땡이 닿는 거리
  cooldownMs: 7000, // 잡은 뒤 다시 잡을 수 있을 때까지
  graceMs: 8000, // 게임 시작 뒤 이 시간 동안은 못 잡는다
  thawHoldMs: 1500, // 땡 버튼을 누르고 있어야 하는 시간
  thawProtectMs: 4000, // 풀린 뒤 보호 시간
  joinProtectMs: 3000, // 도중에 들어온 학생 보호 시간
  deviceReach: 80, // 미끄럼틀·개구멍 입구에서 이만큼 안에 있어야 탈 수 있다
};
export const MINUTES = [5, 8, 10, 12, 15];

// 방해꾼 찾기 규칙 숫자 (outputs/05-spec-impostor.md 6절). "가정" 은 참고작에서 확인하지 못해 정한 값.
export const IMPOSTOR = {
  freezeReach: 100, // 얼리기 거리
  freezeGraceMs: 15000, // 시작 뒤 첫 얼리기까지
  freezeCooldownMs: 25000, // 얼리기 쿨타임
  freezeAfterMeetingMs: 15000, // 회의가 끝난 뒤 다시 얼릴 수 있을 때까지 (가정)
  sabotageGraceMs: 15000, // 시작 뒤 첫 방해까지 (가정)
  blackoutMs: 8000, // 정전 지속
  blackoutVision: 0.35, // 정전 때 살아 있는 학생 시야 배율
  blackoutCooldownMs: 40000, // 정전 쿨타임 (방해꾼 팀 공용)
  lockMs: 7000, // 문 잠금 지속
  lockCooldownMs: 45000, // 문 잠금 쿨타임 (방해꾼 팀 공용)
  lockReach: 300, // 이 거리 안의 잠글 수 있는 문만 잠근다 (가정)
  disguiseMs: 10000, // 위장 지속
  disguisePerGame: 2, // 위장 횟수 (사람마다)
  reportReach: 110, // 얼음 흔적 신고 거리
  buttonReach: 90, // 긴급회의 버튼 거리 (가정)
  buttonGraceMs: 15000, // 시작·회의 뒤 버튼 대기 (가정)
  meetingsDefault: 3, // 긴급회의 총 횟수 기본
  meetingIntroMs: 2000, // 회의 시작 알림 (가정)
  discussMs: 25000, // 토론
  voteMs: 15000, // 투표
  resultMs: 3500, // 결과
  extendMs: 15000, // 선생님 토론 연장 (가정)
  extendMax: 2, // 회의당 연장 횟수 (가정)
};
export const MEETINGS = [0, 1, 2, 3, 4, 5]; // 선생님 설정 선택지 (긴급회의 총 횟수)

export function playerLabel(colorIndex, characterId) {
  const c = COLORS[colorIndex];
  const ch = CHARACTERS.find((x) => x.id === characterId);
  return `${c ? c.adj : ''} ${ch ? ch.name : ''}`.trim();
}
