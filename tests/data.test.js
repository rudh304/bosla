// يتحقق من أن كل نص معرفي في data/*.json موجود حرفيًا في ملفات Word الرسمية (لا معلومة مختلقة)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { docxPlainText } from '../scripts/docx.mjs';

const src = f => new URL(`../source/${f}`, import.meta.url);
const load = f => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const flat = s => s.replace(/\s+/g, ' ');

function strings(obj, skip = []) {
  const out = [];
  (function walk(v, key) {
    if (skip.includes(key)) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(x => walk(x));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
  })(obj);
  return out;
}

const cases = [
  ['paths.json', 'bosla_paths_guide.docx'],
  ['questionnaire.json', 'bosla_questionnaire.docx'],
  ['faq_limits.json', 'bosla_faq_limits.docx']
];

for (const [json, docx] of cases) {
  test(`كل نصوص ${json} موجودة في ${docx}`, () => {
    const source = flat(docxPlainText(src(docx)));
    const missing = strings(load(json), ['source']).filter(s => !source.includes(flat(s)));
    assert.deepEqual(missing, []);
  });
}

test('لا روابط في أي ملف بيانات (الدليل لا يحوي روابط)', () => {
  for (const f of ['paths.json', 'questionnaire.json', 'faq_limits.json', 'matrix.json', 'keywords.json']) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'), /https?:\/\/|www\./, f);
  }
});

test('الدليل: 8 مسارات، ولكل مسار 3 أسئلة مقابلة وخطة بمستويين', () => {
  const { paths } = load('paths.json');
  assert.equal(paths.length, 8);
  for (const p of paths) {
    assert.equal(p.interview.length, 3);
    assert.equal(p.plan.beginner.length, 3);
    assert.equal(p.plan.advanced.length, 3);
    assert.ok(p.certifications.length >= 1 && p.freeResources.length >= 2);
  }
});

test('أسماء المسارات في المصفوفة تطابق الدليل', () => {
  const guide = load('paths.json').paths;
  load('matrix.json').paths.forEach((m, i) => {
    assert.equal(m.ar, guide[i].ar);
    assert.equal(m.en, guide[i].en);
  });
});

test('مفاتيح المطابقة تغطي كل مهارة وكل سؤال مقابلة في الدليل', () => {
  const guide = load('paths.json').paths;
  const kw = load('keywords.json');
  for (const p of guide) {
    assert.equal(kw.paths[p.id].skillKeys.length, p.skills.length, p.ar);
    assert.equal(kw.paths[p.id].interviewKeys.length, 3, p.ar);
  }
});
