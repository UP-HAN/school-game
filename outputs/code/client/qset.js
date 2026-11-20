// 선생님용: 퀴즈 문제 세트. 빈 양식 · AI 요청문 · 엑셀 읽기 · 미리보기(고치기) 창 · 이 브라우저에 보관.
// 방 만들기 전 화면(teacher-setup.js)과 대기방이 함께 쓴다.
//  - '입력 중인 문제'(초안)는 localStorage(sg-qdraft)에 두어 새로고침해도 남는다.
//  - '보관한 세트'는 localStorage(sg-qsets)에 이름별로 최대 30개.
import { readXlsx, writeXlsx } from './shared/xlsx.js';
import { HEADER, SHEET_NAME, parseSheetRows, checkQuestion, normalizeAnswer, buildPrompt } from './shared/questions.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'sg-qsets';
const DRAFT_KEY = 'sg-qdraft';
const MAX_SAVED = 30;
export const DRAFT_EVENT = 'sg-qdraft-change';

// ───────────── 이 브라우저에 보관한 세트 ─────────────
export function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveSet(set) {
  const list = loadSaved().filter((s) => s.title !== set.title);
  list.unshift({ ...set, savedAt: Date.now() });
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
}

// ───────────── 입력 중인 문제 (초안) ─────────────
// 초안 한 줄: { q, a, wrong: ['', '', ''], alts: '쉼표로 구분한 글' }
export const blankRow = () => ({ q: '', a: '', wrong: ['', '', ''], alts: '' });
export function toRow(it) {
  return {
    q: it.q || '',
    a: it.a || '',
    wrong: [0, 1, 2].map((k) => (it.wrong || [])[k] || ''),
    alts: Array.isArray(it.alts) ? it.alts.join(', ') : it.alts || '',
  };
}
export const rowFilled = (r) => !!(r.q.trim() || r.a.trim() || r.wrong.some((w) => w.trim()));

export function loadDraft() {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (v && Array.isArray(v.rows)) return { title: String(v.title || ''), rows: v.rows.map(toRow) };
  } catch {
    /* 없거나 깨졌으면 빈 초안 */
  }
  return { title: '', rows: [] };
}
/** from: 누가 바꿨는지 (같은 화면이 자기 이벤트로 다시 그리지 않게) */
export function saveDraft(draft, from = '') {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title: draft.title, rows: draft.rows.filter(rowFilled) }));
  } catch {
    /* 저장이 막힌 브라우저: 새로고침하면 사라진다 */
  }
  window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { from } }));
}

/** 초안 줄들을 검사한다. 빈 줄은 건너뛴다. → { checks: 줄마다 결과(빈 줄은 null), set, good, bad } */
export function checkRows(rows, title) {
  const seen = new Set();
  const questions = [];
  let bad = 0;
  const checks = rows.map((r) => {
    if (!rowFilled(r)) return null;
    const c = checkQuestion({ q: r.q, a: r.a, wrong: r.wrong });
    const key = normalizeAnswer(r.q);
    if (key && seen.has(key)) c.errors.push('같은 문제가 위에 또 있어요');
    seen.add(key);
    if (c.errors.length) bad++;
    else {
      const alts = c.kind === 'short' ? r.alts.split(',').map((s) => s.trim()).filter(Boolean) : [];
      questions.push({ q: c.q, a: c.a, wrong: c.wrong, alts });
    }
    return c;
  });
  const set = { title: (title || '').trim() || '이름 없는 문제 세트', questions };
  return { checks, set, good: questions.length, bad };
}

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadTemplate(toast) {
  download(writeXlsx([HEADER], SHEET_NAME, [60, 22, 22, 22, 22]), '퀴즈문제_빈양식.xlsx');
  toast('빈 양식을 내려받았어요. 첫 줄(제목)은 그대로 두고 둘째 줄부터 적어 주세요.');
}

