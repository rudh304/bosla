import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBot, loadData } from '../bot.js';

const data = await loadData(async f => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));
const text = m => m.html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** يشغّل محادثة ويتحقق من القاعدة الذهبية في كل رسالة */
function session() {
  const bot = createBot(data);
  const log = [...bot.start()];
  const send = input => {
    const out = bot.handle(typeof input === 'string' ? { text: input } : input);
    for (const m of out) {
      const t = text(m);
      const ends = t.endsWith('؟') || m.buttons.length > 0 || (m.ratings && m.ratings.length > 0);
      assert.ok(ends, `رسالة لا تنتهي بسؤال أو أزرار: ${t}`);
      const phases = [/class="results"/.test(m.html), /السؤال \d من 5/.test(t), /السؤال \d من 3/.test(t) && /مقابلة/.test(t) === false && false].filter(Boolean);
      assert.ok(phases.length <= 1, `رسالة تجمع أكثر من مرحلة: ${t}`);
    }
    log.push(...out);
    return out.at(-1);
  };
  return { bot, send, log };
}
const rate = (c) => ({ action: 'rate', payload: c });

/** يكمل الاستبيان كاملًا بالأزرار */
function survey(send, level, sc, skills = 'Excel و SQL') {
  send({ action: 'discover' });
  send({ action: `lvl:${level}` });
  send(rate({ 1: sc[0], 2: sc[1] }));
  send(rate({ 3: sc[2], 4: sc[3] }));
  send(rate({ 5: sc[4], 6: sc[5], 7: sc[6] }));
  return send(skills);
}

test('الترحيب: سطران وأربعة أزرار و"بماذا نبدأ؟" بلا أسئلة استبيان', () => {
  const { log } = session();
  const w = log[0];
  assert.equal(w.tag, 'welcome');
  assert.equal(w.buttons.length, 4);
  assert.match(text(w), /بماذا نبدأ؟$/);
  assert.doesNotMatch(text(w), /قيّم نفسك/);
});

