// 첫 화면 + 대기방 + 게임 화면 HUD (선생님·학생 공용).
import { COLORS, CHARACTERS, MODES, MAPS, LIMITS, MINUTES, playerLabel, recommendChasers, chaserCount } from './shared/config.js';
import { drawCharacter } from './characters.js';
import { startGame } from './game.js';
import { initMission } from './mission.js';
import { initQset } from './qset.js';
import { initReport, showTeacherReport, showMyReport } from './report.js';
import { initMeeting } from './meeting.js';
import { initManual } from './manual.js';
import { showLoading, hideLoading, showEnding, hideEnding } from './screens.js';
import { MAF, CH, FOG, MEETING_CHOICES, isMafia, terms, itemName, fontsReady } from './mafiaconst.js';

const $ = (id) => document.getElementById(id);
// 이 화면이 어느 페이지인가: 학생 출입 페이지(./) 또는 선생님 페이지(./teacher/, body data-role="teacher")
const TEACHER_PAGE = document.body.dataset.role === 'teacher';
// 재접속 정보도 페이지별로 따로 둔다 (학생 페이지가 선생님 방을 이어받거나 그 반대가 되지 않게)
const SESSION_KEY = TEACHER_PAGE ? 'sg-session-teacher' : 'sg-session';
// 주소는 모두 "게임 첫 주소(app.js 가 있는 폴더) 기준"으로 만든다. 그래야 http://localhost:3210/ 에서도,
// https://학교주소/lantern/ 처럼 앞부분이 붙은 곳에서도, 선생님 페이지(…/teacher/)에서도 똑같이 동작한다.
const APP_ROOT = new URL('./', import.meta.url);
const pageUrl = (rel) => new URL(rel, APP_ROOT);
// 학생 초대 주소 (예: https://학교주소/lantern/?room=1234)
const inviteUrl = (code) => pageUrl(`./?room=${encodeURIComponent(code)}`);

let ws = null;
let session = loadSession(); // { code, token, role, id }
let room = null;

function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    // 페이지와 맞지 않는 역할의 정보는 쓰지 않는다
    return s && (s.role === 'teacher') === TEACHER_PAGE ? s : null;
  } catch {
    return null;
  }
}
function saveSession(s) {
  session = s;
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* 저장이 막힌 브라우저에서는 새로고침 복구만 안 된다 */
  }
}

// ───────────── 화면 전환 · 알림 ─────────────
let lastView = 'home';
function show(view) {
  lastView = view;
  for (const v of ['home', 'teacher', 'student', 'game']) $('view-' + v).hidden = v !== view;
}
const modeOf = () => (room && room.settings && room.settings.mode) || 'sleep-tag';
const T = () => terms(modeOf());
// 받침이 있으면 a, 없으면 b
function josa(word, a, b) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return b;
  return code % 28 ? a : b;
}
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ───────────── 게임 화면 들어가기·나오기 ─────────────
let game = null; // 지금 돌아가는 게임 화면
let gameStarting = false;
let mission = null; // 퀴즈 창
let myInfo = null; // 내 상황 (서버가 알려 준 것)
let loading = false; // 시작 로딩 화면 중
let pendingIntro = null; // 로딩이 끝나면 보여 줄 역할 안내
let endingShown = false; // 끝 연출을 시작했나
let endingDone = false; // 끝 연출이 끝났나

function isPlayer() {
  return session && session.role === 'player' && !!myInfo;
}
function iAmChaser() {
  return isPlayer() && myInfo.role === 'chaser';
}
function mePlayer() {
  return room ? room.players.find((x) => x.id === session.id) : null;
}

function renderGameHud() {
  const mafia = isMafia(room);
  const p = room.progress || { solved: 0, goal: 1 };
  const pct = Math.min(100, Math.round((p.solved / p.goal) * 100));
  $('g-bar').style.height = pct + '%';
  $('g-bar').style.setProperty('--pct', pct + '%');
  $('g-progress').textContent = `${pct}%`;
  $('g-gauge').setAttribute('aria-valuenow', pct);
  const player = isPlayer();
  const chaser = iAmChaser();
  const me = mePlayer();
  const frozen = !!(me && me.frozen);
  const done = player && myInfo.solved >= myInfo.missions;
  // 꿈도둑도 "내 랜턴 n/m" 으로 똑같이 보인다 (옆에서 화면을 봐도 정체가 드러나지 않게)
  const mine = $('g-missions');
  mine.textContent = !player ? `랜턴 ${p.solved}/${p.goal}` : chaser && !mafia ? '나는 잠귀신' : done ? '내 랜턴 다 켰어요!' : `내 랜턴 ${myInfo.solved}/${myInfo.missions}`;
  mine.classList.toggle('chaser', chaser && !mafia);
  renderStreak();
  renderEnergy();
  renderBag();
  const notebookOn = room.settings.notebook !== false;
  $('g-notebook').hidden = !player || !notebookOn;
  $('g-map').hidden = !player;
  if (game) game.setNotebook(notebookOn);
  $('g-meetings').hidden = !mafia;
  if (mafia) $('g-meetings').textContent = `종 ${room.meetingsLeft ?? room.settings.meetings ?? MAF.meetingsDefault}번 남음`;
  if (player) $('g-hint').textContent = roleHint({ mafia, chaser, frozen, done, notebookOn });

  // 게임 끝: 먼저 끝 연출(승리!/아쉬워요) → 결과 창
  if (room.over && !endingShown) startEnding();
  $('g-over').hidden = !room.over || !endingDone;
  if (room.over) {
    renderOver(mafia);
    cancelHold();
    if (mission) mission.hide();
    closeSaboMenu();
  }
  // 꿈도둑을 찾아라: 회의 화면, 꿈에 빠진 자리, 안개 뿌리기·문 막기
  if (mafia) {
    const inMeeting = !!room.meeting && !room.over;
    if (meetingView) meetingView.update(inMeeting ? room.meeting : null, { teacher: session.role === 'teacher', myId: session.id });
    if (game) {
      game.setMarks(room.marks || []);
      game.setSabo(room.sabo || null);
      if (inMeeting !== wasMeeting) game.snapAll(room.players); // 회의 시작·끝: 서버가 정한 자리로
      game.setMeeting(inMeeting);
    }
    if (inMeeting && !wasMeeting) {
      cancelHold();
      closeSaboMenu();
      setMinimap(false);
      if (mission) mission.hide();
    }
    wasMeeting = inMeeting;
  }
  if (game) {
    game.setFog(room.fog || null);
    game.setBonus(room.bonusTerminals || []);
  }
  $('g-myreport').hidden = !(room.over && session.role === 'player');
  if (session.role === 'teacher') renderSide();
  renderAction();
}

function roleHint({ mafia, chaser, frozen, done, notebookOn }) {
  if (mafia) {
    if (iAmGhost()) return '꿈에 빠졌어요 — 랜턴을 계속 켜서 친구들을 도와요! (회의 때는 말하지 않기)';
    if (chaser) return '들키지 말고 학생을 꿈에 빠뜨려요 (F)! 작전은 G. 퀴즈를 맞히면 꿈 구슬이 생겨요';
    if (done) return '내 랜턴 다 켰어요! 꿈에 빠진 친구를 보면 호루라기, 수상하면 회의 종';
    return '꺼진 랜턴에서 퀴즈를 풀어요. 꿈에 빠진 친구를 보면 호루라기!';
  }
  if (chaser) return '학생에게 다가가 [꿈에 빠뜨리기]! 꿈 구슬은 랜턴 퀴즈로 모아요. 개구멍·미끄럼틀은 못 타요';
  if (frozen) return notebookOn ? '꿈에 빠졌어요! 친구가 깨워 줄 때까지 퀴즈 수첩(B)으로 공부해요' : '꿈에 빠졌어요! 친구가 와서 깨워 주길 기다려요';
  if (done) return '내 랜턴 다 켰어요! 꿈에 빠진 친구를 찾아 깨워 주세요';
  return '은은히 빛나는 꺼진 랜턴을 찾아가 스페이스!';
}

