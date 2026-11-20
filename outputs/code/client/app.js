// 첫 화면 + 대기방 (선생님·학생 공용). 게임 화면은 다음 단계에서 만든다.
import { COLORS, CHARACTERS, MODES, MAPS, LIMITS, TAG, MINUTES, playerLabel, recommendChasers, chaserCount } from '/shared/config.js';
import { drawCharacter } from '/characters.js';
import { startGame } from '/game.js';
import { initMission } from '/mission.js';
import { initQset } from '/qset.js';
import { initReport, showTeacherReport, showMyReport } from '/report.js';
import { initMeeting } from '/meeting.js';
import { IMP, MEETING_CHOICES, isImpostor } from '/impconst.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'sg-session';

let ws = null;
let session = loadSession(); // { code, token, role, id }
let room = null;

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
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
function show(view) {
  for (const v of ['home', 'teacher', 'student', 'game']) $('view-' + v).hidden = v !== view;
}

// ───────────── 게임 화면 들어가기·나오기 ─────────────
let game = null; // 지금 돌아가는 게임 화면
let gameStarting = false;
let mission = null; // 문제 창
let myInfo = null; // 내 미션 진행 상황 (서버가 알려 준 것)

function renderGameHud() {
  const p = room.progress || { solved: 0, goal: 1 };
  const pct = Math.min(100, Math.round((p.solved / p.goal) * 100));
  $('g-bar').style.width = pct + '%';
  $('g-progress').textContent = `학교 복구율 ${pct}%`;
  $('g-progress').parentElement.setAttribute('aria-valuenow', pct);
  const isPlayer = session.role === 'player' && myInfo;
  const imp = isImpostor(room);
  const chaser = isPlayer && myInfo.role === 'chaser';
  const mePlayer = isPlayer ? room.players.find((x) => x.id === session.id) : null;
  const frozen = !!(mePlayer && mePlayer.frozen);
  const done = isPlayer && myInfo.solved >= myInfo.missions;
  // 방해꾼 찾기: 방해꾼도 "내 미션 n/m" 으로 똑같이 보인다 (옆에서 화면을 봐도 정체가 드러나지 않게)
  $('g-missions').textContent = !isPlayer ? '' : chaser && !imp ? '나는 술래' : done ? '내 미션 완료!' : `내 미션 ${myInfo.solved}/${myInfo.missions}`;
  $('g-missions').classList.toggle('chaser', !!chaser && !imp);
  $('g-meetings').hidden = !imp;
  if (imp) $('g-meetings').textContent = `긴급회의 ${room.meetingsLeft ?? room.settings.meetings ?? IMP.meetingsDefault}번 남음`;
  if (imp) renderImpostorHud(isPlayer, chaser, done);
  else if (isPlayer) {
    $('g-hint').textContent = chaser
      ? '학생에게 가까이 가서 [잡기]! 미끄럼틀과 개구멍은 탈 수 없어요'
      : frozen
        ? '꽁꽁 얼었어요! 친구가 와서 땡 해 주길 기다려요'
        : done
          ? '내 미션 완료! 얼어 있는 친구를 찾아 땡 해 주세요'
          : '느낌표(!)가 뜬 단말기를 찾아가 문제를 풀어요';
  }
  $('g-over').hidden = !room.over;
  $('g-over-roles').textContent = '';
  if (room.over) {
    const studentsWin = room.over.winner === 'students';
    const why = { restored: '모든 단말기를 고쳤어요.', time_up: '시간 안에 학교를 다 고치지 못했어요.', all_frozen: '학생이 모두 얼어 버렸어요.' };
    $('g-over-title').textContent = studentsWin ? '학교 복구 완료! 학생 팀 승리' : '술래 승리!';
    $('g-over-text').textContent = why[room.over.reason] || '';
    if (imp) {
      const title = {
        all_found: '방해꾼을 모두 찾았어요! 학생 팀 승리',
        restored: '학교 복구 완료! 학생 팀 승리',
        outnumbered: '방해꾼 승리! (학생이 너무 적어요)',
        time_up: '방해꾼 승리! (시간 끝)',
      };
      const text = {
        all_found: '회의에서 방해꾼을 모두 찾아냈어요.',
        restored: '모든 단말기를 고쳤어요.',
        outnumbered: '남은 학생 수가 방해꾼 수보다 많지 않아요.',
        time_up: '시간 안에 학교를 다 고치지 못했어요.',
      };
      $('g-over-title').textContent = title[room.over.reason] || (studentsWin ? '학생 팀 승리' : '방해꾼 승리!');
      $('g-over-text').textContent = text[room.over.reason] || '';
      // 끝나면 모두의 역할이 공개된다
      const names = room.players.filter((p) => p.role === 'chaser').map((p) => playerLabel(p.color, p.character));
      if (names.length) $('g-over-roles').textContent = `방해꾼은 ${names.join(', ')}${josa(names[names.length - 1], '이었어요', '였어요')}`;
    }
    cancelHold();
    if (mission) mission.hide();
    closeSaboMenu();
  }
  // 방해꾼 찾기: 회의 화면, 얼음 흔적, 정전·문 잠금
  if (imp) {
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
  $('g-myreport').hidden = !(room.over && session.role === 'player');
  if (session.role === 'teacher') renderSide();
  renderAction();
}

// 받침이 있으면 a, 없으면 b
function josa(word, a, b) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return b;
  return code % 28 ? a : b;
}

