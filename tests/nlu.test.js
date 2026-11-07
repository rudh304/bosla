import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize, createNLU } from '../nlu.js';

const load = f => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const nlu = createNLU(load('keywords.json'), load('matrix.json'));
const vals = r => Object.fromEntries(Object.entries(r.scores).map(([k, v]) => [k, v.value]));

test('التطبيع: التشكيل والهمزات والتاء المربوطة والألف المقصورة والأرقام العربية', () => {
  assert.equal(normalize('البَرْمَجَةُ'), 'البرمجه');
  assert.equal(normalize('أحمد إبراهيم آمنة'), 'احمد ابراهيم امنه');
  assert.equal(normalize('مستوى'), 'مستوي');
  assert.equal(normalize('٣ و ٤'), '3 و 4');
  assert.equal(normalize('ممتاااااز'), 'ممتاز');
  assert.equal(normalize('مسـؤول'), 'مسوول');
});

test('قاموس العامية: كل درجة', () => {
  const cases = {
    'ما أعرف': 1, 'صفر': 1, 'أبدًا': 1, 'ضعيف جدًا': 1, 'ما احبها': 1,
    'شوي': 2, 'ضعيف': 2, 'قليل': 2, 'بسيط': 2, 'مو زين': 2,
    'عادي': 3, 'متوسط': 3, 'نص نص': 3,
    'كويس': 4, 'جيد': 4, 'زين': 4, 'أحبه': 4,
    'مرة': 5, 'ممتاز': 5, 'قوي': 5, 'أحبه مرة': 5, 'مرررة': 5
  };
  for (const [phrase, score] of Object.entries(cases)) {
    assert.equal(nlu.valueOf(phrase)?.value, score, phrase);
  }
});

test('استخراج الأرقام من النص: "برمجة 2 وتحليل 4"', () => {
  assert.deepEqual(vals(nlu.extractScores('برمجة 2 وتحليل 4', [1, 2])), { 1: 2, 2: 4 });
});

test('استخراج أرقام مجردة بالترتيب: "2 4"', () => {
  assert.deepEqual(vals(nlu.extractScores('2 4', [1, 2])), { 1: 2, 2: 4 });
  assert.deepEqual(vals(nlu.extractScores('٥ ، ٣', [3, 4])), { 3: 5, 4: 3 });
  assert.deepEqual(vals(nlu.extractScores('4 3 2', [5, 6, 7])), { 5: 4, 6: 3, 7: 2 });
});

test('سبعة أرقام دفعة واحدة تملأ المعايير السبعة', () => {
  assert.deepEqual(vals(nlu.extractScores('1 2 5 5 4 2 1', [1, 2])), { 1: 1, 2: 2, 3: 5, 4: 5, 5: 4, 6: 2, 7: 1 });
});

test('إجابة ناقصة: رقم واحد لسؤال من معيارين', () => {
  assert.deepEqual(vals(nlu.extractScores('3', [1, 2])), { 1: 3 });
});

test('سيناريو العامية: "أحب الأرقام مرة، البرمجة شوي، التواصل عادي"', () => {
  const r = nlu.extractScores('أحب الأرقام مرة، البرمجة شوي، التواصل عادي');
  assert.deepEqual(vals(r), { 1: 2, 2: 5, 3: 3 });
  assert.equal(r.scores[2].source, 'word');
});

test('بلا فواصل: "احب الارقام مره والبرمجه شوي والتواصل عادي"', () => {
  assert.deepEqual(vals(nlu.extractScores('احب الارقام مره والبرمجه شوي والتواصل عادي')), { 1: 2, 2: 5, 3: 3 });
});

test('"أنا قوي في التحليل وضعيف في البرمجة"', () => {
  assert.deepEqual(vals(nlu.extractScores('أنا قوي في التحليل وضعيف في البرمجة')), { 1: 2, 2: 5 });
});

test('"البرمجة والتحليل 4" يعطي المعيارين القيمة نفسها', () => {
  assert.deepEqual(vals(nlu.extractScores('البرمجة والتحليل 4')), { 1: 4, 2: 4 });
});

test('أرقام خارج المقياس تُحوَّل لأقرب حد مع علامة للتأكيد', () => {
  const r = nlu.extractScores('البرمجة 7 والتحليل 0');
  assert.equal(r.scores[1].value, 5); assert.equal(r.scores[1].clamped, true); assert.equal(r.scores[1].raw, 7);
  assert.equal(r.scores[2].value, 1); assert.equal(r.scores[2].clamped, true);
});

test('صيغة "4 من 5" و"4/5"', () => {
  assert.deepEqual(vals(nlu.extractScores('التواصل 4 من 5 والقيادة 3/5')), { 3: 4, 4: 3 });
});

