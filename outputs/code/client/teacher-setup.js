// 선생님 페이지 첫 화면: 방을 만들기 전에 한 화면에서 준비한다.
//   ① 문제 넣기(직접 입력 표 · 문제 은행 · 엑셀 올리기 · 빈 양식 · AI 요청문 · 예시 · 보관한 세트)
//   ② 놀이 방법 ③ 맵 ④ 자세히 설정 → [방 만들기]
// 방 만들기를 누르면 create 를 보내고, 서버가 'created' 로 답하면 고른 설정(settings)과 문제(questions)를
// 기존 메시지 그대로 곧바로 보낸다. 고른 설정은 localStorage(sg-tsetup), 문제는 qset.js 의 초안(sg-qdraft)에 남는다.
import { CHARACTERS, MODES, MAPS, MINUTES } from './shared/config.js';
import { MAF, MEETING_CHOICES } from './mafiaconst.js';
import { buildGrid } from './shared/mapgrid.js';
import { renderMap, renderOverview } from './maprender.js';
import { HEADER } from './shared/questions.js';
import {
  loadDraft, saveDraft, blankRow, toRow, rowFilled, checkRows, loadSaved, saveSet,
  downloadTemplate, downloadRows, readQuestionFile, DRAFT_EVENT,
} from './qset.js';
import { initBank } from './bank.js';

const $ = (id) => document.getElementById(id);
const SETUP_KEY = 'sg-tsetup';
const MIN_ROWS = 5;

// 서버의 방 기본값과 같게 둔다 (server/index.js create)
const DEFAULTS = {
  mode: MODES[0].id,
  map: MAPS[0].id,
  chasers: 'auto',
  missions: 5,
  minutes: 10,
  meetings: MAF.meetingsDefault,
  reveal: true,
  fogLoot: true,
  notebook: true,
  chaserSpeed: 'same',
};
// 잠귀신 속도 (잠귀신 술래잡기에서만). 값 이름은 서버와 약속한 것 그대로.
export const CHASER_SPEEDS = [
  { id: 'same', name: '학생과 같은 속도' },
  { id: 'fast', name: '조금 빠르게' },
  { id: 'very', name: '매우 빠르게' },
];

const MODE_INFO = {
  'sleep-tag': { line: '잠귀신을 피해 퀴즈를 맞히고 랜턴을 켜요. 꿈에 빠진 친구는 옆에서 깨워 줘요.', kind: 6, color: 7 },
  mafia: { line: '친구들 사이에 숨은 꿈도둑을 모닥불 회의와 지목으로 찾아내요.', kind: 7, color: 4 },
};

// 예시 문제 (여러 과목이 섞인 연습용)
const EXAMPLES = [
  { q: '우리나라의 수도는 어디일까요?', a: '서울', wrong: [], alts: ['서울특별시'] },
  { q: '7 × 8 은 얼마일까요?', a: '56', wrong: ['54', '48', '64'] },
  { q: '물이 얼면 무엇이 될까요?', a: '얼음', wrong: ['수증기', '구름', '이슬'] },
  { q: '다음 중 포유류는 무엇일까요?', a: '고래', wrong: ['상어', '개구리', '독수리'] },
  { q: '1년은 몇 개월일까요?', a: '12', wrong: [] },
  { q: '"apple"을 우리말로 하면?', a: '사과', wrong: ['포도', '배', '귤'] },
];

function loadSetup() {
  try {
    const v = JSON.parse(localStorage.getItem(SETUP_KEY));
    if (v && typeof v === 'object') return { ...DEFAULTS, ...v };
  } catch {
    /* 기본값 */
  }
  return { ...DEFAULTS };
}
function storeSetup(s) {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(s));
  } catch {
    /* 저장이 막힌 브라우저 */
  }
}
const fill = (sel, items) => {
  sel.replaceChildren();
  for (const it of items) sel.add(new Option(it.name, it.id));
};
const onOff = (b) => (b === false ? 'off' : 'on');

