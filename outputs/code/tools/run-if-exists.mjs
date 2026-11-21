// 시험 파일이 있으면 차례로 실행하고, 없으면 건너뛴다 (npm test 가 아직 없는 맵 시험 때문에 실패하지 않게).
//   node tools/run-if-exists.mjs server/test-map-library.js server/test-map-school.js
// 하나라도 실패하면 그 종료 코드로 끝난다.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const file of process.argv.slice(2)) {
  if (!fs.existsSync(file)) {
    console.log(`(${file} 없음 — 건너뜀)`);
    continue;
  }
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}
