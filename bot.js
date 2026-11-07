// آلة حالات المحادثة في بوصلة. لا تعتمد على المتصفح: تستقبل نص الطالب أو زرًّا، وتعيد رسائل الوكيل.
// كل رسالة: { tag, html, buttons: [{label, action, append?}], ratings?: [{crit, label}] }
import { rankPaths, decide, resolveClose, topContributors, topWeighted, explainCalc, weakPointsFor } from './engine.js';
import { createNLU } from './nlu.js';
import { STRINGS, UNKNOWN_PATHS_EN } from './i18n.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p = text => `<p>${esc(text)}</p>`;
const ul = items => `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
const firstSentence = t => (t.match(/^.+?\.(?=\s|$)/) || [t])[0];

const GROUPS = [
  { key: 'level', q: 1 },
  { key: 'r2', q: 2, crits: [1, 2] },
  { key: 'r3', q: 3, crits: [3, 4] },
  { key: 'r4', q: 4, crits: [5, 6, 7] },
  { key: 'skills', q: 5 }
];
const LEVEL_PLAN = { '12': 'beginner', '3': 'beginner', '4': 'advanced' };
const LEVEL_CODES = ['12', '3', '4'];

export function createBot(data, { lang = 'ar' } = {}) {
  const L = STRINGS[lang] || STRINGS.ar;
  const T = L.t;
  const local = lang === 'en' && data.en ? data.en : data;
  const { matrix, keywords: KW } = data;
  const { paths: guide, questionnaire: Q, faq: F } = local;
  const nlu = createNLU(KW, matrix);
  const P = id => guide.paths.find(x => x.id === id);
  const name = id => P(id).ar;
  const crit = id => L.crit[id];
  const lvl = key => L.level[key];
  const critLabel = id => Q.questions.flatMap(q => q.criteria || []).find(c => c.criterion === id).label;
  const limit = i => F.limits[i].reply;
  const faqA = i => F.faq[i].a;
  const feesNote = () => guide.notes[1].replace(/^الرسوم: /, '');
  const joinAnd = arr => arr.join(L.and);
  const joinList = arr => arr.join(L.list);
  const skillLabel = l => (lang === 'en' ? KW.generalSkills.find(x => x.label === l)?.en || l : l);
  let s;

  function reset() {
    s = {
      stage: 'welcome', surveyStarted: false, level: null, scores: Array(7).fill(null), sources: {},
      defaulted: [], attempts: {}, skills: null, scaleShown: false, results: null, decision: null,
      desired: null, clampQueue: [], compareFirst: null, interview: null, pendingPlan: null, pendingGap: null, turn: 0
    };
  }
  reset();

  // ---------- أدوات الرسائل ----------
  const msg = (tag, parts, buttons = [], extra = {}) => ({ tag, html: parts.filter(Boolean).join(''), buttons, ...extra });
  const btn = (label, action, extra = {}) => ({ label, action, ...extra });
  const welcomeButtons = () => F.buttons.map((b, i) => btn(b.label, ['discover', 'compare', 'list', 'interview'][i]));
  const menuButtons = () => [
    btn(L.b.gap, 'gap'), btn(L.b.plan, 'plan'), btn(L.b.certs, 'certs'), btn(L.b.compare2, 'compare2'), btn(L.b.mock, 'mock')
  ];
  const levelButtons = () => Q.questions[0].options.map((o, i) => btn(o.label, `lvl:${LEVEL_CODES[i]}`));
  const pathButtons = (action, exclude = []) => guide.paths.filter(x => !exclude.includes(x.id)).map(x => btn(x.ar, `${action}:${x.id}`));
  const hasResults = () => !!(s.results && s.decision && s.decision.primary);
  const primaryId = () => (hasResults() ? s.decision.primary.id : null);
  const afterButtons = () => (hasResults() ? menuButtons() : welcomeButtons());
  const afterQuestion = () => (hasResults() ? T.afterResults : T.afterNoResults);
  const resultOf = id => s.results && s.results.find(r => r.id === id);
  const idleStage = () => (hasResults() ? 'menu' : 'idle');

  // ---------- الترحيب ----------
  function welcome() {
    reset();
    return msg('welcome', [p(F.welcome.paragraphs[0]), p(T.welcomeHelp), p(T.startWhat)], welcomeButtons());
  }

  // ---------- الاستبيان ----------
  const missingCrits = g => g.crits.filter(c => s.scores[c - 1] == null);
  const groupDone = g => (g.key === 'level' ? s.level != null : g.key === 'skills' ? s.skills != null : !missingCrits(g).length);
  const currentGroup = () => GROUPS.find(g => !groupDone(g));
  const surveyComplete = () => !currentGroup();

  function askQuestion(g, intro = []) {
    s.stage = 'survey';
    const head = intro.map(p);
    if (g.key === 'level') return msg('q1', [...head, p(T.qHead(1, Q.questions[0].title))], levelButtons(), { progress: 1 });
    if (g.key === 'skills') {
      return msg('q5', [...head, p(T.qHead(5, Q.questions[4].title)), p(T.skillsHint)], [
        ...L.skillChips.map(l => btn(l, 'append', { append: true })),
        btn(L.b.none, 'skills:none')
      ], { progress: 5 });
    }
    const missing = missingCrits(g);
    const parts = [...head];
    parts.push(p(missing.length < g.crits.length ? T.qPartial(g.q) : T.qHead(g.q, Q.questions[g.q - 1].title)));
    parts.push(ul(missing.map(critLabel)));
    if (!s.scaleShown) { parts.push(p(L.shortScale)); s.scaleShown = true; }
    return msg(`q${g.q}`, parts, [], { ratings: missing.map(c => ({ crit: c, label: critLabel(c) })), progress: g.q });
  }

  function reaction(applied) {
    if (!applied.length) return null;
    const top = [...applied].sort((a, b) => b.value - a.value)[0];
    const bucket = top.value >= 5 ? 5 : top.value === 4 ? 4 : top.value === 3 ? 3 : 'low';
    const list = L.reactions[bucket];
    return list[s.turn % list.length].replace('{c}', crit(top.crit));
  }

  /** يطبّق الدرجات المستخرجة ويعيد ما تغيّر */
  function applyScores(scores) {
    const applied = [];
    for (const [k, v] of Object.entries(scores)) {
      const c = Number(k);
      const prev = s.scores[c - 1];
      s.scores[c - 1] = v.value;
      s.sources[c] = v.source;
      s.defaulted = s.defaulted.filter(x => x !== c);
      applied.push({ crit: c, prev, ...v });
    }
    return applied;
  }

  const announce = applied => applied.filter(a => a.source === 'word' && !a.clamped).map(a => T.announce(crit(a.crit), a.value));

  /** يستخرج من النص كل ما يخص ملف الطالب: المستوى والدرجات */
  function absorb(text, g) {
    const lv = nlu.extractLevel(text, { bare: g && g.key === 'level' });
    const expected = g && g.crits ? missingCrits(g) : [];
    const { scores } = nlu.extractScores(text, expected);
    let levelSet = false;
    if (lv && s.level !== lv.level) { s.level = lv.level; levelSet = true; }
    return { levelSet, applied: applyScores(scores) };
  }

  const levelLine = () => (LEVEL_PLAN[s.level] === 'advanced' ? T.levelAdvanced : T.levelBeginner);

  /** يكمل المسار: السؤال التالي، أو تأكيد رقم خارج المقياس، أو النتائج */
  function proceed(intro = [], applied = []) {
    const clamped = applied.filter(a => a.clamped);
    if (clamped.length) {
      s.clampQueue = clamped.map(a => a.crit);
      s.stage = 'confirmClamp';
      return msg('clamp', [
        ...intro.map(p),
        ...clamped.map(a => p(T.clamped(crit(a.crit), a.raw, a.value))),
        p(clamped.length > 1 ? T.confirmMany : T.confirmOne)
      ], [btn(L.b.confirmYes, 'clamp:yes'), btn(L.b.confirmNo, 'clamp:no')]);
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
      const tag = primary && r.id === primary ? `<em class="tag tag-main">${T.tagMain}</em>` : alternative && r.id === alternative ? `<em class="tag tag-alt">${T.tagAlt}</em>` : '';
      return `<div class="row" data-path="${r.id}" data-pct="${r.pct}"><div class="row-head"><span class="name">${esc(name(r.id))}</span>${tag}<span class="pct">${r.pct}%</span><span class="badge lv-${r.level.key}">${lvl(r.level.key)}</span></div><div class="bar"><i class="lv-${r.level.key}" style="--w:${r.pct}%"></i></div></div>`;
    }).join('');
    return `<div class="results" role="table" aria-label="${L.ui.resultsAria}">${rows}</div>`;
  }

  function reasonLines(d) {
    const top = topContributors(d.primary.id, s.scores, matrix);
    const why = joinAnd(top.map(t => T.reasonTerm(crit(t.id), t.weight, t.score)));
    const altTop = topContributors(d.alternative.id, s.scores, matrix, 1)[0];
    return [T.reason(name(d.primary.id), why), T.altReason(name(d.alternative.id), d.alternative.pct, crit(altTop.id), altTop.score)];
  }

  const defaultedNote = () => (s.defaulted.length ? [T.defaulted(joinAnd(s.defaulted.map(crit)))] : []);

  function notesLines() {
    const out = defaultedNote();
    if (s.desired && s.decision.primary && s.desired !== s.decision.primary.id) {
      const r = resultOf(s.desired);
      let line = T.desiredNote(name(r.id), r.pct, lvl(r.level.key));
      const weak = weakPointsFor(s.desired, s.scores, matrix);
      if (weak.length) line += T.gapNote(crit(weak[0].id), weak[0].score, weak[0].weight);
      out.push(line);
    }
    return out;
  }

  function decisiveQuestion(d) {
    const [a, b] = [d.first.id, d.second.id];
    if (a + b === 3 && a * b === 2) return { text: L.daBi.text, labels: { 1: L.daBi[1], 2: L.daBi[2] } };
    const fa = L.focus[a], fb = L.focus[b];
    const cap = t => (lang === 'en' ? t.charAt(0).toUpperCase() + t.slice(1) : t);
    return { text: T.dqGeneric(fa, fb), labels: { [a]: cap(fa), [b]: cap(fb) } };
  }

  const tieButtons = () => {
    const dq = decisiveQuestion(s.decision);
    return [btn(dq.labels[s.decision.first.id], `tb:${s.decision.first.id}`), btn(dq.labels[s.decision.second.id], `tb:${s.decision.second.id}`)];
  };

  function tiebreakMessage(intro = []) {
    const d = s.decision;
    s.stage = 'tiebreak';
    return msg('tiebreak', [
      ...intro.map(p),
      resultsCard(),
      p(T.close(name(d.first.id), d.first.pct, name(d.second.id), d.second.pct, d.gap)),
      ...defaultedNote().map(p),
      p(T.decide(decisiveQuestion(d).text))
    ], tieButtons());
  }

  function recommendationMessage(intro = [], tag = 'results') {
    const d = s.decision;
    s.stage = 'menu';
    const parts = [...intro.map(p)];
    if (tag === 'results') parts.push(resultsCard(d.primary.id, d.alternative.id));
    if (d.type === 'weak') parts.push(p(T.weak(name(d.primary.id), d.primary.pct, name(d.alternative.id), d.alternative.pct)));
    else parts.push(p(T.main(name(d.primary.id), d.primary.pct, lvl(d.primary.level.key), name(d.alternative.id), d.alternative.pct, lvl(d.alternative.level.key))));
    parts.push(...reasonLines(d).map(p));
    parts.push(...notesLines().map(p));
    parts.push(`<p class="disclaimer">${esc(F.disclaimer)}</p>`);
    parts.push(p(T.afterResults));
    return msg(tag, parts, menuButtons(), { share: true });
  }

  function showResults(intro = []) {
    s.results = rankPaths(s.scores, matrix);
    s.decision = decide(s.results);
    if (s.decision.type === 'close') return tiebreakMessage(intro);
    return recommendationMessage(intro, 'results');
  }

  function resolveTie(id) {
    s.decision = resolveClose(s.decision, id);
    return recommendationMessage([T.resolved(name(s.decision.primary.id), name(s.decision.alternative.id))], 'resolved');
  }

  // ---------- التفاصيل عند الطلب ----------
  function gap(id) {
    if (s.skills == null) {
      s.pendingGap = id;
      return askQuestion(GROUPS[4], [T.gapNeedSkills]);
    }
    const g = P(id);
    const res = nlu.gapAnalysis(id, s.skills, g);
    const known = nlu.extractSkills(s.skills).known;
    const pathKeys = KW.paths[id].skillKeys.flat();
    const extra = known.filter(l => !KW.generalSkills.find(x => x.label === l).keys.some(k => pathKeys.includes(k)));
    const have = res.filter(r => r.has).length;
    s.stage = idleStage();
    return msg('gap', [
      p(T.gapHead(g.ar)),
      `<ul class="checklist">${res.map(r => `<li class="${r.has ? 'ok' : 'miss'}">${r.has ? '✅' : '❌'} ${esc(r.label)} — ${r.has ? T.has : T.miss}</li>`).join('')}</ul>`,
      extra.length ? p(T.otherSkills(joinList(extra.map(skillLabel)))) : '',
      p(T.haveCount(have, res.length) + (have < res.length ? T.planHelps : '')),
      p(afterQuestion())
    ], afterButtons());
  }

  function plan(id) {
    if (!s.level) {
      s.pendingPlan = id;
      s.stage = 'askLevel';
      return msg('askLevel', [p(T.askLevelPlan(Q.questions[0].title))], levelButtons());
    }
    const g = P(id);
    const kind = LEVEL_PLAN[s.level];
    s.stage = idleStage();
    return msg('plan', [
      p(T.planHead(g.ar, L.planLabel[kind])),
      ul(g.plan[kind].map(r => T.month(r.months, r.text))),
      p(afterQuestion())
    ], afterButtons());
  }

  function certs(id) {
    const g = P(id);
    s.stage = idleStage();
    return msg('certs', [
      p(T.certsHead(g.ar)),
      ul(g.certifications.map(c => `${c.name}: ${c.details}`)),
      p(T.freeHead),
      ul(g.freeResources.map(c => `${c.name}: ${c.details}`)),
      p(feesNote()),
      p(afterQuestion())
    ], afterButtons());
  }

  function compare(a, b) {
    const A = P(a), B = P(b);
    const pctCell = id => { const r = resultOf(id); return r ? `${r.pct}% (${lvl(r.level.key)})` : T.notYet; };
    const top = id => joinList(topWeighted(id, matrix, 2).map(c => `${crit(c.id)} (${c.weight})`));
    const rows = [
      [T.rows[0], A.description, B.description],
      [T.rows[1], joinList(A.skills.slice(0, 3)), joinList(B.skills.slice(0, 3))],
      [T.rows[2], top(a), top(b)],
      [T.rows[3], A.certifications[0].name, B.certifications[0].name],
      [T.rows[4], pctCell(a), pctCell(b)]
    ];
    s.stage = idleStage();
    s.compareFirst = null;
    return msg('compare', [
      p(T.compareHead(A.ar, B.ar)),
      `<div class="table-wrap"><table class="compare"><thead><tr><th>${T.itemCol}</th><th>${esc(A.ar)}</th><th>${esc(B.ar)}</th></tr></thead><tbody>${rows.map(r => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`,
      p(afterQuestion())
    ], afterButtons());
  }

  function comparePick(intro = []) {
    s.stage = 'comparePick';
    if (s.compareFirst) return msg('comparePick', [...intro.map(p), p(T.pickSecond(name(s.compareFirst)))], pathButtons('cmp', [s.compareFirst]));
    return msg('comparePick', [...intro.map(p), p(T.pickFirst)], pathButtons('cmp'));
  }

  function listPaths() {
    s.stage = 'idle';
    return msg('list', [
      p(T.listHead),
      `<ol class="paths">${guide.paths.map(g => `<li><strong>${esc(g.ar === g.en ? g.en : `${g.ar} (${g.en})`)}</strong>: ${esc(firstSentence(g.description))}</li>`).join('')}</ol>`,
      p(T.listQ)
    ], [btn(L.b.discoverYes, 'discover'), btn(L.b.compare, 'compare'), btn(L.b.interview, 'interview')]);
  }

  function pathInfo(id) {
    const g = P(id);
    s.stage = idleStage();
    const r = resultOf(id);
    return msg('pathInfo', [
      p(g.ar === g.en ? `${g.en}: ${g.description}` : `${g.ar} (${g.en}): ${g.description}`),
      p(T.traits(g.traits)),
      r ? p(T.yourPct(r.pct, lvl(r.level.key))) : '',
      p(T.whatAbout)
    ], [btn(L.b.plan, `plan:${id}`), btn(L.b.certs, `certs:${id}`), btn(L.b.mock, `int:${id}`), hasResults() ? btn(L.b.menu, 'menu') : btn(L.b.discover, 'discover')]);
  }

  // ---------- المقابلة التجريبية ----------
  function interviewPick() {
    s.stage = 'interviewPick';
    return msg('interviewPick', [p(T.interviewPick)], pathButtons('int'));
  }

  function startInterview(id) {
    s.interview = { id, q: 0 };
    s.stage = 'interview';
    const g = P(id);
    return msg('interviewQ', [p(T.interviewIntro(g.ar)), p(T.iq(1, g.interview[0]))], [btn(L.b.endInterview, 'endInterview')]);
  }

  function feedback(answer) {
    const { id, q } = s.interview;
    const e = nlu.evaluateAnswer(answer, id, q);
    // بالإنجليزية تُعرض المصطلحات اللاتينية فقط
    const shown = arr => (lang === 'en' ? arr.filter(k => /^[\x20-\x7E]+$/.test(k)) : arr);
    const hitsShown = shown(e.hits), sugShown = shown(e.suggestions);
    let strength;
    if (e.hits.length >= 2 && hitsShown.length) strength = T.sTerms(joinList(hitsShown.slice(0, 2)));
    else if (e.hits.length >= 2) strength = T.sDetailed;
    else if (e.hasExample) strength = T.sExample;
    else if (e.hits.length === 1 && hitsShown.length) strength = T.sOneTerm(hitsShown[0]);
    else if (e.words >= 25) strength = T.sDetailed;
    else if (e.words >= 8) strength = T.sDirect;
    else strength = T.sStart;
    let improve;
    if (!e.hasExample) improve = T.iExample;
    else if (e.hits.length < 2 && sugShown.length) improve = T.iTerms(joinList(sugShown.slice(0, 2)));
    else if (e.words < 25) improve = T.iExpand;
    else improve = T.iResult;
    return [T.strength(strength), T.improve(improve)];
  }

  function interviewAnswer(text) {
    const fb = feedback(text);
    const g = P(s.interview.id);
    s.interview.q += 1;
    if (s.interview.q < 3) return msg('interviewQ', [...fb.map(p), p(T.iq(s.interview.q + 1, g.interview[s.interview.q]))], [btn(L.b.endInterview, 'endInterview')]);
    return endInterview(fb);
  }

  function endInterview(fb = []) {
    const g = P(s.interview.id);
    s.interview = null;
    s.stage = idleStage();
    return msg('interviewEnd', [...fb.map(p), p(T.interviewEnd(g.ar, afterQuestion()))], afterButtons());
  }

  // ---------- إعادة عرض المرحلة الحالية ----------
  function resume(intro = []) {
    switch (s.stage) {
      case 'survey': return askQuestion(currentGroup() || GROUPS[4], intro);
      case 'confirmClamp': return msg('clamp', [...intro.map(p), p(T.confirmList(joinAnd(s.clampQueue.map(c => `${crit(c)} = ${s.scores[c - 1]}`))))], [btn(L.b.confirmYes, 'clamp:yes'), btn(L.b.confirmNo, 'clamp:no')]);
      case 'tiebreak': return msg('tiebreak', [...intro.map(p), p(decisiveQuestion(s.decision).text)], tieButtons());
      case 'comparePick': return comparePick(intro);
      case 'interviewPick': return msg('interviewPick', [...intro.map(p), p(T.interviewPick)], pathButtons('int'));
      case 'interview': return msg('interviewQ', [...intro.map(p), p(T.iq(s.interview.q + 1, P(s.interview.id).interview[s.interview.q]))], [btn(L.b.endInterview, 'endInterview')]);
      case 'askLevel': return msg('askLevel', [...intro.map(p), p(T.askLevelPlan(Q.questions[0].title))], levelButtons());
      case 'welcome': return msg('welcomeAgain', [...intro.map(p), p(T.startWhat)], welcomeButtons());
      default: return msg('menu', [...intro.map(p), p(afterQuestion())], afterButtons());
    }
  }

  // زر للعودة إلى المرحلة الحالية (مثلًا إكمال الاستبيان)
  function resumeButton() {
    if (s.stage === 'survey') return [btn(L.b.resumeSurvey, 'resume')];
    if (s.stage === 'tiebreak') return [btn(L.b.resumeTie, 'resume')];
    if (s.stage === 'interview') return [btn(L.b.resumeInterview, 'resume')];
    if (hasResults()) return [btn(L.b.menu, 'menu')];
    return [btn(L.b.mainMenu, 'resume')];
  }

  // ---------- النوايا العامة ----------
  function handleIntent(it, text) {
    const pathId = it.paths[0] || primaryId();
    switch (it.intent) {
      case 'restart': return welcome();
      case 'greet': return resume([T.greet]);
      case 'thanks': return resume([T.thanksReply]);
      case 'salary': {
        const alt = pathId ? T.salaryAltPath(name(pathId)) : T.salaryAlt;
        return msg('limit', [p(`${T.notAvailable} ${limit(1)}`), p(T.officialSites), p(`${alt} ${T.wantThat}`)],
          pathId ? [btn(L.b.showCerts, `certs:${pathId}`), ...resumeButton()] : [btn(L.b.list, 'list'), ...resumeButton()]);
      }
      case 'unknownCert': {
        const g = P(it.cert.path);
        return msg('limit', [p(T.certUnknown), p(T.certNearest(joinList(g.certifications.map(c => c.name)), g.ar)), p(T.certOfficial)],
          [btn(L.b.showDetails, `certs:${g.id}`), ...resumeButton()]);
      }
      case 'guideCert': {
        const g = P(it.cert.path);
        const c = g.certifications[it.cert.index];
        return msg('guideCert', [p(T.guideCert(c.name, g.ar, c.details)), p(feesNote()), p(T.wantResources)], [btn(L.b.showResources, `certs:${g.id}`), ...resumeButton()]);
      }
      case 'cv':
        if (pathId) return msg('limit', [p(T.sorry(limit(2))), p(T.cvSkillsQ(name(pathId)))], [btn(L.b.showSkills, `skills:${pathId}`), ...resumeButton()]);
        return msg('limit', [p(T.sorry(limit(2))), p(T.cvDiscoverQ)], [btn(L.b.discover, 'discover'), ...resumeButton()]);
      case 'jobs':
        return msg('limit', [p(T.sorry(limit(0))), p(pathId ? T.jobsSkillsQ(name(pathId)) : T.discoverFirstQ)],
          pathId ? [btn(L.b.showSkills, `skills:${pathId}`), ...resumeButton()] : [btn(L.b.discover, 'discover'), ...resumeButton()]);
      case 'otherMajor':
        return msg('limit', [p(T.sorry(limit(3))), p(T.otherMajorQ)], [btn(L.b.list, 'list'), ...resumeButton()]);
      case 'general':
        return msg('limit', [p(T.general1), p(T.general2)], hasResults() ? menuButtons() : welcomeButtons());
      case 'unknownPath': {
        const g = P(it.unknown.nearest);
        const i = KW.unknownPaths.indexOf(it.unknown);
        const label = lang === 'en' ? UNKNOWN_PATHS_EN[i].label : it.unknown.label;
        const why = lang === 'en' ? UNKNOWN_PATHS_EN[i].why : it.unknown.why;
        return msg('limit', [p(T.unknownPath(label)), p(T.nearestPath(g.ar, g.en, why)), p(T.moreAbout)],
          [btn(L.b.introduce(g.ar), `info:${g.id}`), btn(L.b.list, 'list'), ...resumeButton()]);
      }
      case 'faqCalc': {
        if (hasResults()) {
          const e = explainCalc(primaryId(), s.scores, matrix);
          return msg('calc', [
            p(faqA(0).replace(T.calcStrip, '')),
            p(T.calcHead(name(primaryId()))),
            ul(e.terms.map((t, i) => ({ ...t, id: i + 1 })).filter(t => t.weight > 0).map(t => `${crit(t.id)}: ${t.weight} × ${t.score} = ${t.product}`)),
            p(T.calcSum(e.sum, e.pct)),
            p(T.afterResults)
          ], menuButtons());
        }
        return resume([faqA(0)]);
      }
      case 'faqFinal': return resume([faqA(1)]);
      case 'faqChange': return resume([faqA(2), T.editExample]);
      case 'faqFree': return resume([faqA(3)]);
      case 'faqFees': return resume([faqA(4)]);
      case 'faqWhy8': return resume([faqA(5)]);
      case 'faqPrivacy': return resume([faqA(7)]);
      case 'edit': {
        s.surveyStarted = true;
        const applied = applyScores(it.scores);
        const lines = applied.map(a => T.edited(crit(a.crit), a.value));
        if (s.results && surveyComplete() && !applied.some(a => a.clamped)) lines.push(T.recalculated);
        return proceed(lines, applied);
      }
      case 'desire': return desire(it.paths[0], it.forced);
      case 'pressureNoPath': return resume([T.noChange]);
      case 'discover': return discover(text);
      case 'compare': {
        if (it.paths.length >= 2) return compare(it.paths[0], it.paths[1]);
        if (it.paths.length === 1) { s.compareFirst = it.paths[0]; return comparePick(); }
        if (hasResults() && /المسارين|الاثنين|both|two paths/.test(nlu.normalize(text))) return compare(s.decision.primary.id, s.decision.alternative.id);
        return comparePick();
      }
      case 'list': return listPaths();
      case 'interview': return it.paths[0] ? startInterview(it.paths[0]) : interviewPick();
      case 'gap': return pathId ? gap(pathId) : needPath('gap');
      case 'plan': return pathId ? plan(pathId) : needPath('plan');
      case 'certs': return pathId ? certs(pathId) : needPath('certs');
      case 'pathInfo': return pathInfo(it.paths[0]);
      case 'menu': return resume();
      default: return resume([T.notUnderstood]);
    }
  }

  function needPath(action) {
    s.stage = 'idle';
    return msg('pickPath', [p(T.needPath)], [...pathButtons(action), btn(L.b.discover, 'discover')]);
  }

  function desire(id, forced) {
    const g = P(id);
    if (!hasResults()) {
      s.desired = id;
      const line = forced ? T.desireForcedPre(g.ar) : T.desireSoftPre(g.ar);
      if (s.surveyStarted) return resume([line]);
      return msg('desire', [p(line), p(T.startNowQ)], [btn(L.b.discover, 'discover'), btn(L.b.introduceShort(g.ar), `info:${id}`)]);
    }
    const r = resultOf(id);
    const rank = s.results.findIndex(x => x.id === id) + 1;
    const d = s.decision;
    s.stage = 'menu';
    if (d.primary.id === id) {
      return msg('desire', [p(T.desireIsMain(g.ar, r.pct, lvl(r.level.key))), p(T.planQ(g.ar))], [btn(L.b.planOf(g.ar), `plan:${id}`), btn(L.b.menu, 'menu')]);
    }
    const parts = [];
    if (forced) parts.push(p(T.noChangeShort));
    parts.push(p(T.truePct(g.ar, r.pct, lvl(r.level.key), rank, name(d.primary.id), d.primary.pct)));
    const weak = weakPointsFor(id, s.scores, matrix);
    if (weak.length) parts.push(p(T.gapNoteLine(crit(weak[0].id), weak[0].score, weak[0].weight)));
    parts.push(p(T.planQ(g.ar)));
    return msg('desire', parts, [btn(L.b.planOf(g.ar), `plan:${id}`), btn(L.b.gapOf(g.ar), `gap:${id}`), btn(L.b.menu, 'menu')]);
  }

  function discover(text = '') {
    if (hasResults()) return recommendationMessage([T.alreadyResults]);
    if (s.stage === 'tiebreak') return tiebreakMessage();
    const { levelSet, applied } = absorb(text);
    const intro = [];
    if (!s.surveyStarted) intro.push(T.surveyIntro);
    if (levelSet) intro.push(levelLine());
    intro.push(...announce(applied));
    return startSurvey(intro);
  }

  // ---------- معالجة نص الطالب ----------
  const SKILLS_BLOCKING = ['salary', 'cv', 'jobs', 'unknownCert', 'general', 'otherMajor', 'desire', 'compare', 'interview', 'list', 'faqCalc', 'faqFinal', 'faqChange', 'faqFree', 'faqFees', 'faqWhy8', 'faqPrivacy', 'edit', 'unknownPath', 'greet', 'thanks', 'pressureNoPath'];
  const SURVEY_INTERRUPTS = ['salary', 'cv', 'jobs', 'unknownCert', 'guideCert', 'general', 'otherMajor', 'unknownPath', 'desire', 'pressureNoPath'];

  function handleText(text) {
    const t = String(text || '').trim();
    if (!t) return resume([T.notUnderstood]);
    const it = nlu.detectIntent(t);
    if (it.intent === 'restart') return welcome();
    const fallback = () => (it.intent === 'unknown' ? resume([T.notUnderstood]) : handleIntent(it, t));

    switch (s.stage) {
      case 'interview':
        if (nlu.isEndInterview(t) && t.split(/\s+/).length <= 3) return endInterview();
        return interviewAnswer(t);

      case 'survey': {
        const g = currentGroup();
        if (g.key === 'skills') {
          if (SKILLS_BLOCKING.includes(it.intent)) return handleIntent(it, t);
          if (nlu.isRefusal(t)) return setSkills('', [T.skillsRefused]);
          return setSkills(t);
        }
        if (it.intent === 'edit' || SURVEY_INTERRUPTS.includes(it.intent)) return handleIntent(it, t);
        const { levelSet, applied } = absorb(t, g);
        if (levelSet || applied.length) {
          s.turn++;
          const intro = [];
          if (levelSet) intro.push(g.key === 'level' ? `${T.thanks} ${levelLine()}` : levelLine());
          const react = reaction(applied.filter(a => a.source === 'number'));
          if (react) intro.push(react);
          intro.push(...announce(applied));
          return proceed(intro, applied);
        }
        if (nlu.isRefusal(t)) return refusal(g);
        return fallback();
      }

      case 'confirmClamp': {
        if (nlu.isYes(t)) return handleAction('clamp:yes');
        if (nlu.isNo(t)) return handleAction('clamp:no');
        const { scores } = nlu.extractScores(t, s.clampQueue);
        if (Object.keys(scores).length) {
          const applied = applyScores(scores);
          s.clampQueue = s.clampQueue.filter(c => !applied.find(a => a.crit === c && !a.clamped));
          s.stage = 'survey';
          return proceed(applied.filter(a => !a.clamped).map(a => T.confirmedValue(crit(a.crit), a.value)), applied);
        }
        return fallback();
      }

      case 'tiebreak': {
        const choice = tiebreakChoice(t);
        if (choice) return resolveTie(choice);
        return fallback();
      }

      case 'comparePick': {
        const ids = it.paths;
        if (ids.length >= 2) return compare(ids[0], ids[1]);
        if (ids.length === 1) {
          if (s.compareFirst && s.compareFirst !== ids[0]) return compare(s.compareFirst, ids[0]);
          s.compareFirst = ids[0];
          return comparePick();
        }
        return fallback();
      }

      case 'interviewPick':
        if (it.paths.length) return startInterview(it.paths[0]);
        return fallback();

      case 'askLevel': {
        const lv = nlu.extractLevel(t, { bare: true });
        if (lv) { s.level = lv.level; return plan(s.pendingPlan); }
        return fallback();
      }

      default: {
        if (['unknown', 'greet', 'discover'].includes(it.intent)) {
          const probe = nlu.extractScores(t);
          if (Object.keys(probe.scores).length || nlu.extractLevel(t)) return discover(t);
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
    const labels = decisiveQuestion(d).labels;
    const score = id => [...new Set(nlu.normalize(labels[id]).split(' ').filter(w => w.length > 3))].filter(w => nlu.hasKey(text, w)).length;
    const [a, b] = ids.map(score);
    if (a > b) return ids[0];
    if (b > a) return ids[1];
    return null;
  }

  function refusal(g) {
    s.attempts[g.key] = (s.attempts[g.key] || 0) + 1;
    if (s.attempts[g.key] === 1) return askQuestion(g, [T.reaskOnce]);
    if (g.key === 'level') {
      s.level = '12';
      return proceed([T.levelDefault]);
    }
    const miss = missingCrits(g);
    miss.forEach(c => { s.scores[c - 1] = 3; s.sources[c] = 'default'; s.defaulted.push(c); });
    return proceed(miss.map(c => T.defaultedNow(crit(c))));
  }

  function setSkills(text, intro = []) {
    s.skills = text;
    const { known, none } = nlu.extractSkills(text);
    s.turn++;
    if (known.length) intro.push(T.skillsSaved(joinList(known.map(skillLabel))));
    else if (!intro.length) intro.push(none || !text ? T.skillsNone : T.skillsNoted);
    if (s.pendingGap) {
      const id = s.pendingGap;
      s.pendingGap = null;
      if (!surveyComplete()) return gap(id);
    }
    return proceed(intro);
  }

  // ---------- معالجة الأزرار ----------
  function handleAction(action, payload) {
    const [nm, arg] = String(action).split(':');
    const id = arg ? Number(arg) : null;
    switch (nm) {
      case 'restart': return welcome();
      case 'discover': return discover();
      case 'compare': s.compareFirst = null; return comparePick();
      case 'list': return listPaths();
      case 'interview': return interviewPick();
      case 'resume':
      case 'menu': return resume();
      case 'lvl': {
        s.level = arg;
        if (s.stage === 'askLevel') return plan(s.pendingPlan);
        s.turn++;
        return proceed([`${T.thanks} ${levelLine()}`]);
      }
      case 'rate': {
        const scores = Object.fromEntries(Object.entries(payload || {}).map(([c, v]) => [c, { value: Number(v), raw: Number(v), source: 'number', clamped: false }]));
        const applied = applyScores(scores);
        s.turn++;
        const react = reaction(applied);
        return proceed(react ? [react] : [], applied);
      }
      case 'skills':
        if (arg === 'none') return setSkills(T.none);
        return msg('skills', [p(T.skillsOf(name(id))), ul(P(id).skills), p(afterQuestion())], afterButtons());
      case 'clamp':
        if (arg === 'yes') {
          const c = s.clampQueue;
          s.clampQueue = [];
          s.stage = 'survey';
          return proceed([T.confirmedList(joinAnd(c.map(x => `${crit(x)} = ${s.scores[x - 1]}`)))]);
        }
        s.clampQueue.forEach(c => { s.scores[c - 1] = null; });
        s.clampQueue = [];
        s.surveyStarted = true;
        return proceed([T.writeScore]);
      case 'tb': return resolveTie(id);
      case 'gap': return gap(id || primaryId());
      case 'plan': return plan(id || primaryId());
      case 'certs': return certs(id || primaryId());
      case 'compare2': return compare(s.decision.primary.id, s.decision.alternative.id);
      case 'mock': return startInterview(primaryId());
      case 'cmp':
        if (s.compareFirst && s.compareFirst !== id) return compare(s.compareFirst, id);
        s.compareFirst = id;
        return comparePick();
      case 'int': return startInterview(id);
      case 'info': return pathInfo(id);
      case 'endInterview': return s.interview ? endInterview() : resume();
      default: return resume([T.notUnderstood]);
    }
  }

  return {
    lang,
    start: () => [welcome()],
    /** input: { text } أو { action, payload } */
    handle(input) {
      const out = input.action ? handleAction(input.action, input.payload) : handleText(input.text);
      return Array.isArray(out) ? out : [out];
    },
    /** ملخص نصي للنتيجة (للنسخ والمشاركة) */
    summary() {
      if (!s.results) return '';
      const lines = s.results.map(r => `${name(r.id)}: ${r.pct}% (${lvl(r.level.key)})`);
      if (hasResults()) lines.unshift(T.main(name(s.decision.primary.id), s.decision.primary.pct, lvl(s.decision.primary.level.key), name(s.decision.alternative.id), s.decision.alternative.pct, lvl(s.decision.alternative.level.key)), '');
      return [L.ui.brand + ' 🧭', ...lines, '', F.disclaimer].join('\n');
    },
    get state() { return s; },
    nlu
  };
}

/** تحميل ملفات البيانات (في المتصفح عبر fetch، وفي Node عبر دالة قراءة) */
export async function loadData(readJson) {
  const names = ['matrix', 'paths', 'questionnaire', 'faq_limits', 'keywords'];
  const [matrix, paths, questionnaire, faq, keywords, enPaths, enQ, enF] = await Promise.all([
    ...names.map(n => readJson(`data/${n}.json`)),
    ...['paths', 'questionnaire', 'faq_limits'].map(n => readJson(`data/en/${n}.json`))
  ]);
  return { matrix, paths, questionnaire, faq, keywords, en: { paths: enPaths, questionnaire: enQ, faq: enF } };
}
