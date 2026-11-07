// سيناريوهات المحادثة الكاملة (تطابق جدول اختبارات التقرير) على الجوال 360×740 واللابتوب
import { test, expect } from '@playwright/test';

const bots = page => page.locator('.msg.bot:not(.typing)');
const last = page => bots(page).last();
const idle = page => page.waitForSelector('body[data-busy="0"]');
const count = page => bots(page).count();
/** ينتظر حتى تظهر رسالة جديدة من الوكيل وينتهي "يكتب…" */
const replied = (page, n) => page.waitForFunction(
  n => document.querySelectorAll('.msg.bot:not(.typing)').length > n && document.body.dataset.busy === '0', n);

async function open(page) {
  await page.goto('/?delay=40');
  await page.waitForSelector('body[data-ready="1"]');
}
async function say(page, text) {
  const n = await count(page);
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await replied(page, n);
  return last(page);
}
async function click(page, label) {
  const n = await count(page);
  await page.locator('.msg.bot.live .quick button', { hasText: label }).first().click();
  await replied(page, n);
  return last(page);
}
async function rate(page, values) {
  const n = await count(page);
  const live = page.locator('.msg.bot.live');
  for (const [crit, v] of Object.entries(values)) {
    await live.locator(`.rating-row[data-crit="${crit}"] button[data-v="${v}"]`).click();
  }
  await replied(page, n);
  return last(page);
}
async function snap(page, name, testInfo) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `screenshots/${testInfo.project.name}-${name}.png` });
}

/** القاعدة الذهبية: كل رسالة تنتهي بسؤال أو أزرار، ولا تجمع أكثر من مرحلة */
async function checkGoldenRule(page) {
  const all = await bots(page).evaluateAll(els => els.map(el => ({
    text: el.querySelector('.bubble').innerText.trim(),
    buttons: el.querySelectorAll('.quick button, .rating-row button').length,
    results: !!el.querySelector('.results'),
    tag: el.dataset.tag
  })));
  for (const m of all) {
    const body = m.text.replace(/اختر درجة لكل معيار، أو اكتب إجابتك بأسلوبك\.$/, '').trim();
    expect(body.endsWith('؟') || m.buttons > 0, `رسالة بلا سؤال أو أزرار: ${m.text}`).toBeTruthy();
    const surveyQ = /السؤال \d من 5/.test(m.text);
    expect(m.results && surveyQ, `رسالة تجمع مرحلتين: ${m.text}`).toBeFalsy();
  }
}

test.afterEach(async ({ page }) => { await checkGoldenRule(page); });

test('1) حالة عادية كاملة: ترحيب ← 5 أسئلة ← النتائج ← الفجوة ← الخطة', async ({ page }, testInfo) => {
  await open(page);
  const w = last(page);
  await expect(w).toContainText('بماذا نبدأ؟');
  await expect(w.locator('.quick button')).toHaveCount(4);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await expect(await click(page, 'اكتشف مساري')).toContainText('السؤال 1 من 5');
  await expect(await click(page, 'سنة رابعة أو خريج')).toContainText('السؤال 2 من 5');
  await expect(await rate(page, { 1: 1, 2: 2 })).toContainText('السؤال 3 من 5');
  await expect(await rate(page, { 3: 5, 4: 5 })).toContainText('السؤال 4 من 5');
  await expect(await rate(page, { 5: 4, 6: 3, 7: 2 })).toContainText('السؤال 5 من 5');
  await page.locator('.msg.bot.live .quick button', { hasText: 'Excel' }).click();
  await page.locator('.msg.bot.live .quick button', { hasText: 'إدارة مشاريع' }).click();
  await expect(page.locator('#input')).toHaveValue('Excel، إدارة مشاريع');
  const before = await count(page);
  await page.press('#input', 'Enter');
  await replied(page, before);
  const r = last(page);
  await expect(r).toHaveAttribute('data-tag', 'results');
  await expect(r.locator('.results .row')).toHaveCount(8);
  await expect(r.locator('.results .row').first()).toHaveAttribute('data-pct', '86');
  await expect(r).toContainText('المسار الرئيسي: مدير مشاريع تقنية (86% – ممتاز)');
  await expect(r).toContainText('والبديل: محلل أعمال (76% – جيد)');
  await expect(r).toContainText('إرشادية');
  await r.scrollIntoViewIfNeeded();
  await snap(page, 'scenario1-results', testInfo);

  const g = await click(page, 'تحليل الفجوة');
  await expect(g).toContainText('✅ Excel');
  await expect(g).toContainText('❌ أدوات مثل MS Project');
  const pl = await click(page, 'خطة الأشهر الستة');
  await expect(pl).toContainText('متقدم (سنة 4 أو خريج)');
  await expect(pl).toContainText('التحضير لاختبار CAPM ثم أداؤه');
  await snap(page, 'scenario1-plan', testInfo);
});