function renderOver(mafia) {
  const studentsWin = room.over.winner === 'students';
  $('g-over-roles').textContent = '';
  $('g-over-chaser').textContent = '';
  if (mafia) {
    const title = {
      all_found: '꿈도둑을 모두 찾았어요! 학생 팀 승리',
      restored: '아침이 밝았어요! 학생 팀 승리',
      outnumbered: '꿈도둑 승리! (학생이 너무 적어요)',
      time_up: '꿈도둑 승리! (아침이 오지 않았어요)',
    };
    const text = {
      all_found: '모닥불 회의에서 꿈도둑을 모두 찾아냈어요.',
      restored: '모든 랜턴에 불이 켜져 새벽빛이 가득 찼어요.',
      outnumbered: '깨어 있는 학생 수가 꿈도둑 수보다 많지 않아요.',
      time_up: '아침이 오기 전에 랜턴을 다 켜지 못했어요.',
    };
    $('g-over-title').textContent = title[room.over.reason] || (studentsWin ? '학생 팀 승리' : '꿈도둑 승리!');
    $('g-over-text').textContent = text[room.over.reason] || '';
    const names = room.players.filter((p) => p.role === 'chaser').map((p) => playerLabel(p.color, p.character));
    if (names.length) $('g-over-roles').textContent = `꿈도둑은 ${names.join(', ')}${josa(names[names.length - 1], '이었어요', '였어요')}`;
  } else {
    const why = {
      restored: '모든 랜턴에 불이 켜져 새벽빛이 가득 찼어요.',
      time_up: '아침이 오기 전에 랜턴을 다 켜지 못했어요.',
      all_asleep: '모두 꿈에 빠져 버렸어요.',
      all_frozen: '모두 꿈에 빠져 버렸어요.',
    };
    $('g-over-title').textContent = studentsWin ? '아침이 밝았어요! 학생 팀 승리' : '잠귀신 승리!';
    $('g-over-text').textContent = why[room.over.reason] || '';
    const cs = room.over.chaserSolved;
    const n = Array.isArray(cs) ? cs.reduce((a, c) => a + (c.solved || 0), 0) : typeof cs === 'number' ? cs : null;
    if (n != null) $('g-over-chaser').textContent = `잠귀신이 맞힌 퀴즈 ${n}개 — 잠귀신도 열심히 공부했어요!`;
  }
}

function startEnding() {
  endingShown = true;
  endingDone = false;
  const mafia = isMafia(room);
  const winner = room.over.winner; // 'students' | 'chasers'
  const t = T();
  const teacher = session.role === 'teacher';
  const myTeam = iAmChaser() ? 'chasers' : 'students';
  const result = teacher || !myInfo ? 'neutral' : myTeam === winner ? 'win' : 'lose';
  const look = (p) => ({ kind: p.character, color: (COLORS[p.color] || COLORS[0]).hex });
  const chasers = room.players.filter((p) => p.role === 'chaser');
  const winners = room.players.filter((p) => (winner === 'chasers' ? p.role === 'chaser' : p.role !== 'chaser'));
  const teamName = winner === 'students' ? '학생 팀 승리' : `${t.chaser} 승리`;
  const opts = {
    result,
    title: result === 'win' ? '승리!' : result === 'lose' ? '아쉬워요' : teamName,
    sub: result === 'neutral' ? '' : teamName,
    chars: (mafia ? chasers : winners).slice(0, 10).map(look),
    horns: mafia,
  };
  if (mafia) opts.sub = (opts.sub ? opts.sub + ' · ' : '') + '꿈도둑은 이 친구들이었어요!';
  showEnding(opts).then(() => {
    endingDone = true;
    if (room && room.phase === 'game') renderGameHud();
  });
}