/**
 * opts: { send(msg), toast(msg), showMsg(msg), qset (initQset 의 결과) }
 * 돌려주는 것: { onCreated(), remember(settings), lobbySpeedSelect() }
 */
export function initTeacherSetup(opts) {
  let setup = loadSetup();
  let draft = loadDraft();
  let pending = null; // 방 만들기 뒤 보낼 { settings, set }

  // ───────────────── ① 문제 표 ─────────────────
  const rowsBox = $('ts-rows');
  const ensureRows = () => {
    while (draft.rows.length < MIN_ROWS) draft.rows.push(blankRow());
    if (rowFilled(draft.rows[draft.rows.length - 1])) draft.rows.push(blankRow()); // 맨 아래에 늘 빈 줄 하나
  };
  let saveTimer = 0;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveDraft(draft, 'setup'), 300);
  };

  const COLS = [
    { key: 'q', ph: '문제를 적어 주세요' },
    { key: 'a', ph: '정답' },
    { key: 'w0', ph: '오답 1' },
    { key: 'w1', ph: '오답 2' },
    { key: 'w2', ph: '오답 3' },
  ];
  const getCell = (r, k) => (k[0] === 'w' ? r.wrong[Number(k[1])] : r[k]);
  const setCell = (r, k, v) => {
    if (k[0] === 'w') r.wrong[Number(k[1])] = v;
    else r[k] = v;
  };

  function buildRow(r, i) {
    const row = document.createElement('div');
    row.className = 'ts-row';
    row.setAttribute('role', 'row');
    const num = document.createElement('span');
    num.className = 'ts-n';
    num.textContent = String(i + 1);
    row.append(num);
    COLS.forEach((col, ci) => {
      const cell = document.createElement('span');
      cell.className = `ts-c ts-c-${col.key}`;
      const inp = document.createElement('input');
      inp.value = getCell(r, col.key);
      inp.placeholder = col.ph;
      inp.setAttribute('aria-label', `${i + 1}번 ${col.ph}`);
      inp.dataset.col = String(ci);
      inp.addEventListener('input', () => {
        setCell(r, col.key, inp.value);
        afterEdit(i);
      });
      inp.addEventListener('paste', (e) => onPaste(e, i, ci));
      cell.append(inp);
      if (col.key === 'a') {
        const alt = document.createElement('input');
        alt.className = 'ts-alt';
        alt.value = r.alts;
        alt.placeholder = '같이 인정할 답 (쉼표)';
        alt.setAttribute('aria-label', `${i + 1}번 함께 인정할 답`);
        alt.addEventListener('input', () => {
          r.alts = alt.value;
          persist();
        });
        cell.append(alt);
      }
      row.append(cell);
    });
    const kind = document.createElement('span');
    kind.className = 'ts-kind';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ts-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', `${i + 1}번 줄 지우기`);
    del.addEventListener('click', () => {
      draft.rows.splice(i, 1);
      renderRows();
      persist();
    });
    const note = document.createElement('p');
    note.className = 'ts-note';
    row.append(kind, del, note);
    return row;
  }

  function renderRows() {
    ensureRows();
    rowsBox.replaceChildren(...draft.rows.map(buildRow));
    refreshStatus();
  }

  function afterEdit(i) {
    if (i === draft.rows.length - 1 && rowFilled(draft.rows[i])) {
      draft.rows.push(blankRow());
      rowsBox.append(buildRow(draft.rows[i + 1], i + 1));
    }
    refreshStatus();
    persist();
  }

  function refreshStatus() {
    const { checks, good, bad } = checkRows(draft.rows, draft.title);
    checks.forEach((c, i) => {
      const row = rowsBox.children[i];
      if (!row) return;
      row.classList.toggle('bad', !!c && c.errors.length > 0);
      row.querySelector('.ts-kind').textContent = !c ? '' : c.errors.length ? '고쳐 주세요' : c.kind === 'choice' ? `${c.wrong.length + 1}지선다` : '주관식';
      row.querySelector('.ts-alt').hidden = !c || c.kind !== 'short' || !c.a;
      const note = c ? [...c.errors, ...c.warnings.map((w) => '참고: ' + w)].join(' · ') : '';
      row.querySelector('.ts-note').textContent = note;
      row.querySelector('.ts-note').hidden = !note;
    });
    $('ts-qcount').textContent = `넣은 문제 ${good}개` + (bad ? ` · 고칠 줄 ${bad}개` : '');
    $('ts-qcount').classList.toggle('warn', !good || bad > 0);
    $('ts-create-sub').textContent = good ? `문제 ${good}개` : '문제를 넣어 주세요';
  }

  // 엑셀에서 여러 칸·여러 줄을 복사해 붙여넣기 → 지금 칸부터 오른쪽·아래로 채운다
  function onPaste(e, rowIndex, colIndex) {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return; // 한 칸짜리는 보통 붙여넣기
    e.preventDefault();
    let lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length && lines[0].split('\t').map((s) => s.trim()).join() === HEADER.join()) lines = lines.slice(1);
    lines.forEach((line, k) => {
      const ri = rowIndex + k;
      while (draft.rows.length <= ri) draft.rows.push(blankRow());
      line.split('\t').forEach((v, j) => {
        const col = COLS[colIndex + j];
        if (col) setCell(draft.rows[ri], col.key, v.trim());
      });
    });
    renderRows();
    persist();
    opts.toast(`${lines.length}줄을 붙여넣었어요.`);
  }

  // 새 문제 목록을 표에 넣는다. 이미 적힌 문제가 있으면 바꿀지 이어 붙일지 묻는다.
  function putItems(items, title, what) {
    const incoming = items.map(toRow);
    const kept = draft.rows.filter(rowFilled);
    let replace = true;
    if (kept.length) {
      replace = confirm(`${what} ${incoming.length}문제를 찾았어요.\n\n[확인] 지금 적힌 문제 대신 이 문제로 바꿔요\n[취소] 지금 문제 아래에 이어 붙여요`);
    }
    draft.rows = replace ? incoming : kept.concat(incoming);
    if (replace || !draft.title.trim()) draft.title = title || '';
    $('ts-title').value = draft.title;
    renderRows();
    saveDraft(draft, 'setup');
    const { good } = checkRows(draft.rows, draft.title);
    opts.toast(`${replace ? '' : '이어 붙여서 '}문제가 ${good}개 들어 있어요.`);
  }

  const bank = initBank({ toast: opts.toast, onPick: putItems });
  $('ts-bank').addEventListener('click', () => bank.open());
  $('ts-upload').addEventListener('click', () => $('ts-file').click());
  $('ts-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { title, items } = await readQuestionFile(file);
      putItems(items, title, '파일에서');
    } catch (err) {
      opts.toast(err.message);
    }
  });
  $('ts-template').addEventListener('click', () => downloadTemplate(opts.toast));
  $('ts-prompt').addEventListener('click', () => opts.qset.openPrompt());
  $('ts-example').addEventListener('click', () => putItems(EXAMPLES, '예시 문제', '예시'));
  $('ts-add1').addEventListener('click', () => {
    draft.rows.push(blankRow());
    renderRows();
    rowsBox.lastElementChild?.querySelector('input')?.focus();
  });
  $('ts-add5').addEventListener('click', () => {
    for (let k = 0; k < 5; k++) draft.rows.push(blankRow());
    renderRows();
  });
  $('ts-clear').addEventListener('click', () => {
    if (!draft.rows.some(rowFilled)) return;
    if (!confirm('적힌 문제를 모두 지울까요? (보관한 세트는 그대로 남아요)')) return;
    draft = { title: '', rows: [] };
    $('ts-title').value = '';
    renderRows();
    saveDraft(draft, 'setup');
  });
  $('ts-title').addEventListener('input', (e) => {
    draft.title = e.target.value;
    persist();
  });
  $('ts-keep').addEventListener('click', () => {
    const { set, bad } = checkRows(draft.rows, draft.title);
    if (!set.questions.length) return opts.toast('보관할 문제가 없어요. 문제와 정답을 적어 주세요.');
    const ok = saveSet(set);
    refreshSaved();
    opts.qset.refreshSaved();
    opts.toast(ok ? `"${set.title}" ${set.questions.length}문제를 이 컴퓨터에 보관했어요.` + (bad ? ` (고칠 줄 ${bad}개는 뺐어요)` : '') : '이 브라우저에는 보관하지 못했어요.');
  });
  $('ts-export').addEventListener('click', () => {
    if (!draft.rows.some(rowFilled)) return opts.toast('저장할 문제가 없어요.');
    downloadRows(draft.rows, draft.title);
  });

  function refreshSaved() {
    const list = loadSaved();
    const sel = $('ts-saved');
    sel.replaceChildren(new Option(list.length ? '보관한 세트 불러오기…' : '보관한 세트 없음', ''));
    list.forEach((s, i) => sel.add(new Option(`${s.title} (${s.questions.length}문제)`, String(i))));
    sel.disabled = !list.length;
  }
  $('ts-saved').addEventListener('change', (e) => {
    const s = loadSaved()[Number(e.target.value)];
    e.target.value = '';
    if (s) putItems(s.questions, s.title, `"${s.title}"에서`);
  });

  // 대기방(미리보기 창)에서 문제를 확정하면 이 표도 같은 내용으로 맞춘다
  window.addEventListener(DRAFT_EVENT, (e) => {
    if (e.detail && e.detail.from === 'setup') return;
    draft = loadDraft();
    $('ts-title').value = draft.title;
    renderRows();
    refreshSaved();
  });

  // ───────────────── ② 놀이 방법 · ③ 맵 (카드) ─────────────────
  function card(group, id, title, line, visual) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ts-card';
    b.dataset.id = id;
    b.setAttribute('role', 'radio');
    const t = document.createElement('b');
    t.textContent = title;
    const p = document.createElement('span');
    p.className = 'ts-line';
    p.textContent = line;
    b.append(visual, t, p);
    b.addEventListener('click', () => {
      setup[group] = id;
      apply();
    });
    return b;
  }
  for (const m of MODES) {
    const info = MODE_INFO[m.id] || { line: '', kind: 0, color: 0 };
    const cv = document.createElement('canvas');
    cv.className = 'char ts-char'; // app.js 의 그림 반복이 data-kind 대로 캐릭터를 그린다
    cv.dataset.kind = (CHARACTERS[info.kind] || CHARACTERS[0]).id;
    cv.dataset.color = String(info.color);
    cv.dataset.seed = '0.5';
    cv.dataset.moving = '1';
    cv.width = cv.height = 140;
    $('ts-modes').append(card('mode', m.id, m.name, info.line, cv));
  }
  for (const m of MAPS) {
    const box = document.createElement('span');
    box.className = 'ts-thumb';
    box.textContent = '그림 준비 중…';
    $('ts-maps').append(card('map', m.id, m.name, m.desc || '', box));
    drawThumb(m.id, box);
  }
  // 맵 미리보기: 맵 데이터에 그림 주소(thumb)가 있으면 그 그림, 없으면 게임 지도를 작게 그린다
  async function drawThumb(id, box) {
    try {
      const data = await (await fetch(new URL(`./maps/${id}.json`, import.meta.url))).json();
      if (data.thumb) {
        const img = new Image();
        img.alt = '';
        img.src = new URL(`./maps/${data.thumb}`, import.meta.url).href;
        box.replaceChildren(img);
        return;
      }
      const big = renderMap(data, buildGrid(data), { mode: setup.mode });
      if (data.floors && data.floors.length) {
        // 여러 층 맵: 층 사이 밤하늘을 빼고 층마다 한 칸씩 모아 그린다 (미리보기 칸 비율 2800:1900)
        box.replaceChildren(renderOverview(data, big, 560, 380));
        return;
      }
      const cv = document.createElement('canvas');
      const w = 480;
      cv.width = w;
      cv.height = Math.round((w * big.height) / big.width);
      cv.getContext('2d').drawImage(big, 0, 0, cv.width, cv.height);
      box.replaceChildren(cv);
    } catch (err) {
      console.warn('맵 미리보기를 못 그렸어요', err);
      box.textContent = '';
    }
  }

  // ───────────────── ④ 자세히 설정 ─────────────────
  fill($('ts-chasers'), [{ id: 'auto', name: '자동 (인원에 맞춰 추천)' }, ...[1, 2, 3].map((n) => ({ id: String(n), name: `${n}명` }))]);
  fill($('ts-speed'), CHASER_SPEEDS);
  fill($('ts-missions'), [3, 4, 5, 6, 7, 8].map((n) => ({ id: String(n), name: `${n}개` })));
  fill($('ts-minutes'), MINUTES.map((n) => ({ id: String(n), name: `${n}분` })));
  fill($('ts-meetings'), MEETING_CHOICES.map((n) => ({ id: String(n), name: n ? `${n}번` : '없음' })));
  const readForm = () => {
    const c = $('ts-chasers').value;
    setup.chasers = c === 'auto' ? 'auto' : Number(c);
    setup.chaserSpeed = $('ts-speed').value;
    setup.missions = Number($('ts-missions').value);
    setup.minutes = Number($('ts-minutes').value);
    setup.meetings = Number($('ts-meetings').value);
    setup.fogLoot = $('ts-fogloot').value !== 'off';
    setup.notebook = $('ts-notebook').value !== 'off';
    setup.reveal = $('ts-reveal').value !== 'off';
    apply();
  };
  for (const id of ['ts-chasers', 'ts-speed', 'ts-missions', 'ts-minutes', 'ts-meetings', 'ts-fogloot', 'ts-notebook', 'ts-reveal']) $(id).addEventListener('change', readForm);

  const setSelect = (id, v, fallback) => {
    const sel = $(id);
    sel.value = String(v);
    if (sel.selectedIndex < 0) sel.value = String(fallback);
  };
  // 고른 값을 화면에 그리고 저장한다
  function apply() {
    if (!MODES.some((m) => m.id === setup.mode)) setup.mode = DEFAULTS.mode;
    if (!MAPS.some((m) => m.id === setup.map)) setup.map = DEFAULTS.map;
    if (!CHASER_SPEEDS.some((s) => s.id === setup.chaserSpeed)) setup.chaserSpeed = DEFAULTS.chaserSpeed;
    for (const [box, key] of [['ts-modes', 'mode'], ['ts-maps', 'map']]) {
      for (const b of $(box).children) b.setAttribute('aria-checked', String(b.dataset.id === setup[key]));
    }
    const mafia = setup.mode === 'mafia';
    const chaser = mafia ? '꿈도둑' : '잠귀신';
    $('ts-chaser-label').textContent = `${chaser} 수`;
    $('ts-speed-wrap').hidden = mafia;
    for (const el of document.querySelectorAll('.ts-imp')) el.hidden = !mafia;
    setSelect('ts-chasers', setup.chasers ?? 'auto', 'auto');
    setSelect('ts-speed', setup.chaserSpeed, 'same');
    setSelect('ts-missions', setup.missions, DEFAULTS.missions);
    setSelect('ts-minutes', setup.minutes, DEFAULTS.minutes);
    setSelect('ts-meetings', setup.meetings, DEFAULTS.meetings);
    $('ts-fogloot').value = onOff(setup.fogLoot);
    $('ts-notebook').value = onOff(setup.notebook);
    $('ts-reveal').value = onOff(setup.reveal);
    const speed = CHASER_SPEEDS.find((s) => s.id === setup.chaserSpeed);
    $('ts-more-sum').textContent =
      `· ${chaser} ${setup.chasers === 'auto' ? '자동' : setup.chasers + '명'}` +
      (mafia ? ` · 회의 종 ${setup.meetings ? setup.meetings + '번' : '없음'}` : ` · ${speed ? speed.name : ''}`) +
      ` · 랜턴 ${setup.missions}개 · ${setup.minutes}분`;
    storeSetup(setup);
  }

  // ───────────────── 방 만들기 ─────────────────
  const createBtn = $('ts-create');
  $('create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    opts.showMsg('');
    const { set, good, bad } = checkRows(draft.rows, draft.title);
    if (!good) {
      opts.showMsg('문제를 한 개 이상 넣어 주세요. (문제와 정답 칸을 채워 주세요)');
      rowsBox.querySelector('input')?.focus();
      return;
    }
    if (bad && !confirm(`고쳐야 할 줄 ${bad}개는 빼고 ${good}문제로 방을 만들까요?`)) return;
    const pw = $('create-password');
    if (pw && !pw.value) {
      opts.showMsg('선생님 비밀번호를 적어 주세요.');
      pw.focus();
      return;
    }
    const { mode, map, chasers, missions, minutes, meetings, reveal, fogLoot, notebook, chaserSpeed } = setup;
    pending = { settings: { mode, map, chasers, missions, minutes, meetings, reveal, fogLoot, notebook, chaserSpeed }, set };
    createBtn.disabled = true; // 연타 막기
    setTimeout(() => (createBtn.disabled = false), 1500);
    opts.send(pw ? { t: 'create', password: pw.value } : { t: 'create' });
  });

  $('ts-title').value = draft.title;
  renderRows();
  refreshSaved();
  apply();

  return {
    // 서버가 방을 만들었다: 고른 설정과 문제를 바로 보낸다
    onCreated() {
      if (!pending) return;
      opts.send({ t: 'settings', ...pending.settings });
      opts.send({ t: 'questions', set: pending.set });
      pending = null;
    },
    // 대기방에서 바꾼 설정을 기억한다 (다음에 방을 만들 때 같은 값으로 시작)
    remember(s) {
      if (!s) return;
      const next = { ...setup };
      for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
      if (JSON.stringify(next) === JSON.stringify(setup)) return;
      setup = next;
      apply();
    },
  };
}

