// 문제 은행 시험. 실행: node server/test-bank.js
//  1) 목록(client/bank/index.json)에 적힌 엑셀 파일이 모두 있고, 양식이 맞고, 고쳐야 할 문제가 없는지
//  2) 서버가 목록과 엑셀 파일(한글 이름)을 내려 주는지 — 주소 앞부분(BASE_PATH)이 있을 때도
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeChecker, startServer, runAll } from './testkit.js';
import { readXlsx } from '../shared/xlsx.js';
import { SHEET_NAME, parseSheetRows, checkQuestion, cleanBankIndex as cleanIndex } from '../shared/questions.js';

const T = makeChecker('문제 은행');
const { check } = T;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'bank');
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const sets = cleanIndex(raw);

async function readSet(buffer) {
  const { rows } = await readXlsx(buffer, SHEET_NAME);
  return parseSheetRows(rows);
}

async function files() {
  check('목록의 모든 줄이 쓸 수 있는 모양이다 (file 이 .xlsx, 폴더 기호 없음)', Array.isArray(raw.sets) && sets.length === raw.sets.length, `${sets.length}/${(raw.sets || []).length}`);
  check('같은 파일이 두 번 적혀 있지 않다', new Set(sets.map((s) => s.file)).size === sets.length);
  for (const s of sets) {
    const file = path.join(dir, s.file);
    if (!fs.existsSync(file)) {
      check(`${s.file}: 파일이 있다`, false, '폴더에 파일이 없어요');
      continue;
    }
    const data = fs.readFileSync(file);
    let parsed = null;
    try {
      parsed = await readSet(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } catch (err) {
      check(`${s.file}: 엑셀로 읽힌다`, false, err.message);
      continue;
    }
    check(`${s.file}: 첫 줄(제목)이 양식과 같다`, parsed.headerOk);
    check(`${s.file}: 문제가 1개 이상 있다`, parsed.items.length > 0, `${parsed.items.length}개`);
    const bad = parsed.items.filter((it) => checkQuestion(it).errors.length || it.duplicate);
    check(`${s.file}: 고쳐야 할 문제가 없다 (${parsed.items.length}문제)`, bad.length === 0, bad.map((it) => `${it.row}줄 ${it.duplicate ? '같은 문제가 또 있음' : checkQuestion(it).errors.join(',')}`).join(' / '));
  }
}

async function served(port, base) {
  const srv = await startServer(port, {}, base ? { BASE_PATH: base } : {});
  const url = (p) => `http://127.0.0.1:${port}${base}${p}`;
  const tag = base ? `[${base}] ` : '';
  try {
    const idx = await fetch(url('/bank/index.json'));
    check(`${tag}목록을 내려 준다`, idx.status === 200 && cleanIndex(await idx.json()).length === sets.length);
    if (sets[0]) {
      const res = await fetch(url('/bank/' + encodeURIComponent(sets[0].file)));
      const parsed = res.ok ? await readSet(await res.arrayBuffer()) : null;
      check(`${tag}엑셀 파일(한글 이름)을 내려 주고, 받은 파일이 그대로 읽힌다`, res.status === 200 && !!parsed && parsed.headerOk && parsed.items.length > 0, String(res.status));
    }
    const page = await (await fetch(url('/teacher/'))).text();
    check(`${tag}선생님 화면에 문제 은행 버튼과 창이 있다`, page.includes('id="ts-bank"') && page.includes('id="dlg-bank"'));
    const md = await fetch(url('/bank/' + encodeURIComponent('읽어보세요.md')));
    check(`${tag}안내 글(md)은 내려 주지 않는다`, md.status === 404);
  } finally {
    await srv.stop();
  }
}

runAll(T, [files, () => served(3295, ''), () => served(3296, '/lantern')], 60000);