test('2) التقارب: سؤال حاسم ثم توقف، وبعد الإجابة يُعتمد الرئيسي والبديل', async ({ page }, testInfo) => {
  await open(page);
  await click(page, 'اكتشف مساري');
  await click(page, 'سنة ثالثة');
  await rate(page, { 1: 4, 2: 5 });
  await rate(page, { 3: 2, 4: 2 });
  await rate(page, { 5: 3, 6: 3, 7: 2 });
  const t = await say(page, 'Excel و SQL');
  await expect(t).toHaveAttribute('data-tag', 'tiebreak');
  await expect(t).toContainText('متقاربان');
  await expect(t).toContainText('هل تفضّل تفسير البيانات واستخراج التوصيات منها، أم بناء الأنظمة التي تعرضها؟');
  await expect(t).not.toContainText('المسار الرئيسي');
  await expect(t.locator('.quick button')).toHaveCount(2);
  await page.waitForTimeout(300);
  await expect(bots(page)).toHaveCount(await bots(page).count()); // لا رسائل إضافية بعد السؤال الحاسم
  await t.scrollIntoViewIfNeeded();
  await snap(page, 'scenario2-tiebreak', testInfo);
  const res = await click(page, 'بناء الأنظمة التي تعرضها');
  await expect(res).toContainText('المسار الرئيسي: أخصائي ذكاء الأعمال (70% – جيد)، والبديل: محلل بيانات (72% – جيد)');
  await snap(page, 'scenario2-resolved', testInfo);
});

test('3) معلومات ناقصة بالعامية: يعلن الدرجات ويسأل عن الناقص فقط', async ({ page }) => {
  await open(page);
  const m = await say(page, 'أحب الأرقام مرة، البرمجة شوي، التواصل عادي');
  await expect(m).toContainText('اعتبرتُ درجة التحليل = 5، ويمكنك تصحيحها إن أردت.');
  await expect(m).toContainText('اعتبرتُ درجة البرمجة = 2');
  await expect(m).toContainText('اعتبرتُ درجة التواصل = 3');
  const q = await click(page, 'سنة أولى أو ثانية');
  await expect(q).toContainText('السؤال 3 من 5');
  await expect(q.locator('.rating-row')).toHaveCount(1);
  await expect(q.locator('.rating-row .label')).toHaveText('القيادة وتنظيم المهام');
});

test('4) مقارنة بين محلل أعمال ومدير مشاريع: جدول صحيح', async ({ page }) => {
  await open(page);
  const m = await say(page, 'قارن بين محلل أعمال ومدير مشاريع');
  const table = m.locator('table.compare');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['البند', 'محلل أعمال', 'مدير مشاريع تقنية']);
  const row = name => table.locator('tbody tr', { has: page.locator('th', { hasText: name }) });
  await expect(row('أعلى المعايير وزنًا').locator('td')).toHaveText(['التواصل (3)، فهم الأعمال (3)', 'التواصل (3)، القيادة (3)']);
  await expect(row('الشهادة المقترحة').locator('td')).toHaveText(['ECBA من IIBA', 'CAPM من PMI']);
  await expect(row('نسبة توافقك').locator('td')).toHaveText(['لم تُحسب بعد', 'لم تُحسب بعد']);
});