// ───────────── 연속 정답 별 · 꿈 구슬 · 가방 ─────────────
function renderStreak() {
  const box = $('g-stars');
  const n = isPlayer() ? myInfo.streak || 0 : 0;
  box.hidden = !isPlayer() || typeof myInfo.streak !== 'number';
  if (!box.hidden) {
    const sig = String(n);
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.replaceChildren();
      for (let i = 0; i < 3; i++) {
        const s = document.createElement('span');
        s.className = 'star' + (i < Math.min(n, 3) ? ' on' : '');
        box.append(s);
      }
      if (n >= 5) {
        const tx = document.createElement('span');
        tx.className = 'streak-txt';
        tx.textContent = `연속 ${n}!`;
        box.append(tx);
      }
      box.setAttribute('aria-label', `연속 정답 ${n}개`);
    }
  }
  $('g-hintbank').hidden = !(isPlayer() && myInfo.hintBank > 0);
}
function renderEnergy() {
  const el = $('g-energy');
  const show = iAmChaser() && typeof myInfo.energy === 'number' && !iAmGhost();
  el.hidden = !show;
  if (!show) return;
  const max = myInfo.energyMax || Math.max(myInfo.energy, 1);
  const sig = `${myInfo.energy}/${max}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.replaceChildren();
  const label = document.createElement('span');
  label.textContent = '꿈 구슬';
  el.append(label);
  for (let i = 0; i < max; i++) {
    const o = document.createElement('span');
    o.className = 'orb' + (i < myInfo.energy ? ' on' : '');
    el.append(o);
  }
  el.setAttribute('aria-label', `꿈 구슬 ${myInfo.energy}개 (최대 ${max}개)`);
}
function renderBag() {
  const on = isPlayer() && room.settings.fogLoot !== false;
  const item = on ? myInfo.item || null : null;
  for (const id of ['g-bag', 'g-bag-mini']) {
    $(id).hidden = !on;
    $(id).classList.toggle('on', !!item);
  }
  $('g-bag').classList.toggle('empty-bag', !item);
  $('g-bag-name').textContent = item ? itemName(item) : '가방 비어 있음';
  $('g-bag-mini').querySelector('.mini-text').textContent = item ? itemName(item).split(' ').pop() : '가방';
}
function useItem() {
  if (!isPlayer() || !room || room.over || (isMafia(room) && room.meeting)) return;
  if (!myInfo.item) return toast('가방이 비어 있어요. 보급 상자를 찾아 열어 보세요!');
  if (myInfo.item === 'chance') return toast('찬스 카드는 퀴즈 창에서 [찬스 카드 쓰기]로 써요');
  send({ t: 'useItem' });
}

// ───────────── 꿈도둑을 찾아라 HUD ─────────────
let meetingView = null; // 회의 화면
let wasMeeting = false;
let saboOpen = false;
let mapOpen = false;
// 다시 쓸 수 있는 때 (이 화면의 시계 기준)
const ready = { freeze: 0, blackout: 0, lock: 0, button: 0 };

function iAmGhost() {
  if (!myInfo || !isMafia(room)) return false;
  if (myInfo.ghost) return true;
  const me = mePlayer();
  return !!(me && me.ghost);
}
// 소식 띠: 안개 뿌리기 중이면 그 알림이, 아니면 최근 소식이 보인다
let news = { text: '', until: 0, kind: '' };
function pushNews(text, kind = '', ms = 4500) {
  news = { text, until: performance.now() + ms, kind };
  renderAlert();
}
let bigTimer = 0;
function bigNews(text, ms = 2000) {
  const el = $('g-big');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(bigTimer);
  bigTimer = setTimeout(() => (el.hidden = true), ms);
}
function renderAlert() {
  const el = $('g-alert');
  if (!room || room.phase !== 'game' || room.over || (isMafia(room) && room.meeting)) return (el.hidden = true);
  const left = game && isMafia(room) ? game.blackoutLeft() : 0;
  if (left > 0) {
    const big = session.role === 'player' && game.blackoutHitsMe();
    el.hidden = false;
    el.className = 'hud hud-alert chip' + (big ? ' big' : '');
    el.textContent = big ? `안개 뿌리기! ${Math.ceil(left / 1000)}` : '안개 뿌리기 중';
    return;
  }
  if (news.text && performance.now() < news.until) {
    el.hidden = false;
    el.className = 'hud hud-alert chip' + (news.kind ? ' ' + news.kind : '');
    el.textContent = news.text;
    return;
  }
  el.hidden = true;
}
function closeSaboMenu() {
  saboOpen = false;
  $('g-sabo-menu').hidden = true;
  $('g-sabo').setAttribute('aria-expanded', 'false');
}
function setMinimap(v) {
  mapOpen = !!v && !!game;
  $('g-minimap').hidden = !mapOpen;
  $('g-map').setAttribute('aria-pressed', String(mapOpen));
  if (game) game.setMinimap(mapOpen ? $('g-minimap-canvas') : null);
}
const secsLeft = (at) => Math.ceil((at - performance.now()) / 1000);
// 꿈도둑만 보는 버튼 (꿈에 빠뜨리기 F · 작전 G)
function renderMafiaButtons(hideAll) {
  const chaser = isMafia(room) && iAmChaser() && !iAmGhost();
  const off = hideAll || !chaser;
  $('g-freeze').hidden = off;
  $('g-sabo').hidden = off;
  if (off) return closeSaboMenu();
  const noOrb = typeof myInfo.energy === 'number' && myInfo.energy <= 0;
  const w = secsLeft(ready.freeze);
  $('g-freeze').disabled = w > 0 || noOrb;
  $('g-freeze-label').textContent = noOrb ? '꿈 구슬 없음' : w > 0 ? `꿈에 빠뜨리기 (${w})` : '꿈에 빠뜨리기';
  $('g-freeze-sub').textContent = noOrb ? '퀴즈로 채워요' : 'F';
  const wb = secsLeft(ready.blackout);
  const wl = secsLeft(ready.lock);
  const dl = myInfo.disguiseLeft ?? MAF.disguisePerGame;
  const lastNight = game && game.fogInfo() && game.fogInfo().stage >= 3;
  $('g-sabo-blackout').disabled = wb > 0 || lastNight;
  $('g-sabo-blackout').textContent = lastNight ? '1 안개 뿌리기 (마지막 밤엔 못 써요)' : wb > 0 ? `1 안개 뿌리기 (${wb})` : '1 안개 뿌리기';
  $('g-sabo-lock').disabled = wl > 0;
  $('g-sabo-lock').textContent = wl > 0 ? `2 문 막기 (${wl})` : '2 문 막기';
  $('g-sabo-disguise').disabled = dl <= 0;
  $('g-sabo-disguise').textContent = `3 변신 (${dl}번 남음)`;
}
function doSabotage(kind) {
  if (!iAmChaser() || iAmGhost() || !room || room.over || room.meeting) return;
  const btn = { blackout: 'g-sabo-blackout', lock: 'g-sabo-lock', disguise: 'g-sabo-disguise' }[kind];
  if ($(btn).disabled) return;
  send({ t: 'sabotage', kind });
  closeSaboMenu();
}
function doFreeze() {
  if (!iAmChaser() || iAmGhost() || !room || room.over || room.meeting) return;
  if ($('g-freeze').disabled) {
    if (typeof myInfo.energy === 'number' && myInfo.energy <= 0) toast('꿈 구슬이 없어요 — 퀴즈를 풀어 채워요');
    return;
  }
  send({ t: 'tag' });
}
function toggleSabo() {
  if (!iAmChaser() || iAmGhost() || !room || room.over || room.meeting) return;
  saboOpen = !saboOpen;
  $('g-sabo-menu').hidden = !saboOpen;
  $('g-sabo').setAttribute('aria-expanded', String(saboOpen));
  if (saboOpen) renderMafiaButtons(false);
}

// ───────────── 선생님 화면: 메뉴 · 참가자 상태판 ─────────────
let reveal = false;
let showRoles = false; // 꿈도둑을 찾아라: 정체 칸 보이기 (기본 숨김, TV 대비)
let sideOpen = true;
function renderSide() {
  const box = $('g-side-body');
  box.replaceChildren();
  $('g-side-toggle').textContent = `참가자 상태판 (${room.players.length}명)`;
  $('g-side-toggle').setAttribute('aria-expanded', String(sideOpen));
  box.hidden = !sideOpen;
  if (!sideOpen) return;
  const mafia = isMafia(room);
  const goal = room.settings.missions;
  for (const p of room.players) {
    const row = document.createElement('div');
    row.className = 'side-row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = (COLORS[p.color] || COLORS[0]).hex;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${p.name} · ${playerLabel(p.color, p.character)}`;
    row.append(dot, who);
    const tag = (text, cls) => {
      const s = document.createElement('span');
      s.className = 'tag' + (cls ? ' ' + cls : '');
      s.textContent = text;
      row.append(s);
      return s;
    };
    if (!mafia) {
      if (!p.connected) tag('끊김', 'off');
      else if (p.role === 'chaser') tag('잠귀신', 'chaser');
      else if (p.frozen) tag('꿈에 빠짐', 'frozen');
      else tag(`${p.solved}/${goal}`);
    } else {
      tag(`${p.solved ?? 0}/${goal}`);
      if (!p.connected) tag('끊김', 'off');
      else if (p.ejected) tag('추방됨', 'ejected');
      else if (p.ghost) {
        const s = tag('꿈에 빠짐', 'ghost');
        const h = document.createElement('i');
        h.className = 'halo-mini';
        h.setAttribute('aria-hidden', 'true');
        s.prepend(h);
      } else tag('깨어 있음');
      if (showRoles) tag(p.role === 'chaser' ? '꿈도둑' : '학생', p.role === 'chaser' ? 'role' : '');
    }
    box.append(row);
  }
}
function setRoles(v) {
  showRoles = v;
  $('g-roles').setAttribute('aria-pressed', String(v));
  $('g-roles').textContent = v ? '정체 숨김' : '정체 표시';
  if (game) game.setRoles(v);
  if (room && room.phase === 'game') renderSide();
}
function setReveal(v) {
  reveal = v;
  $('g-reveal').setAttribute('aria-pressed', String(v));
  $('g-reveal').textContent = v ? '모두 위치 숨김' : '모두 위치 표시';
  const ch = T().chaser;
  $('g-hint').textContent = v ? '' : `학생 위치는 숨겨져 있어요 (TV에 띄워도 ${ch}${josa(ch, '이', '가')} 볼 수 없어요)`;
  if (game) game.setReveal(v);
}
function setTeacherMenu(v) {
  $('g-tmenu').hidden = !v;
  $('g-tmenu-btn').setAttribute('aria-expanded', String(!!v));
}

// ───────────── 큰 행동 버튼 (스페이스 하나) ─────────────
let action = null; // 지금 할 수 있는 행동 (game.js pickAction)
let hold = null; // 꾹 누르는 중 { kind:'thaw'|'loot', id, timer }
let notebookPending = false; // 퀴즈 수첩을 열어 달라고 보냈다