// ───────────── 방해꾼 찾기 HUD ─────────────
let meetingView = null; // 회의 화면
let wasMeeting = false;
let markId = null; // 신고할 수 있는 얼음 흔적
let saboOpen = false;
let mapOpen = false;
// 다시 쓸 수 있는 때 (이 화면의 시계 기준)
const ready = { freeze: 0, blackout: 0, lock: 0, button: 0 };

function iAmGhost() {
  if (!myInfo) return false;
  if (myInfo.ghost) return true;
  const me = room && room.players.find((x) => x.id === session.id);
  return !!(me && me.ghost);
}
function renderImpostorHud(isPlayer, chaser, done) {
  if (!isPlayer) return;
  const ghost = iAmGhost();
  $('g-hint').textContent = ghost
    ? '유령이 되었어요 — 미션을 계속 풀어 학교를 도와주세요! (회의 때는 말하지 않기)'
    : chaser
      ? '들키지 말고 학생을 [얼리기]! [방해]로 정전·문 잠금·위장. 미션은 가짜예요'
      : done
        ? '내 미션 완료! 얼음 흔적을 찾으면 [신고], 수상하면 긴급회의 버튼'
        : '느낌표(!) 단말기에서 문제를 풀어요. 얼음 흔적을 보면 [신고]!';
}
// 정전 알림: 살아 있는 학생은 "정전! 8", 방해꾼·유령·선생님은 작은 "정전 중"
function renderAlert() {
  const el = $('g-alert');
  if (!game || !room || !isImpostor(room) || room.over || room.meeting) return (el.hidden = true);
  const left = game.blackoutLeft();
  if (left <= 0) return (el.hidden = true);
  const big = session.role === 'player' && game.blackoutHitsMe();
  el.hidden = false;
  el.classList.toggle('big', big);
  el.textContent = big ? `정전! ${Math.ceil(left / 1000)}` : '정전 중';
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
// 방해꾼 찾기 버튼 묶음 (얼리기·방해·신고·지도). E 행동(g-action)은 renderAction 이 맡는다
function renderImpostorButtons(hideAll) {
  const isPlayer = session.role === 'player' && !!myInfo;
  const ghost = iAmGhost();
  const chaser = isPlayer && myInfo.role === 'chaser' && !ghost;
  const off = hideAll || !isPlayer;
  $('g-map').hidden = off;
  $('g-freeze').hidden = off || !chaser;
  $('g-sabo').hidden = off || !chaser;
  $('g-alarm').hidden = off || ghost || !markId;
  if (off || !chaser) closeSaboMenu();
  if (!off && chaser) {
    const w = secsLeft(ready.freeze);
    $('g-freeze').disabled = w > 0;
    $('g-freeze-label').textContent = w > 0 ? `얼리기 (${w})` : '얼리기';
    const wb = secsLeft(ready.blackout);
    const wl = secsLeft(ready.lock);
    const dl = myInfo.disguiseLeft ?? IMP.disguisePerGame;
    $('g-sabo-blackout').disabled = wb > 0;
    $('g-sabo-blackout').textContent = wb > 0 ? `1 정전 (${wb})` : '1 정전';
    $('g-sabo-lock').disabled = wl > 0;
    $('g-sabo-lock').textContent = wl > 0 ? `2 문 잠금 (${wl})` : '2 문 잠금';
    $('g-sabo-disguise').disabled = dl <= 0;
    $('g-sabo-disguise').textContent = `3 위장 (${dl}번 남음)`;
  }
}
function doSabotage(kind) {
  if (!myInfo || myInfo.role !== 'chaser' || iAmGhost() || !room || room.over || room.meeting) return;
  const btn = { blackout: 'g-sabo-blackout', lock: 'g-sabo-lock', disguise: 'g-sabo-disguise' }[kind];
  if ($(btn).disabled) return;
  send({ t: 'sabotage', kind });
  closeSaboMenu();
}
function doAlarm() {
  if (!markId || !room || room.over || room.meeting || iAmGhost()) return;
  send({ t: 'alarm', mark: markId });
}
function doFreeze() {
  if (!myInfo || myInfo.role !== 'chaser' || iAmGhost() || !room || room.over || room.meeting) return;
  if ($('g-freeze').disabled) return;
  send({ t: 'tag' });
}

// 선생님 화면: 학생 현황 목록
let reveal = false;
let showRoles = false; // 방해꾼 찾기: 역할 칸 보이기 (기본 숨김, TV 대비)
function renderSide() {
  const box = $('g-side');
  box.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = `학생 현황 (${room.players.length}명)`;
  box.append(h);
  if (isImpostor(room)) return renderImpostorSide(box);
  for (const p of room.players) {
    const row = document.createElement('div');
    row.className = 'side-row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = (COLORS[p.color] || COLORS[0]).hex;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${p.name} · ${playerLabel(p.color, p.character)}`;
    const tag = document.createElement('span');
    tag.className = 'tag';
    if (!p.connected) (tag.textContent = '끊김'), tag.classList.add('off');
    else if (p.role === 'chaser') (tag.textContent = '술래'), tag.classList.add('chaser');
    else if (p.frozen) (tag.textContent = '얼음'), tag.classList.add('frozen');
    else tag.textContent = `${p.solved}/${room.settings.missions}`;
    row.append(dot, who, tag);
    box.append(row);
  }
}
function renderImpostorSide(box) {
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
    const fake = p.role === 'chaser' && showRoles ? ' (가짜)' : '';
    const prog = document.createElement('span');
    prog.className = 'tag';
    prog.textContent = `${p.solved ?? 0}/${goal}${fake}`;
    const state = document.createElement('span');
    state.className = 'tag';
    if (!p.connected) (state.textContent = '끊김'), state.classList.add('off');
    else if (p.ejected) (state.textContent = '제외됨'), state.classList.add('ejected');
    else if (p.ghost) (state.textContent = '유령'), state.classList.add('ghost');
    else state.textContent = '살아 있음';
    row.append(dot, who, prog, state);
    if (showRoles) {
      const r = document.createElement('span');
      r.className = 'tag' + (p.role === 'chaser' ? ' role' : '');
      r.textContent = p.role === 'chaser' ? '방해꾼' : '학생';
      row.append(r);
    }
    box.append(row);
  }
}
function setRoles(v) {
  showRoles = v;
  $('g-roles').setAttribute('aria-pressed', String(v));
  $('g-roles').textContent = v ? '역할 숨기기' : '역할 보기';
  if (game) game.setRoles(v);
  if (room && room.phase === 'game') renderSide();
}
function setReveal(v) {
  reveal = v;
  $('g-reveal').setAttribute('aria-pressed', String(v));
  $('g-reveal').textContent = v ? '학생 위치 숨기기' : '학생 위치 보기';
  $('g-hint').textContent = v ? '' : `학생 위치는 숨겨져 있어요 (TV에 띄워도 ${isImpostor(room) ? '방해꾼' : '술래'}가 볼 수 없어요)`;
  if (game) game.setReveal(v);
}