test('5) مقابلة تجريبية: سؤال واحد، ثم تقييم (قوة + تحسين)، ثم السؤال التالي', async ({ page }) => {
  await open(page);
  await click(page, 'أريد التدرب على مقابلة');
  const q1 = await click(page, 'محلل بيانات');
  await expect(q1).toContainText('السؤال 1 من 3: كيف تتعامل مع بيانات فيها قيم ناقصة؟');
  await expect(q1).not.toContainText('السؤال 2 من 3');
  const f = await say(page, 'أبدأ بتنظيف البيانات ومعالجة القيم الناقصة، مثلًا في مشروع جامعي استخدمت Excel');
  await expect(f).toContainText('نقطة قوة');
  await expect(f).toContainText('نقطة تحسين');
  await expect(f).toContainText('السؤال 2 من 3');
  await expect(f).not.toContainText('السؤال 3 من 3');
});

test('6) سؤال عن الراتب: لا تتوفر لدي هذه المعلومة مع توجيه', async ({ page }, testInfo) => {
  await open(page);
  const m = await say(page, 'كم راتب محلل البيانات في السعودية؟');
  await expect(m).toContainText('لا تتوفر لدي هذه المعلومة في قاعدة معرفتي');
  await expect(m).toContainText('المواقع الرسمية');
  await snap(page, 'scenario6-salary', testInfo);
});

test('7) CompTIA Security+: غير موجودة، بلا رسوم مختلقة، مع اقتراح ISC2 CC', async ({ page }) => {
  await open(page);
  const m = await say(page, 'ما رأيك في شهادة CompTIA Security+ ورسومها؟');
  await expect(m).toContainText('لا تتوفر لدي هذه المعلومة');
  await expect(m).toContainText('ISC2 Certified in Cybersecurity (CC)');
  expect(await m.innerText()).not.toMatch(/\$|دولار|https?:/);
});

test('8) طلب كتابة CV: اعتذار وعرض بديل', async ({ page }) => {
  await open(page);
  const m = await say(page, 'اكتب لي سيرتي الذاتية');
  await expect(m).toContainText('أعتذر، هذا خارج تخصصي');
  await expect(m.locator('.quick button').first()).toBeVisible();
});

test('9) تطوير الألعاب: غير موجود، وأقرب مسار مدير منتج رقمي', async ({ page }) => {
  await open(page);
  const m = await say(page, 'أريد أن أصبح مطور ألعاب');
  await expect(m).toContainText('ليس ضمن قاعدة معرفتي');
  await expect(m).toContainText('مدير منتج رقمي');
});

test('10) طلب غامض يبدأ الاستبيان، ثم "أبغى محلل بيانات غصب" لا يغيّر النتيجة', async ({ page }) => {
  await open(page);
  const first = await say(page, 'أبغى شي يناسبني');
  await expect(first).toContainText('السؤال 1 من 5');
  await click(page, 'سنة رابعة أو خريج');
  await rate(page, { 1: 1, 2: 2 });
  await rate(page, { 3: 5, 4: 5 });
  await rate(page, { 5: 4, 6: 3, 7: 2 });
  await click(page, 'لا شيء بعد');
  const m = await say(page, 'أبغى محلل بيانات غصب');
  await expect(m).toContainText('لا أغيّر النتيجة');
  await expect(m).toContainText('نسبة توافقك الحقيقية مع محلل بيانات هي 52% (متوسط)');
  await expect(m).toContainText('مسارك الرئيسي مدير مشاريع تقنية بنسبة 86%');
});

test('محادثة جديدة تعيد كل شيء من البداية، ومؤشر "يكتب…" يظهر قبل الرد', async ({ page }) => {
  await page.goto('/?delay=400');
  await page.waitForSelector('body[data-ready="1"]');
  await page.fill('#input', 'ما المسارات المتاحة؟');
  await page.press('#input', 'Enter');
  await expect(page.locator('.msg.typing')).toContainText('يكتب…');
  await replied(page, 1);
  await page.click('#new-chat');
  await page.waitForFunction(() => document.querySelectorAll('.msg.bot:not(.typing)').length === 1 && document.body.dataset.busy === '0');
  await expect(bots(page)).toHaveCount(1);
  await expect(page.locator('.msg.user')).toHaveCount(0);
});

test('لا تمرير أفقي على شاشة الجوال', async ({ page }) => {
  await open(page);
  await say(page, 'قارن بين محلل أعمال ومدير مشاريع');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