function renderAction() {
  const btn = $('g-action');
  const busy = !room || !!room.over || loading || (mission && mission.isOpen()) || (isMafia(room) && !!room.meeting);
  if (room && isMafia(room)) renderMafiaButtons(busy || !isPlayer());
  else {
    $('g-freeze').hidden = true;
    $('g-sabo').hidden = true;
  }
  const hide = !action || action.type === 'none' || busy;
  btn.hidden = hide;
  // 안내 줄: 장치 앞·출구 쪽 안내가 있으면 그것을 먼저
  if (isPlayer() && room && !room.over) {
    const base = roleHint({ mafia: isMafia(room), chaser: iAmChaser(), frozen: !!(mePlayer() && mePlayer().frozen), done: myInfo.solved >= myInfo.missions, notebookOn: room.settings.notebook !== false });
    $('g-hint').textContent = action && action.hint && !busy ? action.hint : base;
  }
  if (hide) return;
  let wait = action.readyAt ? secsLeft(action.readyAt) : 0;
  let label = action.label;
  let disabled = !!action.disabled;
  if (action.type === 'bell') {
    // 남은 횟수가 없거나 이미 썼으면 회색. 꿈도둑에게도 똑같이 보인다 (눌러도 안 됨)
    const left = room.meetingsLeft ?? room.settings.meetings ?? MAF.meetingsDefault;
    wait = secsLeft(ready.button);
    disabled = left <= 0 || !!(myInfo && myInfo.usedButton);
    label = left <= 0 ? '종 (0번 남음)' : myInfo && myInfo.usedButton ? '종 (이미 씀)' : '종 울리기';
    action.sub = left > 0 && !(myInfo && myInfo.usedButton) ? `${left}번 남음` : '';
  }
  if (action.type === 'device' && wait > 0) label = `${action.short || '장치'} (${wait})`;
  else if (wait > 0) label = `${label} (${wait})`;
  const off = wait > 0 || disabled;
  if (hold && off) cancelHold();
  btn.disabled = off;
  btn.style.setProperty('--c', off ? '#b9b4c9' : action.color || '#ffb547');
  btn.classList.toggle('dark', !off && action.type === 'tag');
  $('g-action-label').textContent = label;
  $('g-action-sub').textContent = action.sub || '';
}
// 태블릿·휴대폰 화면 맞추기
// - 가상 키보드가 올라오면 보이는 높이(--vvh)와 위치(--vvtop)를 CSS 에 알려 퀴즈 창이 입력칸을 가리지 않게 한다
// - 아이폰의 두 손가락 확대·두 번 톡 확대를 막는다 (게임 화면 조작과 겹치지 않게)
function setupViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const update = () => {
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    root.style.setProperty('--vvh', Math.round(h) + 'px');
    root.style.setProperty('--vvtop', Math.round(top) + 'px');
    // 키보드가 열렸는가: 보이는 높이가 창 높이보다 많이 작고 글자칸에 초점이 있다
    const el = document.activeElement;
    const typing = !!el && /^(INPUT|TEXTAREA)$/.test(el.tagName);
    const kb = typing && h < window.innerHeight * 0.8;
    root.classList.toggle('kb-open', kb || (typing && window.innerHeight < 420 && matchMedia('(pointer: coarse)').matches));
    if (typing && el.id === 'm-input') setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 50);
  };
  if (vv) {
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
  }
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  document.addEventListener('focusin', () => setTimeout(update, 300));
  document.addEventListener('focusout', () => setTimeout(update, 300));
  update();
  // 왼쪽 위·오른쪽 위 정보줄의 실제 아래 끝을 재서 새벽빛 게이지가 그 아래에 오게 한다 (줄바꿈되어도 겹치지 않게)
  if (window.ResizeObserver) {
    const game = $('view-game');
    const left = game.querySelector('.hud-left');
    const right = game.querySelector('.hud-right');
    const measure = () => {
      const top = game.getBoundingClientRect().top;
      const lb = left.getBoundingClientRect().bottom - top;
      // 오른쪽은 달 시계·안개 칩까지만 (펼친 선생님 메뉴는 빼고)
      let rb = 0;
      for (const el of right.children) if (!el.hidden && el.id !== 'g-tmenu') rb = Math.max(rb, el.getBoundingClientRect().bottom - top);
      game.style.setProperty('--hudl-b', Math.round(lb) + 'px');
      game.style.setProperty('--hudr-b', Math.round(rb) + 'px');
    };
    const ro = new ResizeObserver(measure);
    ro.observe(left);
    ro.observe(right);
    for (const el of right.children) ro.observe(el);
    window.addEventListener('resize', () => requestAnimationFrame(measure));
  }
  // 아이폰 사파리는 user-scalable=no 를 무시하므로 확대 몸짓을 직접 막는다
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  // 게임 화면에서 두 손가락 이상 닿으면 확대 대신 조작으로 쓴다 (조이스틱 + 버튼 동시)
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && !$('view-game').hidden) e.preventDefault();
    },
    { passive: false },
  );
}
function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  $('g-action').classList.remove('holding');
  send({ t: hold.kind === 'loot' ? 'lootCancel' : 'thawCancel' });
  if (game) game.setWaking(null);
  hold = null;
}
function startHold(kind, id, ms, startMsg, endMsg) {
  send(startMsg);
  const btn = $('g-action');
  btn.style.setProperty('--hold', ms / 1000 + 's');
  btn.classList.remove('holding');
  void btn.offsetWidth; // 고리 채우기를 처음부터
  btn.classList.add('holding');
  if (kind === 'thaw' && game) game.setWaking(id, ms);
  hold = {
    kind,
    id,
    timer: setTimeout(() => {
      hold = null;
      btn.classList.remove('holding');
      if (game) game.setWaking(null);
      send(endMsg);
    }, ms),
  };
}
function openNotebook() {
  if (!isPlayer() || !room || room.over || loading || room.settings.notebook === false) return;
  if (isMafia(room) && room.meeting) return;
  if (mission && mission.isOpen()) return;
  notebookPending = true;
  send({ t: 'open', terminal: 'notebook' });
}
function pressDown() {
  if (!action || !room || room.over || loading || $('g-action').hidden || $('g-action').disabled) {
    if (action && action.type === 'tag' && action.disabled) toast('꿈 구슬이 없어요 — 퀴즈를 풀어 채워요');
    return;
  }
  if (isMafia(room) && room.meeting) return;
  const a = action;
  if (a.type === 'terminal') {
    notebookPending = false;
    send({ t: 'open', terminal: a.id });
  } else if (a.type === 'device') send({ t: 'use', device: a.id });
  else if (a.type === 'bell') {
    // 꿈도둑은 버튼이 보여도 울릴 수 없다 (서버도 막는다)
    if (iAmChaser()) toast('지금은 울릴 수 없어요');
    else send({ t: 'emergency' });
  } else if (a.type === 'alarm') send({ t: 'alarm', mark: a.id });
  else if (a.type === 'tag') send({ t: 'tag' });
  else if (a.type === 'notebook') openNotebook();
  else if (a.type === 'thaw' && !hold) startHold('thaw', a.id, a.hold || CH.thawHoldMs, { t: 'thawStart', id: a.id }, { t: 'thawEnd' });
  else if (a.type === 'loot' && !hold) startHold('loot', a.id, a.hold || 1500, { t: 'lootStart', crate: a.id }, { t: 'lootEnd' });
}
function pressUp() {
  cancelHold();
}

// ───────────── 남은 시간 (달 시계) · 안개 단계 ─────────────
let endsAt = 0; // 게임이 끝나는 때 (이 화면의 시계 기준)
let pausedLeft = null; // 회의 중 멈춘 남은 시간(ms). 회의가 아니면 null
function renderClock() {
  if (!room || room.phase !== 'game') return;
  const ms = pausedLeft != null ? pausedLeft : endsAt - performance.now();
  const left = room.over ? 0 : Math.max(0, ms);
  renderAlert();
  $('g-clock').textContent = mmss(left);
  $('g-clock').closest('.moon').classList.toggle('hurry', left <= 60000 && !room.over);
  renderFogChip();
  renderAction();
}
setInterval(renderClock, 250);
function renderFogChip() {
  const el = $('g-fog');
  const f = game && room && room.settings.fogLoot !== false && !room.over ? game.fogInfo() : null;
  if (!f) return (el.hidden = true);
  el.hidden = false;
  const warnMs = FOG.warnMs || 20000;
  const soon = f.nextMsLeft != null && f.nextMsLeft <= warnMs;
  el.classList.toggle('warn', soon);
  if (f.stage <= 0) el.textContent = f.nextMsLeft != null ? `다음 안개까지 ${mmss(f.nextMsLeft)}` : '안개 없음';
  else if (f.shrinking) el.textContent = `안개 ${f.stage}단계 · 좁혀지는 중`;
  else if (f.nextMsLeft != null) el.textContent = `안개 ${f.stage}단계 · 다음 안개까지 ${mmss(f.nextMsLeft)}`;
  else el.textContent = f.stage >= 3 ? '안개 3단계 · 마지막 밤' : `안개 ${f.stage}단계`;
}

