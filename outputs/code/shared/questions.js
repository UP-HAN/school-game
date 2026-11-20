// 미션 문제: 엑셀 줄 → 문제, 형식 검사, 채점. 서버와 화면이 같이 쓴다. (기준: outputs/02-spec-questions.md)

export const HEADER = ['문제', '정답', '오답1', '오답2', '오답3'];
export const SHEET_NAME = '문제';
export const Q_LIMITS = {
  maxQuestions: 200,
  questionHard: 200, // 이보다 길면 받지 않는다
  answerHard: 60,
  questionWarn: 80, // 이보다 길면 경고만
  choiceWarn: 30,
  shortWarn: 15,
  titleMax: 60,
  altsMax: 5,
};

const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

// 채점할 때 비교용으로 다듬기: 띄어쓰기·대소문자·전각/반각 차이를 없앤다
export function normalizeAnswer(v) {
  return clean(v).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
export function sameAnswer(a, b) {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const nx = Number(x.replace(/,/g, ''));
  const ny = Number(y.replace(/,/g, ''));
  return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
}

// 문제 하나 검사. errors 가 있으면 쓸 수 없는 문제, warnings 는 알려만 준다.
export function checkQuestion(item) {
  const errors = [];
  const warnings = [];
  const q = clean(item.q);
  const a = clean(item.a);
  const wrong = (item.wrong || []).map(clean).filter(Boolean);
  if (!q) errors.push('문제가 비어 있어요');
  if (!a) errors.push('정답이 비어 있어요');
  if ([...q].length > Q_LIMITS.questionHard) errors.push(`문제가 너무 길어요 (${Q_LIMITS.questionHard}자까지)`);
  if ([a, ...wrong].some((s) => [...s].length > Q_LIMITS.answerHard)) errors.push(`답이 너무 길어요 (${Q_LIMITS.answerHard}자까지)`);
  if (wrong.some((w) => sameAnswer(w, a))) errors.push('오답이 정답과 같아요');
  if (new Set(wrong.map(normalizeAnswer)).size !== wrong.length) errors.push('같은 오답이 두 번 있어요');
  const kind = wrong.length ? 'choice' : 'short';
  if ([...q].length > Q_LIMITS.questionWarn) warnings.push('문제가 길어서 읽는 데 시간이 걸려요');
  if (kind === 'choice' && [a, ...wrong].some((s) => [...s].length > Q_LIMITS.choiceWarn)) warnings.push('보기가 길어요');
  if (kind === 'short' && [...a].length > Q_LIMITS.shortWarn) warnings.push('정답이 길어서 학생이 입력하기 어려울 수 있어요');
  return { q, a, wrong, kind, errors, warnings };
}

// 엑셀에서 읽은 줄들(글자 배열의 배열)을 문제 목록으로 바꾼다
export function parseSheetRows(rows) {
  const first = (rows[0] || []).map(clean);
  const headerOk = HEADER.every((h, i) => first[i] === h);
  if (!headerOk) return { headerOk: false, items: [] };
  const items = [];
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const cells = [0, 1, 2, 3, 4].map((k) => clean(r && r[k]));
    if (cells.every((c) => !c)) return; // 빈 줄
    const item = { row: i + 2, q: cells[0], a: cells[1], wrong: cells.slice(2).filter(Boolean), alts: [] };
    const key = normalizeAnswer(item.q);
    item.duplicate = !!key && seen.has(key);
    seen.add(key);
    items.push(item);
  });
  return { headerOk: true, items };
}

// 서버가 받은 문제 세트를 믿을 수 있는 모양으로 다시 만든다 (이상하면 null)
export function sanitizeSet(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) return null;
  const questions = [];
  for (const it of raw.questions.slice(0, Q_LIMITS.maxQuestions)) {
    if (!it || typeof it !== 'object') continue;
    const c = checkQuestion({ q: it.q, a: it.a, wrong: Array.isArray(it.wrong) ? it.wrong.slice(0, 3) : [] });
    if (c.errors.length) continue;
    const alts = (Array.isArray(it.alts) ? it.alts : [])
      .map(clean)
      .filter((s) => s && [...s].length <= Q_LIMITS.answerHard)
      .slice(0, Q_LIMITS.altsMax);
    questions.push({ q: c.q, a: c.a, wrong: c.wrong, alts: c.kind === 'short' ? alts : [], kind: c.kind });
  }
  if (!questions.length) return null;
  const title = [...clean(raw.title)].slice(0, Q_LIMITS.titleMax).join('') || '이름 없는 문제 세트';
  return { title, questions };
}

// 채점. 주관식은 글자로, 4지선다는 고른 보기 글자로 비교한다.
export function isCorrect(question, value) {
  if (question.kind === 'short') return [question.a, ...(question.alts || [])].some((x) => sameAnswer(x, value));
  return clean(value) === question.a;
}

// AI에게 줄 요청문
export function buildPrompt({ count = 30, grade = '초등학생' } = {}) {
  return `첨부한 자료의 내용으로 ${grade}용 퀴즈 문제 ${count}개를 만들어 엑셀(xlsx) 파일로 주세요.

[엑셀 형식]
- 시트 이름: ${SHEET_NAME}
- 첫 줄(제목): ${HEADER.join(' | ')}
- 둘째 줄부터 한 줄에 문제 하나

[문제 규칙]
- 문제는 한 문장, 50자 이내. 그림이나 표를 봐야 풀 수 있는 문제는 만들지 않습니다.
- 4지선다 문제: 정답 1개와 오답 3개를 모두 채웁니다. 보기는 20자 이내.
- 주관식 문제: 정답만 쓰고 오답 칸은 비워 둡니다. 정답은 낱말 하나(10자 이내)로, 답이 여러 가지로 쓰일 수 있는 문제는 피합니다.
- 4지선다 약 70%, 주관식 약 30%로 섞습니다.
- 쉬운 문제와 어려운 문제를 고르게 섞고, 같은 내용을 묻는 문제를 반복하지 않습니다.
- 자료에 없는 내용은 문제로 내지 않습니다.

파일 이름은 "과목_단원_주제.xlsx"로 해 주세요.`;
}
