// 방해꾼 찾기 상수 (화면용). shared/config.js 의 IMPOSTOR·MEETINGS 를 쓰고,
// 아직 없으면(서버 쪽 작업 전) 05 명세 6절의 기본값으로 대신한다.
// 이름을 직접 import 하면 값이 없을 때 모듈 전체가 깨지므로 묶음(*)으로 읽는다.
import * as CFG from '/shared/config.js';

const DEFAULTS = {
  freezeReach: 100,
  freezeGraceMs: 15000,
  freezeCooldownMs: 25000,
  freezeAfterMeetingMs: 15000,
  sabotageGraceMs: 15000,
  blackoutMs: 8000,
  blackoutVision: 0.35,
  blackoutCooldownMs: 40000,
  lockMs: 7000,
  lockCooldownMs: 45000,
  lockReach: 300,
  disguiseMs: 10000,
  disguisePerGame: 2,
  reportReach: 110,
  buttonReach: 90,
  buttonGraceMs: 15000,
  meetingsDefault: 3,
  meetingIntroMs: 2000,
  discussMs: 25000,
  voteMs: 15000,
  resultMs: 3500,
  extendMs: 15000,
  extendMax: 2,
};

export const IMP = { ...DEFAULTS, ...(CFG.IMPOSTOR || {}) };
export const MEETING_CHOICES = Array.isArray(CFG.MEETINGS) ? CFG.MEETINGS : [0, 1, 2, 3, 4, 5];
export const isImpostor = (room) => !!room && !!room.settings && room.settings.mode === 'impostor';