function showIntro(role, info) {
  if (loading) {
    pendingIntro = [role, info];
    return;
  }
  const el = $('g-intro');
  if (isMafia(room)) {
    const mates = ((info && info.mates) || [])
      .map((id) => room.players.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => playerLabel(p.color, p.character));
    $('g-intro-title').textContent = role === 'chaser' ? '당신은 꿈도둑입니다' + (mates.length ? ` (동료: ${mates.join(', ')})` : '') : '당신은 학생입니다';
    $('g-intro-text').textContent =
      role === 'chaser'
        ? '들키지 말고 학생을 꿈에 빠뜨려요 (F). 작전은 G.\n퀴즈를 맞히면 꿈 구슬이 생겨요.'
        : '랜턴을 켜서 새벽빛을 모으고, 숨어 있는 꿈도둑을 찾아내요!\n꿈에 빠진 친구를 보면 호루라기!';
  } else {
    $('g-intro-title').textContent = role === 'chaser' ? '너는 잠귀신!' : '너는 학생!';
    $('g-intro-text').textContent =
      role === 'chaser'
        ? '학생을 꿈에 빠뜨려 아침이 오지 못하게 막아요.\n꿈 구슬이 있어야 해요 — 랜턴 퀴즈를 맞히면 생겨요.\n개구멍·미끄럼틀은 못 타요.'
        : '꺼진 랜턴을 찾아 퀴즈를 맞히고 불을 켜요.\n꿈에 빠진 친구는 옆에서 꾹 눌러 깨워 줘요.\n개구멍은 잠귀신이 못 따라와요.';
  }
  el.classList.toggle('chaser', role === 'chaser');
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 5000);
}

async function runLoading(ms) {
  loading = true;
  if (game) game.setPaused(true);
  renderAction();
  let mapName = (MAPS.find((m) => m.id === room.settings.map) || {}).name || '';
  try {
    const data = await (await fetch(pageUrl(`./maps/${room.settings.map}.json`))).json();
    if (data && data.name) mapName = data.name;
  } catch {
    /* 이름은 MAPS 목록 것으로 */
  }
  await showLoading({ mode: modeOf(), modeName: T().mode, mapName, ms });
  loading = false;
  if (game) game.setPaused(!!(mission && mission.isOpen()));
  if (pendingIntro && room && room.phase === 'game' && !room.over) showIntro(...pendingIntro);
  pendingIntro = null;
  renderAction();
}

async function enterGame() {
  // 회의 중에는 게임 시계가 멈춘다: 회의가 시작될 때의 남은 시간을 그대로 보여 준다
  const inMeeting = isMafia(room) && !!room.meeting && !room.over;
  if (inMeeting) {
    if (pausedLeft == null) pausedLeft = endsAt ? Math.max(0, endsAt - performance.now()) : room.timeLeft || 0;
  } else {
    pausedLeft = null;
    endsAt = performance.now() + (room.timeLeft || 0);
  }
  if (game) {
    renderGameHud();
    renderClock();
    return game.setPlayers(room.players, !!room.over);
  }
  if (gameStarting) return;
  gameStarting = true;
  const fromLobby = lastView === 'teacher' || lastView === 'student';
  show('game');
  const isTeacher = session.role === 'teacher';
  const me = mePlayer();
  $('g-label').textContent = isTeacher ? `${room.code}번 방 · 선생님 화면` : me ? playerLabel(me.color, me.character) : '';
  const mafia = isMafia(room);
  $('g-tmenu-btn').hidden = !isTeacher;
  setTeacherMenu(false);
  $('g-side').hidden = !isTeacher;
  $('g-roles').hidden = !(isTeacher && mafia);
  if (isTeacher) setReveal(false);
  if (isTeacher) setRoles(false);
  action = null;
  wasMeeting = false;
  endingShown = false;
  endingDone = false;
  news = { text: '', until: 0, kind: '' };
  closeSaboMenu();
  setMinimap(false);
  $('g-action').hidden = true;
  $('g-intro').hidden = true;
  $('g-over').hidden = true;
  // 시작 로딩 화면: 게임이 막 시작됐으면 3.5초, 도중 입장·새로고침이면 1.5초 (끝난 판이면 안 보여 줌)
  const loadingDone = room.over ? Promise.resolve() : runLoading(fromLobby ? 3500 : 1500);
  renderGameHud();
  renderClock();
  try {
    const g = await startGame({
      canvas: $('game-canvas'),
      mapId: room.settings.map,
      mode: modeOf(),
      role: session.role,
      myId: session.id,
      players: room.players,
      send,
      onContext(ctx) {
        if (hold && !(ctx && ctx.type === hold.kind && ctx.id === hold.id)) cancelHold();
        action = ctx;
        renderAction();
      },
      onKey(dir, which = 'act') {
        if (which === 'act') {
          if (dir === 'down') pressDown();
          else pressUp();
          return;
        }
        if (dir !== 'down' || !room || loading) return;
        if (which === 'map') setMinimap(!mapOpen);
        else if (which === 'bag') useItem();
        else if (which === 'notebook') openNotebook();
        if (!isMafia(room)) return;
        if (which === 'freeze') doFreeze();
        else if (which === 'sabo') toggleSabo();
        else if (which === 'sabo1') doSabotage('blackout');
        else if (which === 'sabo2') doSabotage('lock');
        else if (which === 'sabo3') doSabotage('disguise');
      },
    });
    // 맵을 읽는 사이에 게임이 끝났으면 바로 정리한다
    if (!room || room.phase !== 'game') g.stop();
    else {
      game = g;
      game.setReveal(reveal);
      game.setRoles(showRoles);
      game.setPlayers(room.players, !!room.over);
      if (myInfo) game.setMe(myInfo);
      if (lastCrates) game.setCrates(lastCrates);
      if (loading) game.setPaused(true);
      if (isMafia(room)) {
        game.setMarks(room.marks || []);
        game.setSabo(room.sabo || null);
        game.setMeeting(!!room.meeting && !room.over);
        wasMeeting = !!room.meeting && !room.over;
      }
      renderGameHud();
    }
  } catch (e) {
    console.error(e);
    toast('맵을 불러오지 못했어요. 새로고침해 주세요.');
  }
  gameStarting = false;
  await loadingDone;
}
function leaveGame() {
  if (game) game.stop();
  game = null;
  myInfo = null;
  action = null;
  wasMeeting = false;
  pausedLeft = null;
  endsAt = 0;
  lastCrates = null;
  cancelHold();
  hideLoading();
  hideEnding();
  loading = false;
  pendingIntro = null;
  endingShown = false;
  endingDone = false;
  if (mission) mission.hide();
  if (meetingView) meetingView.hide();
  closeSaboMenu();
  setMinimap(false);
  $('g-alert').hidden = true;
  $('g-big').hidden = true;
}
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ───────────── 서버 연결 ─────────────
function send(msg) {
  if (msg.t === (TEACHER_PAGE ? 'join' : 'create')) return; // 학생 페이지에서 방 만들기·선생님 페이지에서 학생 입장은 하지 않는다
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else toast('서버에 연결하는 중이에요. 잠시 뒤 다시 눌러 주세요.');
}