// ───────────── 행동 버튼 (잡기 / 땡 / 문제 풀기 / 장치 타기) ─────────────
let action = null; // 지금 할 수 있는 행동 { type, id, label }
let holdTimer = 0; // 땡 버튼을 누르고 있는 동안의 타이머
let tagReadyAt = 0; // 술래가 다시 잡을 수 있는 때 (이 화면의 시계 기준)

function renderAction() {
  const btn = $('g-action');
  const busy = !room || !!room.over || (mission && mission.isOpen()) || (isImpostor(room) && !!room.meeting);
  if (room && isImpostor(room)) renderImpostorButtons(busy);
  const hide = !action || busy;
  btn.hidden = hide;
  if (hide) return;
  let wait = action.type === 'tag' ? Math.ceil((tagReadyAt - performance.now()) / 1000) : 0;
  let label = action.label;
  let disabled = false;
  if (action.type === 'emergency') {
    // 남은 횟수가 없거나 이미 썼으면 회색. 방해꾼에게도 똑같이 보인다 (눌러도 안 됨)
    const left = room.meetingsLeft ?? room.settings.meetings ?? IMP.meetingsDefault;
    wait = secsLeft(ready.button);
    disabled = left <= 0 || !!(myInfo && myInfo.usedButton);
    label = left <= 0 ? '긴급회의 (0번 남음)' : myInfo && myInfo.usedButton ? '긴급회의 (이미 씀)' : `긴급회의 (${left}번 남음)`;
  }
  btn.disabled = wait > 0 || disabled;
  $('g-action-label').textContent = wait > 0 ? `${label} (${wait})` : label;
  btn.classList.toggle('tag', action.type === 'tag');
  btn.classList.toggle('emergency', action.type === 'emergency');
}
function cancelHold() {
  if (!holdTimer) return;
  clearTimeout(holdTimer);
  holdTimer = 0;
  $('g-action').classList.remove('holding');
  send({ t: 'thawCancel' });
}
function pressDown() {
  if (!action || !room || room.over || $('g-action').disabled) return;
  if (isImpostor(room) && room.meeting) return;
  if (action.type === 'terminal') send({ t: 'open', terminal: action.id });
  else if (action.type === 'device') send({ t: 'use', device: action.id });
  else if (action.type === 'emergency') {
    // 방해꾼은 버튼이 보여도 누를 수 없다 (서버도 막는다)
    if (myInfo && myInfo.role === 'chaser') toast('지금은 누를 수 없어요');
    else send({ t: 'emergency' });
  }
  else if (action.type === 'tag') send({ t: 'tag' });
  else if (action.type === 'thaw' && !holdTimer) {
    // 땡은 버튼을 1.5초 누르고 있어야 한다
    send({ t: 'thawStart', id: action.id });
    $('g-action').classList.add('holding');
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      $('g-action').classList.remove('holding');
      send({ t: 'thawEnd' });
    }, TAG.thawHoldMs);
  }
}
function pressUp() {
  cancelHold();
}

