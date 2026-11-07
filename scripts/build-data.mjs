// يبني ملفات data/*.json مباشرة من ملفات Word الرسمية، حتى لا تُكتب أي معلومة يدويًا.
// التشغيل: node scripts/build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocx } from './docx.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = name => path.join(root, 'source', name);
const out = (name, obj) => {
  fs.writeFileSync(path.join(root, 'data', name), JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log('✔ data/' + name);
};

// يقسّم الكتل إلى أقسام حسب العناوين (المستوى المطلوب)
function sections(blocks, level) {
  const result = [];
  let cur = null;
  for (const b of blocks) {
    if (b.type === 'heading' && b.level <= level) {
      cur = { heading: b.text, level: b.level, blocks: [] };
      result.push(cur);
    } else if (cur) cur.blocks.push(b);
  }
  return result;
}
const items = bs => bs.filter(b => b.type === 'item').map(b => b.text);
const paras = bs => bs.filter(b => b.type === 'para').map(b => b.text);
const table = bs => bs.find(b => b.type === 'table').rows.slice(1);
const splitNamed = t => {
  const i = t.indexOf(': ');
  return i < 0 ? { name: t, details: '' } : { name: t.slice(0, i), details: t.slice(i + 2) };
};

// ---------- دليل المسارات ----------
{
  const blocks = readDocx(src('bosla_paths_guide.docx'));
  const top = sections(blocks, 1);
  const general = sections(blocks, 2).find(s => s.heading.startsWith('تنبيهات عامة'));
  const paths = top.filter(s => s.heading.startsWith('المسار')).map(s => {
    const m = s.heading.match(/^المسار (\d+): (.+?) \((.+)\)$/);
    const sub = Object.fromEntries(sections(s.blocks, 2).map(x => [x.heading, x.blocks]));
    const get = prefix => sub[Object.keys(sub).find(k => k.startsWith(prefix))];
    const planRows = table(get('خطة'));
    return {
      id: Number(m[1]),
      ar: m[2],
      en: m[3],
      description: paras(get('الوصف')).join(' '),
      tasks: items(get('المهام')),
      skills: items(get('المهارات')),
      traits: paras(get('السمات')).join(' '),
      certifications: items(get('الشهادات')).map(splitNamed),
      freeResources: items(get('مصادر')).map(splitNamed),
      plan: {
        beginner: planRows.map(r => ({ months: r[0], text: r[1] })),
        advanced: planRows.map(r => ({ months: r[0], text: r[2] }))
      },
      interview: items(get('أسئلة مقابلة'))
    };
  });
  if (paths.length !== 8) throw new Error('عدد المسارات المستخرجة ليس 8');
  out('paths.json', { source: 'bosla_paths_guide.docx', notes: items(general.blocks), paths });
}

// ---------- الاستبيان ----------
{
  const blocks = readDocx(src('bosla_questionnaire.docx'));
  const sec = sections(blocks, 2);
  const find = prefix => sec.find(s => s.heading.startsWith(prefix));
  const qs = [1, 2, 3, 4, 5].map(n => find(`السؤال ${n}:`));
  const rules = sec.filter(s => s.heading.startsWith('القاعدة'));
  const dictRule = rules[1];
  out('questionnaire.json', {
    source: 'bosla_questionnaire.docx',
    purpose: paras(find('الغرض').blocks).join(' '),
    scale: table(find('مقياس').blocks).map(r => ({ score: Number(r[0]), meaning: r[1] })),
    questions: qs.map((q, i) => {
      const title = q.heading.replace(/^السؤال \d+: /, '');
      if (i === 0) {
        return { id: 1, title, options: table(q.blocks).map(r => ({ label: r[0].replace(/^[أبج]\) /, ''), plan: r[1] })) };
      }
      if (i === 4) return { id: 5, title, hint: paras(q.blocks).join(' ') };
      return {
        id: i + 1, title,
        criteria: items(q.blocks).map(t => {
          const [label, ref] = t.split(' ← ');
          return { label, criterion: Number(ref.replace('المعيار ', '')) };
        })
      };
    }),
    rules: rules.map(r => ({ title: r.heading, text: paras(r.blocks)[0] })),
    descriptionScale: table(dictRule.blocks).map(r => ({ description: r[0], score: Number(r[1]) })),
    announceFormat: paras(dictRule.blocks).find(t => t.startsWith('صيغة الإعلان')).replace('صيغة الإعلان: ', '').replace(/^"|"$/g, '')
  });
}

// ---------- الأسئلة الشائعة والحدود ----------
{
  const blocks = readDocx(src('bosla_faq_limits.docx'));
  const sec = sections(blocks, 1);
  const find = prefix => sec.find(s => s.heading.startsWith(prefix));
  const welcome = find('القسم 1').blocks;
  const limits = find('القسم 4').blocks;
  const disclaimer = paras(find('القسم 5').blocks);
  out('faq_limits.json', {
    source: 'bosla_faq_limits.docx',
    welcome: { paragraphs: paras(welcome), bullets: items(welcome) },
    buttons: table(find('القسم 2').blocks).map(r => ({ label: r[0], behavior: r[1] })),
    faq: table(find('القسم 3').blocks).map(r => ({ q: r[0], a: r[1] })),
    limits: table(limits).map(r => ({ type: r[0], reply: r[1] })),
    goldenRule: paras(limits).find(t => t.startsWith('القاعدة الذهبية')).replace('القاعدة الذهبية: ', ''),
    disclaimer: disclaimer[0],
    disclaimerPlacement: disclaimer[1].replace('موضع الظهور: ', '')
  });
}