test('1) حالة عادية كاملة: 5 أسئلة سؤالًا سؤالًا ثم النتائج ثم الفجوة ثم الخطة', () => {
  const { send } = session();
  assert.equal(send({ action: 'discover' }).tag, 'q1');
  assert.equal(send({ action: 'lvl:4' }).tag, 'q2');
  const q3 = send(rate({ 1: 1, 2: 2 }));
  assert.equal(q3.tag, 'q3');
  assert.match(text(q3), /^لا بأس|^شكرًا لصراحتك/);
  assert.equal(send(rate({ 3: 5, 4: 5 })).tag, 'q4');
  assert.equal(send(rate({ 5: 4, 6: 3, 7: 2 })).tag, 'q5');
  const r = send('Excel، إدارة مشاريع، لغة إنجليزية');
  assert.equal(r.tag, 'results');
  assert.match(text(r), /المسار الرئيسي: مدير مشاريع تقنية \(86%/);
  assert.match(text(r), /والبديل: محلل أعمال \(76%/);
  assert.match(text(r), /توصيات "بوصلة" إرشادية/);
  assert.match(text(r), /ماذا تريد بعد ذلك؟$/);
  assert.equal((r.html.match(/class="row"/g) || []).length, 8);
  const g = send({ action: 'gap' });
  assert.equal(g.tag, 'gap');
  assert.match(text(g), /✅ أساسيات إدارة المشاريع/);
  assert.match(text(g), /✅ Excel/);
  assert.match(text(g), /❌ أدوات مثل MS Project/);
  const pl = send({ action: 'plan' });
  assert.equal(pl.tag, 'plan');
  assert.match(text(pl), /متقدم \(سنة 4 أو خريج\)/);
  assert.match(text(pl), /إكمال 23 ساعة تعليم في إدارة المشاريع/);
});

test('2) التقارب: سؤال حاسم والتوقف، ثم اعتماد الرئيسي والبديل حسب الإجابة', () => {
  const { send, bot } = session();
  const r = survey(send, '3', [4, 5, 2, 2, 3, 3, 2]);
  assert.equal(r.tag, 'tiebreak');
  assert.match(text(r), /متقاربان/);
  assert.match(text(r), /هل تفضّل تفسير البيانات واستخراج التوصيات منها، أم بناء الأنظمة التي تعرضها؟/);
  assert.doesNotMatch(text(r), /المسار الرئيسي/);
  assert.doesNotMatch(text(r), /إرشادية/);
  assert.equal(r.buttons.length, 2);
  assert.equal(bot.state.decision.primary, null);
  const res = send('أفضّل بناء الأنظمة');
  assert.equal(res.tag, 'resolved');
  assert.match(text(res), /المسار الرئيسي: أخصائي ذكاء الأعمال \(70%/);
  assert.match(text(res), /والبديل: محلل بيانات \(72%/);
});

test('3) معلومات ناقصة بالعامية: يعلن الدرجات ويسأل عن الناقص فقط', () => {
  const { send, bot } = session();
  const m = send('أحب الأرقام مرة، البرمجة شوي، التواصل عادي');
  const t = text(m);
  assert.match(t, /اعتبرتُ درجة التحليل = 5، ويمكنك تصحيحها إن أردت\./);
  assert.match(t, /اعتبرتُ درجة البرمجة = 2/);
  assert.match(t, /اعتبرتُ درجة التواصل = 3/);
  assert.equal(m.tag, 'q1');
  const q3 = send({ action: 'lvl:12' });
  assert.equal(q3.tag, 'q3', 'السؤال 2 مكتمل فيُتخطى');
  assert.deepEqual(q3.ratings.map(r => r.crit), [4], 'يسأل عن القيادة فقط');
  assert.match(text(q3), /بقي أن تقيّم نفسك/);
  assert.deepEqual(bot.state.scores.slice(0, 3), [2, 5, 3]);
});

test('4) مقارنة محلل أعمال ومدير مشاريع: جدول صحيح', () => {
  const { send } = session();
  const m = send('قارن بين محلل أعمال ومدير مشاريع');
  assert.equal(m.tag, 'compare');
  const t = text(m);
  assert.match(m.html, /<table class="compare">/);
  assert.match(t, /التواصل \(3\)، فهم الأعمال \(3\)/);
  assert.match(t, /التواصل \(3\)، القيادة \(3\)/);
  assert.match(t, /ECBA من IIBA/);
  assert.match(t, /CAPM من PMI/);
  assert.match(t, /لم تُحسب بعد/);
});

test('4ب) المقارنة بالأزرار من الترحيب', () => {
  const { send } = session();
  assert.equal(send({ action: 'compare' }).buttons.length, 8);
  assert.equal(send({ action: 'cmp:3' }).buttons.length, 7);
  assert.equal(send({ action: 'cmp:5' }).tag, 'compare');
});

test('5) مقابلة تجريبية: سؤال واحد، ثم قوة + تحسين، ثم السؤال التالي', () => {
  const { send } = session();
  const q = send('أريد التدرب على مقابلة محلل بيانات');
  assert.equal(q.tag, 'interviewQ');
  assert.match(text(q), /السؤال 1 من 3: كيف تتعامل مع بيانات فيها قيم ناقصة؟/);
  assert.doesNotMatch(text(q), /السؤال 2 من 3/);
  const f = send('أبدأ بتنظيف البيانات ومعالجة القيم الناقصة، مثلًا في مشروع جامعي استخدمت Excel');
  assert.match(text(f), /نقطة قوة/);
  assert.match(text(f), /نقطة تحسين/);
  assert.match(text(f), /السؤال 2 من 3: ما الفرق بين INNER JOIN و LEFT JOIN؟/);
  send('INNER يعيد المتطابق فقط و LEFT يعيد كل سجلات الجدول الأيسر');
  const end = send('حللت مبيعات نادي الجامعة وقدمت توصية');
  assert.equal(end.tag, 'interviewEnd');
});

test('6) الراتب: لا تتوفر لدي هذه المعلومة + توجيه للمصدر الرسمي', () => {
  const { send } = session();
  const m = send('كم راتب محلل البيانات في السعودية؟');
  assert.match(text(m), /^لا تتوفر لدي هذه المعلومة في قاعدة معرفتي/);
  assert.match(text(m), /المواقع الرسمية/);
  assert.doesNotMatch(text(m), /\d{3,}\s*(ريال|SAR)/);
});

test('7) CompTIA Security+: غير موجودة، بلا رسوم مختلقة، مع اقتراح ISC2 CC', () => {
  const { send } = session();
  const m = send('ما رأيك في شهادة CompTIA Security+ ورسومها؟');
  const t = text(m);
  assert.match(t, /لا تتوفر لدي هذه المعلومة/);
  assert.match(t, /ISC2 Certified in Cybersecurity \(CC\)/);
  assert.doesNotMatch(t, /\$|دولار|https?:/);
});

test('8) كتابة CV: اعتذار وعرض بديل', () => {
  const { send } = session();
  const m = send('اكتب لي سيرتي الذاتية');
  assert.match(text(m), /^أعتذر، هذا خارج تخصصي/);
  assert.ok(m.buttons.length >= 1);
});

test('9) تطوير الألعاب: غير موجود، وأقرب مسار مدير منتج رقمي', () => {
  const { send } = session();
  const m = send('أريد أن أصبح مطور ألعاب');
  assert.match(text(m), /ليس ضمن قاعدة معرفتي/);
  assert.match(text(m), /مدير منتج رقمي/);
});

test('10) طلب غامض يبدأ الاستبيان، ثم الضغط لا يغيّر النتيجة الحقيقية (52%)', () => {
  const { send, bot } = session();
  const first = send('أبغى شي يناسبني');
  assert.equal(first.tag, 'q1');
  send({ action: 'lvl:4' });
  send(rate({ 1: 1, 2: 2 }));
  send(rate({ 3: 5, 4: 5 }));
  send(rate({ 5: 4, 6: 3, 7: 2 }));
  const r = send('Excel');
  assert.equal(r.tag, 'results');
  const m = send('أبغى محلل بيانات غصب');
  const t = text(m);
  assert.match(t, /لا أغيّر النتيجة/);
  assert.match(t, /محلل بيانات هي 52% \(متوسط\)/);
  assert.equal(bot.state.decision.primary.id, 5, 'الرئيسي يبقى مدير مشاريع');
  assert.match(t, /لاحظ الفجوة/);
});

test('تعديل درجة بعد النتيجة يعيد الحساب كاملًا', () => {
  const { send, bot } = session();
  survey(send, '4', [1, 2, 5, 5, 4, 2, 1]);
  const m = send('عدّل التحليل إلى 5');
  assert.match(text(m), /عدّلتُ درجة التحليل إلى 5/);
  assert.match(text(m), /أعدتُ الحساب كاملًا/);
  assert.equal(bot.state.scores[1], 5);
  assert.equal(bot.state.results.find(r => r.id === 1).pct, 66);
});

test('عدم تكرار المعلوم: "أنا سنة رابعة وأحب الأرقام" لا يُسأل عن المستوى ولا التحليل', () => {
  const { send, bot } = session();
  const m = send('أنا سنة رابعة وأحب الأرقام');
  assert.equal(bot.state.level, '4');
  assert.equal(m.tag, 'q2');
  assert.deepEqual(m.ratings.map(r => r.crit), [1]);
});

test('القاعدة 3: رفض الإجابة ← إعادة السؤال مرة واحدة ثم اعتبار الدرجة 3', () => {
  const { send, bot } = session();
  send({ action: 'discover' });
  send({ action: 'lvl:3' });
  assert.match(text(send('ما أبغى أجاوب')), /سأعيد السؤال مرة واحدة فقط/);
  const m = send('تخطى');
  assert.match(text(m), /اعتبرتُ درجة البرمجة = 3 \(محايد\)/);
  assert.equal(m.tag, 'q3');
  assert.deepEqual(bot.state.scores.slice(0, 2), [3, 3]);
  send(rate({ 3: 3, 4: 3 })); send(rate({ 5: 3, 6: 3, 7: 3 }));
  const r = send({ action: 'skills:none' });
  assert.match(text(r), /اعتُبرت درجة البرمجة والتحليل = 3 \(محايد\) لعدم الإجابة/);
});

test('القاعدة 4: رقم خارج المقياس يُحوَّل ويُطلب التأكيد', () => {
  const { send, bot } = session();
  send({ action: 'discover' });
  send({ action: 'lvl:3' });
  const m = send('البرمجة 7 والتحليل 4');
  assert.equal(m.tag, 'clamp');
  assert.match(text(m), /حوّلتُ درجة البرمجة من 7 إلى 5/);
  assert.equal(send('نعم').tag, 'q3');
  assert.equal(bot.state.scores[0], 5);
});

test('كل النسب أقل من 50%: نصيحة بناء الأساسيات', () => {
  const { send } = session();
  const r = survey(send, '12', [2, 2, 2, 2, 2, 2, 2]);
  assert.equal(r.tag, 'results');
  assert.match(text(r), /أنصحك ببناء الأساسيات أولًا/);
});

test('تناقض: رغبة في ذكاء الأعمال مع برمجة 1 تُذكر بلطف في النتيجة', () => {
  const { send } = session();
  send('أبغى أكون أخصائي ذكاء الأعمال');
  const r = survey(send, '4', [1, 2, 5, 5, 4, 2, 1]);
  assert.match(text(r), /ذكرتَ رغبتك في مسار أخصائي ذكاء الأعمال: نسبتك الحقيقية فيه 34%/);
  assert.match(text(r), /درجة البرمجة لديك 1/);
});

test('الشهادات ومصادر التعلم من الدليل فقط وبلا روابط', () => {
  const { send } = session();
  survey(send, '12', [4, 5, 2, 2, 3, 3, 2]);
  send({ action: 'tb:1' });
  const c = send({ action: 'certs' });
  const t = text(c);
  assert.match(t, /Google Data Analytics Professional Certificate/);
  assert.match(t, /أكاديمية طويق/);
  assert.doesNotMatch(c.html, /https?:/);
});

test('رسالة غير مفهومة: "لم أفهم طلبك تمامًا" مع إعادة الخيارات', () => {
  const { send } = session();
  const m = send('qwerty asdf');
  assert.match(text(m), /^لم أفهم طلبك تمامًا/);
  assert.equal(m.buttons.length, 4);
});

test('ما المسارات المتاحة؟ ثمانية أسطر ثم سؤال الاكتشاف', () => {
  const { send } = session();
  const m = send({ action: 'list' });
  assert.equal((m.html.match(/<li>/g) || []).length, 8);
  assert.match(text(m), /هل تريد اكتشاف الأنسب لك؟$/);
});

test('عرض الحساب بالتفصيل بعد النتيجة', () => {
  const { send } = session();
  survey(send, '4', [1, 2, 5, 5, 4, 2, 1]);
  const m = send('اعرض الحساب بالتفصيل');
  assert.match(text(m), /المجموع = 42، و42 × 2 = 84%/);
});
