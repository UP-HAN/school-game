// 예시 문제(client/examples.js)를 문제 은행 엑셀(client/bank/예시_연습문제.xlsx)로 다시 만든다.
// 쓰는 법: outputs/code 폴더에서  node tools/make-example-xlsx.mjs
import fs from 'node:fs';
import { EXAMPLE_ROWS } from '../client/examples.js';
import { writeXlsx } from '../shared/xlsx.js';
import { HEADER, SHEET_NAME, checkQuestion } from '../shared/questions.js';

const bad = EXAMPLE_ROWS.filter(([q, a, ...wrong]) => {
  const c = checkQuestion({ q, a, wrong });
  return c.errors.length || c.warnings.length;
});
if (bad.length) {
  console.error('손볼 문제가 있어요:', bad.map((r) => r[0]));
  process.exit(1);
}
const out = new URL('../client/bank/예시_연습문제.xlsx', import.meta.url);
fs.writeFileSync(out, Buffer.from(await writeXlsx([HEADER, ...EXAMPLE_ROWS], SHEET_NAME, [46, 16, 16, 16, 16])));
console.log(`예시 문제 ${EXAMPLE_ROWS.length}개를 엑셀로 만들었어요.`);
