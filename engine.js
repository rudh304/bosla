// محرك بوصلة: الحساب والتصنيف وقواعد القرار. دوال نقية حتمية بلا أي اعتماد على الواجهة.

export const CLOSE_GAP = 5;      // قاعدة التقارب: فرق 5% أو أقل بين الأول والثاني
export const WEAK_LIMIT = 50;    // كل النسب أقل من 50% ← بناء الأساسيات أولًا

/** التحقق من سلامة المصفوفة: 8 مسارات، 7 أوزان لكل مسار، مجموع كل صف = 10 */
export function validateMatrix(matrix) {
  if (matrix.criteria.length !== 7) throw new Error('عدد المعايير يجب أن يكون 7');
  if (matrix.paths.length !== 8) throw new Error('عدد المسارات يجب أن يكون 8');
  for (const p of matrix.paths) {
    if (p.weights.length !== 7) throw new Error(`أوزان ${p.ar} ليست 7`);
    const sum = p.weights.reduce((a, b) => a + b, 0);
    if (sum !== 10) throw new Error(`مجموع أوزان ${p.ar} = ${sum} وليس 10`);
  }
  return true;
}

/** التحقق من الدرجات: 7 أعداد صحيحة من 1 إلى 5 */
export function validateScores(scores) {
  if (!Array.isArray(scores) || scores.length !== 7) throw new Error('يجب إدخال 7 درجات');
  for (const s of scores) {
    if (!Number.isInteger(s) || s < 1 || s > 5) throw new Error(`درجة غير صالحة: ${s}`);
  }
  return true;
}

/** نسبة التوافق % = (Σ وزن المعيار × درجة الطالب) × 2 */
export function matchPercent(weights, scores) {
  return weights.reduce((sum, w, i) => sum + w * scores[i], 0) * 2;
}

/** التصنيف حسب النسبة */
export function classify(pct) {
  if (pct >= 80) return { key: 'excellent', ar: 'ممتاز' };
  if (pct >= 65) return { key: 'good', ar: 'جيد' };
  if (pct >= 50) return { key: 'average', ar: 'متوسط' };
  return { key: 'weak', ar: 'ضعيف' };
}

/** يحسب المسارات الثمانية ويرتبها تنازليًا؛ عند التساوي يُعتمد ترتيب المصفوفة */
export function rankPaths(scores, matrix) {
  validateScores(scores);
  return matrix.paths
    .map((p, order) => {
      const pct = matchPercent(p.weights, scores);
      return { id: p.id, ar: p.ar, en: p.en, pct, order, level: classify(pct) };
    })
    .sort((a, b) => b.pct - a.pct || a.order - b.order);
}

/** المعايير الأكثر تأثيرًا في نسبة مسار: أعلى (وزن × درجة)، ثم الوزن الأعلى، ثم ترتيب المعايير */
export function topContributors(pathId, scores, matrix, n = 2) {
  const p = matrix.paths.find(x => x.id === pathId);
  return matrix.criteria
    .map((c, i) => ({ id: c.id, ar: c.ar, short: c.short, weight: p.weights[i], score: scores[i], value: p.weights[i] * scores[i] }))
    .filter(x => x.weight > 0)
    .sort((a, b) => b.value - a.value || b.weight - a.weight || a.id - b.id)
    .slice(0, n);
}

/** أعلى المعايير وزنًا في مسار (للمقارنة وكشف التناقض) */
export function topWeighted(pathId, matrix, n = 2) {
  const p = matrix.paths.find(x => x.id === pathId);
  return matrix.criteria
    .map((c, i) => ({ id: c.id, ar: c.ar, short: c.short, weight: p.weights[i] }))
    .sort((a, b) => b.weight - a.weight || a.id - b.id)
    .slice(0, n);
}

/**
 * قواعد القرار:
 * - weak: كل النسب أقل من 50% ← نصيحة بناء الأساسيات واقتراح الأقرب (لها الأولوية).
 * - close: الفرق بين الأول والثاني ≤ 5% ← سؤال حاسم ثم انتظار الإجابة.
 * - clear: الأول رئيسي والثاني بديل.
 */
export function decide(ranked) {
  const [first, second] = ranked;
  const gap = first.pct - second.pct;
  const base = { first, second, gap, primary: first, alternative: second };
  if (ranked.every(r => r.pct < WEAK_LIMIT)) return { ...base, type: 'weak' };
  if (gap <= CLOSE_GAP) return { ...base, type: 'close', primary: null, alternative: null };
  return { ...base, type: 'clear' };
}

/** بعد السؤال الحاسم: المسار المختار رئيسي والآخر بديل */
export function resolveClose(decision, chosenId) {
  const { first, second } = decision;
  if (chosenId !== first.id && chosenId !== second.id) throw new Error('المسار المختار ليس أحد المسارين المتقاربين');
  return chosenId === first.id
    ? { ...decision, type: 'resolved', primary: first, alternative: second }
    : { ...decision, type: 'resolved', primary: second, alternative: first };
}

/** تفصيل الحساب لمسار (لعرضه عند الطلب) */
export function explainCalc(pathId, scores, matrix) {
  const p = matrix.paths.find(x => x.id === pathId);
  const terms = p.weights.map((w, i) => ({ criterion: matrix.criteria[i].short, weight: w, score: scores[i], product: w * scores[i] }));
  const sum = terms.reduce((a, t) => a + t.product, 0);
  return { terms, sum, pct: sum * 2 };
}

/** درجة الطالب في أعلى معايير المسار وزنًا إذا كانت منخفضة (≤ 2): تُستخدم للتنبيه إلى الفجوة */
export function weakPointsFor(pathId, scores, matrix) {
  return topWeighted(pathId, matrix, 3)
    .filter(c => c.weight >= 2)
    .map(c => ({ ...c, score: scores[c.id - 1] }))
    .filter(c => c.score <= 2);
}