/** 지금 초안을 엑셀로 내려받기 (빈 양식과 같은 5칸) */
export function downloadRows(rows, title) {
  const body = rows.filter(rowFilled).map((r) => [r.q, r.a, ...r.wrong]);
  const name = ((title || '').trim() || '퀴즈문제').replace(/[\\/:*?"<>|]/g, '_');
  download(writeXlsx([HEADER, ...body], SHEET_NAME, [60, 22, 22, 22, 22]), `${name}.xlsx`);
}

/** 엑셀 파일 → { title, items } (문제가 없거나 양식이 다르면 Error) */
export async function readQuestionFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('파일이 너무 커요. (5MB까지)');
  let rows;
  try {
    ({ rows } = await readXlsx(await file.arrayBuffer(), SHEET_NAME));
  } catch (err) {
    console.error(err);
    throw new Error(err.message && err.message.includes('엑셀') ? err.message : '파일을 읽지 못했어요. 엑셀(xlsx) 파일인지 확인해 주세요.');
  }
  const parsed = parseSheetRows(rows);
  if (!parsed.headerOk) throw new Error(`양식이 달라요. 첫 줄이 "${HEADER.join(', ')}" 순서여야 해요. 빈 양식을 내려받아 써 주세요.`);
  if (!parsed.items.length) throw new Error('문제가 한 줄도 없어요.');
  return { title: file.name.replace(/\.xlsx$/i, ''), items: parsed.items };
}

/**
 * 대화창(AI 요청문·미리보기)과 대기방의 문제 칸을 준비한다.
 * opts: { toast(msg), onConfirm(set) }  — set = { title, questions: [{ q, a, wrong, alts }] } (대기방: 서버로 보냄)
 * 돌려주는 것: { openPrompt(), openPreview(title, items, onConfirm?), refreshSaved() }
 */
export function initQset(opts) {
  let draft = []; // 미리보기에서 고치는 중인 문제들
  let confirmCb = opts.onConfirm;

  // ───── AI 요청문 팝업 ─────
  const refreshPrompt = () => {
    $('p-text').value = buildPrompt({ count: Number($('p-count').value), grade: $('p-grade').value });
  };
  const openPrompt = () => {
    refreshPrompt();
    $('dlg-prompt').showModal();
  };
  $('p-count').addEventListener('change', refreshPrompt);
  $('p-grade').addEventListener('change', refreshPrompt);
  $('p-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('p-text').value);
      opts.toast('요청문을 복사했어요. AI에 자료(PDF)를 첨부하고 붙여넣어 주세요.');
    } catch {
      $('p-text').select();
      opts.toast('복사가 막혀 있어요. 글을 선택했으니 Ctrl+C 로 복사해 주세요.');
    }
  });
  $('p-close').addEventListener('click', () => $('dlg-prompt').close());

  // ───── 대기방의 문제 칸 ─────
  $('q-template').addEventListener('click', () => downloadTemplate(opts.toast));
  $('q-prompt').addEventListener('click', openPrompt);
  $('q-upload').addEventListener('click', () => $('q-file').click());
  $('q-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { title, items } = await readQuestionFile(file);
      openPreview(title, items);
    } catch (err) {
      opts.toast(err.message);
    }
  });
  // 대기방: 지금 넣은 문제를 고치는 버튼 (화면 틀(index.html)은 그대로 두고 여기서 붙인다)
  const edit = document.createElement('button');
  edit.id = 'q-edit';
  edit.type = 'button';
  edit.className = 'btn small';
  edit.textContent = '문제 고치기';
  edit.addEventListener('click', () => {
    const d = loadDraft();
    if (!d.rows.length) return opts.toast('고칠 문제가 없어요. 엑셀을 올리거나 보관한 세트를 골라 주세요.');
    openPreview(d.title, d.rows);
  });
  $('q-upload').after(edit);

  // ───── 보관한 세트 고르기 (대기방) ─────
  function refreshSaved() {
    const list = loadSaved();
    const sel = $('q-saved');
    sel.replaceChildren(new Option(list.length ? '보관한 문제 세트 고르기…' : '보관한 문제 세트가 없어요', ''));
    list.forEach((s, i) => sel.add(new Option(`${s.title} (${s.questions.length}문제)`, String(i))));
    sel.disabled = !list.length;
  }
  $('q-saved').addEventListener('change', (e) => {
    const s = loadSaved()[Number(e.target.value)];
    e.target.value = '';
    if (s) openPreview(s.title, s.questions);
  });
  refreshSaved();

  // ───── 미리보기 · 고치기 ─────
  function openPreview(title, items, onConfirm) {
    confirmCb = onConfirm || opts.onConfirm;
    draft = items.map(toRow);
    $('v-title').value = title || '';
    renderRows();
    $('dlg-preview').showModal();
  }

  function refreshStatus() {
    const { checks } = checkRows(draft, '');
    const rows = $('v-rows').children;
    let good = 0;
    let bad = 0;
    checks.forEach((c, i) => {
      const row = rows[i];
      if (!row) return;
      const isBad = !c || c.errors.length > 0;
      if (c && !isBad) good++;
      if (c && isBad) bad++;
      row.classList.toggle('bad', isBad);
      row.querySelector('.v-kind').textContent = !c ? '빈 줄' : c.kind === 'choice' ? `${c.wrong.length + 1}지선다` : '주관식';
      row.querySelector('.v-alts').hidden = !c || c.kind !== 'short';
      row.querySelector('.v-note').textContent = c ? [...c.errors, ...c.warnings.map((w) => '참고: ' + w)].join(' · ') : '비어 있어서 빼요';
    });
    $('v-summary').textContent = `쓸 수 있는 문제 ${good}개` + (bad ? ` · 고쳐야 할 문제 ${bad}개 (고치지 않으면 빼고 확정해요)` : '');
    $('v-confirm').disabled = good === 0;
  }

  function field(d, key, placeholder, cls, index) {
    const el = document.createElement(key === 'q' ? 'textarea' : 'input');
    if (key === 'q') el.rows = 2;
    el.className = cls;
    el.placeholder = placeholder;
    el.setAttribute('aria-label', placeholder);
    el.value = index == null ? d[key] : d[key][index];
    el.addEventListener('input', () => {
      if (index == null) d[key] = el.value;
      else d[key][index] = el.value;
      refreshStatus();
    });
    return el;
  }

  function renderRows() {
    const box = $('v-rows');
    box.replaceChildren();
    draft.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'v-row';
      const head = document.createElement('div');
      head.className = 'v-head';
      const num = document.createElement('b');
      num.textContent = `${i + 1}`;
      const kind = document.createElement('span');
      kind.className = 'v-kind';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small danger';
      del.textContent = '삭제';
      del.addEventListener('click', () => {
        draft.splice(i, 1);
        renderRows();
      });
      head.append(num, kind, del);
      const answers = document.createElement('div');
      answers.className = 'v-answers';
      answers.append(
        field(d, 'a', '정답', 'v-a'),
        field(d, 'wrong', '오답1', 'v-w', 0),
        field(d, 'wrong', '오답2', 'v-w', 1),
        field(d, 'wrong', '오답3', 'v-w', 2)
      );
      const alts = field(d, 'alts', '함께 인정할 답 (쉼표로 구분, 예: 서울특별시)', 'v-alts');
      const note = document.createElement('p');
      note.className = 'v-note';
      row.append(head, field(d, 'q', '문제', 'v-q'), answers, alts, note);
      box.append(row);
    });
    refreshStatus();
  }

  $('v-cancel').addEventListener('click', () => $('dlg-preview').close());
  $('v-confirm').addEventListener('click', () => {
    const { set } = checkRows(draft, $('v-title').value);
    if (!set.questions.length) return;
    const kept = saveSet(set);
    refreshSaved();
    // 확정한 세트가 곧 '입력 중인 문제'가 된다 (방 만들기 전 화면의 표와 같은 내용)
    saveDraft({ title: set.title, rows: set.questions.map(toRow) }, 'preview');
    $('dlg-preview').close();
    confirmCb(set);
    opts.toast(kept ? `"${set.title}" ${set.questions.length}문제를 확정하고 이 컴퓨터에 보관했어요.` : `"${set.title}" ${set.questions.length}문제를 확정했어요. (이 브라우저에는 보관하지 못했어요)`);
  });

  return { openPrompt, openPreview, refreshSaved };
}
