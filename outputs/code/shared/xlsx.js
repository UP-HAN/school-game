// 엑셀(xlsx) 파일을 라이브러리 없이 읽고 쓴다. 우리 양식(글자만 있는 표 한 장)에 필요한 만큼만 다룬다.
// xlsx 는 "여러 XML 파일을 zip 으로 묶은 것"이다.

const dec = new TextDecoder();
const enc = new TextEncoder();

// ───────────── zip 풀기 ─────────────
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('엑셀(xlsx) 파일이 아니에요.');
  const count = dv.getUint16(end + 10, true);
  let p = dv.getUint32(end + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    files.set(name, { method, data: u8.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => files.has(name),
    async text(name) {
      const f = files.get(name);
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      if (f.method === 8) return dec.decode(await inflate(f.data));
      throw new Error('읽을 수 없는 압축 방식이에요.');
    },
  };
}

// ───────────── XML 에서 필요한 것만 꺼내기 ─────────────
const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};
// <t>글자</t> 들을 이어 붙인다. 발음 표기(<rPh>) 안의 글자는 뺀다.
function textOf(xml) {
  const body = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) out += unescapeXml(m[1] || '');
  return out;
}
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * xlsx 파일 내용을 읽어 줄 목록(글자 배열의 배열)을 돌려준다.
 * sheetName 과 같은 이름의 시트가 있으면 그 시트, 없으면 첫 시트를 읽는다.
 */
export async function readXlsx(buffer, sheetName) {
  const zip = await unzip(buffer);
  const workbook = await zip.text('xl/workbook.xml');
  if (!workbook) throw new Error('엑셀(xlsx) 파일이 아니에요.');
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const targets = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) targets.set(attr(m[0], 'Id'), attr(m[0], 'Target'));
  const sheets = [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => ({
    name: attr(m[0], 'name'),
    target: targets.get(attr(m[0], 'r:id')),
  }));
  const pick = sheets.find((s) => s.name === sheetName) || sheets[0];
  let path = pick && pick.target ? pick.target.replace(/^\//, '') : 'worksheets/sheet1.xml';
  if (!path.startsWith('xl/')) path = 'xl/' + path;
  const sheet = await zip.text(path);
  if (!sheet) throw new Error('엑셀 파일에서 표를 찾지 못했어요.');

  const shared = [];
  const sst = await zip.text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) shared.push(textOf(m[1] || ''));

  const rows = [];
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rowNo = Number(attr(' ' + rm[1], 'r')) || rows.length + 1;
    const cells = [];
    let next = 0;
    for (const cm of (rm[2] || '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const tag = ' ' + cm[1];
      const ref = attr(tag, 'r');
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = attr(tag, 't');
      const inner = cm[2] || '';
      const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
      let value = '';
      if (type === 'inlineStr') value = textOf(inner);
      else if (type === 's') value = shared[Number(v && v[1])] ?? '';
      else if (v) value = unescapeXml(v[1]);
      if (col >= 0 && col < 50) cells[col] = value;
    }
    rows[rowNo - 1] = Array.from(cells, (c) => c ?? '');
  }
  return { sheetName: pick ? pick.name : '', rows: Array.from(rows, (r) => r ?? []) };
}

// ───────────── xlsx 만들기 (빈 양식 내려받기용) ─────────────
let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // 파일 이름이 UTF-8
    head.setUint16(8, 0, true); // 압축 안 함
    head.setUint16(12, 0x21, true); // 날짜 1980-01-01
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(head.buffer), nameBytes, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const endRec = new DataView(new ArrayBuffer(22));
  endRec.setUint32(0, 0x06054b50, true);
  endRec.setUint16(8, entries.length, true);
  endRec.setUint16(10, entries.length, true);
  endRec.setUint32(12, centralSize, true);
  endRec.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(endRec.buffer)];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of all) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const colName = (i) => String.fromCharCode(65 + i);

/** 줄 목록을 xlsx 파일 내용(Uint8Array)으로 만든다. 첫 줄은 굵은 제목 줄이 된다. */
export function writeXlsx(rows, sheetName, widths = []) {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const sheetRows = rows
    .map((r, y) => {
      const cells = r
        .map((v, x) =>
          v === '' || v == null
            ? ''
            : `<c r="${colName(x)}${y + 1}" t="inlineStr"${y === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`
        )
        .join('');
      return `<row r="${y + 1}">${cells}</row>`;
    })
    .join('');
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return zipStore([
    [
      '[Content_Types].xml',
      `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    ['_rels/.rels', `${X}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${X}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    [
      'xl/_rels/workbook.xml.rels',
      `${X}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `${X}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    ],
    ['xl/worksheets/sheet1.xml', `${X}<worksheet xmlns="${main}">${cols}<sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}
