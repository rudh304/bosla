// النسخة الإنجليزية: تطابق بنية الترجمة مع الأصل العربي، وسلوك الوكيل بالإنجليزية
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBot, loadData } from '../bot.js';
import { STRINGS } from '../i18n.js';

const data = await loadData(async f => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));
const text = m => m.html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function session(lang = 'en') {
  const bot = createBot(data, { lang });
  const log = bot.start();
  const send = input => {
    const out = bot.handle(typeof input === 'string' ? { text: input } : input);
    for (const m of out) {
      const t = text(m);
      assert.ok(/[?؟]$/.test(t) || m.buttons.length || (m.ratings && m.ratings.length), `message without a question or buttons: ${t}`);
      assert.doesNotMatch(t, /[؀-ۿ]{3,}/, `Arabic text in English mode: ${t}`);
    }
    log.push(...out);
    return out.at(-1);
  };
  return { bot, send, log };
}
const rate = c => ({ action: 'rate', payload: c });

test('الترجمة تطابق بنية الأصل العربي (عدد المسارات والمهام والمهارات والشهادات والخطط والأسئلة)', () => {
  const ar = data.paths.paths, en = data.en.paths.paths;
  assert.equal(en.length, ar.length);
  ar.forEach((a, i) => {
    const e = en[i];
    assert.equal(e.id, a.id);
    assert.equal(e.en, a.en, 'الاسم الإنجليزي من الدليل نفسه');
    for (const k of ['tasks', 'skills', 'certifications', 'freeResources', 'interview']) assert.equal(e[k].length, a[k].length, `${a.en} ${k}`);
    for (const lv of ['beginner', 'advanced']) {
      assert.deepEqual(e.plan[lv].map(r => r.months), a.plan[lv].map(r => r.months));
    }
  });
  assert.equal(data.en.faq.faq.length, data.faq.faq.length);
  assert.equal(data.en.faq.limits.length, data.faq.limits.length);
  assert.equal(data.en.faq.buttons.length, data.faq.buttons.length);
  assert.equal(data.en.questionnaire.questions.length, data.questionnaire.questions.length);
});

test('الأرقام في الترجمة مطابقة للأصل (الرسوم والمدد والساعات)', () => {
  const nums = s => (JSON.stringify(s).match(/\d+/g) || []).sort().join(',');
  data.paths.paths.forEach((a, i) => {
    const e = data.en.paths.paths[i];
    assert.equal(nums(e.certifications.map(c => c.details)), nums(a.certifications.map(c => c.details)), a.en);
  });
});

test('النصوص بلغتين لها المفاتيح نفسها', () => {
  const keys = o => Object.keys(o).sort();
  assert.deepEqual(keys(STRINGS.en.t), keys(STRINGS.ar.t));
  assert.deepEqual(keys(STRINGS.en.b), keys(STRINGS.ar.b));
  assert.deepEqual(keys(STRINGS.en.ui), keys(STRINGS.ar.ui));
});

test('EN: welcome, full questionnaire, results, gap and plan', () => {
  const { send, log } = session();
  assert.match(text(log[0]), /Where shall we start\?$/);
  assert.equal(send({ action: 'discover' }).tag, 'q1');
  send({ action: 'lvl:4' });
  send(rate({ 1: 1, 2: 2 }));
  send(rate({ 3: 5, 4: 5 }));
  assert.match(text(send(rate({ 5: 4, 6: 3, 7: 2 }))), /Question 5 of 5/);
  const r = send('Excel, project management');
  assert.match(text(r), /Main path: IT Project Manager \(86% – Excellent\), alternative: Business Analyst \(76% – Good\)/);
  assert.match(text(send({ action: 'gap' })), /✅ Excel/);
  assert.match(text(send({ action: 'plan' })), /Preparing for the CAPM exam, then taking it/);
});

test('EN: close paths ask the deciding question and stop', () => {
  const { send } = session();
  send({ action: 'discover' }); send({ action: 'lvl:3' });
  send(rate({ 1: 4, 2: 5 })); send(rate({ 3: 2, 4: 2 }));
  send(rate({ 5: 3, 6: 3, 7: 2 }));
  const t = send({ action: 'skills:none' });
  assert.equal(t.tag, 'tiebreak');
  assert.match(text(t), /Do you prefer interpreting data and drawing recommendations from it, or building the systems that present it\?/);
  assert.match(text(send({ action: 'tb:2' })), /Main path: BI Specialist/);
});

test('EN: free-text scores are announced', () => {
  const { send } = session();
  const m = send('I love numbers, programming a little, communication average');
  assert.match(text(m), /I estimated your Analysis score as 5/);
  assert.match(text(m), /I estimated your Programming score as 2/);
  assert.match(text(m), /I estimated your Communication score as 3/);
});

test('EN: limits (salary, unknown certificate, CV, games)', () => {
  const { send } = session();
  assert.match(text(send('What is the salary of a data analyst?')), /^I don't have this information in my knowledge base/);
  const c = text(send('What about CompTIA Security+ and its fees?'));
  assert.match(c, /ISC2 Certified in Cybersecurity \(CC\)/);
  assert.doesNotMatch(c, /\$|USD|https?:/);
  assert.match(text(send('write my CV')), /^Sorry, this is outside my specialty/);
  assert.match(text(send('I want to be a game developer')), /closest available path is Digital Product Manager/);
});

test('EN: compare and pressure', () => {
  const { send } = session();
  const m = send('compare business analyst and project manager');
  assert.match(text(m), /Communication \(3\), Business understanding \(3\)/);
  assert.match(text(m), /ECBA by IIBA/);
  send({ action: 'discover' }); send({ action: 'lvl:4' });
  send(rate({ 1: 1, 2: 2 })); send(rate({ 3: 5, 4: 5 })); send(rate({ 5: 4, 6: 3, 7: 2 }));
  send({ action: 'skills:none' });
  const pr = text(send('I want data analyst no matter what'));
  assert.match(pr, /Your real match with Data Analyst is 52% \(Average\)/);
});

test('EN: mock interview gives a strength and an improvement', () => {
  const { send } = session();
  send({ action: 'interview' });
  assert.match(text(send({ action: 'int:1' })), /Question 1 of 3: How do you handle data that has missing values\?/);
  const f = text(send('I clean the data in Excel and Python, for example in my project I removed empty rows'));
  assert.match(f, /Strength/);
  assert.match(f, /To improve/);
  assert.match(f, /Question 2 of 3/);
});

test('ملخص النتيجة للنسخ والمشاركة', () => {
  const bot = createBot(data);
  bot.start();
  ['discover', 'lvl:4'].forEach(a => bot.handle({ action: a }));
  bot.handle(rate({ 1: 1, 2: 2 })); bot.handle(rate({ 3: 5, 4: 5 })); bot.handle(rate({ 5: 4, 6: 3, 7: 2 }));
  bot.handle({ action: 'skills:none' });
  const s = bot.summary();
  assert.match(s, /مدير مشاريع تقنية: 86% \(ممتاز\)/);
  assert.match(s, /إرشادية/);
});
