// 화면에서 쓰는 규칙 숫자·이름 모음. shared/config.js 의 묶음(CHASE·MAFIA·FOG·LOOT·ITEMS·ENERGY·STREAK)을 쓰고,
// 아직 없으면(서버 쪽 작업 전) 06 명세 10절의 기본값으로 대신한다.
// 이름을 직접 import 하면 값이 없을 때 모듈 전체가 깨지므로 묶음(*)으로 읽는다.
import * as CFG from './shared/config.js';

// 글꼴: 제목·굵은 글씨는 G마켓 산스 Bold(700), 본문은 Medium(500). 못 받으면 아래 대체 글꼴로 그린다.
export const FONT = "'GmarketSans', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
export const font = (px, bold = true) => `${bold ? 700 : 500} ${Math.round(px)}px ${FONT}`;
// 글꼴을 미리 불러온다. 인터넷이 없어도 화면이 멈추지 않게, 실패해도 그냥 넘어간다.
export const fontsReady = (async () => {
  try {
    await Promise.all([document.fonts.load("700 40px 'GmarketSans'"), document.fonts.load("500 40px 'GmarketSans'")]);
  } catch {
    /* 대체 글꼴로 그린다 */
  }
})();

const pick = (name, defaults) => ({ ...defaults, ...(CFG[name] && typeof CFG[name] === 'object' ? CFG[name] : {}) });

// 잠귀신 술래잡기 (10-1절)
export const CH = pick('CHASE', {
  reach: 75,
  cooldownMs: 6000,
  graceMs: 10000,
  thawHoldMs: 1200,
  thawProtectMs: 4000,
  joinProtectMs: 3000,
  deviceReach: 80,
});

// 꿈도둑을 찾아라 (코드 이름 mafia, 10-2절)
export const MAF = pick('MAFIA', {
  freezeReach: 90,
  freezeGraceMs: 20000,
  freezeCooldownMs: 30000,
  freezeAfterMeetingMs: 15000,
  sabotageGraceMs: 20000,
  blackoutMs: 10000,
  blackoutVision: 0.4,
  blackoutCooldownMs: 45000,
  lockMs: 8000,
  lockCooldownMs: 50000,
  lockReach: 300,
  disguiseMs: 12000,
  disguisePerGame: 2,
  reportReach: 120,
  buttonReach: 90,
  buttonGraceMs: 20000,
  meetingsDefault: 3,
  meetingIntroMs: 2500,
  discussMs: 30000,
  voteMs: 20000,
  resultMs: 4000,
  extendMs: 15000,
  extendMax: 2,
});

// 잠 안개 (10-3절). 단계별 값은 [0단계, 1, 2, 3] 배열
export const FOG = pick('FOG', {
  warnMs: 20000,
  radii: [1250, 850, 550],
  slow: 0.75,
  vision: 0.6,
  wrongLockMs: 8000,
  drowsyMs: 10000,
  wakeHoldMs: [1200, 1200, 1000, 800],
  lastNightChaserSpeed: 1.1,
});
// 단계별 배열에서 지금 단계 값 (배열이 아니면 그대로)
export function byStage(v, stage, fallback) {
  if (Array.isArray(v)) return v[Math.max(0, Math.min(stage | 0, v.length - 1))] ?? fallback;
  return typeof v === 'number' ? v : fallback;
}

export const LOOT = pick('LOOT', { openHoldMs: 1500, openReach: 90, lifeMs: 90000 });

// 아이템 (7-4절). id 는 config.js ITEMS 의 키 (me.item, me.effects, event item 의 이름)
//   speed: 이동 배율, vision: 시야 배율, reach: 거리
const ITEM_DEFAULTS = {
  shoes: { name: '반짝 운동화', ms: 6000, speed: 1.4, color: '#ffb547' },
  umbrella: { name: '꿈막이 우산', ms: 20000, color: '#7fe0c4' },
  flashlight: { name: '손전등', ms: 10000, vision: 1.5, color: '#fff3a0' },
  chance: { name: '찬스 카드', ms: 0, color: '#ff9ec4' },
  bugle: { name: '기상 나팔', ms: 0, reach: 250, color: '#ffd84d' },
  windcape: { name: '바람 망토', ms: 6000, speed: 1.3, color: '#5cc8f2' },
  fogcape: { name: '안개 망토', ms: 8000, alpha: 0.3, color: '#9b6bf2' },
  pillow: { name: '긴 베개', ms: 15000, reach: 115, color: '#ff9ec4' },
};
export const ITEMS = {};
for (const [k, v] of Object.entries(ITEM_DEFAULTS)) {
  const c = CFG.ITEMS && typeof CFG.ITEMS[k] === 'object' ? CFG.ITEMS[k] : {};
  ITEMS[k] = { ...v, ...c, name: v.name };
}
export const itemName = (id) => (ITEMS[id] ? ITEMS[id].name : id || '');

export const ENERGY = pick('ENERGY', { chaserLanternCooldownMs: 30000 });
export const STREAK = pick('STREAK', { roomHintAt: 3, exactHintAt: 5, repeatEvery: 5, roomHintMs: 10000, exactHintMs: 20000 });

export const MEETING_CHOICES = Array.isArray(CFG.MEETINGS) ? CFG.MEETINGS : [0, 1, 2, 3, 4, 5];
export const isMafia = (room) => !!room && !!room.settings && room.settings.mode === 'mafia';

// 화면에서 부르는 이름 (모드별)
export function terms(mode) {
  return mode === 'mafia'
    ? { mode: '꿈도둑을 찾아라', chaser: '꿈도둑', student: '학생' }
    : { mode: '잠귀신 술래잡기', chaser: '잠귀신', student: '학생' };
}