/**
 * 대기방 정리 (화면 틀 index.html 은 그대로 두고 여기서 옮긴다):
 *  - '게임 시작'·안내를 위로, 나머지 설정은 '설정 바꾸기' 접기 안으로
 *  - 잠귀신 속도 선택을 잠귀신 수 아래에 붙인다 (id: t-speed, 감싼 칸 id: t-speed-wrap)
 */
export function arrangeLobby() {
  const cardEl = document.querySelector('#view-teacher .settings-card');
  if (!cardEl || cardEl.dataset.arranged) return;
  cardEl.dataset.arranged = '1';
  const chaserLabel = $('t-chasers').closest('label');
  const wrap = document.createElement('label');
  wrap.id = 't-speed-wrap';
  wrap.append('잠귀신 속도 ');
  const sel = document.createElement('select');
  sel.id = 't-speed';
  fill(sel, CHASER_SPEEDS);
  wrap.append(sel);
  chaserLabel.after(wrap);

  const startRow = $('t-start').closest('.row');
  const hint = $('t-hint');
  const more = document.createElement('details');
  more.className = 't-more';
  const sum = document.createElement('summary');
  sum.textContent = '설정 바꾸기';
  const small = document.createElement('small');
  small.id = 't-more-sum';
  small.className = 'hint';
  sum.append(' ', small);
  more.append(sum);
  for (const el of [...cardEl.children]) if (el !== startRow && el !== hint) more.append(el);
  startRow.classList.add('t-start-row');
  cardEl.replaceChildren(startRow, hint, more);
}