// ───────────── 남은 시간 ─────────────
let endsAt = 0; // 게임이 끝나는 때 (이 화면의 시계 기준)
let pausedLeft = null; // 회의 중 멈춘 남은 시간(ms). 회의가 아니면 null
function renderClock() {
  if (!room || room.phase !== 'game') return;
  const ms = pausedLeft != null ? pausedLeft : endsAt - performance.now();
  const left = room.over ? 0 : Math.max(0, Math.ceil(ms / 1000));
  renderAlert();
  $('g-clock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('g-clock').classList.toggle('hurry', left <= 60 && !room.over);
  renderAction();
}
setInterval(renderClock, 250);

function showIntro(role, info) {
  const el = $('g-intro');
  if (isImpostor(room)) {
    const mates = ((info && info.mates) || [])
      .map((id) => room.players.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => playerLabel(p.color, p.character));
    $('g-intro-title').textContent = role === 'chaser' ? '너는 방해꾼!' + (mates.length ? ` (동료: ${mates.join(', ')})` : '') : '너는 학생!';
    $('g-intro-text').textContent =
      role === 'chaser'
        ? '들키지 말고 학생을 얼려. 미션은 가짜야 (풀어도 복구율이 안 올라).'
        : '문제를 풀어 학교를 고치고, 방해꾼을 찾아내!';
  } else {
    $('g-intro-title').textContent = role === 'chaser' ? '너는 술래!' : '너는 학생!';
    $('g-intro-text').textContent =
      role === 'chaser'
        ? '친구들을 잡아 꽁꽁 얼려요. 시간이 끝날 때까지 학교를 못 고치게 막으면 승리!'
        : '단말기의 문제를 풀어 학교를 고쳐요. 얼어 버린 친구는 옆에서 땡! 해 주세요.';
  }
  el.classList.toggle('chaser', role === 'chaser');
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 4500);
}

