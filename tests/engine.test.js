import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  validateMatrix, matchPercent, classify, rankPaths, decide, resolveClose,
  topContributors, explainCalc, weakPointsFor, validateScores
} from '../engine.js';

const matrix = JSON.parse(fs.readFileSync(new URL('../data/matrix.json', import.meta.url), 'utf8'));
// اختصارات أسماء المسارات حسب ترتيب المصفوفة
const ID = { DA: 1, BI: 2, BA: 3, GRC: 4, PM: 5, ERP: 6, DT: 7, PdM: 8 };
const pctOf = (ranked, id) => ranked.find(r => r.id === id).pct;

test('المصفوفة سليمة: 8 مسارات × 7 معايير، ومجموع كل صف = 10', () => {
  assert.equal(validateMatrix(matrix), true);
});

test('أقصى نسبة = 100% وأدناها = 20%', () => {
  for (const p of matrix.paths) {
    assert.equal(matchPercent(p.weights, [5, 5, 5, 5, 5, 5, 5]), 100);
    assert.equal(matchPercent(p.weights, [1, 1, 1, 1, 1, 1, 1]), 20);
  }
});

test('T1 حالة عادية [1,2,5,5,4,2,1]', () => {
  const r = rankPaths([1, 2, 5, 5, 4, 2, 1], matrix);
  const expected = { PM: 84, BA: 74, DT: 64, PdM: 60, GRC: 60, ERP: 52, DA: 48, BI: 34 };
  for (const [k, v] of Object.entries(expected)) assert.equal(pctOf(r, ID[k]), v, k);
  assert.deepEqual(r.map(x => x.pct), [84, 74, 64, 60, 60, 52, 48, 34]);
  const d = decide(r);
  assert.equal(d.type, 'clear');
  assert.equal(d.gap, 10);
  assert.equal(d.primary.id, ID.PM);
  assert.equal(d.alternative.id, ID.BA);
});

test('T2 تقارب [4,5,2,2,3,3,2]: الفرق 2% ← سؤال حاسم', () => {
  const r = rankPaths([4, 5, 2, 2, 3, 3, 2], matrix);
  const expected = { DA: 72, BI: 70, GRC: 64, ERP: 64, BA: 58, DT: 56, PdM: 52, PM: 52 };
  for (const [k, v] of Object.entries(expected)) assert.equal(pctOf(r, ID[k]), v, k);
  assert.deepEqual(r.map(x => x.pct), [72, 70, 64, 64, 58, 56, 52, 52]);
  const d = decide(r);
  assert.equal(d.type, 'close');
  assert.equal(d.gap, 2);
  assert.equal(d.primary, null, 'لا يُعتمد رئيسي قبل إجابة السؤال الحاسم');
  assert.deepEqual([d.first.id, d.second.id], [ID.DA, ID.BI]);
  const resolved = resolveClose(d, ID.BI);
  assert.equal(resolved.primary.id, ID.BI);
  assert.equal(resolved.alternative.id, ID.DA);
});

test('T3 تقارب [2,4,5,4,4,2,3]', () => {
  const r = rankPaths([2, 4, 5, 4, 4, 2, 3], matrix);
  const expected = { BA: 84, PM: 82, DT: 76, PdM: 74, DA: 68, GRC: 68, ERP: 64, BI: 56 };
  for (const [k, v] of Object.entries(expected)) assert.equal(pctOf(r, ID[k]), v, k);
  assert.deepEqual(r.map(x => x.id), [ID.BA, ID.PM, ID.DT, ID.PdM, ID.DA, ID.GRC, ID.ERP, ID.BI]);
  assert.equal(decide(r).type, 'close');
});

