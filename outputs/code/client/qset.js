// 선생님용: 미션 문제 세트 만들기 (엑셀 올리기 → 미리보기·고치기 → 확정), 빈 양식, AI 요청문.
import { readXlsx, writeXlsx } from '/shared/xlsx.js';
import { HEADER, SHEET_NAME, parseSheetRows, checkQuestion, normalizeAnswer, buildPrompt } from '/shared/questions.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'sg-qsets';
const MAX_SAVED = 30;

// ───────────── 이 브라우저에 보관한 세트 ─────────────
function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveSet(set) {
  const list = loadSaved().filter((s) => s.title !== set.title);
  list.unshift({ ...set, savedAt: Date.now() });
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
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

/**
 * opts: { toast(msg), onConfirm(set) }  — set = { title, questions: [{ q, a, wrong, alts }] }
 */
export function initQset(opts) {
  let draft = []; // 미리보기에서 고치는 중인 문제들

  // ───── 빈 양식 ─────
  $('q-template').addEventListener('click', () => {
    download(writeXlsx([HEADER], SHEET_NAME, [60, 22, 22, 22, 22]), '미션문제_빈양식.xlsx');
    opts.toast('빈 양식을 내려받았어요. 첫 줄(제목)은 그대로 두고 둘째 줄부터 적어 주세요.');
  });

  // ───── AI 요청문 팝업 ─────
  const refreshPrompt = () => {
    $('p-text').value = buildPrompt({ count: Number($('p-count').value), grade: $('p-grade').value });
  };
  $('q-prompt').addEventListener('click', () => {
    refreshPrompt();
    $('dlg-prompt').showModal();
  });
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

  // ───── 엑셀 올리기 ─────
  $('q-upload').addEventListener('click', () => $('q-file').click());
  $('q-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return opts.toast('파일이 너무 커요. (5MB까지)');
    try {
      const { rows } = await readXlsx(await file.arrayBuffer(), SHEET_NAME);
      const parsed = parseSheetRows(rows);
      if (!parsed.headerOk) {
        return opts.toast(`양식이 달라요. 첫 줄이 "${HEADER.join(', ')}" 순서여야 해요. 빈 양식을 내려받아 써 주세요.`);
      }
      if (!parsed.items.length) return opts.toast('문제가 한 줄도 없어요.');
      openPreview(file.name.replace(/\.xlsx$/i, ''), parsed.items);
    } catch (err) {
      console.error(err);
      opts.toast(err.message && err.message.includes('엑셀') ? err.message : '파일을 읽지 못했어요. 엑셀(xlsx) 파일인지 확인해 주세요.');
    }
  });

  // ───── 보관한 세트 고르기 ─────
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
    if (s) openPreview(s.title, s.questions.map((q, i) => ({ row: i + 1, ...q })));
  });
  refreshSaved();

  // ───── 미리보기 · 고치기 ─────
  function openPreview(title, items) {
    draft = items.map((it) => ({
      q: it.q,
      a: it.a,
      wrong: [0, 1, 2].map((k) => (it.wrong || [])[k] || ''),
      alts: (it.alts || []).join(', '),
    }));
    $('v-title').value = title;
    renderRows();
    $('dlg-preview').showModal();
  }

  function evaluate() {
    const seen = new Set();
    return draft.map((d) => {
      const c = checkQuestion({ q: d.q, a: d.a, wrong: d.wrong });
      const key = normalizeAnswer(d.q);
      if (key && seen.has(key)) c.errors.push('같은 문제가 위에 또 있어요');
      seen.add(key);
      return c;
    });
  }

  function refreshStatus() {
    const checks = evaluate();
    const rows = $('v-rows').children;
    let good = 0;
    checks.forEach((c, i) => {
      const row = rows[i];
      if (!row) return;
      const bad = c.errors.length > 0;
      if (!bad) good++;
      row.classList.toggle('bad', bad);
      row.querySelector('.v-kind').textContent = c.kind === 'choice' ? `${c.wrong.length + 1}지선다` : '주관식';
      row.querySelector('.v-alts').hidden = c.kind !== 'short';
      row.querySelector('.v-note').textContent = [...c.errors, ...c.warnings.map((w) => '참고: ' + w)].join(' · ');
    });
    const bad = checks.length - good;
    $('v-summary').textContent = `쓸 수 있는 문제 ${good}개` + (bad ? ` · 고쳐야 할 문제 ${bad}개 (고치지 않으면 빼고 확정해요)` : '');
    $('v-confirm').disabled = good === 0;
    return checks;
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
    const checks = refreshStatus();
    const questions = [];
    checks.forEach((c, i) => {
      if (c.errors.length) return;
      const alts = c.kind === 'short' ? draft[i].alts.split(',').map((s) => s.trim()).filter(Boolean) : [];
      questions.push({ q: c.q, a: c.a, wrong: c.wrong, alts });
    });
    if (!questions.length) return;
    const set = { title: $('v-title').value.trim() || '이름 없는 문제 세트', questions };
    const kept = saveSet(set);
    refreshSaved();
    $('dlg-preview').close();
    opts.onConfirm(set);
    opts.toast(kept ? `"${set.title}" ${questions.length}문제를 확정하고 이 컴퓨터에 보관했어요.` : `"${set.title}" ${questions.length}문제를 확정했어요. (이 브라우저에는 보관하지 못했어요)`);
  });
}
