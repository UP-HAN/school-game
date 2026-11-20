// 첫 화면 + 대기방 (선생님·학생 공용). 게임 화면은 다음 단계에서 만든다.
import { COLORS, CHARACTERS, MODES, MAPS, LIMITS, TAG, MINUTES, playerLabel, recommendChasers, chaserCount } from '/shared/config.js';
import { drawCharacter } from '/characters.js';
import { startGame } from '/game.js';
import { initMission } from '/mission.js';
import { initQset } from '/qset.js';
import { initReport, showTeacherReport, showMyReport } from '/report.js';

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
  const chaser = isPlayer && myInfo.role === 'chaser';
  const mePlayer = isPlayer ? room.players.find((x) => x.id === session.id) : null;
  const frozen = !!(mePlayer && mePlayer.frozen);
  const done = isPlayer && myInfo.solved >= myInfo.missions;
  $('g-missions').textContent = !isPlayer ? '' : chaser ? '나는 술래' : done ? '내 미션 완료!' : `내 미션 ${myInfo.solved}/${myInfo.missions}`;
  $('g-missions').classList.toggle('chaser', !!chaser);
  if (isPlayer) {
    $('g-hint').textContent = chaser
      ? '학생에게 가까이 가서 [잡기]! 미끄럼틀과 개구멍은 탈 수 없어요'
      : frozen
        ? '꽁꽁 얼었어요! 친구가 와서 땡 해 주길 기다려요'
        : done
          ? '내 미션 완료! 얼어 있는 친구를 찾아 땡 해 주세요'
          : '느낌표(!)가 뜬 단말기를 찾아가 문제를 풀어요';
  }
  $('g-over').hidden = !room.over;
  if (room.over) {
    const studentsWin = room.over.winner === 'students';
    const why = { restored: '모든 단말기를 고쳤어요.', time_up: '시간 안에 학교를 다 고치지 못했어요.', all_frozen: '학생이 모두 얼어 버렸어요.' };
    $('g-over-title').textContent = studentsWin ? '학교 복구 완료! 학생 팀 승리' : '술래 승리!';
    $('g-over-text').textContent = why[room.over.reason] || '';
    cancelHold();
    if (mission) mission.hide();
  }
  $('g-myreport').hidden = !(room.over && session.role === 'player');
  if (session.role === 'teacher') renderSide();
  renderAction();
}

// 선생님 화면: 학생 현황 목록
let reveal = false;
function renderSide() {
  const box = $('g-side');
  box.replaceChildren();
  const h = document.createElement('h3');
  h.textContent = `학생 현황 (${room.players.length}명)`;
  box.append(h);
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
function setReveal(v) {
  reveal = v;
  $('g-reveal').setAttribute('aria-pressed', String(v));
  $('g-reveal').textContent = v ? '학생 위치 숨기기' : '학생 위치 보기';
  $('g-hint').textContent = v ? '' : '학생 위치는 숨겨져 있어요 (TV에 띄워도 술래가 볼 수 없어요)';
  if (game) game.setReveal(v);
}

// ───────────── 행동 버튼 (잡기 / 땡 / 문제 풀기 / 장치 타기) ─────────────
let action = null; // 지금 할 수 있는 행동 { type, id, label }
let holdTimer = 0; // 땡 버튼을 누르고 있는 동안의 타이머
let tagReadyAt = 0; // 술래가 다시 잡을 수 있는 때 (이 화면의 시계 기준)

function renderAction() {
  const btn = $('g-action');
  const hide = !action || !room || !!room.over || (mission && mission.isOpen());
  btn.hidden = hide;
  if (hide) return;
  const wait = action.type === 'tag' ? Math.ceil((tagReadyAt - performance.now()) / 1000) : 0;
  btn.disabled = wait > 0;
  $('g-action-label').textContent = wait > 0 ? `${action.label} (${wait})` : action.label;
  btn.classList.toggle('tag', action.type === 'tag');
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
  if (action.type === 'terminal') send({ t: 'open', terminal: action.id });
  else if (action.type === 'device') send({ t: 'use', device: action.id });
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
function renderClock() {
  if (!room || room.phase !== 'game') return;
  const left = room.over ? 0 : Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
  $('g-clock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('g-clock').classList.toggle('hurry', left <= 60 && !room.over);
  renderAction();
}
setInterval(renderClock, 250);

function showIntro(role) {
  const el = $('g-intro');
  $('g-intro-title').textContent = role === 'chaser' ? '너는 술래!' : '너는 학생!';
  $('g-intro-text').textContent =
    role === 'chaser'
      ? '친구들을 잡아 꽁꽁 얼려요. 시간이 끝날 때까지 학교를 못 고치게 막으면 승리!'
      : '단말기의 문제를 풀어 학교를 고쳐요. 얼어 버린 친구는 옆에서 땡! 해 주세요.';
  el.classList.toggle('chaser', role === 'chaser');
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 4500);
}

async function enterGame() {
  endsAt = performance.now() + (room.timeLeft || 0);
  renderGameHud();
  renderClock();
  if (game) return game.setPlayers(room.players, !!room.over);
  if (gameStarting) return;
  gameStarting = true;
  show('game');
  const isTeacher = session.role === 'teacher';
  const me = room.players.find((p) => p.id === session.id);
  $('g-label').textContent = isTeacher ? `${room.code}번 방 · 선생님 화면` : me ? playerLabel(me.color, me.character) : '';
  for (const id of ['g-end', 'g-reveal', 'g-report', 'g-side']) $(id).hidden = !isTeacher;
  if (isTeacher) setReveal(false);
  action = null;
  $('g-action').hidden = true;
  $('g-intro').hidden = true;
  try {
    const g = await startGame({
      canvas: $('game-canvas'),
      mapId: room.settings.map,
      role: session.role,
      myId: session.id,
      players: room.players,
      send,
      onContext(ctx) {
        action = ctx;
        cancelHold();
        renderAction();
      },
      onKey(dir) {
        if (dir === 'down') pressDown();
        else pressUp();
      },
    });
    // 맵을 읽는 사이에 게임이 끝났으면 바로 정리한다
    if (!room || room.phase !== 'game') g.stop();
    else {
      game = g;
      game.setReveal(reveal);
      game.setPlayers(room.players, !!room.over);
      if (myInfo) game.setMe(myInfo);
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
  cancelHold();
  if (mission) mission.hide();
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
    tagReadyAt = performance.now() + (m.tagMs || 0);
    if (game) game.setMe(m);
    if (room && room.phase === 'game') renderGameHud();
    // 게임이 막 시작됐을 때만 역할 안내를 띄운다 (도중 입장·새로고침 포함)
    if (first && room && room.phase === 'game' && !room.over) showIntro(m.role);
  },
  event(m) {
    if (game) game.onEvent(m);
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
  const use = chaserCount(room.settings, count);
  const balance = `${chaser} ${use}명 · 학생 ${count - use}명으로 시작해요.` + (use !== rec ? ` (추천은 ${rec}명)` : '');
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
    });
  };
  fillSelect($('t-minutes'), MINUTES.map((n) => ({ id: String(n), name: `${n}분` })));
  for (const id of ['t-mode', 't-map', 't-chasers', 't-missions', 't-minutes']) $(id).addEventListener('change', sendSettings);
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
