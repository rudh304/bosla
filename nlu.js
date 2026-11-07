// فهم لغة الطالب: تطبيع النص العربي، واستخراج الدرجات والمستوى، وكشف النوايا.
// كل شيء هنا مطابقة كلمات مفتاحية ومرادفات (فصحى + عامية سعودية + إنجليزي)، بلا أي نموذج لغوي.

const CLAUSE = ' | ';

/** تطبيع النص: إزالة التشكيل والتطويل، وتوحيد الهمزات والتاء المربوطة والألف المقصورة، وتحويل الأرقام العربية */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[،,؛;.!?؟\n]+/g, CLAUSE)
    .replace(/[:"'«»()[\]{}…_*~`<>=]/g, ' ')
    .replace(/([^\d\s|])\1{2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripClauses = t => t.replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** صيغ الكلمة بعد نزع السوابق الشائعة (و، ف، ب، ل، ك، ال) */
function variants(token) {
  const out = new Set([token]);
  let t = token;
  if (t.length > 2 && t.startsWith('و')) { t = t.slice(1); out.add(t); }
  if (t.length > 2 && /^[فبلك]/.test(t)) {
    const u = t.slice(1);
    out.add(u);
    if (u.startsWith('ال') && u.length > 3) out.add(u.slice(2));
  }
  if (t.startsWith('ال') && t.length > 3) out.add(t.slice(2));
  if (t.startsWith('لل') && t.length > 3) out.add(t.slice(2));
  return out;
}

const stem = k => (k.startsWith('ال') && k.length > 3 ? k.slice(2) : k);

/** هل يحتوي النص المطبَّع على المفتاح؟ (المفاتيح متعددة الكلمات بالمطابقة الجزئية، والمفردة بمطابقة الكلمة) */
export function hasKey(normText, key) {
  const k = normalize(key);
  if (!k) return false;
  const text = stripClauses(normText);
  if (k.includes(' ') || /[+\-/]/.test(k)) {
    if (/^[a-z0-9 +\-/]+$/.test(k)) return new RegExp(`(^|[^a-z0-9])${k.replace(/[+\-/]/g, m => '\\' + m)}($|[^a-z0-9+])`).test(text);
    return text.includes(k);
  }
  const ks = stem(k);
  return text.split(' ').some(tok => {
    for (const v of variants(tok)) if (v === k || stem(v) === ks) return true;
    return false;
  });
}

/** موضع أول ظهور للمفتاح (لترتيب المسارات المذكورة) */
function keyIndex(normText, key) {
  const k = normalize(key);
  const text = stripClauses(normText);
  if (k.includes(' ')) return text.indexOf(k);
  const toks = text.split(' ');
  let pos = 0;
  for (const tok of toks) {
    for (const v of variants(tok)) if (v === k || stem(v) === stem(k)) return pos;
    pos += tok.length + 1;
  }
  return -1;
}

const anyKey = (normText, keys) => keys.some(k => hasKey(normText, k));

export function createNLU(keywords, matrix) {
  const criteriaKeys = matrix.criteria.map(c => [...new Set([...(keywords.criteria[c.id] || []), normalize(c.ar), normalize(c.short)])]);
  const multiWordCriteria = criteriaKeys
    .flatMap(keys => keys.filter(k => k.includes(' ')).map(k => [k, keys.find(x => !x.includes(' '))]))
    .sort((a, b) => b[0].length - a[0].length);
  const dialect = keywords.dialect.map(g => ({ score: g.score, phrases: g.phrases.map(normalize) }));
  const numberWords = Object.entries(keywords.numberWords).flatMap(([n, ws]) => ws.map(w => [normalize(w), Number(n)]));
  const pathNames = Object.entries(keywords.paths).map(([id, p]) => ({
    id: Number(id), names: (p.names || []).map(normalize), tokens: (p.nameTokens || []).map(normalize)
  }));

  // ---------- المستوى الدراسي ----------
  const LEVEL_PATTERNS = [
    { level: '4', re: /(?:سنه|السنه|سنتي|year)\s*(?:ال)?(?:رابعه|4|اربعه)|4(?:th)? year|fourth year|(?:^|\s)(?:خريج|خريجه|متخرج|متخرجه|تخرجت|graduated?|grad|senior)(?=\s|$)/ },
    { level: '3', re: /(?:سنه|السنه|سنتي|year)\s*(?:ال)?(?:ثالثه|3|ثلاث)|3(?:rd)? year|third year|(?:^|\s)junior(?=\s|$)/ },
    { level: '12', re: /(?:سنه|السنه|سنتي|year)\s*(?:ال)?(?:اولى|اول|ثانيه|ثاني|1|2)|(?:1st|2nd|first|second) year|(?:^|\s)(?:freshman|sophomore)(?=\s|$)/ }
  ];
  const ORD = { اول: 1, ثاني: 2, ثالث: 3, رابع: 4, خامس: 5, سادس: 6, سابع: 7, ثامن: 8 };

  /** يستخرج المستوى الدراسي: '12' (سنة 1–2) أو '3' أو '4' (سنة 4 أو خريج) */
  function extractLevel(text, { bare = false } = {}) {
    const t = stripClauses(normalize(text));
    for (const p of LEVEL_PATTERNS) {
      const m = t.match(p.re);
      if (m) return { level: p.level, match: m[0].trim() };
    }
    // المستويات الجامعية (1–8): 1–4 ← سنة 1–2، و5–6 ← سنة 3، و7–8 ← سنة 4
    const lv = t.match(/(?:المستوي|مستوي|المستوى|مستوى|level)\s*(?:ال)?(\d|اول|ثاني|ثالث|رابع|خامس|سادس|سابع|ثامن)/);
    if (lv) {
      const n = Number(lv[1]) || ORD[lv[1]];
      if (n >= 1 && n <= 8) return { level: n <= 4 ? '12' : n <= 6 ? '3' : '4', match: lv[0] };
    }
    if (bare) {
      const b = t.match(/(?:^|\s)(?:ال)?(اولى|اول|ثانيه|ثاني|ثالثه|ثالث|رابعه|رابع|[1-4])(?=\s|$)/);
      if (b) {
        const w = b[1];
        const level = /^(اولى|اول|ثانيه|ثاني|1|2)$/.test(w) ? '12' : /^(ثالثه|ثالث|3)$/.test(w) ? '3' : '4';
        return { level, match: b[0].trim() };
      }
    }
    return null;
  }

  // ---------- الدرجات ----------
  function criterionOf(token) {
    for (let i = 0; i < criteriaKeys.length; i++) {
      for (const k of criteriaKeys[i]) {
        if (k.includes(' ')) continue;
        const ks = stem(k);
        for (const v of variants(token)) if (v === k || stem(v) === ks) return i + 1;
      }
    }
    return 0;
  }

  /** قيمة مقطع نصي: رقم صريح أو كلمة رقمية أو وصف عامي */
  function valueOf(segText) {
    const t = segText.replace(/(\d+)\s*(?:\/|من|out of)\s*(?:5|10)(?!\d)/g, '$1');
    const num = t.match(/(?:^|[^\d])(-?\d{1,3})(?!\d)/);
    if (num) {
      const raw = Number(num[1]);
      const value = Math.min(5, Math.max(1, raw));
      return { value, raw, source: 'number', clamped: value !== raw };
    }
    const toks = t.split(' ');
    for (const [w, n] of numberWords) {
      if (toks.some(tok => [...variants(tok)].includes(w))) return { value: n, raw: n, source: 'number', clamped: false };
    }
    const padded = ' ' + toks.map(tok => (tok.length > 2 && tok.startsWith('و') && !tok.startsWith('واجد') ? tok.slice(1) : tok)).join(' ') + ' ';
    for (const g of dialect) {
      for (const ph of g.phrases) {
        if (padded.includes(' ' + ph + ' ')) return { value: g.score, raw: g.score, source: 'word', phrase: ph, clamped: false };
      }
    }
    return null;
  }

  /** يحذف أسماء المسارات من النص حتى لا تُفهم كلماتها (مثل "تقنية" و"أعمال") كمعايير */
  function stripPathNames(t) {
    let out = ' ' + t + ' ';
    for (const p of pathNames) for (const n of p.names) if (n.includes(' ')) out = out.split(n).join(' ');
    return out.replace(/\s+/g, ' ').trim();
  }

  const BREAKERS = new Set(['بس', 'لكن', 'but', 'however', 'اما', 'وبس', 'ولكن']);

  /**
   * يستخرج درجات المعايير من نص حر.
   * expected: أرقام المعايير المنتظرة في السؤال الحالي (للأرقام المجردة مثل "2 4").
   * يعيد { scores: {criterionId: {value, raw, source, clamped}}, mentioned: [ids بلا قيمة] }
   */
  function extractScores(text, expected = []) {
    let t = normalize(text);
    const lvl = extractLevel(text);
    if (lvl) t = t.replace(lvl.match, ' ');
    t = stripPathNames(t);
    // العبارات متعددة الكلمات ("فهم الاعمال"، "الكلام مع الناس") تُستبدل بكلمة المعيار المفردة
    for (const [phrase, single] of multiWordCriteria) t = t.split(phrase).join(single);
    const scores = {};
    const mentionedNoValue = [];

    // تقسيم إلى مقاطع: كل مقطع يحوي معيارًا واحدًا وقيمته
    const segments = [];
    for (const clause of t.split('|')) {
      let seg = { crit: 0, tokens: [] };
      const push = () => { if (seg.tokens.length || seg.crit) segments.push(seg); };
      for (const tok of clause.trim().split(' ').filter(Boolean)) {
        if (BREAKERS.has(tok)) { push(); seg = { crit: 0, tokens: [] }; continue; }
        const c = criterionOf(tok);
        const segHasValue = seg.crit && valueOf(seg.tokens.join(' '));
        if (c && seg.crit && c !== seg.crit) { push(); seg = { crit: c, tokens: [] }; continue; }
        if (c && !seg.crit) { seg.crit = c; continue; }
        if (c) continue;
        if (segHasValue && tok.startsWith('و') && tok.length > 2) { push(); seg = { crit: 0, tokens: [] }; }
        seg.tokens.push(tok);
      }
      push();
    }
    // مقطع فيه معيار بلا قيمة ولا كلمات أخرى يرث قيمة المقطع التالي ("البرمجة والتحليل 4")
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (!s.crit) continue;
      let v = valueOf(s.tokens.join(' '));
      if (!v && s.tokens.length === 0 && segments[i + 1]?.crit) v = valueOf(segments[i + 1].tokens.join(' '));
      if (v) scores[s.crit] = v; else if (!mentionedNoValue.includes(s.crit)) mentionedNoValue.push(s.crit);
    }

    // أرقام مجردة بلا ذكر معايير ("2 4" أو "1 2 5 5 4 2 1")
    if (!Object.keys(scores).length && !mentionedNoValue.length) {
      const flat = stripClauses(t).replace(/(\d+)\s*(?:\/|من|out of)\s*(?:5|10)(?!\d)/g, '$1');
      const nums = [...flat.matchAll(/(?:^|[^\d])(-?\d{1,3})(?!\d)/g)].map(m => Number(m[1]));
      const all = /(?:^|\s)(كلها|كلهم|الكل|الاثنين|الثنتين|all|both)(?=\s|$)/.test(flat);
      if (nums.length === 7) {
        nums.forEach((n, i) => { scores[i + 1] = mk(n); });
      } else if (nums.length && expected.length) {
        if (all && nums.length === 1) expected.forEach(c => { scores[c] = mk(nums[0]); });
        else nums.slice(0, expected.length).forEach((n, i) => { scores[expected[i]] = mk(n); });
      } else if (expected.length) {
        const v = valueOf(flat);
        if (v) (all ? expected : expected.slice(0, 1)).forEach(c => { scores[c] = { ...v }; });
      }
    }
    return { scores, mentioned: mentionedNoValue };
  }
  const mk = n => {
    const value = Math.min(5, Math.max(1, n));
    return { value, raw: n, source: 'number', clamped: value !== n };
  };

  // ---------- المسارات ----------
  /** المسارات المذكورة في النص بترتيب ظهورها */
  function findPaths(text) {
    const t = normalize(text);
    const found = [];
    for (const p of pathNames) {
      let idx = -1;
      for (const n of p.names) {
        const i = n.includes(' ') ? stripClauses(t).indexOf(n) : keyIndex(t, n);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
      }
      for (const n of p.tokens) {
        const i = keyIndex(t, n);
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
      }
      if (idx >= 0) found.push({ id: p.id, idx });
    }
    return found.sort((a, b) => a.idx - b.idx).map(f => f.id);
  }

  // ---------- المهارات (السؤال 5) وتحليل الفجوة ----------
  const NONE_RE = /(?:^|\s)(لا شي|لا شيء|ولا شي|ما اعرف شي|ما عندي|لا يوجد|nothing|none|لا شيء بعد|لا شي بعد)(?=\s|$)/;
  function extractSkills(text) {
    const t = normalize(text);
    const known = keywords.generalSkills.filter(s => anyKey(t, s.keys)).map(s => s.label);
    return { known, none: NONE_RE.test(stripClauses(t)) && !known.length };
  }

  /** يقارن مهارات الطالب بمهارات المسار في الدليل */
  function gapAnalysis(pathId, skillsText, guidePath) {
    const t = normalize(skillsText || '');
    const aid = keywords.paths[pathId];
    return guidePath.skills.map((label, i) => ({
      label,
      has: anyKey(t, aid.skillKeys[i] || []),
      optional: (aid.optionalSkills || []).includes(i)
    }));
  }

  // ---------- تقييم إجابة المقابلة ----------
  const EXAMPLE_KEYS = ['مثلا', 'مثال', 'على سبيل', 'في مشروع', 'مشروع', 'قمت', 'عملت', 'اشتغلت', 'سويت', 'طبقت', 'تجربتي', 'تجربه', 'خبرتي', 'في الجامعه', 'في التدريب', 'في النادي', 'مره من المرات', 'for example', 'e.g', 'i worked', 'in my project', 'once'];
  function evaluateAnswer(answer, pathId, qIndex) {
    const t = normalize(answer);
    const words = stripClauses(t).split(' ').filter(Boolean).length;
    const keys = keywords.paths[pathId].interviewKeys[qIndex] || [];
    const hits = keys.filter(k => hasKey(t, k));
    const hasExample = anyKey(t, EXAMPLE_KEYS);
    return { words, hits, hasExample, suggestions: keys.filter(k => !hits.includes(k)).slice(0, 3) };
  }

  // ---------- النوايا ----------
  const K = {
    restart: ['محادثه جديده', 'ابدا من جديد', 'من البدايه', 'restart', 'start over', 'ابدا من الصفر'],
    greet: ['السلام عليكم', 'سلام', 'مرحبا', 'هلا', 'اهلا', 'hello', 'hi', 'hey', 'صباح الخير', 'مساء الخير'],
    thanks: ['شكرا', 'يعطيك العافيه', 'مشكور', 'thanks', 'thank you', 'جزاك الله خير'],
    cv: ['سيره ذاتيه', 'السيره الذاتيه', 'سيرتي', 'سي في', 'cv', 'resume', 'رزومه'],
    jobs: ['وظائف', 'وظايف', 'شاغره', 'شاغر', 'توظيف', 'ابحث لي عن وظيفه', 'دور لي وظيفه', 'قدم لي على', 'jobs', 'hiring', 'job openings'],
    salary: ['راتب', 'رواتب', 'الراتب', 'معاش', 'salary', 'salaries', 'كم يعطون', 'كم يدفعون'],
    otherMajor: ['الطب', 'طب', 'طبيب', 'تمريض', 'صيدله', 'هندسه مدنيه', 'هندسه ميكانيكيه', 'هندسه كهربائيه', 'الهندسه', 'مهندس مدني', 'محاماه', 'قانون', 'medicine', 'nursing', 'civil engineering', 'law school'],
    general: ['طقس', 'الطقس', 'الجو', 'واجب', 'واجبي', 'الواجب', 'حل الواجب', 'homework', 'assignment', 'نكته', 'وصفه', 'طبخ', 'مباراه', 'كوره', 'weather', 'ترجم', 'translate', 'اكتب لي مقال', 'قصيده'],
    faqCalc: ['كيف تحسب', 'كيف تنحسب', 'كيف حسبت', 'كيف تم الحساب', 'طريقه الحساب', 'المعادله', 'how do you calculate', 'how is it calculated', 'اعرض الحساب', 'تفاصيل الحساب', 'الحساب بالتفصيل', 'وضح الحساب'],
    faqFinal: ['نهائيه', 'نهائي', 'قرار نهائي', 'final'],
    faqChange: ['اغير اجاباتي', 'تغيير اجاباتي', 'اعدل اجاباتي', 'اقدر اغير', 'اقدر اعدل', 'يمكنني تغيير', 'change my answers'],
    faqFees: ['الرسوم دقيقه', 'دقه الرسوم', 'الرسوم محدثه', 'الاسعار دقيقه', 'الرسوم صحيحه'],
    faqWhy8: ['ليش ثمان', 'ليش ثمانيه', 'لماذا ثمانيه', 'لماذا ثمان', 'ليش 8', 'لماذا 8', 'why 8', 'why eight', 'ثمانيه مسارات فقط', 'بس ثمان'],
    faqPrivacy: ['تحتفظ ببياناتي', 'بياناتي', 'خصوصيه', 'خصوصيتي', 'privacy', 'تحفظ معلوماتي'],
    free: ['مجانيه', 'مجاني', 'مجانا', 'ببلاش', 'free'],
    edit: ['عدل', 'عدلي', 'غير', 'غيري', 'صحح', 'خل', 'خلي', 'اجعل', 'حط', 'بدل', 'change', 'set', 'update', 'edit'],
    pressure: ['غصب', 'بالقوه', 'لازم', 'اجعلني', 'خلني', 'خليني', 'حطني', 'غيرها', 'غير النتيجه', 'make me', 'force'],
    desire: ['ابغى اكون', 'ابي اكون', 'اريد ان اكون', 'اريد ان اصبح', 'ابغى اصير', 'ابي اصير', 'حاب اكون', 'نفسي اكون', 'ابغاه', 'ابيه', 'اريده', 'i want to be', 'اريد ان', 'ابغى', 'ابي', 'اريد', 'حاب'],
    discover: ['اكتشف مساري', 'اكتشف', 'مساري', 'يناسبني', 'تناسبني', 'المناسب لي', 'الانسب لي', 'ساعدني اختار', 'ساعدني في اختيار', 'محتار', 'احتار', 'وش اختار', 'discover', 'suit me', 'suits me', 'ابدا الاستبيان', 'نبدا'],
    compare: ['قارن', 'مقارنه', 'الفرق بين', 'فرق بين', 'وش الفرق', 'ايش الفرق', 'compare', 'comparison', 'vs', 'versus'],
    list: ['المسارات المتاحه', 'ما المسارات', 'وش المسارات', 'ايش المسارات', 'المسارات الثمانيه', 'اعرض المسارات', 'كل المسارات', 'المسارات الموجوده', 'available paths', 'list paths', 'المسارات'],
    interview: ['مقابله', 'مقابلات', 'انترفيو', 'interview'],
    gap: ['الفجوه', 'فجوه', 'gap', 'ينقصني', 'تنقصني', 'المهارات الناقصه', 'مهارات ناقصه', 'وش ينقصني', 'نواقصي'],
    plan: ['خطه', 'الخطه', 'plan', 'سته اشهر', '6 اشهر', 'الاشهر السته', 'roadmap'],
    certs: ['شهاده', 'شهادات', 'الشهادات', 'مصادر', 'المصادر', 'دورات', 'كورسات', 'كورس', 'certificate', 'certification', 'certifications', 'courses', 'resources'],
    menu: ['القائمه', 'رجوع', 'ارجع', 'back', 'menu', 'الخيارات'],
    yes: ['نعم', 'اي', 'ايه', 'ايوه', 'ايوا', 'yes', 'اكيد', 'تمام', 'اوكي', 'ok', 'موافق', 'اكد', 'اؤكد', 'نعم اؤكد'],
    no: ['لا', 'no', 'لا شكرا', 'مو لازم'],
    refuse: ['تخطي', 'تخطى', 'سكيب', 'skip', 'pass', 'ما ابغى اجاوب', 'ما ابي اجاوب', 'ما ودي', 'مدري', 'ما ادري', 'لا ادري', 'لا اريد الاجابه', 'بدون اجابه', 'no answer', 'i dont know', 'dont know', 'idk', 'ما ابغى اقيم', 'ما ابي اقيم', 'لا اعرف كيف اقيم'],
    endInterview: ['انهاء المقابله', 'انهي المقابله', 'وقف المقابله', 'خلاص', 'يكفي', 'stop', 'end interview']
  };

  const is = (t, name) => anyKey(t, K[name]);

  /** يكشف النية الرئيسية للرسالة مع تفاصيلها */
  function detectIntent(text) {
    const t = normalize(text);
    const words = stripClauses(t).split(' ').filter(Boolean);
    const paths = findPaths(text);
    const res = (intent, extra = {}) => ({ intent, paths, ...extra });

    if (is(t, 'restart')) return res('restart');

    // شهادات: من الدليل أو غير موجودة فيه
    const guideCert = keywords.guideCerts.find(c => anyKey(t, c.keys));
    const unknownCert = keywords.unknownCerts.find(c => anyKey(t, c.keys));
    if (unknownCert && !guideCert) return res('unknownCert', { cert: unknownCert });

    if (is(t, 'cv')) return res('cv');
    if (is(t, 'salary')) return res('salary');
    if (is(t, 'jobs')) return res('jobs');

    const unknownPath = keywords.unknownPaths.find(p => anyKey(t, p.keys));
    if (unknownPath && !paths.length) return res('unknownPath', { unknown: unknownPath });
    if (is(t, 'otherMajor') && !paths.length) return res('otherMajor');
    if (is(t, 'general') && !paths.length) return res('general');

    if (guideCert && !is(t, 'compare')) return res('guideCert', { cert: guideCert });

    if (is(t, 'faqCalc')) return res('faqCalc');
    if (is(t, 'faqWhy8')) return res('faqWhy8');
    if (is(t, 'faqFees')) return res('faqFees');
    if (is(t, 'faqPrivacy')) return res('faqPrivacy');
    if (is(t, 'faqChange')) return res('faqChange');
    if (is(t, 'free') && is(t, 'certs') && !hasKey(t, 'مصادر')) return res('faqFree');
    if (is(t, 'faqFinal') && words.length <= 8) return res('faqFinal');

    // تعديل درجة: فعل تعديل + معيار + رقم
    const ex = extractScores(text);
    const scoreIds = Object.keys(ex.scores).map(Number);
    if (is(t, 'edit') && scoreIds.length && !paths.length) return res('edit', { scores: ex.scores });

    if (is(t, 'compare') && (paths.length || !is(t, 'list'))) return res('compare');
    if (is(t, 'interview')) return res('interview');
    if (is(t, 'gap')) return res('gap');
    if (is(t, 'plan')) return res('plan');
    if (is(t, 'certs')) return res('certs');

    if (paths.length && (is(t, 'pressure') || is(t, 'desire'))) return res('desire', { forced: is(t, 'pressure') });
    if (is(t, 'pressure') && !scoreIds.length) return res('pressureNoPath');

    if (is(t, 'discover')) return res('discover');
    if (is(t, 'list')) return res('list');
    if (paths.length === 1 && words.length <= 4) return res('pathInfo');
    if (is(t, 'menu')) return res('menu');
    if (words.length <= 4 && is(t, 'thanks')) return res('thanks');
    if (words.length <= 4 && is(t, 'greet')) return res('greet');
    return res('unknown');
  }

  return {
    normalize, extractLevel, extractScores, findPaths, extractSkills, gapAnalysis,
    evaluateAnswer, detectIntent, valueOf: s => valueOf(stripClauses(normalize(s))),
    isYes: s => { const t = normalize(s); return is(t, 'yes') && !is(t, 'no'); },
    isNo: s => { const t = stripClauses(normalize(s)); return /^(لا|no|لا شكرا|مو لازم)$/.test(t); },
    isRefusal: s => is(normalize(s), 'refuse'),
    isEndInterview: s => is(normalize(s), 'endInterview'),
    hasKey: (s, k) => hasKey(normalize(s), k)
  };
}