function connect() {
  // 페이지 주소 기준 ./ws (예: https://학교주소/lantern/ → wss://학교주소/lantern/ws)
  const url = pageUrl('./ws');
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(url);
  ws.onopen = () => {
    $('offline').hidden = true;
    if (session) ws.send(JSON.stringify({ t: 'resume', code: session.code, token: session.token }));
  };
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (onMessage[m.t]) onMessage[m.t](m);
  };
  ws.onclose = () => {
    $('offline').hidden = false;
    setTimeout(connect, 1500);
  };
}

let lastCrates = null;
let lastHintSig = '';
const STREAK_REWARD = {
  room: '보급 상자가 있는 방 힌트가 나왔어요!',
  exact: '보급 상자 자리가 반짝여요! 작은 지도에도 표시했어요',
  bank: '지금은 상자가 없어서 다음 택배 힌트로 모아 뒀어요',
};
// 서버가 보내는 'event' 중 소식 띠·알림에 쓰는 것
function onNewsEvent(m) {
  const me = session && m.id === session.id;
  switch (m.kind) {
    case 'freeze':
      if (me) {
        toast('꿈에 빠졌어요! 머리 위에 고리가 생겼어요. 랜턴은 계속 켤 수 있어요');
        if (myInfo) myInfo.ghost = true;
        if (mission) mission.hide();
      }
      break;
    case 'tag':
      if (me && !isMafia(room)) {
        if (m.by === 'fog') pushNews('안개 속에서 잠들어 버렸어요! 친구가 깨워 줄 거예요', 'big');
        else toast('꿈에 빠졌어요! 친구가 깨워 줄 때까지 기다려요');
        if (mission && !mission.isNotebook()) mission.hide();
      }
      break;
    case 'drowsySleep':
      pushNews('안개 속에서 잠들어 버렸어요! 친구가 깨워 줄 거예요', 'big');
      break;
    case 'fogWarn': {
      const s = Math.max(1, Math.round((m.inMs ?? FOG.warnMs ?? 20000) / 1000));
      pushNews(`${s}초 뒤 잠 안개가 몰려와요! 빛 구역 안으로!`, 'big', 6000);
      bigNews('잠 안개가 몰려와요!');
      break;
    }
    case 'fogStart':
      if (m.stage >= 3) pushNews('마지막 밤! 안개가 가장 좁아져요. 빛 구역 안으로!', 'big', 6000);
      else pushNews(`잠 안개 ${m.stage}단계! 빛 구역이 좁아지고 있어요`, 'big', 5000);
      break;
    case 'bonusLanterns':
      pushNews('마지막 밤! 빛 구역에 임시 랜턴 2개가 생겼어요', '', 6000);
      break;
    case 'drop':
      bigNews('부엉이 택배 도착!');
      pushNews('부엉이 택배가 도착했어요! 보급 상자가 어느 방 가구 속에 숨겨졌어요. 찾아서 써 보세요!', 'loot', 7000);
      break;
    case 'crateOpened':
      pushNews('누군가 보급 상자를 열었어요!', 'loot');
      break;
    case 'crateGone':
      pushNews('보급 상자가 사라졌어요', '');
      break;
    case 'streak':
      bigNews(`연속 ${m.n}!`, 1600);
      if (m.reward && STREAK_REWARD[m.reward]) pushNews(STREAK_REWARD[m.reward], 'loot', 6000);
      break;
    case 'item':
      if (me) toast(`${itemName(m.item)} 사용!`);
      break;
    case 'shieldPop':
      if (me) toast('꿈막이 우산이 막아 줬어요!');
      break;
    default:
      break;
  }
}

const onMessage = {
  created(m) {
    saveSession({ code: m.code, token: m.token, role: 'teacher' });
    if ($('create-password')) $('create-password').value = '';
  },
  joined(m) {
    saveSession({ code: m.code, token: m.token, role: 'player', id: m.id });
  },
  resumed(m) {
    if ((m.role === 'teacher') !== TEACHER_PAGE) return goHome(); // 페이지와 다른 역할로는 이어받지 않는다
    saveSession({ ...session, role: m.role, id: m.id });
  },
  room(m) {
    room = m;
    if (!session) return;
    if (m.phase === 'game') return enterGame();
    leaveGame();
    if (session.role === 'teacher') renderTeacher();
    else renderStudent();
  },
  state(m) {
    if (game) game.onState(m.p);
  },
  fix(m) {
    if (game) game.onFix(m.x, m.y);
  },
  me(m) {
    const first = !myInfo;
    myInfo = m;
    const now = performance.now();
    // 꿈도둑을 찾아라: 쿨타임들 (서버가 남은 ms 로 알려 준다)
    ready.freeze = now + (m.freezeMs ?? m.tagMs ?? 0);
    ready.blackout = now + ((m.saboMs && m.saboMs.blackout) || 0);
    ready.lock = now + ((m.saboMs && m.saboMs.lock) || 0);
    ready.button = now + (m.buttonMs || 0);
    if (game) game.setMe(m);
    if (mission && mission.isOpen()) mission.setChance(m.item === 'chance');
    // 연속 정답 힌트: 새로 받았을 때만 알린다
    const sig = m.hint ? JSON.stringify([m.hint.room, m.hint.x, m.hint.y, m.hint.exact]) : '';
    if (sig && sig !== lastHintSig && m.hint.room) pushNews(m.hint.exact ? `보급 상자 자리가 반짝여요! (${m.hint.room})` : `보급 상자는 ${m.hint.room}에 있어요`, 'loot', 8000);
    lastHintSig = sig;
    if (room && room.phase === 'game') renderGameHud();
    // 게임이 막 시작됐을 때만 역할 안내를 띄운다 (도중 입장·새로고침 포함)
    if (first && room && room.phase === 'game' && !room.over) showIntro(m.role, m);
  },
  crates(m) {
    lastCrates = m.crates || m.list || m.c || [];
    if (game) game.setCrates(lastCrates);
  },
  event(m) {
    if (game) game.onEvent(m);
    onNewsEvent(m);
    if (room && room.phase === 'game') renderGameHud();
  },
  picked(m) {
    picked = new Set(m.ids || []);
    if (room && room.phase === 'lobby' && session.role === 'teacher') renderTeacher();
  },
  closeq() {
    mission.hide();
  },
  report(m) {
    showTeacherReport({ ...m, mode: m.mode || modeOf() });
  },
  myreport(m) {
    showMyReport(m);
  },
  question(m) {
    const notebook = m.terminal === 'notebook' || m.source === 'notebook' || (notebookPending && m.terminal == null && m.source == null);
    notebookPending = false;
    mission.show(m, { notebook, chance: !!(myInfo && myInfo.item === 'chance') });
  },
  result(m) {
    mission.result(m);
  },
  left() {
    goHome();
  },
  closed(m) {
    const why = {
      kicked: '선생님이 방에서 내보냈어요.',
      teacher_closed: '선생님이 방을 닫았어요.',
      expired: '방이 오래되어 닫혔어요.',
    };
    goHome(why[m.reason] || '방이 닫혔어요.');
  },
  error(m) {
    if (m.code === 'resume_failed') return goHome();
    notebookPending = false;
    toast(m.msg || '문제가 생겼어요.');
  },
};

function goHome(msg) {
  leaveGame();
  saveSession(null);
  room = null;
  show('home');
  if (msg) toast(msg);
}

