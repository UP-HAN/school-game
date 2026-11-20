// 학습 기록 화면: 선생님용(많이 틀린 문제·학생별·CSV)과 학생용(나의 기록).
import { playerLabel } from '/shared/config.js';

const $ = (id) => document.getElementById(id);
const RESULT = { first: '첫 시도에 정답', retry: '다시 도전해 해결', unsolved: '아직 못 푼 문제' };
const KIND = { choice: '고르기', short: '주관식' };
const sec = (ms) => (ms / 1000).toFixed(1);

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function table(headers, rows) {
  const t = el('table', null, 'r-table');
  const head = el('tr');
  headers.forEach((h) => head.append(el('th', h)));
  t.append(head);
  for (const r of rows) {
    const tr = el('tr');
    r.forEach((c, i) => tr.append(el('td', String(c), i === 0 ? 'left' : '')));
    t.append(tr);
  }
  return t;
}

// 문제별로 모으기: 많이 틀린 문제가 위로 오게
export function byQuestion(records) {
  const map = new Map();
  for (const r of records) {
    const q = map.get(r.question) || { question: r.question, answer: r.answer, tries: 0, first: 0, retry: 0, unsolved: 0, wrong: 0 };
    q.tries++;
    q[r.result]++;
    q.wrong += r.wrong;
    map.set(r.question, q);
  }
  return [...map.values()].sort((a, b) => b.wrong - a.wrong || b.unsolved - a.unsolved || b.tries - a.tries);
}
// 학생별로 모으기
export function byStudent(records) {
  const map = new Map();
  for (const r of records) {
    const key = r.name;
    const s = map.get(key) || { name: r.name, label: playerLabel(r.color, r.character), first: 0, retry: 0, unsolved: 0, wrong: 0, ms: 0, solved: 0 };
    s[r.result]++;
    s.wrong += r.wrong;
    if (r.result !== 'unsolved') {
      s.ms += r.ms;
      s.solved++;
    }
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function toCsv(records) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 엑셀이 수식으로 읽지 않게
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [['학생', '캐릭터', '문제', '정답', '형식', '결과', '오답 횟수', '걸린 시간(초)']];
  for (const r of records) {
    lines.push([r.name, playerLabel(r.color, r.character), r.question, r.answer, KIND[r.kind] || r.kind, RESULT[r.result] || r.result, r.wrong, sec(r.ms)]);
  }
  return '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n'); // 맨 앞 표시는 엑셀에서 한글이 깨지지 않게 하는 것
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 선생님용
export function showTeacherReport(m) {
  const box = $('r-body');
  box.replaceChildren();
  $('r-title').textContent = '학습 기록' + (m.title ? ` · ${m.title}` : '');
  const recs = m.records;
  if (!recs.length) {
    box.append(el('p', '아직 기록이 없어요. 학생이 문제를 풀면 여기에 쌓여요.', 'sub'));
  } else {
    const solved = recs.filter((r) => r.result !== 'unsolved').length;
    const first = recs.filter((r) => r.result === 'first').length;
    box.append(el('p', `문제를 연 횟수 ${recs.length}번 · 해결 ${solved}번 · 첫 시도 정답 ${first}번 (${Math.round((first / recs.length) * 100)}%)`, 'sub'));
    box.append(el('h3', '많이 틀린 문제'));
    box.append(
      table(
        ['문제', '정답', '연 횟수', '첫 시도 정답', '다시 풀어 해결', '못 풂', '오답 수'],
        byQuestion(recs).map((q) => [q.question, q.answer, q.tries, q.first, q.retry, q.unsolved, q.wrong])
      )
    );
    box.append(el('h3', '학생별'));
    box.append(
      table(
        ['학생', '캐릭터', '첫 시도 정답', '다시 풀어 해결', '못 풂', '오답 수', '평균 시간(초)'],
        byStudent(recs).map((s) => [s.name, s.label, s.first, s.retry, s.unsolved, s.wrong, s.solved ? sec(s.ms / s.solved) : '-'])
      )
    );
  }
  $('r-csv').hidden = !recs.length;
  $('r-csv').onclick = () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    downloadText(toCsv(recs), `학습기록_${m.title || m.code}_${stamp}.csv`);
  };
  if (!$('dlg-report').open) $('dlg-report').showModal();
}

// 학생용: 점수 비교 없이 내가 푼 문제만
export function showMyReport(m) {
  const box = $('r-body');
  box.replaceChildren();
  $('r-title').textContent = '나의 기록';
  $('r-csv').hidden = true;
  if (!m.records.length) box.append(el('p', '아직 푼 문제가 없어요.', 'sub'));
  const order = { unsolved: 0, retry: 1, first: 2 };
  // 같은 문제를 여러 번 열었으면 가장 좋은 결과 하나만 보여 준다
  const best = new Map();
  for (const r of m.records) {
    const old = best.get(r.question);
    if (!old || order[r.result] > order[old.result]) best.set(r.question, r);
  }
  for (const r of [...best.values()].sort((a, b) => order[a.result] - order[b.result])) {
    const card = el('div', null, 'r-card ' + r.result);
    card.append(el('p', r.question, 'r-q'));
    card.append(el('p', RESULT[r.result] + (r.answer ? ` · 정답: ${r.answer}` : ''), 'r-res'));
    box.append(card);
  }
  if (!$('dlg-report').open) $('dlg-report').showModal();
}

export function initReport() {
  $('r-close').addEventListener('click', () => $('dlg-report').close());
}
