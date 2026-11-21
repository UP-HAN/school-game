// 선생님용: 문제 은행. client/bank/index.json 에 적힌 엑셀 파일 목록을 보여 주고, 고른 세트를 문제 표에 담는다.
// 새 세트를 더하는 방법은 client/bank/읽어보세요.md 에 있다.
import { readQuestionFile } from './qset.js';
import { cleanBankIndex } from './shared/questions.js';

const $ = (id) => document.getElementById(id);
const INDEX_URL = new URL('./bank/index.json', import.meta.url);
const ALL = '';

export const fileUrl = (file) => new URL(`./bank/${encodeURIComponent(file)}`, import.meta.url).href;

/**
 * opts: { toast(msg), onPick(items, title, what) }  — 고른 세트의 문제를 넘겨준다
 * 돌려주는 것: { open() }
 */
export function initBank(opts) {
  const dlg = $('dlg-bank');
  let sets = null; // 아직 안 불러옴

  const uniq = (key) => [...new Set(sets.map((s) => s[key]).filter(Boolean))];
  const fillSelect = (sel, label, values) => {
    const keep = sel.value;
    sel.replaceChildren(new Option(`${label} 전체`, ALL), ...values.map((v) => new Option(v, v)));
    sel.value = values.includes(keep) ? keep : ALL;
  };

  function render() {
    const g = $('bk-grade').value;
    const sub = $('bk-subject').value;
    const shown = sets.filter((s) => (g === ALL || s.grade === g) && (sub === ALL || s.subject === sub));
    $('bk-count').textContent = sets.length ? `${shown.length}개 세트` : '';
    const box = $('bk-list');
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'hint bk-empty';
      p.textContent = sets.length ? '고른 조건에 맞는 세트가 없어요.' : '아직 올라온 문제 세트가 없어요. 곧 채워질 거예요!';
      box.replaceChildren(p);
      return;
    }
    box.replaceChildren(
      ...shown.map((s) => {
        const row = document.createElement('div');
        row.className = 'bk-row';
        const info = document.createElement('div');
        info.className = 'bk-info';
        const tags = document.createElement('p');
        tags.className = 'bk-tags';
        for (const t of [s.grade, s.subject, s.unit]) {
          if (!t) continue;
          const chip = document.createElement('span');
          chip.textContent = t;
          tags.append(chip);
        }
        const name = document.createElement('b');
        name.textContent = s.title;
        info.append(tags, name);
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'btn accent small';
        pick.textContent = '담기';
        pick.addEventListener('click', () => choose(s, pick));
        const down = document.createElement('a');
        down.className = 'btn small';
        down.textContent = '엑셀 받기';
        down.href = fileUrl(s.file);
        down.download = s.file;
        row.append(info, pick, down);
        return row;
      })
    );
  }

  async function choose(s, btn) {
    btn.disabled = true;
    try {
      const res = await fetch(fileUrl(s.file));
      if (!res.ok) throw new Error('이 세트 파일을 찾지 못했어요.');
      const { items } = await readQuestionFile(new File([await res.blob()], s.file));
      dlg.close();
      opts.onPick(items, s.title, `"${s.title}"에서`);
    } catch (err) {
      opts.toast(err.message || '세트를 불러오지 못했어요.');
    } finally {
      btn.disabled = false;
    }
  }

  async function open() {
    dlg.showModal();
    if (sets) return;
    $('bk-list').textContent = '불러오는 중…';
    try {
      const res = await fetch(INDEX_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      sets = cleanBankIndex(await res.json());
    } catch {
      $('bk-list').textContent = '문제 은행을 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.';
      return;
    }
    fillSelect($('bk-grade'), '학년', uniq('grade'));
    fillSelect($('bk-subject'), '과목', uniq('subject'));
    render();
  }

  $('bk-grade').addEventListener('change', render);
  $('bk-subject').addEventListener('change', render);
  $('bk-close').addEventListener('click', () => dlg.close());
  return { open };
}
