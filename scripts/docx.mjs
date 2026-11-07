// قارئ مبسّط لملفات Word (.docx) بلا مكتبات خارجية:
// يفك ضغط الملف (ZIP) ويحوّل word/document.xml إلى كتل: عناوين، وفقرات، وعناصر قوائم، وجداول.
import fs from 'node:fs';
import zlib from 'node:zlib';

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ليس ملف ZIP صالحًا');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function paragraphText(p) {
  let out = '';
  for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
    out += m[1] !== undefined ? decode(m[1]) : (m[0] === '<w:tab/>' ? '\t' : '\n');
  }
  return out.trim();
}

function paragraphBlock(p) {
  const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
  const text = paragraphText(p);
  const h = style.match(/^Heading(\d)$/i);
  if (/^Title$/i.test(style)) return { type: 'title', text };
  if (h) return { type: 'heading', level: Number(h[1]), text };
  if (/<w:numPr>/.test(p)) return { type: 'item', text };
  return { type: 'para', text };
}

/** يعيد قائمة كتل مرتبة كما تظهر في المستند */
export function readDocx(path) {
  const files = unzip(fs.readFileSync(path));
  const xml = files['word/document.xml'].toString('utf8');
  const body = xml.split('<w:body>')[1];
  const blocks = [];
  for (const tk of body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g) || []) {
    if (tk.startsWith('<w:tbl>')) {
      const rows = tk.match(/<w:tr\b[\s\S]*?<\/w:tr>/g).map(row =>
        row.match(/<w:tc>[\s\S]*?<\/w:tc>/g).map(c =>
          (c.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []).map(paragraphText).filter(Boolean).join(' ')));
      blocks.push({ type: 'table', rows });
    } else {
      const b = paragraphBlock(tk);
      if (b.text) blocks.push(b);
    }
  }
  return blocks;
}

/** نص المستند كاملًا (للتحقق من عدم اختلاق أي معلومة) */
export function docxPlainText(path) {
  return readDocx(path).map(b => b.type === 'table' ? b.rows.map(r => r.join(' | ')).join('\n') : b.text).join('\n');
}