// ───────────── 캐릭터 캔버스 ─────────────
// class="char" 인 캔버스는 data-kind / data-color 값대로 매 프레임 다시 그린다. data-halo="1" 이면 천사 고리.
function charCanvas(kind, colorIndex, cssSize) {
  const cv = document.createElement('canvas');
  cv.className = 'char';
  cv.dataset.kind = kind;
  cv.dataset.color = colorIndex;
  cv.dataset.seed = (Math.random() * 3).toFixed(2);
  cv.width = cv.height = cssSize * 2;
  return cv;
}
function animate(ms) {
  const t = ms / 1000;
  for (const cv of document.querySelectorAll('canvas.char')) {
    if (cv.offsetParent === null) continue; // 안 보이는 화면은 건너뛴다
    const ctx = cv.getContext('2d');
    const w = cv.width;
    ctx.clearRect(0, 0, w, w);
    const color = COLORS[Number(cv.dataset.color)] || COLORS[0];
    const halo = cv.dataset.halo === '1';
    drawCharacter(ctx, {
      kind: cv.dataset.kind,
      color: color.hex,
      x: w / 2,
      y: w * (halo ? 0.97 : 0.92),
      size: w * (halo ? 0.7 : 0.82),
      t,
      seed: Number(cv.dataset.seed) || 0,
      moving: cv.dataset.moving === '1',
      halo,
    });
  }
  drawParade(t);
  requestAnimationFrame(animate);
}

// 첫 화면 아래를 지나가는 캐릭터들 (손에 랜턴)
const parade = CHARACTERS.map((ch, i) => ({
  kind: ch.id,
  color: COLORS[(i * 3 + 1) % COLORS.length].hex,
  offset: i / CHARACTERS.length,
  seed: i * 0.7,
}));
function drawParade(t) {
  const cv = $('parade');
  if ($('view-home').hidden) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const span = w + 240;
  for (const p of parade) {
    const x = ((t * 46 + p.offset * span) % span) - 120;
    drawCharacter(ctx, { kind: p.kind, color: p.color, x, y: h - 16, size: 104, t, seed: p.seed, moving: true });
    // 손에 든 작은 랜턴
    const lx = x + 34;
    const ly = h - 52 + Math.sin(t * 6 + p.seed) * 2;
    const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 26);
    g.addColorStop(0, 'rgba(255,214,106,.9)');
    g.addColorStop(1, 'rgba(255,181,71,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lx, ly, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd76a';
    ctx.strokeStyle = '#2a2140';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(lx - 7, ly - 9, 14, 18, 4);
    ctx.fill();
    ctx.stroke();
  }
}

// ───────────── 친구 목록 ─────────────
function renderPlayers(container, opts) {
  const have = new Map([...container.querySelectorAll('.player')].map((el) => [el.dataset.id, el]));
  container.querySelector('.empty')?.remove();
  for (const p of room.players) {
    let el = have.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'player';
      el.dataset.id = p.id;
      el.append(charCanvas(p.character, p.color, opts.size));
      const who = document.createElement('div');
      who.className = 'who';
      const name = document.createElement('div');
      name.className = 'name';
      el.append(who, name);
      if (opts.kick) {
        const b = document.createElement('button');
        b.className = 'kick';
        b.type = 'button';
        b.textContent = '✕';
        b.addEventListener('click', () => {
          if (confirm(`${p.name} 학생을 방에서 내보낼까요?`)) send({ t: 'kick', id: p.id });
        });
        el.append(b);
      }
      container.append(el);
    }
    have.delete(p.id);
    const cv = el.querySelector('canvas');
    cv.dataset.kind = p.character;
    cv.dataset.color = p.color;
    el.querySelector('.who').textContent = playerLabel(p.color, p.character);
    el.querySelector('.name').textContent = p.name;
    el.querySelector('.kick')?.setAttribute('aria-label', `${p.name} 내보내기`);
    el.classList.toggle('off', !p.connected);
    el.classList.toggle('me', session.id === p.id);
  }
  for (const el of have.values()) el.remove();
  if (!room.players.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = opts.empty;
    container.append(e);
  }
}

// ───────────── 선생님 대기방 ─────────────
function fillSelect(sel, items) {
  for (const it of items) sel.add(new Option(it.name, it.id));
}
function renderTeacher() {
  show('teacher');
  $('t-code').textContent = room.code;
  const invite = inviteUrl(room.code);
  $('t-link').textContent = invite.host + invite.pathname + invite.search;
  $('t-mode').value = room.settings.mode;
  $('t-map').value = room.settings.map;
  const n = room.players.length;
  $('t-count').textContent = `(${n}/${LIMITS.maxPlayers})`;
  // 잠귀신(꿈도둑) 수: '자동'이면 인원에 맞춰 추천한 수를 쓴다
  const chaser = T().chaser;
  const count = Math.max(n, LIMITS.minPlayers);
  const rec = recommendChasers(room.settings.mode, count);
  $('t-chaser-label').textContent = `${chaser} 수`;
  const sel = $('t-chasers');
  sel.options[0].text = `자동 (${count}명일 때 추천: ${rec}명)`;
  sel.value = String(room.settings.chasers ?? 'auto');
  $('t-missions').value = String(room.settings.missions);
  $('t-minutes').value = String(room.settings.minutes);
  $('t-fogloot').value = room.settings.fogLoot === false ? 'off' : 'on';
  $('t-notebook').value = room.settings.notebook === false ? 'off' : 'on';
  $('t-report').hidden = !room.recordCount;
  // 퀴즈 문제 상태
  const qs = room.qset;
  $('q-status').textContent = qs ? `${qs.title} · ${qs.count}문제` : '아직 문제가 없어요. 엑셀 파일을 올려 주세요.';
  const wanted = count * room.settings.missions;
  $('q-warn').textContent =
    qs && qs.count < room.settings.missions
      ? `문제가 적어요. 한 사람이 랜턴 ${room.settings.missions}개를 켜야 해서 같은 문제가 다시 나올 수 있어요.`
      : qs && qs.count < wanted
        ? `참고: 학생마다 다른 문제를 주려면 ${wanted}문제쯤 있으면 좋아요. (지금도 시작할 수 있어요)`
        : '';
  const need = LIMITS.minPlayers - n;
  $('t-start').disabled = need > 0 || !qs;
  // 꿈도둑을 찾아라 설정 (회의 종 횟수 · 정체 공개 · 몰래 정하기)
  const mafia = isMafia(room);
  $('t-imp').hidden = !mafia;
  for (const id of [...picked]) if (!room.players.some((p) => p.id === id)) picked.delete(id); // 나간 학생은 빠진다
  if (mafia) {
    $('t-meetings').value = String(room.settings.meetings ?? MAF.meetingsDefault);
    $('t-reveal-role').value = room.settings.reveal === false ? 'off' : 'on';
    renderPickList();
  }
  const use = mafia && picked.size ? picked.size : chaserCount(room.settings, count);
  const balance =
    `${chaser} ${use}명 · 학생 ${count - use}명으로 시작해요.` +
    (mafia && picked.size ? ' (선생님이 몰래 정함)' : use !== rec ? ` (추천은 ${rec}명)` : '');
  $('t-hint').textContent =
    need > 0
      ? `${need}명 더 들어오면 시작할 수 있어요. 게임 중에도 들어올 수 있어요.`
      : !qs
        ? '퀴즈 문제를 올리면 시작할 수 있어요.'
        : balance + ' 게임 중에도 들어올 수 있어요.';
  renderPlayers($('t-players'), {
    size: 120,
    kick: true,
    empty: '아직 아무도 없어요. 학생들에게 방 번호를 알려 주세요!',
  });
}

