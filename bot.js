// آلة حالات المحادثة في بوصلة. لا تعتمد على المتصفح: تستقبل نص الطالب أو زرًّا، وتعيد رسائل الوكيل.
// كل رسالة: { tag, html, buttons: [{label, action, append?}], ratings?: [{crit, label}] }
import { rankPaths, decide, resolveClose, topContributors, topWeighted, explainCalc, weakPointsFor } from './engine.js';
import { createNLU } from './nlu.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p = text => `<p>${esc(text)}</p>`;
const ul = items => `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
const firstSentence = t => (t.match(/^[^.]+\./) || [t])[0];

const GROUPS = [
  { key: 'level', q: 1 },
  { key: 'r2', q: 2, crits: [1, 2] },
  { key: 'r3', q: 3, crits: [3, 4] },
  { key: 'r4', q: 4, crits: [5, 6, 7] },
  { key: 'skills', q: 5 }
];
const LEVEL_PLAN = { '12': 'beginner', '3': 'beginner', '4': 'advanced' };
const PLAN_LABEL = { beginner: 'مبتدئ (سنة 1–3)', advanced: 'متقدم (سنة 4 أو خريج)' };
const SHORT_SCALE = 'المقياس: 1 ضعيف، 2 أقل من المتوسط، 3 متوسط، 4 جيد، 5 ممتاز.';

const REACTIONS = {
  5: ['ممتاز، {c} نقطة قوة واضحة لديك.', 'رائع، {c} من أبرز نقاط قوتك.'],
  4: ['جميل، مستواك في {c} جيد.', 'حسنًا، {c} لديك في مستوى جيد.'],
  3: ['حسنًا، مستواك في {c} متوسط ويمكن تطويره.', 'جيد، {c} لديك في المنتصف، وهذا قابل للتحسين.'],
  low: ['لا بأس، {c} مهارة يمكن بناؤها مع الوقت.', 'شكرًا لصراحتك، يمكن تطوير {c} بالتدريج.']
};

export function createBot(data) {
  const { matrix, paths: guide, questionnaire: Q, faq: F, keywords: KW } = data;
  const nlu = createNLU(KW, matrix);
  const P = id => guide.paths.find(x => x.id === id);
  const C = id => matrix.criteria[id - 1];
  const critLabel = id => Q.questions.flatMap(q => q.criteria || []).find(c => c.criterion === id).label;
  const limit = prefix => F.limits.find(l => l.type.startsWith(prefix)).reply;
  const faqA = prefix => F.faq.find(f => f.q.startsWith(prefix)).a;
  let s;

  function reset() {
    s = {
      stage: 'welcome', surveyStarted: false, level: null, scores: Array(7).fill(null), sources: {},
      defaulted: [], attempts: {}, skills: null, scaleShown: false, results: null, decision: null,
      desired: null, clampQueue: [], compareFirst: null, interview: null, pendingPlan: null, turn: 0
    };
  }
  reset();

  // ---------- أدوات الرسائل ----------
  const msg = (tag, parts, buttons = [], extra = {}) => ({ tag, html: parts.filter(Boolean).join(''), buttons, ...extra });
  const btn = (label, action, extra = {}) => ({ label, action, ...extra });
  const welcomeButtons = () => F.buttons.map((b, i) => btn(b.label, ['discover', 'compare', 'list', 'interview'][i]));
  const menuButtons = () => [
    btn('تحليل الفجوة', 'gap'), btn('خطة الأشهر الستة', 'plan'), btn('الشهادات ومصادر التعلم', 'certs'),
    btn('مقارنة المسارين', 'compare2'), btn('مقابلة تجريبية', 'mock')
  ];
  const pathButtons = (action, exclude = []) => matrix.paths.filter(x => !exclude.includes(x.id)).map(x => btn(x.ar, `${action}:${x.id}`));
  const hasResults = () => !!(s.results && s.decision && s.decision.primary);
  const primaryId = () => (hasResults() ? s.decision.primary.id : null);
  const afterButtons = () => (hasResults() ? menuButtons() : welcomeButtons());
  const afterQuestion = () => (hasResults() ? 'ماذا تريد بعد ذلك؟' : 'بماذا تريد أن نكمل؟');
  const pctOf = id => s.results && s.results.find(r => r.id === id);

  // ---------- الترحيب ----------
  function welcome() {
    reset();
    return [msg('welcome', [
      p(F.welcome.paragraphs[0]),
      p('يمكنني مساعدتك في اكتشاف مسارك، ومعرفة المهارات التي تنقصك مع خطة لستة أشهر، والمقارنة بين مسارين، والتدرب على المقابلات.'),
      p('بماذا نبدأ؟')
    ], welcomeButtons())];
  }

  // ---------- الاستبيان ----------
  const missingCrits = g => g.crits.filter(c => s.scores[c - 1] == null);
  const groupDone = g => (g.key === 'level' ? s.level != null : g.key === 'skills' ? s.skills != null : !missingCrits(g).length);
  const currentGroup = () => GROUPS.find(g => !groupDone(g));
  const surveyComplete = () => !currentGroup();

  function askQuestion(g, intro = []) {
    s.stage = 'survey';
    const head = intro.map(p);
    if (g.key === 'level') {
      const q = Q.questions[0];
      return msg('q1', [...head, p(`السؤال 1 من 5: ${q.title}`)],
        q.options.map((o, i) => btn(o.label, `lvl:${['12', '3', '4'][i]}`)));
    }
    if (g.key === 'skills') {
      const q = Q.questions[4];
      return msg('q5', [...head, p(`السؤال 5 من 5: ${q.title}`), p('اكتبها بأسلوبك، أو اختر من الاقتراحات ثم اضغط إرسال.')], [
        ...['Excel', 'SQL', 'Python', 'Power BI', 'إدارة مشاريع', 'لغة إنجليزية'].map(l => btn(l, 'append', { append: true })),
        btn('لا شيء بعد', 'skills:none')
      ]);
    }
    const missing = missingCrits(g);
    const q = Q.questions[g.q - 1];
    const parts = [...head];
    parts.push(p(missing.length < g.crits.length
      ? `السؤال ${g.q} من 5: بقي أن تقيّم نفسك من 1 إلى 5 في:`
      : `السؤال ${g.q} من 5: ${q.title}`));
    parts.push(ul(missing.map(critLabel)));
    if (!s.scaleShown) { parts.push(p(SHORT_SCALE)); s.scaleShown = true; }
    return msg(`q${g.q}`, parts, [], { ratings: missing.map(c => ({ crit: c, label: critLabel(c) })) });
  }

  function reaction(applied) {
    if (!applied.length) return null;
    const top = [...applied].sort((a, b) => b.value - a.value)[0];
    const bucket = top.value >= 5 ? 5 : top.value === 4 ? 4 : top.value === 3 ? 3 : 'low';
    const list = REACTIONS[bucket];
    return list[s.turn % list.length].replace('{c}', C(top.crit).short);
  }

  /** يطبّق الدرجات المستخرجة ويعيد ما تغيّر */
  function applyScores(scores) {
    const applied = [];
    for (const [k, v] of Object.entries(scores)) {
      const crit = Number(k);
      const prev = s.scores[crit - 1];
      s.scores[crit - 1] = v.value;
      s.sources[crit] = v.source;
      s.defaulted = s.defaulted.filter(c => c !== crit);
      applied.push({ crit, prev, ...v });
    }
    return applied;
  }

  const announce = applied => applied.filter(a => a.source === 'word' && !a.clamped)
    .map(a => `اعتبرتُ درجة ${C(a.crit).short} = ${a.value}، ويمكنك تصحيحها إن أردت.`);

  /** يستخرج من النص كل ما يخص ملف الطالب: المستوى والدرجات */
  function absorb(text, g) {
    const lvl = nlu.extractLevel(text, { bare: g && g.key === 'level' });
    const expected = g && g.crits ? missingCrits(g) : [];
    const { scores } = nlu.extractScores(text, expected);
    let levelSet = false;
    if (lvl && s.level !== lvl.level) { s.level = lvl.level; levelSet = true; }
    const applied = applyScores(scores);
    return { levelSet, applied };
  }

  const levelLine = () => (LEVEL_PLAN[s.level] === 'advanced'
    ? 'سأعتمد لك خطة المستوى المتقدم (سنة 4 أو خريج).'
    : 'سأعتمد لك خطة المستوى المبتدئ (سنة 1–3).');

  /** يكمل المسار: السؤال التالي، أو تأكيد رقم خارج المقياس، أو النتائج */
  function proceed(intro = [], applied = []) {
    const clamped = applied.filter(a => a.clamped);
    if (clamped.length) {
      s.clampQueue = clamped.map(a => a.crit);
      s.stage = 'confirmClamp';
      return msg('clamp', [
        ...intro.map(p),
        ...clamped.map(a => p(`حوّلتُ درجة ${C(a.crit).short} من ${a.raw} إلى ${a.value}، لأن المقياس من 1 إلى 5.`)),
        p(clamped.length > 1 ? 'هل تؤكد هذه الدرجات؟' : 'هل تؤكد هذه الدرجة؟')
      ], [btn('نعم، أؤكد', 'clamp:yes'), btn('سأكتب درجة أخرى', 'clamp:no')]);
    }
    if (!surveyComplete()) return askQuestion(currentGroup(), intro);
    return showResults(intro);
  }

  function startSurvey(intro) {
    s.surveyStarted = true;
    return proceed(intro);
  }

  // ---------- النتائج ----------
  function resultsCard(primary, alternative) {
    const rows = s.results.map(r => {
      const tag = primary && r.id === primary ? '<em class="tag tag-main">رئيسي</em>' : alternative && r.id === alternative ? '<em class="tag tag-alt">بديل</em>' : '';
      return `<div class="row" data-path="${r.id}" data-pct="${r.pct}"><div class="row-head"><span class="name">${esc(r.ar)}</span>${tag}<span class="pct">${r.pct}%</span><span class="badge lv-${r.level.key}">${r.level.ar}</span></div><div class="bar"><i class="lv-${r.level.key}" style="width:${r.pct}%"></i></div></div>`;
    }).join('');
    return `<div class="results" role="table" aria-label="نتائج التوافق">${rows}</div>`;
  }

  function reasonLines(d) {
    const top = topContributors(d.primary.id, s.scores, matrix);
    const why = top.map(t => `${t.short} (الوزن ${t.weight} × درجتك ${t.score})`).join(' و');
    const lines = [`السبب: أكثر ما رفع نسبتك في ${d.primary.ar} معيارا ${why}.`];
    const altTop = topContributors(d.alternative.id, s.scores, matrix, 1)[0];
    lines.push(`والبديل ${d.alternative.ar} (${d.alternative.pct}%) يعتمد كذلك على ${altTop.short} الذي حصلتَ فيه على ${altTop.score}.`);
    return lines;
  }

  const defaultedNote = () => (s.defaulted.length
    ? [`ملاحظة: اعتُبرت درجة ${s.defaulted.map(c => C(c).short).join(' و')} = 3 (محايد) لعدم الإجابة.`]
    : []);

  function notesLines() {
    const out = defaultedNote();
    if (s.desired && s.decision.primary && s.desired !== s.decision.primary.id) {
      const r = pctOf(s.desired);
      let line = `ذكرتَ رغبتك في مسار ${r.ar}: نسبتك الحقيقية فيه ${r.pct}% (${r.level.ar}).`;
      const weak = weakPointsFor(s.desired, s.scores, matrix);
      if (weak.length) line += ` لاحظ الفجوة: درجة ${weak[0].short} لديك ${weak[0].score}، بينما وزنها في هذا المسار ${weak[0].weight} وهو من أعلى أوزانه.`;
      out.push(line);
    }
    return out;
  }

  function decisiveQuestion(d) {
    const [a, b] = [d.first.id, d.second.id];
    if (a + b === 3 && a * b === 2) return { text: 'هل تفضّل تفسير البيانات واستخراج التوصيات منها، أم بناء الأنظمة التي تعرضها؟', labels: { 1: 'تفسير البيانات واستخراج التوصيات', 2: 'بناء الأنظمة التي تعرضها' } };
    const fa = KW.paths[a].focus, fb = KW.paths[b].focus;
    return { text: `هل تفضّل ${fa}، أم ${fb}؟`, labels: { [a]: fa, [b]: fb } };
  }

  function tiebreakMessage(intro = []) {
    const d = s.decision;
    const dq = decisiveQuestion(d);
    s.stage = 'tiebreak';
    return msg('tiebreak', [
      ...intro.map(p),
      resultsCard(),
      p(`المساران الأولان متقاربان: ${d.first.ar} (${d.first.pct}%) و${d.second.ar} (${d.second.pct}%)، والفرق بينهما ${d.gap}% فقط.`),
      ...defaultedNote().map(p),
      p(`لنحسم الاختيار بسؤال واحد: ${dq.text}`)
    ], [btn(dq.labels[d.first.id], `tb:${d.first.id}`), btn(dq.labels[d.second.id], `tb:${d.second.id}`)]);
  }

  function recommendationMessage(intro = [], tag = 'results') {
    const d = s.decision;
    s.stage = 'menu';
    const parts = [...intro.map(p)];
    if (tag === 'results') parts.push(resultsCard(d.primary.id, d.alternative.id));
    if (d.type === 'weak') {
      parts.push(p(`جميع النسب أقل من 50%، لذلك أنصحك ببناء الأساسيات أولًا. المسار الأقرب إليك حاليًا: ${d.primary.ar} (${d.primary.pct}%)، ثم ${d.alternative.ar} (${d.alternative.pct}%).`));
    } else {
      parts.push(p(`المسار الرئيسي: ${d.primary.ar} (${d.primary.pct}% – ${d.primary.level.ar})، والبديل: ${d.alternative.ar} (${d.alternative.pct}% – ${d.alternative.level.ar}).`));
    }
    parts.push(...reasonLines(d).map(p));
    parts.push(...notesLines().map(p));
    parts.push(`<p class="disclaimer">${esc(F.disclaimer)}</p>`);
    parts.push(p('ماذا تريد بعد ذلك؟'));
    return msg(tag, parts, menuButtons());
  }

  function showResults(intro = []) {
    s.results = rankPaths(s.scores, matrix);
    s.decision = decide(s.results);
    if (s.decision.type === 'close') return tiebreakMessage(intro);
    return recommendationMessage(intro, 'results');
  }

  function resolveTie(id) {
    s.decision = resolveClose(s.decision, id);
    return recommendationMessage([`بناءً على إجابتك، اعتمدتُ ${s.decision.primary.ar} مسارًا رئيسيًا، و${s.decision.alternative.ar} بديلًا.`], 'resolved');
  }

  // ---------- التفاصيل عند الطلب ----------
  function gap(id) {
    const g = P(id);
    if (s.skills == null) {
      s.stage = 'survey';
      s.pendingGap = id;
      return askQuestion(GROUPS[4], ['لتحليل الفجوة أحتاج أولًا إلى معرفة مهاراتك الحالية.']);
    }
    const res = nlu.gapAnalysis(id, s.skills, g);
    const known = nlu.extractSkills(s.skills).known;
    const pathKeys = KW.paths[id].skillKeys.flat();
    const extra = known.filter(l => !KW.generalSkills.find(x => x.label === l).keys.some(k => pathKeys.includes(k)));
    const have = res.filter(r => r.has).length;
    s.stage = hasResults() ? 'menu' : 'idle';
    return msg('gap', [
      p(`تحليل الفجوة لمسار ${g.ar} مقارنةً بمهاراتك الحالية:`),
      `<ul class="checklist">${res.map(r => `<li class="${r.has ? 'ok' : 'miss'}">${r.has ? '✅' : '❌'} ${esc(r.label)} — ${r.has ? 'تمتلكها' : 'تنقصك'}</li>`).join('')}</ul>`,
      extra.length ? p(`مهارات أخرى ذكرتَها: ${extra.join('، ')}.`) : '',
      p(`تمتلك ${have} من ${res.length} مهارات.${have < res.length ? ' خطة الأشهر الستة تساعدك على سد الفجوة.' : ''}`),
      p(afterQuestion())
    ], afterButtons());
  }

  function plan(id) {
    if (!s.level) {
      s.pendingPlan = id;
      s.stage = 'askLevel';
      const q = Q.questions[0];
      return msg('askLevel', [p(`لأختار لك الخطة المناسبة: ${q.title}`)], q.options.map((o, i) => btn(o.label, `lvl:${['12', '3', '4'][i]}`)));
    }
    const g = P(id);
    const kind = LEVEL_PLAN[s.level];
    s.stage = hasResults() ? 'menu' : 'idle';
    return msg('plan', [
      p(`خطة الأشهر الستة لمسار ${g.ar} – مستوى ${PLAN_LABEL[kind]}:`),
      ul(g.plan[kind].map(r => `الشهر ${r.months}: ${r.text}`)),
      p(afterQuestion())
    ], afterButtons());
  }

  function certs(id) {
    const g = P(id);
    s.stage = hasResults() ? 'menu' : 'idle';
    return msg('certs', [
      p(`الشهادات المهنية لمسار ${g.ar} (مدفوعة):`),
      ul(g.certifications.map(c => `${c.name}: ${c.details}`)),
      p('مصادر تعلم مجانية:'),
      ul(g.freeResources.map(c => `${c.name}: ${c.details}`)),
      p(guide.notes[1].replace(/^الرسوم: /, '')),
      p(afterQuestion())
    ], afterButtons());
  }

  function compare(a, b) {
    const A = P(a), B = P(b);
    const pctCell = id => { const r = pctOf(id); return r ? `${r.pct}% (${r.level.ar})` : 'لم تُحسب بعد'; };
    const rows = [
      ['الوصف', A.description, B.description],
      ['أهم المهارات', A.skills.slice(0, 3).join('، '), B.skills.slice(0, 3).join('، ')],
      ['أعلى المعايير وزنًا', ...[a, b].map(id => topWeighted(id, matrix, 2).map(c => `${c.short} (${c.weight})`).join('، '))],
      ['الشهادة المقترحة', A.certifications[0].name, B.certifications[0].name],
      ['نسبة توافقك', pctCell(a), pctCell(b)]
    ];
    s.stage = hasResults() ? 'menu' : 'idle';
    s.compareFirst = null;
    return msg('compare', [
      p(`مقارنة بين ${A.ar} و${B.ar}:`),
      `<div class="table-wrap"><table class="compare"><thead><tr><th>البند</th><th>${esc(A.ar)}</th><th>${esc(B.ar)}</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`,
      p(afterQuestion())
    ], afterButtons());
  }

  function comparePick(intro = []) {
    s.stage = 'comparePick';
    if (s.compareFirst) {
      return msg('comparePick', [...intro.map(p), p(`اخترتَ ${P(s.compareFirst).ar}. ما المسار الثاني؟`)], pathButtons('cmp', [s.compareFirst]));
    }
    return msg('comparePick', [...intro.map(p), p('اختر مسارين للمقارنة. ما المسار الأول؟')], pathButtons('cmp'));
  }

  function listPaths() {
    s.stage = 'idle';
    return msg('list', [
      p('المسارات الثمانية المتاحة:'),
      `<ol class="paths">${guide.paths.map(g => `<li><strong>${esc(g.ar)} (${esc(g.en)})</strong>: ${esc(firstSentence(g.description))}</li>`).join('')}</ol>`,
      p('هل تريد اكتشاف الأنسب لك؟')
    ], [btn('نعم، اكتشف مساري', 'discover'), btn('⚖️ قارن بين مسارين', 'compare'), btn('🎤 أريد التدرب على مقابلة', 'interview')]);
  }

  function pathInfo(id) {
    const g = P(id);
    s.stage = hasResults() ? 'menu' : 'idle';
    const r = pctOf(id);
    return msg('pathInfo', [
      p(`${g.ar} (${g.en}): ${g.description}`),
      p(`السمات المناسبة: ${g.traits}`),
      r ? p(`نسبة توافقك معه: ${r.pct}% (${r.level.ar}).`) : '',
      p('ماذا تريد أن تعرف عنه؟')
    ], [btn('خطة الأشهر الستة', `plan:${id}`), btn('الشهادات ومصادر التعلم', `certs:${id}`), btn('مقابلة تجريبية', `int:${id}`), ...(hasResults() ? [btn('القائمة', 'menu')] : [btn('🧭 اكتشف مساري', 'discover')])]);
  }

  // ---------- المقابلة التجريبية ----------
  function interviewPick() {
    s.stage = 'interviewPick';
    return msg('interviewPick', [p('أي مسار تريد التدرب على مقابلته؟')], pathButtons('int'));
  }

  function startInterview(id) {
    s.interview = { id, q: 0 };
    s.stage = 'interview';
    const g = P(id);
    return msg('interviewQ', [
      p(`مقابلة تجريبية لمسار ${g.ar}: ثلاثة أسئلة، سؤال في كل رسالة، وأعلّق بعد كل إجابة.`),
      p(`السؤال 1 من 3: ${g.interview[0]}`)
    ], [btn('إنهاء المقابلة', 'endInterview')]);
  }

  function feedback(answer) {
    const { id, q } = s.interview;
    const e = nlu.evaluateAnswer(answer, id, q);
    let strength;
    if (e.hits.length >= 2) strength = `استخدمتَ مصطلحات مرتبطة بالسؤال، مثل: ${e.hits.slice(0, 2).join('، ')}.`;
    else if (e.hasExample) strength = 'دعمتَ إجابتك بمثال عملي، وهذا يجعلها مقنعة.';
    else if (e.hits.length === 1) strength = `أشرتَ إلى نقطة مرتبطة بالسؤال (${e.hits[0]}).`;
    else if (e.words >= 25) strength = 'إجابتك مفصّلة ومنظّمة.';
    else if (e.words >= 8) strength = 'إجابتك مباشرة وواضحة.';
    else strength = 'بادرتَ بالإجابة دون تردد، وهذه بداية جيدة.';
    let improve;
    if (!e.hasExample) improve = 'أضف مثالًا عمليًا من مشروع أو تجربة (في الجامعة أو التدريب).';
    else if (e.hits.length < 2) improve = `اذكر مصطلحات من المسار، مثل: ${e.suggestions.slice(0, 2).join('، ')}.`;
    else if (e.words < 25) improve = 'وسّع إجابتك بخطوات أوضح، واختمها بالنتيجة التي تحققت.';
    else improve = 'اختم إجابتك بالنتيجة أو الأثر الذي تحقق باختصار.';
    return [`💪 نقطة قوة: ${strength}`, `🎯 نقطة تحسين: ${improve}`];
  }

  function interviewAnswer(text) {
    const fb = feedback(text);
    const g = P(s.interview.id);
    s.interview.q += 1;
    if (s.interview.q < 3) {
      return msg('interviewQ', [...fb.map(p), p(`السؤال ${s.interview.q + 1} من 3: ${g.interview[s.interview.q]}`)], [btn('إنهاء المقابلة', 'endInterview')]);
    }
    return endInterview(fb);
  }

  function endInterview(fb = []) {
    const g = P(s.interview.id);
    s.interview = null;
    s.stage = hasResults() ? 'menu' : 'idle';
    return msg('interviewEnd', [...fb.map(p), p(`انتهت المقابلة التجريبية لمسار ${g.ar}. ${afterQuestion()}`)], afterButtons());
  }

  // ---------- إعادة عرض المرحلة الحالية ----------
  function resume(intro = []) {
    switch (s.stage) {
      case 'survey': return askQuestion(currentGroup() || GROUPS[4], intro);
      case 'confirmClamp': return msg('clamp', [...intro.map(p), p(`هل تؤكد درجة ${s.clampQueue.map(c => `${C(c).short} = ${s.scores[c - 1]}`).join(' و')}؟`)], [btn('نعم، أؤكد', 'clamp:yes'), btn('سأكتب درجة أخرى', 'clamp:no')]);
      case 'tiebreak': {
        const dq = decisiveQuestion(s.decision);
        return msg('tiebreak', [...intro.map(p), p(dq.text)], [btn(dq.labels[s.decision.first.id], `tb:${s.decision.first.id}`), btn(dq.labels[s.decision.second.id], `tb:${s.decision.second.id}`)]);
      }
      case 'comparePick': return comparePick(intro);
      case 'interviewPick': return msg('interviewPick', [...intro.map(p), p('أي مسار تريد التدرب على مقابلته؟')], pathButtons('int'));
      case 'interview': return msg('interviewQ', [...intro.map(p), p(`السؤال ${s.interview.q + 1} من 3: ${P(s.interview.id).interview[s.interview.q]}`)], [btn('إنهاء المقابلة', 'endInterview')]);
      case 'askLevel': return msg('askLevel', [...intro.map(p), p(`لأختار لك الخطة المناسبة: ${Q.questions[0].title}`)], Q.questions[0].options.map((o, i) => btn(o.label, `lvl:${['12', '3', '4'][i]}`)));
      case 'welcome': return msg('welcomeAgain', [...intro.map(p), p('بماذا نبدأ؟')], welcomeButtons());
      default: return msg('menu', [...intro.map(p), p(afterQuestion())], afterButtons());
    }
  }

  // ---------- النوايا العامة ----------
  function handleIntent(it, text) {
    const pathId = it.paths[0] || primaryId();
    switch (it.intent) {
      case 'restart': return welcome()[0];
      case 'greet': return resume(['أهلًا بك!']);
      case 'thanks': return resume(['العفو، يسعدني ذلك.']);
      case 'salary': {
        const alt = pathId ? `يمكنني بدلًا من ذلك عرض شهادات مسار ${P(pathId).ar} ومصادر تعلمه المجانية.` : 'يمكنني بدلًا من ذلك عرض المسارات الثمانية ومهاراتها وشهاداتها.';
        return msg('limit', [
          p(`لا تتوفر لدي هذه المعلومة في قاعدة معرفتي؛ ${limit('السؤال عن الرواتب')}`),
          p('أنصحك بالرجوع إلى المواقع الرسمية للجهات المعنية.'),
          p(`${alt} هل تريد ذلك؟`)
        ], pathId ? [btn('نعم، اعرض الشهادات والمصادر', `certs:${pathId}`), ...resumeButton()] : [btn('📚 ما المسارات المتاحة؟', 'list'), ...resumeButton()]);
      }
      case 'unknownCert': {
        const g = P(it.cert.path);
        return msg('limit', [
          p(`لا تتوفر لدي هذه المعلومة في قاعدة معرفتي؛ فهذه الشهادة ليست ضمن الدليل، ولن أذكر لها رسومًا أو روابط.`),
          p(`أقرب بديل في الدليل: ${g.certifications.map(c => c.name).join('، ')} (مسار ${g.ar}).`),
          p('وأنصحك بالرجوع إلى الموقع الرسمي للجهة المانحة للتحقق من أي شهادة. هل تريد عرض تفاصيل البديل ومصادر التعلم المجانية؟')
        ], [btn('نعم، اعرض التفاصيل', `certs:${g.id}`), ...resumeButton()]);
      }
      case 'guideCert': {
        const g = P(it.cert.path);
        const c = g.certifications[it.cert.index];
        return msg('guideCert', [
          p(`${c.name} (مسار ${g.ar}): ${c.details}`),
          p(guide.notes[1].replace(/^الرسوم: /, '')),
          p('هل تريد عرض مصادر التعلم المجانية لهذا المسار؟')
        ], [btn('نعم، اعرض المصادر', `certs:${g.id}`), ...resumeButton()]);
      }
      case 'cv': {
        const parts = [p(`أعتذر، ${limit('كتابة السيرة الذاتية')}`)];
        if (pathId) {
          parts.push(p(`هل تريد معرفة المهارات التي يحسُن إبرازها لمسار ${P(pathId).ar}؟`));
          return msg('limit', parts, [btn('نعم، اعرض المهارات', `skills:${pathId}`), ...resumeButton()]);
        }
        parts.push(p('هل تريد أن نكتشف مسارك أولًا لأعرف المهارات المناسبة لإبرازها؟'));
        return msg('limit', parts, [btn('🧭 اكتشف مساري', 'discover'), ...resumeButton()]);
      }
      case 'jobs': {
        const parts = [p(`أعتذر، ${limit('البحث عن وظائف')}`)];
        parts.push(p(pathId ? `هل تريد معرفة مهارات مسار ${P(pathId).ar}؟` : 'هل تريد أن نكتشف مسارك أولًا؟'));
        return msg('limit', parts, pathId ? [btn('نعم، اعرض المهارات', `skills:${pathId}`), ...resumeButton()] : [btn('🧭 اكتشف مساري', 'discover'), ...resumeButton()]);
      }
      case 'otherMajor':
        return msg('limit', [p(`أعتذر، ${limit('تخصصات أخرى')}`), p('هل تريد التعرف على المسارات الثمانية في التخصص؟')], [btn('📚 ما المسارات المتاحة؟', 'list'), ...resumeButton()]);
      case 'general':
        return msg('limit', [
          p('أعتذر، هذا الطلب خارج نطاق عملي؛ فأنا مرشد للمسارات الوظيفية في نظم المعلومات الإدارية.'),
          p('يمكنني مساعدتك في اكتشاف مسارك، والمقارنة بين مسارين، والتدرب على المقابلات. بماذا نبدأ؟')
        ], hasResults() ? menuButtons() : welcomeButtons());
      case 'unknownPath': {
        const g = P(it.unknown.nearest);
        return msg('limit', [
          p(`مسار ${it.unknown.label} ليس ضمن قاعدة معرفتي، فالدليل يغطي ثمانية مسارات فقط.`),
          p(`أقرب مسار متاح هو ${g.ar} (${g.en})، ${it.unknown.why}`),
          p('هل تريد معرفة المزيد عنه؟')
        ], [btn(`نعم، عرّفني بـ${g.ar}`, `info:${g.id}`), btn('📚 ما المسارات المتاحة؟', 'list'), ...resumeButton()]);
      }
      case 'faqCalc': {
        if (hasResults()) {
          const e = explainCalc(primaryId(), s.scores, matrix);
          return msg('calc', [
            p(`${faqA('كيف تُحسب')}`.replace(' ويمكنني عرض الحساب بالتفصيل إذا طلبت ذلك.', '')),
            p(`تفصيل الحساب لمسار ${P(primaryId()).ar}:`),
            ul(e.terms.filter(t => t.weight > 0).map(t => `${t.criterion}: ${t.weight} × ${t.score} = ${t.product}`)),
            p(`المجموع = ${e.sum}، و${e.sum} × 2 = ${e.pct}%.`),
            p('ماذا تريد بعد ذلك؟')
          ], menuButtons());
        }
        return resume([faqA('كيف تُحسب')]);
      }
      case 'faqFinal': return resume([faqA('هل توصيتك نهائية')]);
      case 'faqChange': return resume([faqA('هل يمكنني تغيير'), 'مثال: "عدّل التحليل إلى 3".']);
      case 'faqFree': return resume([faqA('هل الشهادات المهنية مجانية')]);
      case 'faqFees': return resume([faqA('هل معلومات الرسوم')]);
      case 'faqWhy8': return resume([faqA('لماذا ثمانية')]);
      case 'faqPrivacy': return resume([faqA('هل تحتفظ')]);
      case 'edit': {
        if (!s.surveyStarted && !hasResults()) s.surveyStarted = true;
        const applied = applyScores(it.scores);
        const lines = applied.map(a => `عدّلتُ درجة ${C(a.crit).short} إلى ${a.value}.`);
        if (s.results && surveyComplete() && !applied.some(a => a.clamped)) lines.push('وأعدتُ الحساب كاملًا:');
        return proceed(lines, applied);
      }
      case 'desire': return desire(it.paths[0], it.forced);
      case 'pressureNoPath': return resume(['لا يمكنني تغيير النتيجة؛ فهي محسوبة من إجاباتك بمعادلة ثابتة. وإن رأيت أن إحدى درجاتك لا تمثّلك فعدّلها، وسأعيد الحساب.']);
      case 'discover': return discover(text);
      case 'compare': {
        if (it.paths.length >= 2) return compare(it.paths[0], it.paths[1]);
        if (it.paths.length === 1) { s.compareFirst = it.paths[0]; return comparePick(); }
        if (hasResults() && !it.paths.length && /المسارين|الاثنين/.test(nlu.normalize(text))) return compare(s.decision.primary.id, s.decision.alternative.id);
        return comparePick();
      }
      case 'list': return listPaths();
      case 'interview': return it.paths[0] ? startInterview(it.paths[0]) : interviewPick();
      case 'gap': return pathId ? gap(pathId) : needPath('gap');
      case 'plan': return pathId ? plan(pathId) : needPath('plan');
      case 'certs': return pathId ? certs(pathId) : needPath('certs');
      case 'pathInfo': return pathInfo(it.paths[0]);
      case 'menu': return resume();
      default: return resume(['لم أفهم طلبك تمامًا.']);
    }
  }

  // زر للعودة إلى المرحلة الحالية (مثلًا إكمال الاستبيان)
  function resumeButton() {
    if (s.stage === 'survey') return [btn('لنكمل الاستبيان', 'resume')];
    if (s.stage === 'tiebreak') return [btn('العودة للسؤال الحاسم', 'resume')];
    if (s.stage === 'interview') return [btn('العودة للمقابلة', 'resume')];
    if (hasResults()) return [btn('القائمة', 'menu')];
    return [btn('القائمة الرئيسية', 'resume')];
  }

  function needPath(action) {
    s.stage = 'idle';
    return msg('pickPath', [p('لأي مسار؟ اختر من القائمة، أو اكتشف مسارك أولًا.')], [...pathButtons(action), btn('🧭 اكتشف مساري', 'discover')]);
  }

  function desire(id, forced) {
    const g = P(id);
    if (!hasResults()) {
      s.desired = id;
      const line = forced
        ? `أتفهّم رغبتك في ${g.ar}، لكني لا أغيّر النتائج إرضاءً لأحد؛ سأحسب نسبتك الحقيقية معه بعد اكتمال الاستبيان وأعرضها بصدق.`
        : `سأحسب نسبة توافقك مع ${g.ar} بعد اكتمال الاستبيان وأعرضها لك.`;
      if (s.surveyStarted) return resume([line]);
      return msg('desire', [p(line), p('هل نبدأ الاستبيان الآن؟')], [btn('🧭 اكتشف مساري', 'discover'), btn(`عرّفني بـ${g.ar}`, `info:${id}`)]);
    }
    const r = pctOf(id);
    const rank = s.results.findIndex(x => x.id === id) + 1;
    const d = s.decision;
    s.stage = 'menu';
    if (d.primary.id === id) {
      return msg('desire', [p(`خبر جيد: ${g.ar} هو مسارك الرئيسي فعلًا بنسبة ${r.pct}% (${r.level.ar}).`), p(`هل تريد عرض خطة الأشهر الستة لمسار ${g.ar}؟`)],
        [btn(`نعم، اعرض خطة ${g.ar}`, `plan:${id}`), btn('القائمة', 'menu')]);
    }
    const parts = [];
    if (forced) parts.push(p('أتفهّم رغبتك، لكني لا أغيّر النتيجة إرضاءً لأحد؛ فهي محسوبة من إجاباتك بمعادلة ثابتة.'));
    parts.push(p(`نسبة توافقك الحقيقية مع ${g.ar} هي ${r.pct}% (${r.level.ar})، وترتيبه ${rank} من 8، بينما مسارك الرئيسي ${d.primary.ar} بنسبة ${d.primary.pct}%.`));
    const weak = weakPointsFor(id, s.scores, matrix);
    if (weak.length) parts.push(p(`لاحظ الفجوة: درجة ${weak[0].short} لديك ${weak[0].score}، بينما وزنها في هذا المسار ${weak[0].weight} وهو من أعلى أوزانه.`));
    parts.push(p(`هل تريد عرض خطة الأشهر الستة لمسار ${g.ar}؟`));
    return msg('desire', parts, [btn(`نعم، اعرض خطة ${g.ar}`, `plan:${id}`), btn(`تحليل الفجوة لـ${g.ar}`, `gap:${id}`), btn('القائمة', 'menu')]);
  }

  function discover(text = '') {
    if (hasResults()) return recommendationMessage(['هذه نتيجتك المحسوبة. ويمكنك تعديل أي درجة (مثل: "عدّل التحليل إلى 3")، أو بدء محادثة جديدة لإعادة الاستبيان.']);
    if (s.stage === 'tiebreak') return tiebreakMessage();
    const { levelSet, applied } = absorb(text);
    const intro = [];
    if (!s.surveyStarted) intro.push('لنكتشف مسارك معًا بخمسة أسئلة قصيرة، سؤالًا في كل مرة.');
    if (levelSet) intro.push(levelLine());
    intro.push(...announce(applied));
    return startSurvey(intro);
  }

  // ---------- معالجة نص الطالب ----------
  function handleText(text) {
    const t = String(text || '').trim();
    if (!t) return resume(['لم أفهم طلبك تمامًا.']);
    const it = nlu.detectIntent(t);
    if (it.intent === 'restart') return welcome()[0];

    switch (s.stage) {
      case 'interview':
        if (nlu.isEndInterview(t) && t.split(/\s+/).length <= 3) return endInterview();
        return interviewAnswer(t);

      case 'survey': {
        const g = currentGroup();
        if (g.key === 'skills') {
          const blocking = ['salary', 'cv', 'jobs', 'unknownCert', 'general', 'otherMajor', 'desire', 'compare', 'interview', 'list', 'faqCalc', 'faqFinal', 'faqChange', 'faqFree', 'faqFees', 'faqWhy8', 'faqPrivacy', 'edit', 'unknownPath', 'greet', 'thanks', 'pressureNoPath'];
          if (blocking.includes(it.intent)) return handleIntent(it, t);
          if (nlu.isRefusal(t)) return setSkills('', ['لا بأس، سأعتبر أنك في البداية.']);
          return setSkills(t);
        }
        if (it.intent === 'edit') return handleIntent(it, t);
        if (['salary', 'cv', 'jobs', 'unknownCert', 'guideCert', 'general', 'otherMajor', 'unknownPath', 'desire', 'pressureNoPath'].includes(it.intent)) return handleIntent(it, t);
        const { levelSet, applied } = absorb(t, g);
        if (levelSet || applied.length) {
          s.turn++;
          const intro = [];
          if (levelSet) intro.push(g.key === 'level' ? `شكرًا. ${levelLine()}` : levelLine());
          const react = reaction(applied.filter(a => a.source === 'number'));
          if (react) intro.push(react);
          intro.push(...announce(applied));
          return proceed(intro, applied);
        }
        if (nlu.isRefusal(t)) return refusal(g);
        if (it.intent !== 'unknown') return handleIntent(it, t);
        return resume(['لم أفهم طلبك تمامًا.']);
      }

      case 'confirmClamp': {
        if (nlu.isYes(t)) return handleAction('clamp:yes');
        if (nlu.isNo(t)) return handleAction('clamp:no');
        const { scores } = nlu.extractScores(t, s.clampQueue);
        if (Object.keys(scores).length) {
          const applied = applyScores(scores);
          s.clampQueue = s.clampQueue.filter(c => !applied.find(a => a.crit === c && !a.clamped));
          s.stage = 'survey';
          return proceed([...applied.filter(a => !a.clamped).map(a => `اعتمدتُ درجة ${C(a.crit).short} = ${a.value}.`)], applied);
        }
        return it.intent !== 'unknown' ? handleIntent(it, t) : resume(['لم أفهم طلبك تمامًا.']);
      }

      case 'tiebreak': {
        const choice = tiebreakChoice(t);
        if (choice) return resolveTie(choice);
        if (it.intent === 'unknown') return resume(['لم أفهم طلبك تمامًا.']);
        return handleIntent(it, t);
      }

      case 'comparePick': {
        const ids = it.paths;
        if (ids.length >= 2) return compare(ids[0], ids[1]);
        if (ids.length === 1) {
          if (s.compareFirst && s.compareFirst !== ids[0]) return compare(s.compareFirst, ids[0]);
          s.compareFirst = ids[0];
          return comparePick();
        }
        return it.intent === 'unknown' ? resume(['لم أفهم طلبك تمامًا.']) : handleIntent(it, t);
      }

      case 'interviewPick':
        if (it.paths.length) return startInterview(it.paths[0]);
        return it.intent === 'unknown' ? resume(['لم أفهم طلبك تمامًا.']) : handleIntent(it, t);

      case 'askLevel': {
        const lv = nlu.extractLevel(t, { bare: true });
        if (lv) { s.level = lv.level; return plan(s.pendingPlan); }
        return it.intent === 'unknown' ? resume(['لم أفهم طلبك تمامًا.']) : handleIntent(it, t);
      }

      case 'welcome':
      case 'idle':
      default: {
        if (['unknown', 'greet', 'discover'].includes(it.intent)) {
          const probe = nlu.extractScores(t);
          const lvl = nlu.extractLevel(t);
          if (Object.keys(probe.scores).length || lvl) return discover(t);
          if (it.intent === 'discover') return discover(t);
        }
        return handleIntent(it, t);
      }
    }
  }

  function tiebreakChoice(text) {
    const d = s.decision;
    const ids = [d.first.id, d.second.id];
    const named = nlu.findPaths(text).filter(id => ids.includes(id));
    if (named.length === 1) return named[0];
    const t = nlu.normalize(text);
    if (/(^|\s)(الاول|الاولى|الخيار الاول|1|first)(\s|$)/.test(t)) return d.first.id;
    if (/(^|\s)(الثاني|الثانيه|الخيار الثاني|2|second)(\s|$)/.test(t)) return d.second.id;
    const words = id => new Set(nlu.normalize(decisiveQuestion(d).labels[id]).split(' ').filter(w => w.length > 3));
    const score = id => [...words(id)].filter(w => nlu.hasKey(text, w)).length;
    const [a, b] = ids.map(score);
    if (a > b) return ids[0];
    if (b > a) return ids[1];
    return null;
  }

  function refusal(g) {
    const key = g.key;
    s.attempts[key] = (s.attempts[key] || 0) + 1;
    if (s.attempts[key] === 1) return askQuestion(g, ['لا بأس، سأعيد السؤال مرة واحدة فقط.']);
    if (g.key === 'level') {
      s.level = '12';
      return proceed(['لا بأس، سأعتمد خطة المستوى المبتدئ (سنة 1–3)، ويمكنك تغييرها بذكر مستواك في أي وقت.']);
    }
    const miss = missingCrits(g);
    miss.forEach(c => { s.scores[c - 1] = 3; s.sources[c] = 'default'; s.defaulted.push(c); });
    return proceed(miss.map(c => `اعتبرتُ درجة ${C(c).short} = 3 (محايد) لعدم الإجابة، وسأذكر ذلك في النتيجة.`));
  }

  function setSkills(text, intro = []) {
    s.skills = text;
    const { known, none } = nlu.extractSkills(text);
    s.turn++;
    if (known.length) intro.push(`رائع، سجّلتُ مهاراتك: ${known.join('، ')}.`);
    else if (!intro.length) intro.push(none || !text ? 'لا بأس، البداية من الصفر طبيعية.' : 'شكرًا، سجّلتُ إجابتك.');
    if (s.pendingGap) { const id = s.pendingGap; s.pendingGap = null; if (!surveyComplete()) return gap(id); }
    return proceed(intro);
  }

  // ---------- معالجة الأزرار ----------
  function handleAction(action, payload) {
    const [name, arg] = String(action).split(':');
    const id = arg ? Number(arg) : null;
    switch (name) {
      case 'restart': return welcome()[0];
      case 'discover': return discover();
      case 'compare': s.compareFirst = null; return comparePick();
      case 'list': return listPaths();
      case 'interview': return interviewPick();
      case 'resume': return resume();
      case 'menu': return resume();
      case 'lvl': {
        s.level = arg;
        if (s.stage === 'askLevel') return plan(s.pendingPlan);
        s.turn++;
        return proceed([`شكرًا. ${levelLine()}`]);
      }
      case 'rate': {
        const scores = Object.fromEntries(Object.entries(payload || {}).map(([c, v]) => [c, { value: Number(v), raw: Number(v), source: 'number', clamped: false }]));
        const applied = applyScores(scores);
        s.turn++;
        const react = reaction(applied);
        return proceed(react ? [react] : [], applied);
      }
      case 'skills':
        if (arg === 'none') return setSkills('لا شيء بعد');
        return msg('skills', [p(`المهارات المطلوبة لمسار ${P(id).ar} كما في الدليل، وهي ما يحسُن إبرازه:`), ul(P(id).skills), p(afterQuestion())], afterButtons());
      case 'clamp':
        if (arg === 'yes') {
          const c = s.clampQueue; s.clampQueue = [];
          s.stage = 'survey';
          return proceed([`اعتمدتُ درجة ${c.map(x => `${C(x).short} = ${s.scores[x - 1]}`).join(' و')}.`]);
        }
        s.clampQueue.forEach(c => { s.scores[c - 1] = null; });
        s.clampQueue = [];
        s.surveyStarted = true;
        return proceed(['حسنًا، اكتب الدرجة من 1 إلى 5.']);
      case 'tb': return resolveTie(id);
      case 'gap': return gap(id || primaryId());
      case 'plan': return plan(id || primaryId());
      case 'certs': return certs(id || primaryId());
      case 'compare2': return compare(s.decision.primary.id, s.decision.alternative.id);
      case 'mock': return startInterview(primaryId());
      case 'cmp': {
        if (s.compareFirst && s.compareFirst !== id) return compare(s.compareFirst, id);
        s.compareFirst = id;
        return comparePick();
      }
      case 'int': return startInterview(id);
      case 'info': return pathInfo(id);
      case 'endInterview': return s.interview ? endInterview() : resume();
      default: return resume(['لم أفهم طلبك تمامًا.']);
    }
  }

  return {
    start: () => welcome(),
    /** input: { text } أو { action, payload } */
    handle(input) {
      const out = input.action ? handleAction(input.action, input.payload) : handleText(input.text);
      return Array.isArray(out) ? out : [out];
    },
    get state() { return s; },
    nlu
  };
}

/** تحميل ملفات البيانات (في المتصفح عبر fetch، وفي Node عبر دالة قراءة) */
export async function loadData(readJson) {
  const [matrix, paths, questionnaire, faq, keywords] = await Promise.all(
    ['matrix', 'paths', 'questionnaire', 'faq_limits', 'keywords'].map(n => readJson(`data/${n}.json`)));
  return { matrix, paths, questionnaire, faq, keywords };
}