async function enterGame() {
  // 회의 중에는 게임 시계가 멈춘다: 회의가 시작될 때의 남은 시간을 그대로 보여 준다
  const inMeeting = isImpostor(room) && !!room.meeting && !room.over;
  if (inMeeting) {
    if (pausedLeft == null) pausedLeft = endsAt ? Math.max(0, endsAt - performance.now()) : room.timeLeft || 0;
  } else {
    pausedLeft = null;
    endsAt = performance.now() + (room.timeLeft || 0);
  }
  renderGameHud();
  renderClock();
  if (game) return game.setPlayers(room.players, !!room.over);
  if (gameStarting) return;
  gameStarting = true;
  show('game');
  const isTeacher = session.role === 'teacher';
  const me = room.players.find((p) => p.id === session.id);
  $('g-label').textContent = isTeacher ? `${room.code}번 방 · 선생님 화면` : me ? playerLabel(me.color, me.character) : '';
  const imp = isImpostor(room);
  for (const id of ['g-end', 'g-reveal', 'g-report', 'g-side']) $(id).hidden = !isTeacher;
  $('g-roles').hidden = !(isTeacher && imp);
  if (isTeacher) setReveal(false);
  if (isTeacher) setRoles(false);
  action = null;
  markId = null;
  wasMeeting = false;
  closeSaboMenu();
  setMinimap(false);
  $('g-action').hidden = true;
  $('g-intro').hidden = true;
  try {
    const g = await startGame({
      canvas: $('game-canvas'),
      mapId: room.settings.map,
      role: session.role,
      myId: session.id,
      players: room.players,
      impostor: imp,
      send,
      onContext(ctx) {
        action = ctx;
        cancelHold();
        renderAction();
      },
      onMark(id) {
        markId = id;
        renderAction();
      },
      onKey(dir, which = 'act') {
        if (which === 'act') {
          if (dir === 'down') pressDown();
          else pressUp();
          return;
        }
        if (dir !== 'down' || !room || !isImpostor(room)) return;
        if (which === 'freeze') doFreeze();
        else if (which === 'alarm') doAlarm();
        else if (which === 'map') setMinimap(!mapOpen);
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
      if (isImpostor(room)) {
        game.setMarks(room.marks || []);
        game.setSabo(room.sabo || null);
        game.setMeeting(!!room.meeting && !room.over);
        wasMeeting = !!room.meeting && !room.over;
      }
    }
  } catch (e) {
    console.error(e);
    toast('맵을 불러오지 못했어요. 새로고침해 주세요.');
  }
  gameStarting = false;
}
function leaveGame() {
  if (game) game.stop();
  game = null;
  myInfo = null;
  action = null;
  markId = null;
  wasMeeting = false;
  pausedLeft = null;
  endsAt = 0;
  cancelHold();
  if (mission) mission.hide();
  if (meetingView) meetingView.hide();
  closeSaboMenu();
  setMinimap(false);
  $('g-alert').hidden = true;
}
function toggleSabo() {
  if (!myInfo || myInfo.role !== 'chaser' || iAmGhost() || !room || room.over || room.meeting) return;
  saboOpen = !saboOpen;
  $('g-sabo-menu').hidden = !saboOpen;
  $('g-sabo').setAttribute('aria-expanded', String(saboOpen));
  if (saboOpen) renderImpostorButtons(false);
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
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else toast('서버에 연결하는 중이에요. 잠시 뒤 다시 눌러 주세요.');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
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

const onMessage = {
  created(m) {
    saveSession({ code: m.code, token: m.token, role: 'teacher' });
    $('create-password').value = '';
  },
  joined(m) {
    saveSession({ code: m.code, token: m.token, role: 'player', id: m.id });
  },
  resumed(m) {
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
    tagReadyAt = now + (m.tagMs || 0);
    // 방해꾼 찾기: 쿨타임들 (서버가 남은 ms 로 알려 준다)
    ready.freeze = now + (m.freezeMs ?? m.tagMs ?? 0);
    ready.blackout = now + ((m.saboMs && m.saboMs.blackout) || 0);
    ready.lock = now + ((m.saboMs && m.saboMs.lock) || 0);
    ready.button = now + (m.buttonMs || 0);
    if (game) game.setMe(m);
    if (room && room.phase === 'game') renderGameHud();
    // 게임이 막 시작됐을 때만 역할 안내를 띄운다 (도중 입장·새로고침 포함)
    if (first && room && room.phase === 'game' && !room.over) showIntro(m.role, m);
  },
  event(m) {
    if (game) game.onEvent(m);
    if (m.kind === 'freeze' && m.id === session.id) {
      toast('얼려졌어요! 이제 유령이에요. 미션은 계속 풀 수 있어요');
      if (myInfo) myInfo.ghost = true;
      if (mission) mission.hide();
      if (room && room.phase === 'game') renderGameHud();
    }
  },
  picked(m) {
    picked = new Set(m.ids || []);
    if (room && room.phase === 'lobby' && session.role === 'teacher') renderTeacher();
  },
  closeq() {
    mission.hide();
  },
  report(m) {
    showTeacherReport(m);
  },
  myreport(m) {
    showMyReport(m);
  },
  question(m) {
    mission.show(m);
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
// class="char" 인 캔버스는 data-kind / data-color 값대로 매 프레임 다시 그린다.
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
    drawCharacter(ctx, {
      kind: cv.dataset.kind,
      color: color.hex,
      x: w / 2,
      y: w * 0.92,
      size: w * 0.82,
      t,
      seed: Number(cv.dataset.seed) || 0,
      moving: cv.dataset.moving === '1',
    });
  }
  drawParade(t);
  requestAnimationFrame(animate);
}

// 첫 화면 아래를 지나가는 캐릭터들
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
  $('t-link').textContent = `${location.host}/?room=${room.code}`;
  $('t-mode').value = room.settings.mode;
  $('t-map').value = room.settings.map;
  const n = room.players.length;
  $('t-count').textContent = `(${n}/${LIMITS.maxPlayers})`;
  // 술래(방해꾼) 수: '자동'이면 인원에 맞춰 추천한 수를 쓴다
  const chaser = (MODES.find((x) => x.id === room.settings.mode) || MODES[0]).chaser;
  const count = Math.max(n, LIMITS.minPlayers);
  const rec = recommendChasers(room.settings.mode, count);
  $('t-chaser-label').textContent = `${chaser} 수`;
  const sel = $('t-chasers');
  sel.options[0].text = `자동 (${count}명일 때 추천: ${rec}명)`;
  sel.value = String(room.settings.chasers ?? 'auto');
  $('t-missions').value = String(room.settings.missions);
  $('t-minutes').value = String(room.settings.minutes);
  $('t-report').hidden = !room.recordCount;
  // 미션 문제 상태
  const qs = room.qset;
  $('q-status').textContent = qs ? `${qs.title} · ${qs.count}문제` : '아직 문제가 없어요. 엑셀 파일을 올려 주세요.';
  const wanted = count * room.settings.missions;
  $('q-warn').textContent =
    qs && qs.count < room.settings.missions
      ? `문제가 적어요. 한 학생이 ${room.settings.missions}문제를 풀어야 해서 같은 문제가 다시 나올 수 있어요.`
      : qs && qs.count < wanted
        ? `참고: 학생마다 다른 문제를 주려면 ${wanted}문제쯤 있으면 좋아요. (지금도 시작할 수 있어요)`
        : '';
  const need = LIMITS.minPlayers - n;
  $('t-start').disabled = need > 0 || !qs;
  // 방해꾼 찾기 설정 (긴급회의 횟수 · 정체 공개 · 직접 고르기)
  const imp = isImpostor(room);
  $('t-imp').hidden = !imp;
  for (const id of [...picked]) if (!room.players.some((p) => p.id === id)) picked.delete(id); // 나간 학생은 빠진다
  if (imp) {
    $('t-meetings').value = String(room.settings.meetings ?? IMP.meetingsDefault);
    $('t-reveal-role').value = room.settings.reveal === false ? 'off' : 'on';
    renderPickList();
  }
  const use = imp && picked.size ? picked.size : chaserCount(room.settings, count);
  const balance =
    `${chaser} ${use}명 · 학생 ${count - use}명으로 시작해요.` +
    (imp && picked.size ? ' (선생님이 직접 고름)' : use !== rec ? ` (추천은 ${rec}명)` : '');
  $('t-hint').textContent =
    need > 0
      ? `${need}명 더 들어오면 시작할 수 있어요. 게임 중에도 들어올 수 있어요.`
      : !qs
        ? '미션 문제를 올리면 시작할 수 있어요.'
        : balance + ' 게임 중에도 들어올 수 있어요.';
  renderPlayers($('t-players'), {
    size: 120,
    kick: true,
    empty: '아직 아무도 없어요. 학생들에게 방 번호를 알려 주세요!',
  });
}

// 선생님: 방해꾼 직접 고르기 목록 (펼쳤을 때만 보인다. 학생 화면에는 절대 안 간다)
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
  const me = room.players.find((p) => p.id === session.id);
  if (!me) return;
  show('student');
  const cv = $('s-me');
  cv.dataset.kind = me.character;
  cv.dataset.color = me.color;
  cv.dataset.moving = '1';
  $('s-label').textContent = playerLabel(me.color, me.character);
  $('s-name').textContent = `${me.name} · ${room.code}번 방`;
  $('s-count').textContent = `(${room.players.length}명)`;
  for (const b of $('s-picker').children) {
    b.setAttribute('aria-pressed', String(b.dataset.kind === me.character));
    b.querySelector('canvas').dataset.color = me.color;
  }
  renderPlayers($('s-players'), { size: 84, empty: '' });
}

// ───────────── 처음 한 번 준비 ─────────────
function init() {
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
  $('open-teacher').addEventListener('click', () => {
    $('create-form').hidden = !$('create-form').hidden;
    if (!$('create-form').hidden) $('create-password').focus();
  });
  $('create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send({ t: 'create', password: $('create-password').value });
  });

  fillSelect($('t-mode'), MODES);
  fillSelect($('t-map'), MAPS);
  fillSelect($('t-chasers'), [
    { id: 'auto', name: '자동' },
    { id: '1', name: '1명' },
    { id: '2', name: '2명' },
    { id: '3', name: '3명' },
  ]);
  fillSelect($('t-missions'), [3, 4, 5, 6, 7, 8].map((n) => ({ id: String(n), name: `${n}문제` })));
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
    });
  };
  fillSelect($('t-minutes'), MINUTES.map((n) => ({ id: String(n), name: `${n}분` })));
  fillSelect($('t-meetings'), MEETING_CHOICES.map((n) => ({ id: String(n), name: n ? `${n}번` : '없음' })));
  $('t-meetings').value = String(IMP.meetingsDefault);
  for (const id of ['t-mode', 't-map', 't-chasers', 't-missions', 't-minutes', 't-meetings', 't-reveal-role']) $(id).addEventListener('change', sendSettings);
  $('t-pick-toggle').addEventListener('click', () => {
    const open = $('t-pick').hidden;
    $('t-pick').hidden = !open;
    $('t-pick-toggle').setAttribute('aria-expanded', String(open));
    $('t-pick-toggle').textContent = open ? '방해꾼 고르기 닫기' : '방해꾼 고르기 열기';
  });
  meetingView = initMeeting({ send, toast });
  $('g-roles').addEventListener('click', () => setRoles(!showRoles));
  $('g-freeze').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    doFreeze();
  });
  $('g-alarm').addEventListener('click', doAlarm);
  $('g-sabo').addEventListener('click', toggleSabo);
  $('g-sabo-blackout').addEventListener('click', () => doSabotage('blackout'));
  $('g-sabo-lock').addEventListener('click', () => doSabotage('lock'));
  $('g-sabo-disguise').addEventListener('click', () => doSabotage('disguise'));
  $('g-map').addEventListener('click', () => setMinimap(!mapOpen));
  $('g-minimap-close').addEventListener('click', () => setMinimap(false));
  for (const id of ['g-freeze', 'g-alarm', 'g-sabo']) $(id).addEventListener('contextmenu', (e) => e.preventDefault());
  initQset({ toast, onConfirm: (set) => send({ t: 'questions', set }) });
  mission = initMission({
    send,
    onOpen: () => {
      if (game) game.setPaused(true);
      renderAction();
    },
    onClose: () => {
      if (game) game.setPaused(false);
      renderAction();
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
    const url = `${location.origin}/?room=${room.code}`;
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
    if (confirm('게임을 끝내고 대기방으로 돌아갈까요?')) send({ t: 'end' });
  });

  show('home');
  connect();
  requestAnimationFrame(animate);
}
init();