test('معايير متعددة الكلمات والإنجليزية', () => {
  assert.deepEqual(vals(nlu.extractScores('فهم الأعمال جيد، الدقة والالتزام ممتاز، الإبداع متوسط')), { 5: 4, 6: 5, 7: 3 });
  assert.deepEqual(vals(nlu.extractScores('programming 3, analysis 5')), { 1: 3, 2: 5 });
});

test('المستوى الدراسي من النص الحر', () => {
  assert.equal(nlu.extractLevel('أنا سنة رابعة وأحب الأرقام').level, '4');
  assert.equal(nlu.extractLevel('انا خريجة').level, '4');
  assert.equal(nlu.extractLevel('السنة الثالثة').level, '3');
  assert.equal(nlu.extractLevel('سنة اولى').level, '12');
  assert.equal(nlu.extractLevel('المستوى السابع').level, '4');
  assert.equal(nlu.extractLevel('رابعة', { bare: true }).level, '4');
  assert.equal(nlu.extractLevel('احب الارقام'), null);
});

test('المستوى لا يُفهم كدرجة: "أنا سنة 4 وأحب الأرقام"', () => {
  assert.deepEqual(vals(nlu.extractScores('أنا سنة 4 وأحب الأرقام')), { 2: 4 });
});

test('أسماء المسارات لا تُفهم كمعايير', () => {
  assert.deepEqual(vals(nlu.extractScores('أبغى أخصائي ذكاء الأعمال مرة')), {});
});

test('كشف المسارات بترتيب ذكرها', () => {
  assert.deepEqual(nlu.findPaths('قارن بين محلل أعمال ومدير مشاريع'), [3, 5]);
  assert.deepEqual(nlu.findPaths('ما الفرق بين محلل البيانات وأخصائي ذكاء الأعمال؟'), [1, 2]);
  assert.deepEqual(nlu.findPaths('ERP و التحول الرقمي'), [6, 7]);
});

test('كشف النوايا', () => {
  const cases = {
    'كم راتب محلل البيانات في السعودية؟': 'salary',
    'ما رأيك في شهادة CompTIA Security+ ورسومها؟': 'unknownCert',
    'اكتب لي سيرتي الذاتية': 'cv',
    'أريد أن أصبح مطور ألعاب': 'unknownPath',
    'قارن بين محلل أعمال ومدير مشاريع': 'compare',
    'أريد التدرب على مقابلة': 'interview',
    'أبغى شي يناسبني': 'discover',
    'أبغى محلل بيانات غصب': 'desire',
    'عدّل التحليل إلى 3': 'edit',
    'وش ينقصني؟': 'gap',
    'اعطني خطة الستة أشهر': 'plan',
    'وش الشهادات المناسبة؟': 'certs',
    'ما المسارات المتاحة؟': 'list',
    'هل توصيتك نهائية؟': 'faqFinal',
    'كيف تحسب النسبة؟': 'faqCalc',
    'هل الشهادات مجانية؟': 'faqFree',
    'كم رسوم CAPM؟': 'guideCert',
    'وش الطقس اليوم': 'general',
    'أبغى أدرس طب': 'otherMajor',
    'ابحث لي عن وظائف شاغرة': 'jobs',
    'محادثة جديدة': 'restart',
    'السلام عليكم': 'greet',
    'qwerty asdf': 'unknown'
  };
  for (const [text, intent] of Object.entries(cases)) assert.equal(nlu.detectIntent(text).intent, intent, text);
  assert.equal(nlu.detectIntent('أبغى محلل بيانات غصب').forced, true);
  assert.deepEqual(nlu.detectIntent('عدّل التحليل إلى 3').scores[2].value, 3);
});

test('المهارات الحالية (السؤال 5)', () => {
  assert.deepEqual(nlu.extractSkills('أعرف إكسل و SQL وشوي بايثون').known, ['Excel', 'SQL', 'Python']);
  assert.equal(nlu.extractSkills('لا شيء بعد').none, true);
});

test('تحليل الفجوة بالمرادفات', () => {
  const guide = load('paths.json').paths[0];
  const g = nlu.gapAnalysis(1, 'اكسل وباور بي آي', guide);
  assert.deepEqual(g.map(x => x.has), [true, false, true, false, false]);
  assert.equal(g[4].optional, true);
});

test('تقييم إجابة المقابلة', () => {
  const e = nlu.evaluateAnswer('أبدأ بتنظيف البيانات ومعالجة القيم الناقصة، مثلًا في مشروع الجامعة استخدمت Excel', 1, 0);
  assert.ok(e.hits.length >= 2);
  assert.equal(e.hasExample, true);
  const short = nlu.evaluateAnswer('ما أدري', 1, 0);
  assert.equal(short.hits.length, 0);
  assert.equal(short.hasExample, false);
});