test('T4 كلها ضعيفة [2,…,2]: كل المسارات 40% ← بناء الأساسيات', () => {
  const r = rankPaths([2, 2, 2, 2, 2, 2, 2], matrix);
  assert.ok(r.every(x => x.pct === 40 && x.level.ar === 'ضعيف'));
  const d = decide(r);
  assert.equal(d.type, 'weak');
  assert.equal(d.primary.id, ID.DA, 'عند التساوي يُعتمد ترتيب المصفوفة');
});

test('T5 حد أدنى [1,…,1]: كل المسارات 20%', () => {
  const r = rankPaths([1, 1, 1, 1, 1, 1, 1], matrix);
  assert.ok(r.every(x => x.pct === 20));
  assert.equal(decide(r).type, 'weak');
});

test('حالة التقرير 1 [1,2,5,5,4,3,2]: مدير مشاريع 86 والبديل محلل أعمال 76، ومحلل بيانات 52', () => {
  const r = rankPaths([1, 2, 5, 5, 4, 3, 2], matrix);
  assert.equal(r[0].id, ID.PM); assert.equal(r[0].pct, 86);
  assert.equal(r[1].id, ID.BA); assert.equal(r[1].pct, 76);
  assert.equal(pctOf(r, ID.DA), 52);
  assert.equal(decide(r).type, 'clear');
});

test('الترتيب عند التساوي يتبع ترتيب المصفوفة', () => {
  const r = rankPaths([1, 2, 5, 5, 4, 2, 1], matrix);
  const ties = r.filter(x => x.pct === 60).map(x => x.id);
  assert.deepEqual(ties, [ID.GRC, ID.PdM]);
});

test('التصنيف عند الحدود 49/50/64/65/79/80', () => {
  assert.equal(classify(49).ar, 'ضعيف');
  assert.equal(classify(50).ar, 'متوسط');
  assert.equal(classify(64).ar, 'متوسط');
  assert.equal(classify(65).ar, 'جيد');
  assert.equal(classify(79).ar, 'جيد');
  assert.equal(classify(80).ar, 'ممتاز');
  assert.equal(classify(100).ar, 'ممتاز');
  assert.equal(classify(20).ar, 'ضعيف');
});

test('قاعدة التقارب عند الحد: فرق 5% تقارب، و6% لا', () => {
  const mk = (a, b) => [{ id: 1, pct: a }, { id: 2, pct: b }, { id: 3, pct: 10 }];
  assert.equal(decide(mk(80, 75)).type, 'close');
  assert.equal(decide(mk(80, 74)).type, 'clear');
  assert.equal(decide(mk(55, 50)).type, 'close');
  assert.equal(decide(mk(49, 48)).type, 'weak', 'الضعف له الأولوية على التقارب');
});

test('المعايير الأكثر تأثيرًا في T1 لمدير المشاريع: التواصل والقيادة (3×5)', () => {
  const top = topContributors(ID.PM, [1, 2, 5, 5, 4, 2, 1], matrix);
  assert.deepEqual(top.map(t => t.short), ['التواصل', 'القيادة']);
  assert.equal(top[0].value, 15);
});

test('تفصيل الحساب يطابق النسبة', () => {
  const e = explainCalc(ID.DA, [4, 5, 2, 2, 3, 3, 2], matrix);
  assert.equal(e.sum, 36);
  assert.equal(e.pct, 72);
});

test('كشف التناقض: برمجة 1 مع ذكاء الأعمال', () => {
  const w = weakPointsFor(ID.BI, [1, 3, 3, 3, 3, 3, 3], matrix);
  assert.equal(w[0].short, 'البرمجة');
  assert.equal(w[0].weight, 3);
});

test('رفض الدرجات غير الصالحة', () => {
  assert.throws(() => validateScores([1, 2, 3]));
  assert.throws(() => validateScores([0, 2, 3, 4, 5, 1, 2]));
  assert.throws(() => validateScores([6, 2, 3, 4, 5, 1, 2]));
  assert.throws(() => resolveClose(decide(rankPaths([4, 5, 2, 2, 3, 3, 2], matrix)), 5));
});