// 선생님: 꿈도둑 몰래 정하기 목록 (펼쳤을 때만 보인다. 학생 화면에는 절대 안 간다)
let picked = new Set(); // 서버가 'picked' 로 돌려준 id 목록
function renderPickList() {
  const box = $('t-pick-rows');
  const sig = JSON.stringify([room.players.map((p) => [p.id, p.name, p.color, p.character]), [...picked]]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren();
  if (!room.players.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '아직 들어온 학생이 없어요.';
    box.append(p);
  }
  for (const p of room.players) {
    const row = document.createElement('label');
    row.className = 'pick-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = picked.has(p.id);
    cb.addEventListener('change', () => {
      const ids = new Set(picked);
      if (cb.checked) ids.add(p.id);
      else ids.delete(p.id);
      send({ t: 'pickChasers', ids: [...ids] });
    });
    row.append(cb, document.createTextNode(`${p.name} · ${playerLabel(p.color, p.character)}`));
    box.append(row);
  }
}

// ───────────── 학생 대기방 ─────────────
function renderStudent() {
  const me = mePlayer();
  if (!me) return;
  show('student');
  const cv = $('s-me');
  cv.dataset.kind = me.character;
  cv.dataset.color = me.color;
  cv.dataset.moving = '1';
  $('s-label').textContent = playerLabel(me.color, me.character);
  $('s-name').textContent = `${me.name} · ${room.code}번 방 · ${T().mode}`;
  $('s-count').textContent = `(${room.players.length}명)`;
  for (const b of $('s-picker').children) {
    b.setAttribute('aria-pressed', String(b.dataset.kind === me.character));
    b.querySelector('canvas').dataset.color = me.color;
  }
  renderPlayers($('s-players'), { size: 84, empty: '' });
}

// ───────────── 처음 한 번 준비 ─────────────
function init() {
  if (TEACHER_PAGE) {
    // 선생님 페이지: 비밀번호 → 방 만들기 (학생 입장 칸은 이 페이지에 없다)
    $('create-form').addEventListener('submit', (e) => {
      e.preventDefault();
      send({ t: 'create', password: $('create-password').value });
    });
  } else {
    // 학생 출입 페이지: 방 번호 + 이름 → 들어가기 (방 만들기 칸은 이 페이지에 없다)
    const params = new URLSearchParams(location.search);
    const code = (params.get('room') || '').replace(/\D/g, '').slice(0, 4);
    if (code) $('join-code').value = code;
    $('join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
    $('join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      send({ t: 'join', code: $('join-code').value, name: $('join-name').value });
    });
  }

  // 놀이 방법 보기 (첫 화면·대기방)
  const manual = initManual();
  for (const b of document.querySelectorAll('.open-manual')) b.addEventListener('click', () => manual.open(room ? modeOf() : 'sleep-tag'));

  // 게임 방식 이름은 화면 용어로 보여 준다 (id 는 서버 것 그대로)
  fillSelect(
    $('t-mode'),
    MODES.map((m) => ({ id: m.id, name: m.id === 'sleep-tag' || m.id === 'mafia' ? terms(m.id).mode : m.name })),
  );
  fillSelect($('t-map'), MAPS);
  fillSelect($('t-chasers'), [
    { id: 'auto', name: '자동' },
    { id: '1', name: '1명' },
    { id: '2', name: '2명' },
    { id: '3', name: '3명' },
  ]);
  fillSelect($('t-missions'), [3, 4, 5, 6, 7, 8].map((n) => ({ id: String(n), name: `${n}개` })));
  const sendSettings = () => {
    const c = $('t-chasers').value;
    send({
      t: 'settings',
      mode: $('t-mode').value,
      map: $('t-map').value,
      chasers: c === 'auto' ? 'auto' : Number(c),
      missions: Number($('t-missions').value),
      minutes: Number($('t-minutes').value),
      meetings: Number($('t-meetings').value),
      reveal: $('t-reveal-role').value !== 'off',
      fogLoot: $('t-fogloot').value !== 'off',
      notebook: $('t-notebook').value !== 'off',
    });
  };
  fillSelect($('t-minutes'), MINUTES.map((n) => ({ id: String(n), name: `${n}분` })));
  fillSelect($('t-meetings'), MEETING_CHOICES.map((n) => ({ id: String(n), name: n ? `${n}번` : '없음' })));
  $('t-meetings').value = String(MAF.meetingsDefault);
  for (const id of ['t-mode', 't-map', 't-chasers', 't-missions', 't-minutes', 't-meetings', 't-reveal-role', 't-fogloot', 't-notebook']) $(id).addEventListener('change', sendSettings);
  $('t-pick-toggle').addEventListener('click', () => {
    const open = $('t-pick').hidden;
    $('t-pick').hidden = !open;
    $('t-pick-toggle').setAttribute('aria-expanded', String(open));
    $('t-pick-toggle').textContent = open ? '꿈도둑 몰래 정하기 닫기' : '꿈도둑 몰래 정하기 열기';
  });
  meetingView = initMeeting({ send, toast });
  $('g-roles').addEventListener('click', () => setRoles(!showRoles));
  $('g-freeze').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    doFreeze();
  });
  $('g-sabo').addEventListener('click', toggleSabo);
  $('g-sabo-blackout').addEventListener('click', () => doSabotage('blackout'));
  $('g-sabo-lock').addEventListener('click', () => doSabotage('lock'));
  $('g-sabo-disguise').addEventListener('click', () => doSabotage('disguise'));
  $('g-map').addEventListener('click', () => setMinimap(!mapOpen));
  $('g-minimap-close').addEventListener('click', () => setMinimap(false));
  $('g-bag').addEventListener('click', useItem);
  $('g-bag-mini').addEventListener('click', useItem);
  $('g-notebook').addEventListener('click', openNotebook);
  for (const id of ['g-freeze', 'g-sabo']) $(id).addEventListener('contextmenu', (e) => e.preventDefault());
  $('g-tmenu-btn').addEventListener('click', () => setTeacherMenu($('g-tmenu').hidden));
  $('g-side-toggle').addEventListener('click', () => {
    sideOpen = !sideOpen;
    if (room && room.phase === 'game') renderSide();
  });
  initQset({ toast, onConfirm: (set) => send({ t: 'questions', set }) });
  mission = initMission({
    send,
    onOpen: () => {
      cancelHold();
      if (game) game.setPaused(true);
      renderAction();
    },
    onClose: () => {
      if (game) game.setPaused(loading);
      renderAction();
    },
    // 수첩에서 맞히면 다음 문제를 바로 연다
    onNotebookNext: () => {
      if (room && room.phase === 'game' && !room.over) openNotebook();
    },
  });
  initReport();
  $('g-report').addEventListener('click', () => send({ t: 'report' }));
  $('t-report').addEventListener('click', () => send({ t: 'report' }));
  $('g-myreport').addEventListener('click', () => send({ t: 'myreport' }));
  $('g-reveal').addEventListener('click', () => setReveal(!reveal));
  const btn = $('g-action');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pressDown();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, pressUp);
  btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 태블릿에서 꾹 누를 때 메뉴가 뜨지 않게
  $('t-start').addEventListener('click', () => send({ t: 'start' }));
  $('t-close').addEventListener('click', () => {
    if (confirm('방을 닫을까요? 들어와 있는 학생이 모두 나가게 돼요.')) send({ t: 'close' });
  });
  $('t-copy').addEventListener('click', async () => {
    const url = inviteUrl(room.code).href;
    try {
      await navigator.clipboard.writeText(url);
      toast('초대 주소를 복사했어요.');
    } catch {
      toast(url);
    }
  });

  for (const ch of CHARACTERS) {
    const b = document.createElement('button');
    b.className = 'pick';
    b.type = 'button';
    b.dataset.kind = ch.id;
    b.setAttribute('aria-pressed', 'false');
    b.append(charCanvas(ch.id, 0, 84), document.createTextNode(ch.name));
    b.addEventListener('click', () => send({ t: 'character', character: ch.id }));
    $('s-picker').append(b);
  }
  $('s-leave').addEventListener('click', () => send({ t: 'leave' }));
  $('g-end').addEventListener('click', () => {
    if (confirm('이번 판을 끝내고 대기방으로 돌아갈까요?')) send({ t: 'end' });
  });

  setupViewport();
  show('home');
  connect();
  requestAnimationFrame(animate);
  fontsReady.then(() => document.body.classList.add('fonts-ready'));
}
init();
